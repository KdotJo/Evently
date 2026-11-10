// Venue memory: venues this planner evaluated on earlier events (GET /search/venues, backed by Elasticsearch).
// Search is optional, so every failure (503 when it isn't configured, network, anything else) reads as "no hits".
import { useEffect, useState } from 'react'
import { api, type Query } from '../../api/client'
import type { EventDetails, Task } from '../../types'
import { buildCriteria } from './criteria'

/** One hit. Nearly everything is optional in the index, so treat every field as possibly missing. */
export interface VenueMemoryHit {
  card_id?: string | null
  event_id?: string | null
  event_name?: string | null
  name?: string | null
  address?: string | null
  place_id?: string | null
  capacity_estimate?: number | null
  capacity_fit?: string | null
  parking_on_site?: boolean | null
  parking_summary?: string | null
  parking_score?: number | null
  weather_summary?: string | null
  weather_risk?: string | null
  traffic_summary?: string | null
  traffic_score?: number | null
  score_overall?: number | null
  pros?: string[] | null
  summary?: string | null
  criteria?: { headcount?: number | null; event_type?: string | null; event_date?: string | null; location?: string | null } | null
  status?: string | null
  updated_at?: string | null
}

const SHOWN = 4
const DEBOUNCE_MS = 400
// A little under the headcount, so a near-fit from a smaller past event still shows.
const NEAR_FIT = 0.6

export type VenueMemoryQuery = Query & { q: string; exclude_event_id: string; limit: number }

/** What the upcoming venue search will look for, as a memory query. Null when there's nothing to search on. */
export function memoryQuery(task: Task, event: EventDetails, eventId: string, requirements: unknown): VenueMemoryQuery | null {
  const c = buildCriteria(task, event, requirements)
  const location = c.location?.trim()
  if (!location) return null
  const setting = c.setting === 'indoor' || c.setting === 'outdoor' ? `${c.setting} ` : ''
  const people = c.headcount ? ` for ${c.headcount} people` : ''
  // Event type goes in the text, not the `event_type` filter: a conference venue can be a fine hackathon venue,
  // and the filter would drop it. `min_capacity` is left out too because it drops every venue with no capacity estimate.
  return { q: `${setting}${c.event_type ?? ''} venue in ${location}${people}`.trim(), exclude_event_id: eventId, limit: SHOWN + 1 }
}

// Words long enough to identify a place: "San Francisco, CA" → ["francisco"]; "LA" → none, so no check.
const placeWords = (city: string) => city.split(',')[0].toLowerCase().split(/\s+/).filter((w) => w.length >= 4)

function usable(hit: VenueMemoryHit, headcount: number | null, city: string) {
  if (!hit.name?.trim()) return false
  // Cards still being researched or that failed aren't an evaluation yet.
  if (hit.status && hit.status !== 'ready') return false
  if (headcount && hit.capacity_estimate != null && hit.capacity_estimate < headcount * NEAR_FIT) return false
  // The frontend has no coordinates for `near`, so location only ranks; don't show another city's venues.
  const where = `${hit.address ?? ''} ${hit.criteria?.location ?? ''}`.toLowerCase()
  const words = placeWords(city)
  return !where.trim() || !words.length || words.some((w) => where.includes(w))
}

function pickHits(raw: unknown, headcount: number | null, city: string): VenueMemoryHit[] {
  const hits = (raw as { hits?: unknown } | null | undefined)?.hits
  if (!Array.isArray(hits)) return []
  const seen = new Set<string>()
  return (hits as VenueMemoryHit[])
    .filter((h) => usable(h, headcount, city))
    .filter((h) => {
      // One venue evaluated for several events shows once, best match first.
      const id = h.place_id || h.name!
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .slice(0, SHOWN)
}

interface State {
  hits: VenueMemoryHit[]
  loading: boolean
}

const NOTHING: State = { hits: [], loading: false }

/** Fetches once per distinct query, debounced; `hits` stays put while a newer query is in flight. */
export function useVenueMemory(query: VenueMemoryQuery | null, headcount: number | null, city: string): State {
  const [state, setState] = useState<State>(NOTHING)
  // A string dep: requirements change identity on every store update even when the query is the same.
  const key = query ? JSON.stringify({ query, headcount, city }) : null

  useEffect(() => {
    if (!key) return
    const { query, headcount, city } = JSON.parse(key) as { query: VenueMemoryQuery; headcount: number | null; city: string }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }))
      api.get<unknown>('/search/venues', { query, signal: ctrl.signal }).then(
        (res) => setState({ hits: pickHits(res, headcount, city), loading: false }),
        () => {
          if (!ctrl.signal.aborted) setState({ hits: [], loading: false })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [key])

  return key ? state : NOTHING
}
