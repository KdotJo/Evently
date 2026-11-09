import type { EventType } from '../types'

// Events the user started, newest first. Kept in this browser only.
export interface RecentEvent {
  type: EventType
  note?: string
  at: number
}

const KEY = 'evently.recent'
const MAX = 12

export function loadRecent(): RecentEvent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function addRecent(e: Omit<RecentEvent, 'at'>) {
  try {
    const rest = loadRecent().filter((r) => r.type !== e.type || r.note !== e.note)
    localStorage.setItem(KEY, JSON.stringify([{ ...e, at: Date.now() }, ...rest].slice(0, MAX)))
  } catch {
    // Storage blocked (private window etc.): history just isn't kept.
  }
}
