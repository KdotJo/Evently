---
title: "Package ownership and entrypoint-only cross-package calls"
description: "A PR should stay inside one work package's files and talk to other packages through their entrypoints (plan §5 rules 1–4)."
slug: package-ownership
type: check
when: "A pull request changes files under app/"
actions: "Comment with the packages touched; fail only on cross-package imports that bypass entrypoints or on direct socket writes from services"
---

# Package ownership

`docs/IMPLEMENTATION_PLAN.md` §5 maps every path to a work package. Use that table as the source of
truth (the summary below may lag behind it):

| Package | Owns |
|---|---|
| 1 Auth + events | `app/api/auth.py`, `app/api/events.py` |
| 2 Board | `app/api/board.py`, `app/services/board.py`, `app/services/layout.py` |
| 3 Realtime gateway | `app/api/ws_events.py`, `app/api/stream.py`, `app/realtime/redis_bus.py`, `app/realtime/presence.py` |
| 4–5 Providers | `app/providers/places.py`, `weather.py`, `traffic.py` |
| 6 Venue agents | `app/agents/venues/**`, `app/api/venues.py` |
| 7 Orchestrator | `app/agents/orchestrator/**`, `app/api/chat.py` |
| 8–9 Presentations | `app/agents/presentations/**`, `app/api/presentations.py`, `app/services/deck_render.py`, `app/services/html_sanitize.py` |
| 10–11 STT | `app/transcription/*` (except `base.py`) |
| 12–14 Live | `app/live/**`, `app/api/live_sessions.py`, `app/api/ws_live.py`, `app/api/ws_audio.py` |
| 15 Outreach | `app/integrations/**` (except `outreach.py` signatures), `app/api/outreach.py` |
| 16 Platform | `Dockerfile`, `docker-compose.yml`, `deploy/**`, `.github/**`, `app/observability/**`, `sonar-project.properties`, `.gitar/**`, `docs/DEPLOYMENT.md`, `docs/OBSERVABILITY.md` |
| Search | `app/search/**`, `app/api/search.py` |

## Steps

1. Group the changed `app/` files by package. Post one short comment naming the packages touched.
   Touching two or more packages is **not** a failure by itself (integration PRs exist), but ask the
   author to confirm the other owners agreed when the PR title does not start with `integration:`
   or `foundation:`.
2. **Fail** when a changed file imports another package's internals instead of its entrypoint
   (§5 rule 3). Entrypoints are: the `__init__.py` of `app/agents/venues`,
   `app/agents/presentations`, `app/agents/orchestrator`; `app/live/service.py`; `ctx.places`,
   `ctx.weather`, `ctx.traffic`; `app/transcription/factory.py`. Examples that fail:
   `from app.agents.venues.research import …` from outside `app/agents/venues/`,
   `from app.transcription.deepgram import …` from outside `app/transcription/`.
3. **Fail** when a service or agent writes to a WebSocket or SSE response directly instead of
   publishing an envelope with `ctx.bus.publish(topic, type, data)` using constants from
   `app/realtime/events.py` (§5 rule 4). Only `app/api/ws_*.py` and `app/api/stream.py` may call
   `websocket.send_*` / stream bytes to clients.
4. Flag (comment, do not fail) new string literals used as event types where an `events.py`
   constant exists.

Keep comments short and point at the entrypoint the author should import instead.
