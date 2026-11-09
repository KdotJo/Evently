// Live slides sync: the presenter publishes the current slide, audience screens follow it.
//
// Transport for the two-tab demo is BroadcastChannel, which only reaches other tabs of the same
// browser on the same origin. To reach phones, swap `joinLive` for Supabase Realtime or a WebSocket;
// the presenter and audience views only use the interface below.

export interface LiveState {
  index: number
}

type Message =
  | { kind: 'state'; state: LiveState }
  // Sent by an audience screen when it opens, so the presenter replies with the current slide.
  | { kind: 'hello'; from: string }
  // Audience heartbeat, used to count who is watching.
  | { kind: 'here'; from: string }

interface Handlers {
  onState?: (state: LiveState) => void
  onHello?: (from: string) => void
  onHere?: (from: string) => void
}

export interface LiveSession {
  publish: (state: LiveState) => void
  hello: (from: string) => void
  here: (from: string) => void
  close: () => void
}

const storageKey = (id: string) => `evently-live:${id}`

export function joinLive(id: string, handlers: Handlers): LiveSession {
  const channel = new BroadcastChannel(`evently-live:${id}`)
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    if (data.kind === 'state') handlers.onState?.(data.state)
    else if (data.kind === 'hello') handlers.onHello?.(data.from)
    else if (data.kind === 'here') handlers.onHere?.(data.from)
  }
  const send = (m: Message) => channel.postMessage(m)
  return {
    publish: (state) => {
      send({ kind: 'state', state })
      // Kept so a presenter tab that reloads resumes on the same slide.
      try {
        localStorage.setItem(storageKey(id), JSON.stringify(state))
      } catch {
        // Storage can be blocked (private mode); the live channel still works.
      }
    },
    hello: (from) => send({ kind: 'hello', from }),
    here: (from) => send({ kind: 'here', from }),
    close: () => channel.close(),
  }
}

export function savedState(id: string): LiveState | null {
  try {
    const raw = localStorage.getItem(storageKey(id))
    return raw ? (JSON.parse(raw) as LiveState) : null
  } catch {
    return null
  }
}

// How often each side announces itself, and how long before it counts as gone.
export const HEARTBEAT_MS = 2000
export const TIMEOUT_MS = 5000

export const audienceUrl = (id: string) => `${location.origin}${location.pathname}#/live/${id}`
export const presenterUrl = (id: string) => `${location.origin}${location.pathname}#/present/${id}`
export const uploadUrl = (id: string) => `${location.origin}${location.pathname}#/upload/${id}`
