"""Liveness and configuration summary."""

from fastapi import APIRouter

from app.core.deps import Ctx

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(ctx: Ctx) -> dict:
    s = ctx.settings
    return {
        "status": "ok",
        "environment": s.environment,
        "llm_configured": ctx.llm.available,
        "maps_configured": bool(s.maps_api_key),
        "stt_keys": {
            "deepgram": bool(s.deepgram_api_key),
            "assemblyai": bool(s.assemblyai_api_key),
            "openai": bool(s.openai_api_key),
        },
        "livekit_configured": bool(s.livekit_url and s.livekit_api_key and s.livekit_api_secret),
        "active_agent_runs": len(ctx.runtime.active_run_ids()),
    }
