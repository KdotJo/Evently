import {
  ArrowRight,
  Bot,
  Calendar,
  Check,
  ChevronRight,
  Contact,
  Globe,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Presentation,
  Sparkles,
  Users,
  UtensilsCrossed,
  Workflow,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { EVENT_TYPES } from '../data/workflows'

const YEAR = new Date().getFullYear()

interface Props {
  onStart: () => void
}

export default function MarketingPage({ onStart }: Props) {
  return (
    <div className="h-full overflow-y-auto bg-white text-gray-900">
      <Nav onStart={onStart} />
      <Hero onStart={onStart} />
      <EventStrip />
      <Features />
      <Stats />
      <Integrations />
      <UseCases onStart={onStart} />
      <FinalCta onStart={onStart} />
      <Footer />
    </div>
  )
}

/* ---------- shared bits ---------- */

function Logo() {
  return (
    <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
      <span className="grid size-8 place-items-center rounded-full bg-accent text-white">
        <Sparkles size={15} />
      </span>
      Evently
    </div>
  )
}

function PrimaryButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group inline-flex items-center gap-1.5 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:bg-indigo-500"
    >
      {children}
      <ChevronRight size={16} className="transition group-hover:translate-x-0.5" />
    </button>
  )
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-accent ring-1 ring-gray-900/10 transition hover:ring-accent"
    >
      {children}
    </button>
  )
}

function TextLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group inline-flex items-center gap-1 text-sm font-semibold text-accent">
      {children}
      <ChevronRight size={15} className="transition group-hover:translate-x-0.5" />
    </button>
  )
}

// Two-tone headline: dark lead sentence, muted continuation.
function Heading({ lead, rest, dark = false, className = '' }: { lead: string; rest: string; dark?: boolean; className?: string }) {
  return (
    <h2 className={`text-3xl font-bold tracking-tight sm:text-4xl ${className}`}>
      <span className={dark ? 'text-white' : 'text-gray-900'}>{lead}</span>{' '}
      <span className={dark ? 'text-indigo-200/60' : 'text-gray-400'}>{rest}</span>
    </h2>
  )
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  )
}

/* ---------- sections ---------- */

function Nav({ onStart }: Props) {
  return (
    <header className="group relative z-30 px-3 pt-2">
      <div className="mx-auto flex max-w-7xl items-center gap-8 rounded-3xl px-6 py-3 transition duration-300 group-focus-within:bg-white group-focus-within:shadow-lg group-focus-within:shadow-indigo-500/5 group-focus-within:ring-1 group-focus-within:ring-gray-900/5 group-hover:bg-white group-hover:shadow-lg group-hover:shadow-indigo-500/5 group-hover:ring-1 group-hover:ring-gray-900/5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm font-medium text-gray-700 md:flex">
          <a href="#features" className="hover:text-accent">Product</a>
          <a href="#integrations" className="hover:text-accent">Integrations</a>
          <a href="#use-cases" className="hover:text-accent">Use cases</a>
          <a href="#how" className="hover:text-accent">How it works</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onStart} className="rounded-full px-4 py-2 text-sm font-semibold text-gray-700 hover:text-accent">
            Sign in
          </button>
          <button
            onClick={onStart}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Get started <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </header>
  )
}

function Hero({ onStart }: Props) {
  return (
    // Pulled up under the sticky nav so the ribbon shows through its translucent background.
    <section className="relative -mt-[72px] overflow-hidden pt-[72px]">
      <Ribbon />

      <div className="relative mx-auto grid max-w-7xl gap-16 px-6 pt-12 pb-20 lg:min-h-[calc(100svh-72px)] lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-12">
        <div className="animate-rise">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm text-gray-600 ring-1 ring-gray-900/10">
            <span className="size-1.5 rounded-full bg-accent" />
            Agents for event planning
          </p>
          <h1 className="text-5xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl xl:text-7xl">
            Plan any event with a team of AI agents.
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-gray-500 xl:text-2xl">
            Venues, catering, sponsors and invites — handled in one conversation.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <PrimaryButton onClick={onStart}>Get started</PrimaryButton>
            <SecondaryButton onClick={onStart}>
              <GoogleG /> Sign up with Google
            </SecondaryButton>
          </div>
        </div>

        <HeroPreview />
      </div>
    </section>
  )
}

