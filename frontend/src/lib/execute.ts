import type { EventDetails, Task, TaskResult } from '../types'

// Agents working through an approved option's "What we need to do" checklist.
//
// Backend contract (for when a real LLM replaces `runChecklist`): the server runs the option's
// checklist in order and streams one update per change, e.g. over SSE from
//   POST /api/agents/:taskId/options/:optionTitle/run   { event, option, from }
// as `{ index, status, note }`. The agent must report every item it finishes with status 'done'
// and a short note saying what it did ("Email sent to dana@…"), and report 'needs-you' for any
// item only a person can do (printing, rehearsing, signing) instead of skipping it silently.

export type TodoStatus = 'pending' | 'working' | 'done' | 'needs-you'

export interface TodoProgress {
  status: TodoStatus
  // Who finished it: the step's agent, or the user ticking it by hand.
  by?: 'agent' | 'you'
  // What the agent did, or why it needs a person.
  note?: string
}

export type Progress = Record<string, TodoProgress[]>

export const isDone = (p?: TodoProgress) => p?.status === 'done'

// --- Stand-in agent, until the backend exists. Every note below is made up. ---

// Items an agent can't do on its own; a person has to.
const HUMAN = /\b(print|rehearse|test the|walk-through|tasting|tour|visit|sign|pick up|hand out|put the)\b/i

function noteFor(task: Task, item: string): TodoProgress {
  if (HUMAN.test(item)) return { status: 'needs-you', note: 'An agent can’t do this one. Tick it when it’s done.' }
  const verb = item.toLowerCase()
  const note = /^(send|email|invite|share|ask|request|reach out)/.test(verb)
    ? `Sent by the ${task.agent} agent. Replies will show up here.`
    : /^(confirm|check|collect)/.test(verb)
      ? `Checked by the ${task.agent} agent.`
      : `Done by the ${task.agent} agent.`
  return { status: 'done', by: 'agent', note }
}

// Works through the option's checklist from the first item not yet finished.
// Calls `onUpdate` for every change and returns a function that stops the run.
export function runChecklist(
  task: Task,
  option: TaskResult,
  _event: EventDetails,
  current: TodoProgress[],
  onUpdate: (index: number, p: TodoProgress) => void,
): () => void {
  const items = option.todo ?? []
  let stopped = false
  let timer = 0
  const step = (i: number) => {
    while (i < items.length && current[i] && current[i].status !== 'pending' && current[i].status !== 'working') i++
    if (stopped || i >= items.length) return
    onUpdate(i, { status: 'working' })
    timer = window.setTimeout(() => {
      if (stopped) return
      onUpdate(i, noteFor(task, items[i]))
      step(i + 1)
    }, 1100 + Math.random() * 900)
  }
  step(0)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
