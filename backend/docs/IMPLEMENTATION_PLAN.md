# Evently backend — implementation plan

Evently is a FastAPI backend for an AI-assisted event-planning web app. A planner chats with an
AI orchestrator; the orchestrator spawns research agents that find and vet venues; every agent is
mirrored live as a card on a whiteboard; the planner can then generate a slide deck, present it with
live transcription and voice-driven slide changes, and let attendees' phones follow along and act as
loudspeakers.

## 1. Product capabilities → backend features

| Capability | Backend feature |
|---|---|
| Chat with the AI | Orchestrator agent (Claude, tool use). `POST /events/{id}/chat/messages`, replies stream over the event channel. |
| AI spins up agents to find venues (headcount, location, parking, weather, rush hour) | Venue pipeline: one scout agent finds candidates, then one research agent **per venue** runs in parallel with Places / parking / weather / traffic tools. |
| Whiteboard cards tied to real running agents | `Board` / `Card` / `Edge` model. Each research agent owns a card; `AgentRun` lifecycle and card patches are pushed in real time. |
| User edits or re-prompts a specific result | `PATCH /cards/{id}` (manual edits lock those fields against agent overwrites) and `POST /cards/{id}/prompt` (re-runs an agent on that card). |
| Prompt for a presentation, with visuals | Deck pipeline: outline agent → one slide-render agent per slide, each emitting a self-contained HTML "artifact" slide. Prompt-based edits per deck or per slide. |
| Live transcript | Pluggable streaming STT (Deepgram, AssemblyAI, OpenAI Realtime, browser Web Speech, mock). |
| Auto slide change on keywords / "next slide" | `SlideTracker`: voice commands, per-slide trigger keywords, script alignment. |
| Send emails (venue inquiries, invites) and publish a Luma event from chat | Outreach package: AI drafts → planner confirms → send via Resend/SMTP or Luma public API; every email and the Luma event are persisted. |
| Bonus: phones join and rebroadcast the speaker | Live session with join code; WebSocket audio relay (PCM16 fan-out) plus optional LiveKit (WebRTC) tokens; listeners also receive slides and transcript. |

## 2. Architecture

```
            REST (/api/v1)            WebSockets (/ws)
                 │                         │
   ┌─────────────┴─────────────────────────┴──────────────┐
   │ FastAPI routers (app/api)                             │
   ├───────────────────────────────────────────────────────┤
   │ Services: board · live session · deck render          │
   │ Agents:   orchestrator · venues · presentations       │
   │           └── AgentRuntime (asyncio tasks, semaphore) │
   ├───────────────────────────────────────────────────────┤
   │ LLM (Claude)   Providers            Transcription     │
   │ app/llm        places/weather/      deepgram/aai/     │
   │                traffic              openai/browser    │
   ├───────────────────────────────────────────────────────┤
   │ EventBus (in-memory, Redis optional) · AudioHub       │
   │ SQLAlchemy async (SQLite dev → Postgres prod)         │
   └───────────────────────────────────────────────────────┘
```

Key decisions:

- **Python 3.13, FastAPI, SQLAlchemy 2 async.** SQLite (aiosqlite) for dev; the URL is the only change for Postgres.
- **One `AppContext`** (`app/core/context.py`) holds settings, DB sessionmaker, event bus, agent runtime, LLM and providers. Routers get it from `app.state.ctx`; background agents receive it explicitly. No module-level globals, so every test gets an isolated app.
- **Agents are asyncio tasks, not processes.** `AgentRuntime.spawn()` persists an `AgentRun`, runs the coroutine under a concurrency semaphore, and publishes lifecycle events. This is what makes "a card per running agent" literal.
- **Everything realtime goes through the `EventBus`** as typed envelopes on two topic families: `event:{event_id}` (planner workspace) and `session:{session_id}` (live presentation). WebSocket/SSE gateways only forward bus envelopes.
- **Claude via the official `anthropic` SDK**, model `claude-opus-5-5` (configurable), adaptive thinking, streaming tool loop, prompt caching on the system prompt, server-side refusal fallbacks enabled. All Claude access goes through `app/llm` so tests use a scripted double.
- **Slides are HTML artifacts.** Each slide is a self-contained HTML fragment (inline CSS/SVG, no scripts) rendered inside a sandboxed iframe, the same model as Claude artifacts. The server sanitises slide HTML and serves the deck with a strict CSP.
- **Audio relay is deliberately simple first:** PCM16 mono frames over WebSocket with a small header, fanned out by an in-memory hub and teed into STT. LiveKit tokens are offered when configured, for larger rooms.

