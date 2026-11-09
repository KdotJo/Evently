"""Application settings, loaded from the environment and `.env`."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_ignore_empty=True,  # `ANTHROPIC_API_KEY=` in .env means "not set"
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite+aiosqlite:///./evently.db"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # --- auth -----------------------------------------------------------
    secret_key: str = "dev-insecure-secret-key-change-me-in-production"
    access_token_ttl_minutes: int = 60 * 24 * 7
    participant_token_ttl_minutes: int = 60 * 12
    # None = required in production, optional elsewhere (requests without a
    # token act as a local dev user).
    auth_required: bool | None = None

    # --- Claude ---------------------------------------------------------
    anthropic_api_key: str | None = None
    llm_orchestrator_model: str = "claude-opus-5-5"
    llm_worker_model: str = "claude-opus-5-5"
    llm_orchestrator_effort: str = "medium"
    llm_worker_effort: str = "medium"
    # Re-run a safety-classifier refusal on Anthropic's recommended fallback model.
    llm_refusal_fallbacks: bool = True
    # Let research agents use Claude's hosted web search tool.
    llm_web_search: bool = True
    max_parallel_agents: int = 6

    # --- venue data providers ---------------------------------------------
    google_maps_api_key: str | None = None
    google_api_key: str | None = None  # used for Maps when google_maps_api_key is unset
    places_provider: Literal["auto", "google", "mock"] = "auto"
    weather_provider: Literal["auto", "open_meteo", "mock"] = "auto"
    traffic_provider: Literal["auto", "google", "heuristic"] = "auto"

    # --- transcription ----------------------------------------------------
    stt_provider: Literal["auto", "deepgram", "assemblyai", "openai", "browser", "mock"] = "auto"
    deepgram_api_key: str | None = None
    assemblyai_api_key: str | None = None
    openai_api_key: str | None = None

    # --- live sessions ----------------------------------------------------
    livekit_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None
    audio_max_listeners_per_session: int = 500

    # --- outreach: email + Luma ------------------------------------------
    email_provider: Literal["auto", "resend", "smtp", "console"] = "auto"
    email_from: str | None = None  # e.g. "Evently <events@yourdomain.com>"
    resend_api_key: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True
    luma_api_key: str | None = None  # Luma public API (Luma Plus)

    # --- observability (OpenTelemetry → Dash0 or any OTLP endpoint) -------
    otel_enabled: bool = False
    otel_service_name: str = "evently-api"
    otel_exporter_otlp_endpoint: str | None = None  # e.g. https://ingress.<region>.dash0.com:4317
    otel_exporter_otlp_headers: str | None = None  # e.g. "Authorization=Bearer <dash0 token>"
    dash0_dataset: str | None = None

    # --- search (Elasticsearch) --------------------------------------------
    elasticsearch_url: str | None = None  # e.g. http://elasticsearch:9200 or an Elastic Cloud URL
    elasticsearch_api_key: str | None = None
    elasticsearch_index_prefix: str = "evently"
    # Inference endpoint for semantic_text (e.g. ".elser-2-elasticsearch"); "none" forces plain text mode.
    elasticsearch_inference_id: str | None = None

    # --- infrastructure ---------------------------------------------------
    redis_url: str | None = None
    bus_history_size: int = Field(default=500, ge=0)

    @property
    def is_auth_required(self) -> bool:
        if self.auth_required is not None:
            return self.auth_required
        return self.environment == "production"

    @property
    def maps_api_key(self) -> str | None:
        return self.google_maps_api_key or self.google_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
