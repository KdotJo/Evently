"""Agent run inspection and cancellation."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.deps import Ctx, CurrentUser, OwnedEvent, Session, load_owned_event
from app.models import AgentRun
from app.schemas.common import AgentRunOut

router = APIRouter(tags=["agent-runs"])


@router.get("/events/{event_id}/agent-runs", response_model=list[AgentRunOut])
async def list_runs(event: OwnedEvent, session: Session, active: bool = False, limit: int = 100):
    query = select(AgentRun).where(AgentRun.event_id == event.id).order_by(AgentRun.created_at.desc())
    if active:
        query = query.where(AgentRun.status.in_(["queued", "running"]))
    return list((await session.execute(query.limit(min(limit, 500)))).scalars())


async def _owned_run(ctx: Ctx, run_id: str, user: CurrentUser) -> AgentRun:
    run = await ctx.runtime.get(run_id)
    if run is None or await load_owned_event(ctx, run.event_id, user) is None:
        raise HTTPException(404, "Agent run not found")
    return run


@router.get("/agent-runs/{run_id}", response_model=AgentRunOut)
async def get_run(run_id: str, ctx: Ctx, user: CurrentUser):
    return await _owned_run(ctx, run_id, user)


@router.post("/agent-runs/{run_id}/cancel", response_model=AgentRunOut)
async def cancel_run(run_id: str, ctx: Ctx, user: CurrentUser):
    """Cancel a queued or running agent. Children it spawned keep running unless cancelled too."""
    run = await _owned_run(ctx, run_id, user)
    if await ctx.runtime.cancel(run_id):
        run = await ctx.runtime.wait(run_id, timeout=5)
    return run