## 3. Data model (`app/models/tables.py`)

`User` · `Event` (planning project, holds `requirements`) · `ChatMessage` · `Board` · `Card` · `Edge` ·
`AgentRun` · `Presentation` · `Slide` · `LiveSession` · `Participant` · `TranscriptSegment`.

- `Card.kind`: `venue | note | summary | comparison | presentation`. `Card.status`: `pending | running | ready | error`.
- `Card.data` for venue cards follows `VenueCardData` (`app/schemas/venue.py`): `place`, `capacity`, `parking`, `weather`, `traffic`, `pricing`, `pros`, `cons`, `score`, `summary`, `sources`.
- `Card.locked_fields`: top-level `data` keys the user edited by hand; agent patches skip them.
- `AgentRun.kind`: `orchestrator | venue_search | venue_scout | venue_research | card_refine | presentation_build | slide_render | presentation_edit`. `parent_run_id` gives the run tree.
- `Slide`: `html`, `notes` (speaker script), `keywords` (voice triggers).

## 4. Realtime protocol

Envelope (JSON), identical on WebSocket and SSE:

```json
{"id": "env_…", "type": "board.card.updated", "topic": "event:evt_…", "seq": 42, "ts": "…Z", "data": {…}}
```

Event types are the constants in `app/realtime/events.py` (`chat.*`, `agent.run.*`, `board.*`,
`presentation.*`, `slide.*`, `session.*`). Clients reconnect with `?since=<seq>` to replay missed envelopes. Ephemeral envelopes (`board.presence`) carry `seq: 0`, are never retained, and must not be used as a resume point.

| Channel | Purpose |
|---|---|
| `WS /ws/events/{event_id}` | Planner workspace: chat deltas, agent runs, board changes, deck generation. Client may send board ops (`card.move`, `card.update`, `presence.cursor`). |
| `GET /api/v1/events/{event_id}/stream` | Same envelopes over SSE. |
| `WS /ws/sessions/{session_id}` | Live session control: slide changes, transcript, participants. Host sends `slide.goto/next/prev`; browser-STT clients send `transcript.text`. |
| `WS /ws/sessions/{session_id}/audio` | Binary audio. Speaker uploads frames, listeners receive them. First message is a JSON hello. |

Audio frame: 12-byte header (`uint32 seq`, `uint32 timestamp_ms`, `uint16 sample_rate_hz/100`,
`uint8 codec`, `uint8 flags`, big-endian) followed by the payload (default PCM16LE mono 16 kHz, 20–40 ms).

## 5. Work packages (parallel subagents)

Foundation (built first, by the lead): project config, `AppContext`, DB + models, security, event bus,
envelopes, LLM wrapper + scripted test double, `AgentRuntime`, board service core, shared schemas,
provider/transcription base types, router stubs, test fixtures.

