import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Check, ChevronUp, ExternalLink, Link2, Loader2, Mail, Phone, Plus, RotateCw, Star, Users, X } from 'lucide-react'
import { useState, type FormEvent, type MouseEvent } from 'react'
import type { Field, FieldKey } from '../lib/options'
import type { TaskResult } from '../types'

export type Decision = 'approved' | 'ignored'

export type ResultItem =
  // `implied`: approved only because the whole plan was approved. `planApproved`: agents act on approved options.
  | { kind: 'result'; n: number; result: TaskResult; decision?: Decision; implied?: boolean; planApproved?: boolean }
  | { kind: 'loading'; agent: string }
  | { kind: 'locked'; integration: string }
  | { kind: 'error'; message: string }
  | { kind: 'add'; fields: Field[] }

export interface ResultNodeData extends Record<string, unknown> {
  item: ResultItem
  size: { w: number; h: number }
  expanded: boolean
  city: string
  // Todo indexes the user has checked off.
  checked: Set<number>
  onOpen: () => void
  onDecide: (d: Decision) => void
  onToggleTodo: (i: number) => void
  onConnectGoogle: () => void
  onRetry: () => void
  onAdd: (values: Partial<Record<FieldKey, string>>) => void
}

export type ResultNodeType = Node<ResultNodeData, 'result'>

// Keep clicks on controls from toggling the node.
const stop = (e: MouseEvent) => e.stopPropagation()

// Whole-card colour for a decision.
const TONE = {
  approved: 'bg-emerald-50 ring-emerald-300',
  ignored: 'bg-rose-50 ring-rose-300',
  none: 'bg-white ring-accent/20',
} as const

const mapsUrl = (r: TaskResult, city: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.title} ${r.address ?? city}`)}`

