import { Background, Controls, ReactFlow, type Edge, type ReactFlowInstance } from '@xyflow/react'
import { ArrowLeft, Check, CheckCircle2, Link2, Loader2, MapPin, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENT_TYPES, INTEGRATION_LABEL, gatedByGoogle } from '../data/workflows'
import { layout, type Box } from '../lib/layout'
import { addFields, addFormHeight, buildOption, type FieldKey } from '../lib/options'
import type { RunnerContext } from '../lib/runners'
import { useLiveVenueTasks } from '../features/venues/useLiveVenueTasks'
import type { EventDetails, Task, TaskResult } from '../types'
import ResultNode, { type Decision, type ResultItem, type ResultNodeType } from './ResultNode'
import TaskNode, { type TaskNodeType } from './TaskNode'

const nodeTypes = { task: TaskNode, result: ResultNode }
const MIN_READABLE_ZOOM = 0.75
const PAD = 32
const MAX_FOCUS_ZOOM = 1.1
// Matches the node transform transition in index.css.
const MOVE_MS = 450
const EMPTY = new Set<number>()
const OPTION_ZOOM = 1.2

interface Props {
  event: EventDetails
  tasks: Task[]
  selectedId: string | null
  googleConnected: boolean
  approved: boolean
  running: boolean
  onApprove: () => void
  onBack: () => void
  onRunTask: (id: string) => void
  onAddOption: (id: string, result: TaskResult) => void
  onSelect: (id: string | null) => void
  onConnectGoogle: () => void
  /** Backend context for result actions and live cards; null/absent for sample-only plans. */
  ctx?: RunnerContext | null
  /** Replace one option of a step (matched by `cardId`, else `title`). Without it the canvas keeps the edit locally. */
  onUpdateResult?: (taskId: string, next: TaskResult) => void
}

// Identity of an option within its step: its board card when it has one, else its title.
const sameResult = (a: TaskResult, b: TaskResult) => (a.cardId || b.cardId ? a.cardId === b.cardId : a.title === b.title)
const resultKey = (taskId: string, r: TaskResult) => `${taskId}:${r.cardId ?? r.title}`

// Local replacements (used when App doesn't handle onUpdateResult), applied over the step's results.
function applyOverrides(tasks: Task[], overrides: Record<string, TaskResult[]>): Task[] {
  if (!Object.keys(overrides).length) return tasks
  return tasks.map((t) => {
    const mine = overrides[t.id]
    if (!mine?.length || !t.results) return t
    return { ...t, results: t.results.map((r) => mine.find((o) => sameResult(o, r)) ?? r) }
  })
}

// What fans out of an opened step: its results, or a placeholder while it can't show any yet.
// The agent's first option shapes the hand-add form and lends it a checklist and draft.
const templateOf = (task: Task | undefined) => task?.results?.find((r) => r.meta !== 'Added by you') ?? task?.results?.[0]

// Approving the whole plan approves every option the user hasn't ignored; explicit choices win.
function decisionFor(decisions: Record<string, Decision>, planApproved: boolean, key: string): Decision | undefined {
  return decisions[key] ?? (planApproved ? 'approved' : undefined)
}

function childItems(
  task: Task | undefined,
  googleConnected: boolean,
  decisions: Record<string, Decision>,
  planApproved: boolean,
): ResultItem[] {
  if (!task) return []
  if (task.status === 'running') return [{ kind: 'loading', agent: task.agent }]
  if (task.status === 'error') return [{ kind: 'error', message: task.error ?? 'The agent run failed.' }]
  if (task.results)
    return [
      ...task.results.map((result, i): ResultItem => {
        const key = resultKey(task.id, result)
        return { kind: 'result', n: i + 1, result, decision: decisionFor(decisions, planApproved, key), implied: !decisions[key] && planApproved, planApproved }
      }),
      // Always last: lets the user add an option the agent missed.
      { kind: 'add', fields: addFields(task.id, templateOf(task)) },
    ]
  if (gatedByGoogle(task) && !googleConnected) return [{ kind: 'locked', integration: INTEGRATION_LABEL[task.integration] }]
  return []
}

