// "Similar venues you've evaluated before": docked along the bottom of the plan canvas while a venue search is
// ahead or running. Renders nothing on empty results or any error; search must never get in the planner's way.
// Text only: `highlights` from the API contain markup and are deliberately not used.
import { Car, CloudSun, ExternalLink, History, TrafficCone, Users, X } from 'lucide-react'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { EVENT_TYPES } from '../../data/workflows'
import type { RunnerContext } from '../../lib/runners'
import type { EventDetails, Task } from '../../types'
import { ScoreBadge } from './VenueDetails'
import { memoryQuery, useVenueMemory, type VenueMemoryHit } from './useVenueMemory'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const NEUTRAL = 'bg-gray-100 text-gray-600'
const GOOD = 'bg-emerald-50 text-emerald-700'
const FAIR = 'bg-amber-50 text-amber-700'
const POOR = 'bg-rose-50 text-rose-700'
const scored = (s: number) => (s >= 60 ? GOOD : s >= 40 ? FAIR : POOR)

// Read the date's text: `new Date('2026-12-01')` is UTC midnight, which is November west of Greenwich.
function monthOf(iso: string | null | undefined): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})/)
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  return m && month ? `${month} ${m[1]}` : null
}

function Chip({ tone, title, children }: { tone: string; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[10px] font-semibold ${tone}`}>
      {children}
    </span>
  )
}

function Capacity({ hit }: { hit: VenueMemoryHit }) {
  const holds = hit.capacity_estimate
  const evaluatedFor = hit.criteria?.headcount
  if (holds == null && evaluatedFor == null) return null
  const tone = hit.capacity_fit === 'yes' ? GOOD : hit.capacity_fit === 'tight' ? FAIR : hit.capacity_fit === 'no' ? POOR : NEUTRAL
  return (
    <Chip tone={tone} title="Venue capacity, and the headcount it was evaluated for">
      <Users size={10} />
      {[holds != null ? `Holds ${holds}` : null, evaluatedFor != null ? `for ${evaluatedFor}` : null].filter(Boolean).join(' · ')}
    </Chip>
  )
}

function Signals({ hit }: { hit: VenueMemoryHit }) {
  const { parking_on_site: onSite, parking_score: parking, weather_risk: risk, traffic_score: traffic } = hit
  const parkingLabel = onSite ? 'On-site' : parking != null ? (parking >= 60 ? 'Good' : parking >= 40 ? 'Some' : 'Limited') : onSite === false ? 'Off-site' : null
  const parkingTone = onSite || (parking != null && parking >= 60) ? GOOD : parking != null ? scored(parking) : NEUTRAL
  const riskLabel = risk === 'low' || risk === 'medium' || risk === 'high' ? risk[0].toUpperCase() + risk.slice(1) : null
  return (
    <>
      {parkingLabel && (
        <Chip tone={parkingTone} title={`Parking${hit.parking_summary ? `: ${hit.parking_summary}` : ''}`}>
          <Car size={10} /> {parkingLabel}
        </Chip>
      )}
      {riskLabel && (
        <Chip tone={risk === 'low' ? GOOD : risk === 'medium' ? FAIR : POOR} title={`Weather risk${hit.weather_summary ? `: ${hit.weather_summary}` : ''}`}>
          <CloudSun size={10} /> {riskLabel}
        </Chip>
      )}
      {traffic != null && (
        <Chip tone={scored(traffic)} title={`Traffic${hit.traffic_summary ? `: ${hit.traffic_summary}` : ''}`}>
          <TrafficCone size={10} /> {traffic >= 60 ? 'Light' : traffic >= 40 ? 'Moderate' : 'Heavy'}
        </Chip>
      )}
    </>
  )
}

const CARD = 'w-[300px] shrink-0 rounded-xl bg-white p-3 ring-1 ring-gray-900/5'

function HitCard({ hit }: { hit: VenueMemoryHit }) {
  const line = hit.summary?.trim() || hit.pros?.find((p) => p?.trim())
  const when = monthOf(hit.criteria?.event_date) ?? monthOf(hit.updated_at)
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{hit.name}</span>
        <ScoreBadge score={hit.score_overall} />
        {hit.event_id && <ExternalLink size={11} className="shrink-0 text-gray-400 transition group-hover:text-accent" />}
      </div>
      {hit.address && <div className="truncate text-[11px] text-muted">{hit.address}</div>}
      <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
        <Capacity hit={hit} />
        <Signals hit={hit} />
      </div>
      {line && <div className="mt-1.5 truncate text-[11px] text-gray-600">{line}</div>}
      <div className="mt-1 truncate text-[10px] font-semibold text-accent">
        Evaluated for {hit.event_name?.trim() || 'a past event'}
        {when ? ` · ${when}` : ''}
      </div>
    </>
  )
  // A new tab: following the link in this one would drop the plan the planner is working on.
  return hit.event_id ? (
    <a href={`/events/${encodeURIComponent(hit.event_id)}`} target="_blank" rel="noreferrer" className={`group block transition hover:ring-accent ${CARD}`}>
      {body}
    </a>
  ) : (
    <div className={CARD}>{body}</div>
  )
}

function Skeleton() {
  return (
    <div aria-hidden className={`${CARD} animate-pulse`}>
      <div className="h-3 w-2/3 rounded bg-gray-100" />
      <div className="mt-2 h-2 w-1/2 rounded bg-gray-100" />
      <div className="mt-3 h-3 w-5/6 rounded bg-gray-100" />
      <div className="mt-2 h-2 w-3/4 rounded bg-gray-100" />
    </div>
  )
}

const NO_SUBSCRIBE = () => () => {}
const NO_REQUIREMENTS = () => undefined

interface Props {
  tasks: Task[]
  selectedId: string | null
  /** An option is zoomed in on: stay out of its way. */
  hidden: boolean
  event: EventDetails
  ctx: RunnerContext | null
}

export default function VenueMemoryPanel({ tasks, selectedId, hidden, event, ctx }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const store = ctx?.store ?? null
  const requirements = useSyncExternalStore<unknown>(store?.subscribe ?? NO_SUBSCRIBE, store ? () => store.getState().event?.requirements : NO_REQUIREMENTS)
  const step = tasks.find((t) => t.id === 'venue')
  // Plans that aren't saved to the backend have no history to look through.
  const query = step && ctx ? memoryQuery(step, event, ctx.eventId, requirements) : null
  const { hits, loading } = useVenueMemory(query, event.headcount > 0 ? event.headcount : null, event.city)

  // Once this search has its own results they take over, unless the planner reopens the step to compare.
  const relevant = step && (step.status !== 'done' || selectedId === step.id)
  if (!relevant || hidden || dismissed || (!hits.length && !loading)) return null

  const label = EVENT_TYPES.find((e) => e.id === event.type)?.label
  return (
    <aside className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex pr-20">
      <div className="pointer-events-auto max-w-full min-w-0 animate-rise rounded-2xl bg-white/90 p-3 shadow-lg ring-1 shadow-indigo-500/10 ring-gray-900/10 backdrop-blur">
        {hits.length > 0 ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <History size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">Similar venues you've evaluated before</div>
              <div className="truncate text-[11px] text-muted">
                From your past events, for {[label, event.city, `${event.headcount} people`].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss similar venues" className="shrink-0 rounded-full p-1 text-muted hover:bg-gray-100 hover:text-ink">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div aria-hidden className="mb-2 flex animate-pulse items-center gap-2">
            <span className="size-6 rounded-full bg-gray-100" />
            <span className="h-3 w-52 rounded bg-gray-100" />
          </div>
        )}
        <div className="flex gap-2 overflow-x-auto">
          {hits.length > 0
            ? hits.map((h) => <HitCard key={h.card_id ?? `${h.event_id}:${h.name}`} hit={h} />)
            : [0, 1, 2].map((i) => <Skeleton key={i} />)}
        </div>
      </div>
    </aside>
  )
}