export default function ResultNode({ data }: NodeProps<ResultNodeType>) {
  const { item, size, expanded, onConnectGoogle } = data
  const tone = item.kind === 'add' && !expanded ? 'bg-white/60 ring-transparent' : TONE[(item.kind === 'result' && item.decision) || 'none']
  const clickable = item.kind === 'result' || (item.kind === 'add' && !expanded)

  return (
    <div
      style={{ width: size.w, height: size.h }}
      onClick={clickable ? data.onOpen : stop}
      className={`nodrag nopan flex flex-col overflow-hidden rounded-2xl ring-1 transition-[background-color,box-shadow] duration-300 ${tone} ${
        expanded ? 'shadow-xl outline-2 outline-offset-3 outline-accent' : 'shadow-md hover:shadow-lg'
      } ${item.kind === 'add' && !expanded ? 'border-2 border-dashed border-accent/40 hover:border-accent' : ''} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-accent/50" />

      {item.kind === 'loading' && (
        <div className="flex h-full items-center gap-2 px-4 text-sm text-accent">
          <Loader2 size={15} className="animate-spin" /> {item.agent} is searching…
        </div>
      )}

      {item.kind === 'add' &&
        (expanded ? (
          <AddForm fields={item.fields} onAdd={data.onAdd} onCancel={data.onOpen} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm font-semibold text-accent">
            <span className="grid size-6 place-items-center rounded-full bg-accent-soft">
              <Plus size={14} strokeWidth={2.5} />
            </span>
            Add option
          </div>
        ))}

      {item.kind === 'error' && (
        <div className="flex h-full items-center gap-3 bg-rose-50 px-4">
          <AlertTriangle size={16} className="shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-semibold text-rose-700">Agent run failed</div>
            <div className="truncate text-rose-700/70">{item.message}</div>
          </div>
          <button
            onClick={(e) => {
              stop(e)
              data.onRetry()
            }}
            className="flex shrink-0 items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <RotateCw size={12} /> Retry
          </button>
        </div>
      )}

      {item.kind === 'locked' && (
        <div className="flex h-full items-center gap-3 px-4">
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-semibold">Needs {item.integration}</div>
            <div className="text-muted">Connect Google to fetch results</div>
          </div>
          <button
            onClick={(e) => {
              stop(e)
              onConnectGoogle()
            }}
            className="flex shrink-0 items-center gap-1 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Link2 size={12} /> Connect
          </button>
        </div>
      )}

      {item.kind === 'result' && (
        <>
          <Summary item={item} expanded={expanded} />
          {expanded && <Details data={data} item={item} />}
        </>
      )}
    </div>
  )
}

function Summary({ item, expanded }: { item: Extract<ResultItem, { kind: 'result' }>; expanded: boolean }) {
  const { n, result: r, decision, implied, planApproved } = item
  const badge = decision === 'approved' ? 'bg-emerald-500 text-white' : decision === 'ignored' ? 'bg-rose-500 text-white' : 'bg-accent text-white'
  return (
    <div className={`flex shrink-0 items-center gap-3 px-3.5 ${expanded ? 'border-b border-gray-900/5 py-3' : 'h-full'}`}>
      <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${badge}`}>
        {decision === 'approved' ? <Check size={12} strokeWidth={3} /> : decision === 'ignored' ? <X size={12} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`truncate font-semibold ${expanded ? 'text-base' : 'text-[13px]'}`}>{r.title}</div>
        <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-gray-600">
          {r.rating !== undefined && (
            <span className="flex items-center gap-0.5 font-medium text-ink">
              <Star size={10} className="fill-amber-400 text-amber-400" />
              {r.rating.toFixed(1)}
            </span>
          )}
          {r.capacity && (
            <span className="flex items-center gap-0.5">
              <Users size={10} /> {r.capacity.replace('Fits ', '')}
            </span>
          )}
          <span className="truncate">{r.price ?? r.subtitle}</span>
        </div>
        <div className="truncate text-[11px] text-muted">{r.address ?? r.contact?.name ?? r.meta}</div>
      </div>
      {expanded ? (
        <ChevronUp size={16} className="shrink-0 text-muted" />
      ) : (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
            decision === 'approved'
              ? 'bg-emerald-100 text-emerald-700 ring-emerald-300'
              : decision === 'ignored'
                ? 'bg-rose-100 text-rose-700 ring-rose-300'
                : 'bg-white text-muted ring-gray-900/10'
          }`}
        >
          {decision === 'approved' ? (implied ? 'Auto-approved' : 'Approved') : decision === 'ignored' ? (planApproved ? 'Ignored · won’t run' : 'Ignored') : 'Pending'}
        </span>
      )}
    </div>
  )
}

function Details({ data, item }: { data: ResultNodeData; item: Extract<ResultItem, { kind: 'result' }> }) {
  const { city, checked, onDecide, onToggleTodo } = data
  const r = item.result
  const todo = r.todo ?? []
  const done = todo.filter((_, i) => checked.has(i)).length

  return (
    <div onClick={stop} className="nowheel flex min-h-0 flex-1 cursor-default flex-col gap-4 overflow-y-auto p-4 text-sm">
      {r.why && (
        <div>
          <Label>Why it fits</Label>
          <p className="text-[13px] leading-relaxed text-gray-700">{r.why}</p>
        </div>
      )}

      {todo.length > 0 && (
        <div>
          <Label>
            What we need to do
            <span className="ml-auto font-mono text-[10px] text-muted normal-case">
              {done}/{todo.length}
            </span>
          </Label>
          <ul className="space-y-1.5">
            {todo.map((t, i) => (
              <li key={t}>
                <button onClick={() => onToggleTodo(i)} className="flex w-full items-start gap-2.5 text-left text-[13px]">
                  <span
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-md ring-1 transition ${
                      checked.has(i) ? 'bg-accent text-white ring-accent' : 'bg-white ring-gray-300'
                    }`}
                  >
                    {checked.has(i) && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className={checked.has(i) ? 'text-muted line-through' : ''}>{t}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.contact && (
        <div>
          <Label>Contact</Label>
          <div className="rounded-xl bg-white/80 p-3 text-xs ring-1 ring-gray-900/5">
            <div className="font-semibold">
              {r.contact.name}
              {r.contact.role && <span className="font-normal text-muted"> · {r.contact.role}</span>}
            </div>
            {r.contact.email && (
              <div className="mt-1 flex items-center gap-1.5 text-gray-600">
                <Mail size={11} /> {r.contact.email}
              </div>
            )}
            {r.contact.phone && (
              <div className="mt-0.5 flex items-center gap-1.5 text-gray-600">
                <Phone size={11} /> {r.contact.phone}
              </div>
            )}
          </div>
        </div>
      )}

      {r.draft && (
        <div>
          <Label>Draft outreach</Label>
          <p className="rounded-xl bg-white/80 p-3 text-xs leading-relaxed text-gray-700 ring-1 ring-gray-900/5">{r.draft}</p>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <button
          onClick={() => onDecide('approved')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold transition ${
            item.decision === 'approved'
              ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/30'
              : 'bg-white text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-50'
          }`}
        >
          <Check size={12} strokeWidth={3} /> {item.decision === 'approved' ? 'Approved' : 'Approve'}
        </button>
        <button
          onClick={() => onDecide('ignored')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold transition ${
            item.decision === 'ignored'
              ? 'bg-rose-600 text-white shadow-sm shadow-rose-500/30'
              : 'bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50'
          }`}
        >
          <X size={12} strokeWidth={3} /> {item.decision === 'ignored' ? 'Ignored' : 'Ignore'}
        </button>
        {r.pin && (
          <a
            href={mapsUrl(r, city)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-accent ring-1 ring-gray-900/10 hover:ring-accent"
          >
            Maps <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  )
}

function AddForm({
  fields,
  onAdd,
  onCancel,
}: {
  fields: Field[]
  onAdd: (values: Partial<Record<FieldKey, string>>) => void
  onCancel: () => void
}) {
  const [values, setValues] = useState<Partial<Record<FieldKey, string>>>({})
  const set = (k: FieldKey, v: string) => setValues((s) => ({ ...s, [k]: v }))
  const ready = !!values.title?.trim()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready) onAdd(values)
  }
  const input =
    'mt-1 w-full rounded-xl bg-white px-3 py-1.5 text-sm font-normal tracking-normal text-ink normal-case ring-1 ring-gray-900/10 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-accent'

  return (
    <form onSubmit={submit} onClick={stop} className="nowheel flex h-full cursor-default flex-col gap-3 overflow-y-auto p-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-accent">
          <Plus size={14} strokeWidth={2.5} />
        </span>
        <span className="flex-1 text-base font-semibold">Add an option</span>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="rounded-full p-1 text-muted hover:bg-gray-100">
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {fields.map((f, i) => (
          <label key={f.key} className={`text-[10px] font-semibold tracking-wide text-muted uppercase ${f.half ? '' : 'col-span-2'}`}>
            {f.label}
            {f.required && <span className="text-rose-500"> *</span>}
            {f.type === 'textarea' ? (
              <textarea rows={2} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className={`${input} resize-none`} />
            ) : (
              <input
                autoFocus={i === 0}
                type={f.type ?? 'text'}
                step={f.key === 'rating' ? '0.1' : undefined}
                min={f.type === 'number' ? 0 : undefined}
                max={f.key === 'rating' ? 5 : undefined}
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                className={input}
              />
            )}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={!ready}
        className="mt-auto flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:bg-indigo-500 disabled:opacity-40"
      >
        <Plus size={12} strokeWidth={3} /> Add to list
      </button>
    </form>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 flex items-center text-[10px] font-semibold tracking-wide text-muted uppercase">{children}</div>
}
