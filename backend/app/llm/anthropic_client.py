"""Claude implementation of `LLMClient` (official Anthropic SDK, async, streaming)."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import anthropic

from app.core.config import Settings
from app.llm.base import (
    AgentResult,
    LLMClient,
    LLMError,
    LLMRateLimitError,
    LLMRefusalError,
    LLMUnavailableError,
    RunCallbacks,
    T,
    Tier,
    Tool,
    ToolCallRecord,
    UnconfiguredLLM,
    execute_tool,
)
from app.observability import metrics, tracing

log = logging.getLogger(__name__)

# `fallbacks: "default"` lets the API re-run a safety-classifier refusal on
# Anthropic's recommended fallback model inside the same request.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
_THINKING_TYPES = {"thinking", "redacted_thinking"}
_USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def build_llm(settings: Settings) -> LLMClient:
    """Return a Claude client, or a placeholder when no credentials can be found."""
    has_credentials = bool(
        settings.anthropic_api_key
        or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        or os.environ.get("ANTHROPIC_PROFILE")
        or (Path.home() / ".config" / "anthropic").exists()
    )
    if not has_credentials:
        return UnconfiguredLLM()
    return AnthropicLLM(settings)


def _block_to_dict(block: Any) -> dict[str, Any]:
    if isinstance(block, dict):
        return block
    return block.model_dump(mode="json", exclude_none=True)


@contextmanager
def _llm_span(purpose: str, model: str, tier: str, max_tokens: int, *, structured: bool = False) -> Iterator[Any]:
    """`llm.request` span around one Claude request (GenAI semantic conventions). No-op when OTel is off."""
    attributes = {
        "gen_ai.system": "anthropic",
        "gen_ai.provider.name": "anthropic",
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": model,
        "gen_ai.request.max_tokens": max_tokens,
        "evently.llm.purpose": purpose,
        "evently.llm.tier": tier,
        "evently.llm.structured_output": structured,
    }
    with tracing.start_span("llm.request", attributes) as span:
        try:
            yield span
        except Exception as exc:
            span.record_exception(exc)
            span.set_error(f"{type(exc).__name__}: {exc}")
            raise


def _record_response(span: Any, model: str, response: Any) -> None:
    """Token usage + stop reason onto the span and the `evently.llm.*` metrics."""
    usage = {key: getattr(response.usage, key, 0) or 0 for key in _USAGE_KEYS}
    stop_reason = getattr(response, "stop_reason", None)
    span.set_attributes(
        {
            "gen_ai.response.model": getattr(response, "model", None),
            "gen_ai.response.id": getattr(response, "id", None),
            "gen_ai.response.finish_reasons": [stop_reason] if stop_reason else None,
            "gen_ai.usage.input_tokens": usage["input_tokens"],
            "gen_ai.usage.output_tokens": usage["output_tokens"],
            "gen_ai.usage.cache_read_input_tokens": usage["cache_read_input_tokens"],
            "gen_ai.usage.cache_creation_input_tokens": usage["cache_creation_input_tokens"],
        }
    )
    metrics.llm_request(model, stop_reason)
    metrics.llm_tokens(model, usage)


def _persistable(role: str, content: Any) -> dict[str, Any]:
    """JSON-safe copy of a message with thinking blocks removed.

    Thinking blocks are only valid in the exact conversation that produced
    them, so history replayed on a later request must not carry them.
    """
    if isinstance(content, str):
        return {"role": role, "content": content}
    blocks = [_block_to_dict(b) for b in content]
    return {"role": role, "content": [b for b in blocks if b.get("type") not in _THINKING_TYPES]}


class AnthropicLLM(LLMClient):
    available = True

    def __init__(self, settings: Settings, client: anthropic.AsyncAnthropic | None = None) -> None:
        self._settings = settings
        if client is not None:
            self._client = client
        elif settings.anthropic_api_key:
            self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        else:
            self._client = anthropic.AsyncAnthropic()  # env token / `ant auth login` profile

    # -- request plumbing ---------------------------------------------------

    def _resolve(self, tier: Tier, model: str | None, effort: str | None) -> tuple[str, str]:
        s = self._settings
        if tier == "orchestrator":
            return model or s.llm_orchestrator_model, effort or s.llm_orchestrator_effort
        return model or s.llm_worker_model, effort or s.llm_worker_effort

    def _request(self, model: str, effort: str, system: str, max_tokens: int) -> tuple[Any, dict[str, Any]]:
        """Pick the SDK namespace and build the kwargs shared by every request."""
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            # The system prompt is the stable prefix: cache it.
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort},
        }
        # Haiku has no server-side fallback, so the parameter is left off there.
        if self._settings.llm_refusal_fallbacks and "haiku" not in model:
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"
            return self._client.beta.messages, kwargs
        return self._client.messages, kwargs

    @staticmethod
    def _translate(exc: Exception) -> LLMError:
        if isinstance(exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError):
            return LLMUnavailableError(f"Claude rejected the configured credentials: {exc}")
        if isinstance(exc, anthropic.RateLimitError):
            return LLMRateLimitError("Claude is rate limiting requests; try again shortly.")
        if isinstance(exc, anthropic.APIStatusError):
            return LLMError(f"Claude API error {exc.status_code}: {exc.message}")
        if isinstance(exc, anthropic.APIConnectionError):
            return LLMError("Could not reach the Claude API.")
        return LLMError(str(exc))

    async def _stream_turn(self, api: Any, kwargs: dict[str, Any], callbacks: RunCallbacks | None) -> Any:
        """One streamed request. Retries when the SDK cannot parse a streamed tool input."""
        for attempt in range(3):
            try:
                async with api.stream(**kwargs) as stream:
                    async for event in stream:
                        if (
                            callbacks
                            and callbacks.on_text
                            and event.type == "content_block_delta"
                            and event.delta.type == "text_delta"
                        ):
                            await callbacks.on_text(event.delta.text)
                    return await stream.get_final_message()
            except ValueError:
                # Unparseable tool-input JSON raised from the stream iterator: there
                # is no tool_use id to answer, so re-issue the turn.
                if attempt == 2:
                    raise LLMError("Claude produced an unparseable tool call three times.") from None
                log.warning("unparseable streamed tool input; retrying turn")
            except anthropic.APIError as exc:
                raise self._translate(exc) from exc
        raise AssertionError("unreachable")

    # -- LLMClient ----------------------------------------------------------

    async def run(
        self,
        *,
        purpose: str,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[Tool] | None = None,
        server_tools: list[dict[str, Any]] | None = None,
        tier: Tier = "worker",
        model: str | None = None,
        effort: str | None = None,
        max_tokens: int = 16000,
        max_turns: int = 16,
        callbacks: RunCallbacks | None = None,
    ) -> AgentResult:
        model, effort = self._resolve(tier, model, effort)
        api, kwargs = self._request(model, effort, system, max_tokens)
        tool_map = {t.name: t for t in tools or []}
        tool_defs = [t.to_api() for t in tool_map.values()] + list(server_tools or [])
        if tool_defs:
            kwargs["tools"] = tool_defs

        history: list[dict[str, Any]] = list(messages)
        result = AgentResult(text="", stop_reason="max_turns", usage=dict.fromkeys(_USAGE_KEYS, 0))

        for _ in range(max_turns):
            with _llm_span(purpose, model, tier, max_tokens) as span:
                response = await self._stream_turn(api, {**kwargs, "messages": history}, callbacks)
                _record_response(span, model, response)
            result.turns += 1
            for key in _USAGE_KEYS:
                result.usage[key] += getattr(response.usage, key, 0) or 0

            if response.stop_reason == "refusal":
                # Checked before reading content: a refusal can cut a tool call off mid-input.
                raise LLMRefusalError(f"Claude declined the request ({purpose}).")

            # Append content unchanged so thinking blocks stay valid within this loop.
            history.append({"role": "assistant", "content": response.content})
            result.new_messages.append(_persistable("assistant", response.content))
            text = "".join(b.text for b in response.content if b.type == "text")
            if text:
                result.text = text

            if response.stop_reason == "pause_turn":
                continue  # a server tool hit its iteration cap; resend to let it resume

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                result.stop_reason = response.stop_reason or "end_turn"
                break

            if response.stop_reason == "max_tokens":
                # A truncated tool input parses as a valid partial object; never run it.
                records = [
                    ToolCallRecord(
                        b.name, {}, "Tool input was cut off by the output limit. Retry with a shorter input.", True
                    )
                    for b in tool_uses
                ]
            else:
                records = await asyncio.gather(
                    *(execute_tool(tool_map, b.name, b.input, callbacks) for b in tool_uses)
                )
            result.tool_calls.extend(records)
            # All results for one assistant turn go back in a single user message.
            tool_results = [
                {"type": "tool_result", "tool_use_id": b.id, "content": r.result, "is_error": r.is_error}
                for b, r in zip(tool_uses, records, strict=True)
            ]
            history.append({"role": "user", "content": tool_results})
            result.new_messages.append({"role": "user", "content": tool_results})

        log.info("llm.run purpose=%s model=%s turns=%d usage=%s", purpose, model, result.turns, result.usage)
        return result

    async def parse(
        self,
        *,
        purpose: str,
        system: str,
        messages: list[dict[str, Any]],
        output_model: type[T],
        tier: Tier = "worker",
        model: str | None = None,
        effort: str | None = None,
        max_tokens: int = 16000,
    ) -> T:
        model, effort = self._resolve(tier, model, effort)
        api, kwargs = self._request(model, effort, system, max_tokens)
        with _llm_span(purpose, model, tier, max_tokens, structured=True) as span:
            try:
                # Streamed so long structured answers (slide HTML) cannot hit HTTP timeouts.
                async with api.stream(**kwargs, messages=messages, output_format=output_model) as stream:
                    response = await stream.get_final_message()
            except anthropic.APIError as exc:
                raise self._translate(exc) from exc
            _record_response(span, model, response)

        if response.stop_reason == "refusal":
            raise LLMRefusalError(f"Claude declined the request ({purpose}).")
        if response.stop_reason == "max_tokens":
            raise LLMError(f"Structured answer for '{purpose}' was cut off; raise max_tokens.")
        parsed = getattr(response, "parsed_output", None)
        if isinstance(parsed, output_model):
            return parsed
        text = "".join(b.text for b in response.content if b.type == "text")
        return output_model.model_validate_json(text)

    async def close(self) -> None:
        await self._client.close()