export default function WorkflowCanvas({
  event,
  tasks: rawTasks,
  selectedId,
  googleConnected,
  approved,
  running,
  onApprove,
  onBack,
  onRunTask,
  onAddOption,
  onSelect,
  onConnectGoogle,
  ctx = null,
  onUpdateResult,
}: Props) {
  // Edits kept here only when App doesn't take onUpdateResult.
  const [overrides, setOverrides] = useState<Record<string, TaskResult[]>>({})
  const edited = useMemo(() => applyOverrides(rawTasks, overrides), [rawTasks, overrides])
  // Venue options follow their board cards live while research agents fill them in.
  const tasks = useLiveVenueTasks(edited, ctx)
  const updateResult = useCallback(
    (taskId: string, next: TaskResult) => {
      if (onUpdateResult) return onUpdateResult(taskId, next)
      setOverrides((o) => ({ ...o, [taskId]: [...(o[taskId] ?? []).filter((r) => !sameResult(r, next)), next] }))
    },
    [onUpdateResult],
  )
  // `open` is the step whose children are mounted; `spread` animates them out of / back into it.
  const [open, setOpen] = useState<string | null>(null)
  const [spread, setSpread] = useState(false)
  // Approve / ignore per option, keyed `${step}:${title}`.
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  // The option the user clicked into, plus per-option progress (keyed `${step}:${title}`).
  const [focus, setFocus] = useState<number | null>(null)
  const [checked, setChecked] = useState<Record<string, Set<number>>>({})

  const openTask = tasks.find((t) => t.id === open)
  const items = useMemo(() => childItems(openTask, googleConnected, decisions, approved), [openTask, googleConnected, decisions, approved])
  const itemsKey = `${open}:${items.length}:${items[0]?.kind ?? ''}`

  // Selection changed: tuck the current children back in, then open the new step.
  useEffect(() => {
    if (selectedId === open) return
    setFocus(null)
    setSpread(false)
    const t = window.setTimeout(() => setOpen(selectedId), open ? MOVE_MS : 0)
    return () => clearTimeout(t)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Children mounted (or swapped, e.g. "searching…" → results): start them at the parent, then fan out.
  useEffect(() => {
    if (!open || open !== selectedId || !items.length) return
    setSpread(false)
    let inner = 0
    const outer = requestAnimationFrame(() => (inner = requestAnimationFrame(() => setSpread(true))))
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [itemsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const focused = focus != null ? items[focus] : undefined
  const focusedAdd = focused?.kind === 'add' ? focused : undefined

  const { boxes, children } = useMemo(
    () =>
      layout(
        tasks,
        open ? { id: open, count: items.length, spread, focus, focusH: focusedAdd ? addFormHeight(focusedAdd.fields) : undefined } : null,
      ),
    [tasks, open, items, spread, focus, focusedAdd],
  )

  // Clicking the current decision again clears it.
  const decide = useCallback(
    (key: string, d: Decision) =>
      setDecisions((all) => {
        const next = { ...all }
        if (next[key] === d) delete next[key]
        else next[key] = d
        return next
      }),
    [],
  )

  // Per step: options approved (drives the check) and options reviewed either way (the label).
  const { approvedCount, reviewedCount } = useMemo(() => {
    const approvedCount: Record<string, number> = {}
    const reviewedCount: Record<string, number> = {}
    for (const t of tasks) {
      for (const r of t.results ?? []) {
        const d = decisionFor(decisions, approved, resultKey(t.id, r))
        if (d) reviewedCount[t.id] = (reviewedCount[t.id] ?? 0) + 1
        if (d === 'approved') approvedCount[t.id] = (approvedCount[t.id] ?? 0) + 1
      }
    }
    return { approvedCount, reviewedCount }
  }, [tasks, decisions, approved])

  const keyOf = (item: ResultItem) => (item.kind === 'result' && open ? resultKey(open, item.result) : '')

  const toggleTodo = useCallback((key: string, i: number) => {
    setChecked((c) => {
      const next = new Set(c[key])
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return { ...c, [key]: next }
    })
  }, [])

  // Save a hand-added option; it counts as approved since the user picked it.
  const addOption = (values: Partial<Record<FieldKey, string>>) => {
    if (!open || !openTask || !values.title?.trim()) return
    const taken = new Set(openTask.results?.map((r) => r.title))
    const base = values.title.trim()
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base} (${n})`
    onAddOption(open, buildOption({ ...values, title: name }, templateOf(openTask)))
    setDecisions((d) => ({ ...d, [`${open}:${name}`]: 'approved' }))
    setFocus(null)
  }

  const connectAndRun = useCallback(() => {
    onConnectGoogle()
    if (open) onRunTask(open)
  }, [onConnectGoogle, onRunTask, open])

  const nodes = useMemo<(TaskNodeType | ResultNodeType)[]>(
    () => [
      ...tasks.map(
        (task): TaskNodeType => ({
          id: task.id,
          type: 'task',
          position: { x: boxes[task.id].x, y: boxes[task.id].y },
          data: { task, selected: task.id === selectedId, approved: approvedCount[task.id] ?? 0, reviewed: reviewedCount[task.id] ?? 0, googleConnected, planApproved: approved },
          draggable: false,
          zIndex: task.id === open ? 2 : 1,
        }),
      ),
      ...items.map(
        (item, i): ResultNodeType => ({
          id: `${open}::${i}`,
          type: 'result',
          position: { x: children[i].x, y: children[i].y },
          data: {
            item,
            task: openTask!,
            event,
            ctx,
            size: { w: children[i].w, h: children[i].h },
            expanded: focus === i,
            city: event.city,
            checked: checked[keyOf(item)] ?? EMPTY,
            onOpen: () => setFocus((f) => (f === i ? null : i)),
            onDecide: (d: Decision) => decide(keyOf(item), d),
            onToggleTodo: (t: number) => toggleTodo(keyOf(item), t),
            onConnectGoogle: connectAndRun,
            onRetry: () => open && onRunTask(open),
            onAdd: addOption,
            onUpdateResult: (next: TaskResult) => open && updateResult(open, next),
          },
          draggable: false,
          selectable: false,
          zIndex: focus === i ? 3 : 0,
          style: { opacity: spread ? 1 : 0, transition: 'opacity 0.3s' },
        }),
      ),
    ],
    [tasks, boxes, children, items, open, selectedId, spread, focus, checked, approvedCount, reviewedCount, googleConnected, approved, event, ctx, openTask, decide, toggleTodo, connectAndRun, updateResult], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const flowRef = useRef<ReactFlowInstance<TaskNodeType | ResultNodeType> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const fitTo = (all: Box[], maxZoom: number, duration: number) => {
    const rf = flowRef.current
    const box = boxRef.current?.getBoundingClientRect()
    if (!rf || !box || !all.length) return
    const minX = Math.min(...all.map((b) => b.x))
    const minY = Math.min(...all.map((b) => b.y))
    const w = Math.max(...all.map((b) => b.x + b.w)) - minX
    const h = Math.max(...all.map((b) => b.y + b.h)) - minY
    const fit = Math.min((box.width - PAD * 2) / w, (box.height - PAD * 2) / h, maxZoom)
    const zoom = Math.max(fit, MIN_READABLE_ZOOM)
    // Too big to fit at a readable zoom: anchor on the left edge and let the user pan.
    const x = fit >= MIN_READABLE_ZOOM ? (box.width - w * zoom) / 2 - minX * zoom : PAD - minX * zoom
    rf.setViewport({ x, y: (box.height - h * zoom) / 2 - minY * zoom, zoom }, { duration })
  }

  // Whole chart when nothing is open; the opened step and its children once they've fanned out.
  // A clicked option gets zoomed onto on its own.
  const frame = () => {
    if (spread && focus != null && children[focus]) fitTo([children[focus]], OPTION_ZOOM, 700)
    else if (spread && open && boxes[open]) fitTo([boxes[open], ...children], MAX_FOCUS_ZOOM, 700)
    else if (!selectedId) fitTo(Object.values(boxes), 1, 500)
  }
  useEffect(frame, [tasks.length, spread, open, items.length, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const edges = useMemo<Edge[]>(() => {
    const ids = new Set(tasks.map((t) => t.id))
    const deps = tasks.flatMap((t) =>
      t.dependsOn
        .filter((d) => ids.has(d))
        .map(
          (d): Edge => ({
            id: `${d}-${t.id}`,
            source: d,
            target: t.id,
            type: 'smoothstep',
            animated: t.status === 'running',
            // Fade the rest of the graph while a step is fanned out.
            style: { opacity: spread ? 0.25 : 1, transition: 'opacity 0.3s' },
          }),
        ),
    )
    const fan = items.map(
      (_, i): Edge => ({
        id: `${open}->${i}`,
        source: open!,
        target: `${open}::${i}`,
        type: 'smoothstep',
        style: { stroke: '#818cf8', strokeDasharray: '4 4', opacity: spread ? 1 : 0, transition: 'opacity 0.3s' },
      }),
    )
    return [...deps, ...fan]
  }, [tasks, items, open, spread])

  // Matches the checkmark on step nodes: agent finished and at least one option approved.
  const done = tasks.filter((t) => t.status === 'done' && approvedCount[t.id] > 0).length
  const meta = EVENT_TYPES.find((e) => e.id === event.type)!

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-3xl bg-gray-50 shadow-sm ring-1 ring-gray-900/5">
      <header className="flex items-center gap-3 border-b border-line bg-white/80 px-5 py-3.5 backdrop-blur">
        <button onClick={onBack} aria-label="Back" className="rounded-full p-2 text-muted hover:bg-line/60 hover:text-ink">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none font-bold tracking-tight">
              {meta.emoji} {meta.label} logistics
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                approved ? 'bg-accent-soft text-accent ring-accent/20' : 'bg-gray-50 text-muted ring-gray-900/10'
              }`}
            >
              {approved ? 'Approved' : 'Draft'}
            </span>
          </div>
          <div className="mt-1.5 flex gap-3 text-xs text-muted">
            <span className="flex items-center gap-1"><Users size={12} />{event.headcount} people</span>
            <span className="flex items-center gap-1"><MapPin size={12} />{event.city}</span>
            <span>{tasks.length} steps · {done} complete</span>
          </div>
        </div>
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-ok transition-all duration-500" style={{ width: `${(done / Math.max(tasks.length, 1)) * 100}%` }} />
        </div>
        <button
          onClick={onConnectGoogle}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-sm ring-1 transition ${
            googleConnected ? 'bg-ok-soft text-ok ring-ok/30' : 'bg-white ring-gray-900/10 hover:ring-accent'
          }`}
        >
          {googleConnected ? <CheckCircle2 size={13} /> : <Link2 size={13} />}
          {googleConnected ? 'Google connected' : 'Connect Google'}
        </button>
        <button
          onClick={onApprove}
          disabled={approved}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:bg-indigo-500 disabled:bg-accent-soft disabled:text-accent disabled:shadow-none"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
          {running ? 'Agents running' : approved ? 'Plan approved' : 'Approve plan'}
        </button>
      </header>

      <div ref={boxRef} className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => {
            if (n.type !== 'task') return
            if (n.id === selectedId) return onSelect(null)
            onSelect(n.id)
            // First open of a step with nothing yet: send its agent to fetch results.
            const t = tasks.find((x) => x.id === n.id)
            if (t && !t.results && t.status !== 'running' && !(gatedByGoogle(t) && !googleConnected)) onRunTask(t.id)
          }}
          onPaneClick={() => onSelect(null)}
          onInit={(rf) => {
            flowRef.current = rf
            fitTo(Object.values(boxes), 1, 0)
          }}
          panOnScroll
          nodesConnectable={false}
          minZoom={0.3}
        >
          <Background gap={22} size={1.2} color="#d1d5db" />
          <Controls showInteractive={false} position="top-right" orientation="horizontal" />
        </ReactFlow>
      </div>

    </section>
  )
}