| # | Package | Owns |
|---|---|---|
| 1 | Auth + events API | `app/api/auth.py`, `app/api/events.py` |
| 2 | Board API + layout + edges | `app/api/board.py`, `app/services/board.py`, `app/services/layout.py` |
| 3 | Realtime gateway | `app/api/ws_events.py`, `app/api/stream.py`, `app/realtime/redis_bus.py`, `app/realtime/presence.py` |
| 4 | Places provider | `app/providers/places.py` |
| 5 | Weather + traffic providers | `app/providers/weather.py`, `app/providers/traffic.py` |
| 6 | Venue research agents | `app/agents/venues/*`, `app/api/venues.py` |
| 7 | Chat orchestrator | `app/agents/orchestrator/*`, `app/api/chat.py` |
| 8 | Presentation agents | `app/agents/presentations/*` |
| 9 | Presentation API + deck renderer | `app/api/presentations.py`, `app/services/deck_render.py`, `app/services/html_sanitize.py` |
| 10 | STT: Deepgram + AssemblyAI | `app/transcription/deepgram.py`, `app/transcription/assemblyai.py` |
| 11 | STT: OpenAI + mock + factory + provider comparison | `app/transcription/openai_realtime.py`, `mock.py`, `factory.py`, `docs/TRANSCRIPTION.md` |
| 12 | Slide tracker | `app/live/slide_tracker.py`, `app/live/text_match.py` |
| 13 | Live session service + API + control WS | `app/live/service.py`, `app/api/live_sessions.py`, `app/api/ws_live.py` |
| 14 | Audio broadcast | `app/live/audio_hub.py`, `app/live/stt_pipeline.py`, `app/live/livekit.py`, `app/api/ws_audio.py` |
| 15 | Outreach: email + Luma | `app/integrations/*`, `app/api/outreach.py` |

Second wave, after integration: dev console (browser harness for mic/audio/slides) and the
frontend-facing protocol reference, written against the real code.

### Rules for every package

1. **Stay inside your owned files** (plus your own `tests/test_<area>*.py`). Foundation files are
   frozen: `app/core/*`, `app/models/*`, `app/realtime/bus.py`, `app/realtime/events.py`, `app/llm/*`,
   `app/agents/runtime.py`, `app/schemas/*`, `app/integrations/outreach.py` (signatures), `app/providers/base.py`, `app/transcription/base.py`,
   `app/main.py`, `tests/conftest.py`, `pyproject.toml`. If a frozen file needs a change, say so in
   your final report instead of editing it.
2. **Keep the signatures of stubbed entrypoints** exactly as written; other packages call them.
3. **Cross-package calls go through entrypoints only** (the `__init__.py` of `app/agents/venues`,
   `app/agents/presentations`, `app/agents/orchestrator`; `app/live/service.py`; `ctx.places`,
   `ctx.weather`, `ctx.traffic`; `app/transcription/factory.py`). Import them inside functions when
   that avoids import cycles.
4. **Publish, don't push.** State changes emit envelopes via `ctx.bus.publish(topic, type, data)`
   using constants from `app/realtime/events.py`; never write to sockets from services.
5. **No network in tests.** Use `ScriptedLLM` (already in `ctx.llm` under test), `respx` for HTTP,
   and in-process fakes for provider WebSockets.
6. **No new dependencies without reporting them.** Everything in `pyproject.toml` is installed in `.venv`.
7. Run `.venv/bin/python -m pytest tests/test_<your area>*.py -q` and `.venv/bin/ruff check <your files>` before finishing.

## 6. Verification

- Unit tests per package; scripted-LLM pipeline tests for agents; WebSocket tests via Starlette `TestClient`.
- End-to-end smoke test after integration: chat → venue search → cards appear on the event channel →
  deck build → live session → transcript drives a slide change → listener receives audio frames.
- Live Claude / STT calls need keys in `.env` (`ANTHROPIC_API_KEY`, and one of `DEEPGRAM_API_KEY`,
  `ASSEMBLYAI_API_KEY`, `OPENAI_API_KEY`); without them those endpoints return `503` with a clear
  message and the rest of the API works.

## 7. Deliberately out of scope for this pass

Alembic migrations (tables are created on startup), multi-tenant orgs/sharing, PPTX export,
horizontal scaling of the audio hub (use LiveKit for that), and the production frontend.
