import { MessageCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import IntakePage from './components/IntakePage'
import Landing from './components/Landing'
import MarketingPage from './components/MarketingPage'
import PlanLoader from './components/PlanLoader'
import WorkflowCanvas from './components/WorkflowCanvas'
import { DEFAULT_HEADCOUNT, EVENT_TYPES, buildWorkflow, needsGoogle } from './data/workflows'
import { runAgent } from './lib/agents'
import { interpret, type ChatAction } from './lib/chat'
import { extractAnswers, mergeFound } from './lib/extract'
import { addRecent } from './lib/recent'
import { BUILD_NOW, QUESTIONS, SKIP, isRequired, missingRequired, nextQuestion, type IntakeAnswers } from './lib/intake'
import type { ChatMessage, EventDetails, EventType, Task, TaskResult } from './types'

let msgSeq = 0
const msg = (role: ChatMessage['role'], text: string): ChatMessage => ({ id: `m${++msgSeq}`, role, text })

// Short names for intake questions, for "I filled in: date, budget".
const LABEL: Record<string, string> = {
  goal: 'goal', date: 'date', headcount: 'headcount', city: 'location', budget: 'budget', approver: 'approver',
  audience: 'audience', format: 'format', food: 'food', accessibility: 'accessibility', features: 'must-haves',
  booked: 'bookings', tickets: 'registration', branding: 'branding', constraints: 'constraints', contact: 'updates',
}
const describe = (ids: string[]) => ids.map((id) => LABEL[id] ?? id).join(', ')

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function applyAction(tasks: Task[], a: ChatAction): Task[] {
  if (a.kind === 'add') {
    let id = slug(a.title) || 'task'
    while (tasks.some((t) => t.id === id)) id += '-2'
    const parent = a.after ?? tasks[0]?.id
    return [
      ...tasks,
      {
        id,
        title: a.title,
        description: `Custom step added from chat: ${a.title}.`,
        agent: 'Research',
        integration: 'web',
        dependsOn: parent ? [parent] : [],
        status: 'idle',
      },
    ]
  }
  if (a.kind === 'remove') {
    const gone = tasks.find((t) => t.id === a.id)
    if (!gone) return tasks
    // Children of the removed step inherit its dependencies so the graph stays connected.
    return tasks
      .filter((t) => t.id !== a.id)
      .map((t) =>
        t.dependsOn.includes(a.id)
          ? { ...t, dependsOn: [...new Set([...t.dependsOn.filter((d) => d !== a.id), ...gone.dependsOn])] }
          : t,
      )
  }
  return tasks
}

export default function App() {
  // TODO: replace with real auth (Google sign-in) once the backend exists.
  const [signedIn, setSignedIn] = useState(false)
  const [event, setEvent] = useState<EventDetails | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [building, setBuilding] = useState(false)
  const [approved, setApproved] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // Assistant messages already seen; the rest show as an unread badge on the chat button.
  const [seen, setSeen] = useState(0)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [answers, setAnswers] = useState<IntakeAnswers>({})
  // True while the chat is asking its setup questions, before the plan is drawn.
  const [intake, setIntake] = useState(false)
  // Why the last intake answer was rejected, shown under the question.
  const [intakeNote, setIntakeNote] = useState<string | null>(null)
  // Question ids answered by the landing page (event type, plus any headcount or city in the prompt).
  const [prefilled, setPrefilled] = useState<string[]>([])
  // True while Claude reads a typed description for answers.
  const [extracting, setExtracting] = useState(false)
  // Tells the user what Claude filled in from their typed text.
  const [intakeInfo, setIntakeInfo] = useState<string | null>(null)
  // Bumped on every pick, so a slow extraction for an abandoned event is ignored.
  const pickSeq = useRef(0)
  const started = useRef(new Set<string>())

  const pick = (type: EventType, note?: string) => {
    const meta = EVENT_TYPES.find((e) => e.id === type)!
    const wf = buildWorkflow(type)
    addRecent({ type, note })
    // Pull headcount / city out of a free-text landing prompt like "200-person hackathon in Austin".
    const patch = Object.assign(
      {},
      ...interpret(note?.replace(/-person/i, ' people') ?? '', wf).actions.flatMap((a) => (a.kind === 'details' ? [a.patch] : [])),
    )
    setEvent({ type, headcount: DEFAULT_HEADCOUNT[type], city: 'San Francisco', date: '', ...patch })
    setTasks(wf)
    setSelectedId(null)
    setRunning(false)
    setApproved(false)
    setBuilding(false)
    setIntake(true)
    setChatOpen(false)
    setSeen(0)
    started.current.clear()
    // Details already given in the landing prompt count as answered.
    const pre: IntakeAnswers = { type: meta.label }
    if (patch.headcount) pre.headcount = String(patch.headcount)
    if (patch.city) pre.city = patch.city
    setAnswers(pre)
    setPrefilled(Object.keys(pre))
    setIntakeNote(null)
    setIntakeInfo(null)
    setMessages([msg('user', note ?? meta.label)])
    const seq = ++pickSeq.current
    if (!note) return setExtracting(false)
    // Let Claude fill in anything else the landing prompt already says (date, budget, food, …).
    setExtracting(true)
    extractAnswers(note, meta.label, pre)
      .then((found) => {
        if (seq !== pickSeq.current) return
        const merged = mergeFound(pre, found)
        setEvent((e) => (e ? { ...e, ...merged.patch } : e))
        setAnswers(merged.answers)
        setPrefilled(Object.keys(merged.answers))
        if (merged.added.length) setIntakeInfo(`From your description I filled in: ${describe(merged.added)}.`)
        if (!nextQuestion(merged.answers)) finishIntake(wf.length)
      })
      .finally(() => seq === pickSeq.current && setExtracting(false))
  }

  // Ends the questions and draws the plan. The draft message waits in the chat as an unread message.
  const finishIntake = (steps = tasks.length) => {
    setMessages((m) => [
      ...m,
      msg(
        'assistant',
        `Thanks! Here's a draft plan with ${steps} steps — each one gets its own agent. What would you like to edit? When it looks right, hit Approve plan.`,
      ),
    ])
    setSeen(0)
    setIntake(false)
    setBuilding(true)
  }

  const answer = (text: string) => {
    const q = nextQuestion(answers)!
    setIntakeInfo(null)
    if (text.toLowerCase() === BUILD_NOW.toLowerCase()) {
      const missing = missingRequired(answers)
      if (!missing.length) return finishIntake()
      return setIntakeNote(`I still need ${missing.length} required answer${missing.length > 1 ? 's' : ''} first.`)
    }
    const skipped = text.toLowerCase() === SKIP.toLowerCase()
    if (skipped && isRequired(q)) return setIntakeNote("This one is required, so it can't be skipped.")
    const patch = skipped ? {} : q.parse ? q.parse(text) : {}
    if (!patch) return setIntakeNote(q.id === 'headcount' ? 'Please include a number, like “250 people”.' : "I didn't catch that. Try again?")
    setIntakeNote(null)
    if (Object.keys(patch).length) setEvent((e) => (e ? { ...e, ...patch } : e))
    const next = { ...answers, [q.id]: skipped ? '' : text }
    setAnswers(next)
    if (!nextQuestion(next)) finishIntake()
  }

  // Typed text can answer several questions at once ("Dec 5, about $10k, vegan food"), so Claude reads it first.
  // If it finds nothing, the text is taken as the answer to the question on screen.
  const answerFreeText = async (text: string) => {
    const q = nextQuestion(answers)
    if (!q || !event) return
    setExtracting(true)
    const seq = pickSeq.current
    const found = await extractAnswers(text, EVENT_TYPES.find((e) => e.id === event.type)!.label, answers, q.id)
    if (seq !== pickSeq.current) return
    setExtracting(false)
    const merged = mergeFound(answers, found)
    if (!merged.added.length) return answer(text)
    setIntakeNote(null)
    setIntakeInfo(`Got it. I filled in: ${describe(merged.added)}.`)
    setEvent((e) => (e ? { ...e, ...merged.patch } : e))
    setAnswers(merged.answers)
    if (!nextQuestion(merged.answers)) finishIntake()
  }

  // Reopens the closest answered question before the one on screen. Pre-filled answers stay locked.
  const intakeBack = () => {
    const at = QUESTIONS.indexOf(nextQuestion(answers)!)
    const prev = QUESTIONS.slice(0, at).findLast((q) => q.id in answers && !prefilled.includes(q.id))
    if (!prev) return
    const rest = { ...answers }
    delete rest[prev.id]
    setAnswers(rest)
    setIntakeNote(null)
  }


  const send = (text: string) => {
    const { reply, actions } = interpret(text, tasks)
    let next = tasks
    for (const a of actions) {
      if (a.kind === 'details') setEvent((e) => (e ? { ...e, ...a.patch } : e))
      else if (a.kind === 'run') setApproved(true)
      else next = applyAction(next, a)
    }
    if (next !== tasks) setTasks(next)
    setMessages((m) => [...m, msg('user', text), msg('assistant', reply)])
    if (actions.some((a) => a.kind === 'run')) startRun()
    // Any edit after approval sends the plan back to draft.
    else if (actions.some((a) => a.kind !== 'none')) setApproved(false)
  }

  const approve = () => {
    setApproved(true)
    setMessages((m) => [...m, msg('assistant', 'Plan approved. Spinning up agents — each step starts as soon as the ones it depends on finish.')])
    startRun()
  }

  const finishBuilding = useCallback(() => setBuilding(false), [])

  const startRun = () => {
    started.current.clear()
    setTasks((ts) => ts.map((t) => ({ ...t, status: 'queued', results: undefined })))
    setRunning(true)
  }

  const failTask = (id: string, e: unknown) =>
    setTasks((ts) =>
      ts.map((t) => (t.id === id ? { ...t, status: 'error', error: e instanceof Error ? e.message : 'The agent run failed.' } : t)),
    )

  // Scheduler: start every queued task whose dependencies are done.
  useEffect(() => {
    if (!running || !event) return
    const status = new Map(tasks.map((t) => [t.id, t.status]))
    const ids = new Set(tasks.map((t) => t.id))
    const updates = new Map<string, Pick<Task, 'status' | 'blockedBy'>>()

    for (const t of tasks) {
      if (t.status !== 'queued' || started.current.has(t.id)) continue
      const deps = t.dependsOn.filter((d) => ids.has(d)).map((d) => status.get(d))
      // A missing connection outranks waiting on earlier steps.
      if (needsGoogle(t.integration) && !googleConnected) updates.set(t.id, { status: 'blocked', blockedBy: 'google' })
      else if (deps.some((s) => s === 'blocked' || s === 'error')) updates.set(t.id, { status: 'blocked', blockedBy: 'deps' })
      else if (deps.every((s) => s === 'done')) {
        started.current.add(t.id)
        updates.set(t.id, { status: 'running' })
        runAgent(t, event).then(
          (results) => setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status: 'done', results } : x))),
          (e: unknown) => failTask(t.id, e),
        )
      }
    }

    if (updates.size) {
      setTasks((ts) => ts.map((t) => (updates.has(t.id) ? { ...t, blockedBy: undefined, ...updates.get(t.id)! } : t)))
      return
    }
    if (!tasks.some((t) => t.status === 'queued' || t.status === 'running')) {
      setRunning(false)
      const blocked = tasks.filter((t) => t.status === 'blocked').length
      setMessages((m) => [
        ...m,
        msg(
          'assistant',
          blocked
            ? `Finished what I could. ${blocked} step${blocked > 1 ? 's are' : ' is'} waiting on Google access — connect Google and run again.`
            : 'All agents finished. Click any step to review what they found.',
        ),
      ])
    }
  }, [tasks, running, event, googleConnected])

  // Options the user adds by hand go at the end of the step's list.
  const addOption = (id: string, result: TaskResult) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, results: [...(t.results ?? []), result] } : t)))

  // Run one step's agent on demand from its details panel, ignoring dependencies.
  const runTask = (id: string) => {
    const task = tasks.find((t) => t.id === id)
    if (!task || !event) return
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'running', results: undefined, error: undefined } : t)))
    runAgent(task, event).then(
      (results) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', results } : t))),
      (e: unknown) => failTask(id, e),
    )
  }

  const connectGoogle = () => {
    // TODO: replace with real Google OAuth (Maps, Gmail, Calendar, Contacts, Slides scopes).
    setGoogleConnected((c) => !c)
    setTasks((ts) => ts.map((t) => (t.status === 'blocked' ? { ...t, status: 'idle', blockedBy: undefined } : t)))
  }

  if (!signedIn) return <MarketingPage onStart={() => setSignedIn(true)} />
  if (!event) return <Landing onPick={pick} onHome={() => setSignedIn(false)} />
  if (intake)
    return (
      <IntakePage
        key={nextQuestion(answers)!.id}
        event={event}
        answers={answers}
        question={nextQuestion(answers)!}
        note={intakeNote}
        info={intakeInfo}
        extracting={extracting}
        onAnswer={answer}
        onFreeText={answerFreeText}
        prefilled={prefilled}
        onBack={intakeBack}
        onExit={() => setEvent(null)}
      />
    )
  if (building) return <PlanLoader event={event} tasks={tasks} onDone={finishBuilding} />

  const assistantCount = messages.filter((m) => m.role === 'assistant').length
  const unread = chatOpen ? 0 : assistantCount - seen
  const toggleChat = () => {
    setChatOpen((o) => !o)
    setSeen(assistantCount)
  }

  return (
    <main className="relative h-full bg-gray-100 p-3">
      <WorkflowCanvas
        event={event}
        onBack={() => setEvent(null)}
        onRunTask={runTask}
        onAddOption={addOption}
        tasks={tasks}
        selectedId={selectedId}
        googleConnected={googleConnected}
        approved={approved}
        running={running}
        onApprove={approve}
        onSelect={setSelectedId}
        onConnectGoogle={connectGoogle}
      />

      {chatOpen && (
        <div className="absolute right-6 bottom-24 z-20 h-[min(640px,calc(100%-9rem))] w-[420px] max-w-[calc(100%-3rem)] animate-rise">
          <ChatPanel event={event} messages={messages} onSend={send} onClose={toggleChat} />
        </div>
      )}
      <button
        onClick={toggleChat}
        aria-label={chatOpen ? 'Close chat' : 'Open chat'}
        className="absolute right-6 bottom-6 z-20 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg shadow-indigo-500/40 transition hover:scale-105 hover:bg-indigo-500"
      >
        {chatOpen ? <X size={22} /> : <MessageCircle size={22} />}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-warn text-[11px] font-bold ring-2 ring-white">
            {unread}
          </span>
        )}
      </button>
    </main>
  )
}