function HeroPreview() {
  const steps = [
    { t: 'Location', s: 'done', i: MapPin },
    { t: 'Sponsors', s: 'done', i: Users },
    { t: 'Catering', s: 'running', i: UtensilsCrossed },
    { t: 'Schedule', s: 'idle', i: Calendar },
  ] as const
  return (
    <div className="relative hidden animate-rise [animation-delay:150ms] lg:block">
      <div className="rounded-[32px] bg-white/80 p-5 shadow-2xl ring-1 shadow-indigo-500/10 ring-gray-900/5 backdrop-blur">
        <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
          <span className="size-2.5 rounded-full bg-gray-200" />
          <span className="size-2.5 rounded-full bg-gray-200" />
          <span className="size-2.5 rounded-full bg-gray-200" />
          <span className="ml-2 rounded-full bg-gray-100 px-3 py-0.5">evently.app/plan</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3 rounded-3xl bg-gray-50 p-4">
            <div className="ml-auto w-fit rounded-3xl rounded-br-lg bg-accent px-3.5 py-2 text-xs text-white">200-person hackathon in Austin</div>
            <div className="w-fit rounded-3xl rounded-bl-lg bg-white px-3.5 py-2 text-xs shadow-sm ring-1 ring-gray-900/5">
              Here’s a 10-step workflow. What would you like to edit?
            </div>
            <div className="ml-auto w-fit rounded-3xl rounded-br-lg bg-accent px-3.5 py-2 text-xs text-white">Add a photo booth</div>
            <div className="w-fit rounded-3xl rounded-bl-lg bg-white px-3.5 py-2 text-xs shadow-sm ring-1 ring-gray-900/5">Done — added after Location.</div>
          </div>
          <div className="space-y-2.5">
            {steps.map(({ t, s, i: Icon }) => (
              <div
                key={t}
                className={`flex items-center gap-3 rounded-2xl border bg-white px-3.5 py-3 text-sm shadow-sm ${
                  s === 'running' ? 'border-run ring-4 ring-run-soft' : s === 'done' ? 'border-accent/40' : 'border-line'
                }`}
              >
                <Icon size={14} className="text-gray-400" />
                <span className="font-semibold">{t}</span>
                <span className="ml-auto">
                  {s === 'done' && (
                    <span className="grid size-5 place-items-center rounded-full bg-accent text-white">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                  {s === 'running' && <Loader2 size={15} className="animate-spin text-run" />}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- hero ribbon ---------- */

type Pt = [number, number]
type Curve = [Pt, Pt, Pt, Pt]

// Two edges of the band (cubic béziers in a 1000×1000 box). Fibers are interpolated between them.
const EDGE_IN: Curve = [[353, -260], [560, 330], [800, 560], [1060, 800]]
const EDGE_OUT: Curve = [[818, -260], [900, 170], [980, 300], [1060, 340]]
// A narrower fold that sits on top of the main band for depth.
const FOLD_IN: Curve = [[527, -260], [700, 260], [880, 470], [1060, 600]]
const FOLD_OUT: Curve = [[705, -260], [820, 200], [940, 340], [1060, 420]]

const lerp = (a: Curve, b: Curve, t: number): Curve =>
  a.map(([x, y], i) => [x + (b[i][0] - x) * t, y + (b[i][1] - y) * t]) as Curve
const d = ([p0, p1, p2, p3]: Curve) => `M${p0} C${p1} ${p2} ${p3}`
const band = (a: Curve, b: Curve) =>
  `${d(a)} L${b[3]} C${b[2]} ${b[1]} ${b[0]} Z`

const FIBERS = Array.from({ length: 56 }, (_, i) => lerp(EDGE_IN, EDGE_OUT, i / 55))
const FOLD_FIBERS = Array.from({ length: 22 }, (_, i) => lerp(FOLD_IN, FOLD_OUT, i / 21))

function Ribbon() {
  return (
    <div
      aria-hidden
      className="ribbon-wrap pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
    >
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMaxYMin slice" className="size-full overflow-visible">
        <defs>
          <linearGradient id="rb-fill" x1="0.35" y1="0" x2="1" y2="0.8">
            <stop offset="0" stopColor="#bae6fd" />
            <stop offset="0.3" stopColor="#818cf8" />
            <stop offset="0.55" stopColor="#a78bfa" />
            <stop offset="0.8" stopColor="#f472b6" />
            <stop offset="1" stopColor="#fda4af" />
          </linearGradient>
          <linearGradient id="rb-fold" x1="0.5" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor="#c7d2fe" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="#e879f9" stopOpacity="0.8" />
            <stop offset="1" stopColor="#6366f1" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="rb-edge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <filter id="rb-soft">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* soft halo so the band blends into white */}
        <path d={band(EDGE_IN, EDGE_OUT)} fill="url(#rb-fill)" opacity="0.35" filter="url(#rb-soft)" transform="translate(-30 10)" />
        <path d={band(EDGE_IN, EDGE_OUT)} fill="url(#rb-fill)" opacity="0.85" />
        <g fill="none" stroke="#fff" strokeWidth="0.8">
          {FIBERS.map((c, i) => (
            <path key={i} d={d(c)} strokeOpacity={0.08 + 0.22 * Math.abs(Math.sin(i * 0.7))} />
          ))}
        </g>

        <path d={band(FOLD_IN, FOLD_OUT)} fill="url(#rb-fold)" opacity="0.75" />
        <g fill="none" stroke="#fff" strokeWidth="0.7">
          {FOLD_FIBERS.map((c, i) => (
            <path key={i} d={d(c)} strokeOpacity={0.12 + 0.25 * Math.abs(Math.cos(i * 0.9))} />
          ))}
        </g>
        {/* bright leading edge */}
        <path d={d(EDGE_IN)} fill="none" stroke="url(#rb-edge)" strokeWidth="3" opacity="0.8" />
      </svg>
    </div>
  )
}

function EventStrip() {
  const items = [...EVENT_TYPES, ...EVENT_TYPES, ...EVENT_TYPES]
  return (
    <section className="border-y border-gray-900/5 bg-white/60 py-7">
      <div className="mx-auto max-w-7xl overflow-hidden px-6 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="marquee flex w-max gap-14">
          {items.map((e, i) => (
            <div key={i} className="flex items-center gap-3 text-xl font-semibold whitespace-nowrap text-gray-400">
              <span className="text-2xl grayscale-[30%]">{e.emoji}</span>
              {e.label}
              <span className="text-sm font-normal text-gray-300">{e.blurb}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({ title, className = '', children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-[32px] bg-white ring-1 ring-gray-900/5 ${className}`}>
      <h3 className="p-7 pb-0 text-2xl font-semibold tracking-tight">{title}</h3>
      <div className="relative flex flex-1 items-end p-7">{children}</div>
    </div>
  )
}

function Features() {
  return (
    <section id="features" className="bg-gray-50/70 py-28">
      <div className="mx-auto max-w-7xl px-6">
        <Heading
          lead="Everything an event needs, in one workflow."
          rest="Evently turns your idea into a plan, then assigns an agent to every step — designed to work on its own or together."
          className="max-w-4xl"
        />

        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <FeatureCard title="Describe your event, get a plan" className="md:col-span-4">
            <div className="absolute inset-0 bg-gradient-to-br from-transparent via-indigo-100/60 to-pink-200/70" />
            <div className="relative grid w-full gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-3xl bg-white p-4 shadow-lg ring-1 ring-gray-900/5">
                <div className="text-xs font-semibold text-accent">Evently</div>
                <p className="text-sm">What event are you planning?</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {EVENT_TYPES.map((e) => (
                    <span key={e.id} className={`rounded-full px-2.5 py-1 text-xs ring-1 ${e.id === 'wedding' ? 'bg-accent text-white ring-accent' : 'ring-gray-900/10'}`}>
                      {e.emoji} {e.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-2 rounded-3xl bg-white p-4 shadow-lg ring-1 ring-gray-900/5">
                {['Budget & vision', 'Guest list', 'Location', 'Catering', 'Photographer', 'Invitations'].map((s, i) => (
                  <div key={s} className="flex items-center gap-2 text-sm">
                    <span className="grid size-5 place-items-center rounded-full bg-accent-soft font-mono text-[10px] text-accent">{i + 1}</span>
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </FeatureCard>

          <FeatureCard title="Edit it like a conversation" className="md:col-span-2">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-violet-300/70" />
            <div className="relative w-full space-y-2">
              {['Make it 300 people', 'Remove judges', 'Move it to Austin'].map((m) => (
                <div key={m} className="ml-auto w-fit rounded-3xl rounded-br-lg bg-accent px-4 py-2 text-sm text-white shadow">
                  {m}
                </div>
              ))}
              <div className="w-fit rounded-3xl rounded-bl-lg bg-white px-4 py-2 text-sm shadow ring-1 ring-gray-900/5">Updated — 3 changes.</div>
            </div>
          </FeatureCard>

          <FeatureCard title="Find venues on Google Maps" className="md:col-span-2">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_60%,#e0e7ff,transparent_60%),radial-gradient(circle_at_80%_80%,#bae6fd,transparent_55%)]" />
            <div className="relative w-full rounded-3xl bg-white p-4 shadow-lg ring-1 ring-gray-900/5">
              <div className="relative mb-3 h-28 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#eef2ff,#f0f9ff)]">
                <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_48%,#fff_48%,#fff_52%,transparent_52%),linear-gradient(0deg,transparent_45%,#fff_45%,#fff_50%,transparent_50%)] opacity-80" />
                {[
                  ['20%', '30%'],
                  ['62%', '55%'],
                  ['40%', '70%'],
                ].map(([l, t]) => (
                  <MapPin key={l} size={20} className="absolute fill-accent text-white" style={{ left: l, top: t }} />
                ))}
              </div>
              {['Innovation Hub · fits 240', 'The Foundry · fits 200'].map((v) => (
                <div key={v} className="border-t border-gray-100 py-1.5 text-xs text-gray-600 first:border-0">{v}</div>
              ))}
            </div>
          </FeatureCard>

          <FeatureCard title="Agents run in parallel" className="md:col-span-2">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-sky-200/70" />
            <div className="relative w-full space-y-2">
              {[
                ['Sponsor Hunter', 'done'],
                ['Caterer', 'running'],
                ['Tech Ops', 'running'],
                ['Scheduler', 'queued'],
              ].map(([a, s]) => (
                <div key={a} className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-sm shadow ring-1 ring-gray-900/5">
                  <Bot size={14} className="text-accent" />
                  {a}
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${s === 'done' ? 'bg-accent text-white' : s === 'running' ? 'bg-run-soft text-accent' : 'bg-gray-100 text-gray-500'}`}>
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </FeatureCard>

          <FeatureCard title="Live slides with a QR code" className="md:col-span-2">
            <div className="absolute inset-0 bg-gradient-to-br from-transparent via-pink-100/70 to-indigo-200/80" />
            <div className="relative mx-auto flex items-center gap-4 rounded-3xl bg-white p-4 shadow-lg ring-1 ring-gray-900/5">
              <div className="grid size-24 grid-cols-7 gap-0.5 rounded-xl bg-white p-1.5 ring-1 ring-gray-200">
                {Array.from({ length: 49 }, (_, i) => (
                  <span key={i} className={`rounded-[2px] ${[0, 1, 2, 7, 9, 14, 15, 16, 4, 5, 6, 11, 13, 18, 19, 20, 28, 29, 30, 35, 37, 42, 43, 44, 24, 26, 32, 40, 46, 22, 38].includes(i) ? 'bg-gray-900' : 'bg-transparent'}`} />
                ))}
              </div>
              <div className="text-xs">
                <div className="font-semibold">Opening keynote</div>
                <div className="text-gray-500">Scan to follow along</div>
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Live
                </div>
              </div>
            </div>
          </FeatureCard>
        </div>
      </div>
    </section>
  )
}

function Stats() {
  const stats = [
    ['5', 'event types with ready-made workflows'],
    ['50+', 'planning steps across all templates'],
    ['6', 'integrations, from Maps to Slides'],
    ['1', 'conversation to plan the whole thing'],
  ]
  return (
    <section className="relative overflow-hidden py-28">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(ellipse_at_bottom,#c7d2fe,transparent_70%)]" />
      <div className="relative mx-auto max-w-7xl px-6">
        <h2 className="mx-auto max-w-2xl text-center text-4xl font-bold tracking-tight sm:text-5xl">The fastest way from idea to run sheet</h2>
        <div className="mt-16 grid gap-y-10 border-y border-gray-900/5 py-12 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(([n, l], i) => (
            <div key={l} className="text-center">
              <div className={`text-5xl font-bold tracking-tight ${i === 0 ? 'text-gray-900' : 'text-gray-400'}`}>{n}</div>
              <div className={`mx-auto mt-2 max-w-48 text-sm ${i === 0 ? 'text-gray-900' : 'text-gray-500'}`}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Integrations() {
  const tools = [
    { label: 'Google Maps', icon: MapPin, pos: 'left-[6%] top-[12%]' },
    { label: 'Gmail', icon: Mail, pos: 'right-[6%] top-[12%]' },
    { label: 'Calendar', icon: Calendar, pos: 'left-0 top-1/2 -translate-y-1/2' },
    { label: 'Contacts', icon: Contact, pos: 'right-0 top-1/2 -translate-y-1/2' },
    { label: 'Slides', icon: Presentation, pos: 'left-[6%] bottom-[12%]' },
    { label: 'Web search', icon: Globe, pos: 'right-[6%] bottom-[12%]' },
  ]
  const how = [
    { icon: MessageSquare, title: 'Tell Evently about your event.', body: 'Pick a type or describe it in a sentence. You get a full workflow in seconds.' },
    { icon: Workflow, title: 'Shape the workflow.', body: 'Add, remove or reorder steps by chatting. The flowchart updates as you go.' },
    { icon: Bot, title: 'Let the agents run.', body: 'Each step gets an agent that researches, drafts and reports back for your approval.' },
  ]
  return (
    <section id="integrations" className="relative overflow-hidden bg-[#0f1033] py-28 text-white">
      <div aria-hidden className="pointer-events-none absolute -right-40 bottom-0 h-[500px] w-[900px] rounded-full bg-[conic-gradient(from_180deg,#6366f1,#ec4899,#8b5cf6,#38bdf8,#6366f1)] opacity-25 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-6">
        <Heading
          dark
          lead="Agents that work in the tools you already use."
          rest="Connect your Google account once and every agent can search, draft and schedule on your behalf."
          className="max-w-4xl"
        />
        <div className="mt-10 flex flex-wrap gap-3">
          <PrimaryButton>Connect Google</PrimaryButton>
          <button className="rounded-full px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/20 hover:ring-white/50">See all integrations</button>
        </div>

        {/* Hub diagram */}
        <div className="relative mx-auto mt-20 h-80 max-w-3xl rounded-[40px] bg-[radial-gradient(#ffffff14_1px,transparent_1px)] [background-size:16px_16px]">
          <svg className="absolute inset-0 size-full" aria-hidden>
            {[
              ['20%', '22%'],
              ['80%', '22%'],
              ['10%', '50%'],
              ['90%', '50%'],
              ['20%', '78%'],
              ['80%', '78%'],
            ].map(([x, y]) => (
              <line key={x + y} x1="50%" y1="50%" x2={x} y2={y} stroke="#818cf8" strokeOpacity="0.5" strokeDasharray="3 5" />
            ))}
          </svg>
          <div className="absolute top-1/2 left-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[28px] bg-gradient-to-br from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-500/50">
            <Sparkles size={30} />
          </div>
          {tools.map(({ label, icon: Icon, pos }) => (
            <div key={label} className={`absolute flex items-center gap-2 rounded-full bg-indigo-500/90 px-4 py-2 text-sm font-medium shadow-lg ${pos}`}>
              <Icon size={14} /> {label}
            </div>
          ))}
        </div>

        <div id="how" className="mt-28 border-t border-white/10 pt-20">
          <Heading dark lead="How it works." rest="Three steps from blank page to booked." className="max-w-3xl" />
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {how.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="rounded-[32px] bg-white/5 p-7 ring-1 ring-white/10">
                <div className="mb-6 flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30">
                    <Icon size={18} />
                  </span>
                  <span className="font-mono text-xs text-indigo-300/70">0{i + 1}</span>
                </div>
                <p className="leading-relaxed">
                  <b className="font-semibold">{title}</b> <span className="text-indigo-100/60">{body}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-[32px] bg-black/30 p-6 font-mono text-xs leading-6 ring-1 ring-white/10">
            <div className="text-indigo-300">› evently run hackathon --people 200 --city Austin</div>
            <div className="text-white/50">  ✓ Venue Scout      3 venues match · 24h access · Wi-Fi</div>
            <div className="text-white/50">  ✓ Sponsor Hunter   12 companies shortlisted · drafts ready</div>
            <div className="text-white/50">  ◌ Caterer          requesting quotes near The Foundry…</div>
            <div className="text-white/50">  · Scheduler        waiting on Location, Judges</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function UseCases({ onStart }: Props) {
  const cases = [
    { type: 'hackathon', grad: 'from-indigo-600 via-violet-600 to-fuchsia-500', line: 'Sponsors, prizes, judges and a 24-hour schedule.' },
    { type: 'conference', grad: 'from-sky-500 via-indigo-500 to-violet-600', line: 'Speakers, tracks, ticketing and hotel blocks.' },
    { type: 'wedding', grad: 'from-pink-400 via-rose-400 to-violet-500', line: 'Venue, vendors, guest list and the day-of timeline.' },
    { type: 'business', grad: 'from-slate-800 via-indigo-800 to-indigo-500', line: 'Offsites and launches with invites and follow-ups.' },
    { type: 'reunion', grad: 'from-amber-300 via-pink-400 to-indigo-500', line: 'Find old friends, poll a date, share the photos.' },
  ] as const
  return (
    <section id="use-cases" className="py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">A workflow for every kind of event</h2>
            <div className="mt-6">
              <PrimaryButton onClick={onStart}>Start planning</PrimaryButton>
            </div>
          </div>
          <p className="text-lg text-gray-500 lg:max-w-md lg:justify-self-end">
            Each template comes with the steps planners actually use — and every step can be edited, removed or handed to an agent.
          </p>
        </div>

        <div className="-mx-6 mt-14 flex snap-x gap-4 overflow-x-auto px-6 pb-4">
          {cases.map(({ type, grad, line }) => {
            const meta = EVENT_TYPES.find((e) => e.id === type)!
            return (
              <div key={type} className="w-72 shrink-0 snap-start">
                <div className={`relative flex h-96 items-end overflow-hidden rounded-[32px] bg-gradient-to-br p-6 ${grad}`}>
                  <span className="absolute top-8 left-1/2 -translate-x-1/2 text-8xl opacity-90 drop-shadow-xl">{meta.emoji}</span>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,#ffffff40,transparent_50%)]" />
                  <span className="relative text-2xl font-bold text-white">{meta.label}</span>
                </div>
                <p className="mt-4 text-gray-700">{line}</p>
                <div className="mt-3">
                  <TextLink onClick={onStart}>Plan a {meta.label.toLowerCase()}</TextLink>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {[
            { b: 'Start from a sentence.', t: 'Type “a 120-guest wedding in Napa in June” and Evently fills in the details.', l: 'Try it now', g: 'from-fuchsia-500 to-indigo-600' },
            { b: 'Bring your team.', t: 'Share the workflow so co-organizers can review what each agent found.', l: 'Invite organizers', g: 'from-amber-300 to-pink-500' },
          ].map(({ b, t, l, g }) => (
            <div key={b} className="relative overflow-hidden rounded-[32px] bg-gray-50 p-8 ring-1 ring-gray-900/5">
              <div className={`absolute -right-10 -bottom-16 size-56 rotate-12 rounded-[48px] bg-gradient-to-br opacity-90 ${g}`} />
              <p className="relative max-w-sm leading-relaxed">
                <b className="font-semibold">{b}</b> <span className="text-gray-500">{t}</span>
              </p>
              <div className="relative mt-4">
                <TextLink onClick={onStart}>{l}</TextLink>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta({ onStart }: Props) {
  return (
    <section className="bg-gray-50/70 py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to plan your next event?</h2>
          <p className="mt-4 max-w-md text-lg text-gray-500">Create an account in seconds and get your first workflow before your coffee cools.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <PrimaryButton onClick={onStart}>Start now</PrimaryButton>
            <SecondaryButton onClick={onStart}>Sign in</SecondaryButton>
          </div>
        </div>
        <div>
          <span className="mb-4 grid size-11 place-items-center rounded-full bg-accent-soft text-accent">
            <Workflow size={18} />
          </span>
          <h3 className="font-semibold">Templates included</h3>
          <p className="mt-1 text-gray-500">Business, conference, hackathon, wedding and reunion workflows out of the box.</p>
          <div className="mt-3">
            <TextLink onClick={onStart}>Browse templates</TextLink>
          </div>
        </div>
        <div>
          <span className="mb-4 grid size-11 place-items-center rounded-full bg-accent-soft text-accent">
            <GoogleG />
          </span>
          <h3 className="font-semibold">Works with Google</h3>
          <p className="mt-1 text-gray-500">Maps, Gmail, Calendar, Contacts and Slides — connected with one sign-in.</p>
          <div className="mt-3">
            <TextLink onClick={onStart}>Connect account</TextLink>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const cols = {
    Product: ['Workflows', 'Agents', 'Integrations', 'Live slides', 'Pricing'],
    'Use cases': ['Hackathons', 'Conferences', 'Weddings', 'Business events', 'Reunions'],
    Resources: ['Guides', 'Templates', 'Help center', 'Changelog'],
    Company: ['About', 'Careers', 'Contact', 'Privacy', 'Terms'],
  }
  return (
    <footer className="border-t border-gray-900/5 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid gap-12 md:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-gray-500">AI agents that plan, coordinate and streamline your events.</p>
            <form onSubmit={(e) => e.preventDefault()} className="mt-6 flex max-w-sm gap-2 rounded-full bg-gray-50 p-1.5 ring-1 ring-gray-900/10 focus-within:ring-2 focus-within:ring-accent">
              <input type="email" placeholder="Enter your email" className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
              <button className="inline-flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white">
                Subscribe <ArrowRight size={14} />
              </button>
            </form>
          </div>
          {Object.entries(cols).map(([h, links]) => (
            <div key={h}>
              <h4 className="text-sm font-semibold">{h}</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-gray-500">
                {links.map((l) => (
                  <li key={l}>
                    <a href="#" className="hover:text-accent">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex items-center justify-between border-t border-gray-900/5 pt-8 text-sm text-gray-400">
          <span>© {YEAR} Evently</span>
          <span className="flex items-center gap-1.5">
            <Globe size={14} /> English
          </span>
        </div>
      </div>
    </footer>
  )
}
