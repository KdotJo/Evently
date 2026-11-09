"""Events (planning projects): CRUD, requirements and the first-paint snapshot.

`Event.requirements` follows `VenueCriteria`, but the planner fills it in
gradually, so here every field is optional and only keys that were explicitly
set are stored (as JSON-safe values).
"""

import asyncio
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, create_model
from sqlalchemy import delete, select

from app.core.context import AppContext
from app.core.deps import Ctx, CurrentUser, OwnedEvent, Session
from app.models import AgentRun, Card, Edge, Event, LiveSession, Presentation
from app.schemas.common import AgentRunOut, CardOut, EdgeOut, EventOut, ORMModel
from app.schemas.live import LiveSessionOut
from app.schemas.presentation import PresentationOut
from app.schemas.venue import VenueCriteria
from app.services import board

router = APIRouter(tags=["events"])

ACTIVE_RUN_STATUSES = ("queued", "running")


def _all_optional(model: type[BaseModel], name: str) -> type[BaseModel]:
    """A copy of `model` where every field defaults to None (constraints kept) and unknown keys are rejected."""
    fields: dict[str, Any] = {}
    for field_name, info in model.model_fields.items():
        annotation = info.annotation | None
        if info.metadata:  # ge/le/… constraints
            annotation = Annotated[annotation, *info.metadata]
        fields[field_name] = (annotation, Field(default=None, description=info.description))
    return create_model(name, __config__=ConfigDict(extra="forbid"), **fields)


RequirementsPatch = _all_optional(VenueCriteria, "RequirementsPatch")

EventName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class EventCreate(BaseModel):
    name: EventName
    description: str = ""
    requirements: RequirementsPatch | None = None


class EventUpdate(BaseModel):
    """Omitted or null fields are left unchanged; `requirements` is merged, not replaced."""

    name: EventName | None = None
    description: str | None = None
    status: Literal["planning", "confirmed", "archived"] | None = None
    requirements: RequirementsPatch | None = None


class BoardOut(ORMModel):
    id: str
    event_id: str
    name: str
    viewport: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class EventSnapshot(BaseModel):
    """Current state of an event's workspace. Slide HTML and chat history are fetched separately."""

    event: EventOut
    board: BoardOut
    cards: list[CardOut]
    edges: list[EdgeOut]
    active_agent_runs: list[AgentRunOut]
    presentations: list[PresentationOut]
    live_sessions: list[LiveSessionOut]


def merge_requirements(current: dict[str, Any], patch: BaseModel | None) -> dict[str, Any]:
    """Return `current` with the keys explicitly set in `patch` applied; a null value removes its key."""
    merged = dict(current)
    if patch is not None:
        for key, value in patch.model_dump(mode="json", exclude_unset=True).items():
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
    return merged


def _locks(ctx: AppContext) -> dict[str, asyncio.Lock]:
    return ctx.service("event_locks", dict)


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def create_event(body: EventCreate, ctx: Ctx, session: Session, user: CurrentUser):
    """Create an event owned by the caller, together with its (empty) board."""
    event = Event(
        owner_id=user.id,
        name=body.name,
        description=body.description,
        requirements=merge_requirements({}, body.requirements),
    )
    session.add(event)
    await session.commit()
    await board.get_or_create_board(ctx, event.id)
    return event


@router.get("/events", response_model=list[EventOut])
async def list_events(session: Session, user: CurrentUser):
    """The caller's events, newest first."""
    query = select(Event).where(Event.owner_id == user.id).order_by(Event.created_at.desc(), Event.id.desc())
    return list((await session.execute(query)).scalars())


@router.get("/events/{event_id}", response_model=EventOut)
async def get_event(event: OwnedEvent):
    return event


@router.patch("/events/{event_id}", response_model=EventOut)
async def update_event(body: EventUpdate, event: OwnedEvent, ctx: Ctx, session: Session):
    """Update the given fields. `requirements` is merged key by key; a null value removes that key."""
    # Merging is read-modify-write: serialise it per event (in this process via the lock,
    # across processes via the row lock) so concurrent patches to different keys both land.
    async with _locks(ctx).setdefault(event.id, asyncio.Lock()):
        row = await session.get(Event, event.id, with_for_update=True)
        if row is None:  # deleted since the ownership check
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
        for name in ("name", "description", "status"):
            value = getattr(body, name)
            if value is not None:
                setattr(row, name, value)
        if body.requirements is not None:
            row.requirements = merge_requirements(row.requirements or {}, body.requirements)
        await session.commit()
    return row


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event: OwnedEvent, ctx: Ctx, session: Session) -> None:
    """Delete the event and everything under it (board, cards, runs, decks, sessions cascade in the DB).

    Active agent runs are cancelled first so no agent keeps writing to a deleted event.
    """
    active = select(AgentRun.id).where(AgentRun.event_id == event.id, AgentRun.status.in_(ACTIVE_RUN_STATUSES))
    run_ids = list((await session.execute(active)).scalars())
    for run_id in run_ids:
        await ctx.runtime.cancel(run_id)
    await ctx.runtime.wait_all(run_ids, timeout=5)
    await session.execute(delete(Event).where(Event.id == event.id))
    await session.commit()
    _locks(ctx).pop(event.id, None)


@router.get("/events/{event_id}/snapshot", response_model=EventSnapshot)
async def get_snapshot(event: OwnedEvent, ctx: Ctx, session: Session):
    """Everything a frontend needs for first paint, in one round trip.

    Lists are complete (not paginated): cards and edges oldest first, active runs
    (queued or running) oldest first so parents precede children, presentations and
    live sessions newest first. `board` always exists; it is created on first use.
    """

    async def rows(model, *where, newest_first: bool = False) -> list:
        order = model.created_at.desc() if newest_first else model.created_at
        return list((await session.execute(select(model).where(*where).order_by(order))).scalars())

    return {
        "event": event,
        "board": await board.get_or_create_board(ctx, event.id),
        "cards": await rows(Card, Card.event_id == event.id),
        "edges": await rows(Edge, Edge.event_id == event.id),
        "active_agent_runs": await rows(
            AgentRun, AgentRun.event_id == event.id, AgentRun.status.in_(ACTIVE_RUN_STATUSES)
        ),
        "presentations": await rows(Presentation, Presentation.event_id == event.id, newest_first=True),
        "live_sessions": await rows(LiveSession, LiveSession.event_id == event.id, newest_first=True),
    }
