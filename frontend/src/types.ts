export type EventType = 'business' | 'conference' | 'hackathon' | 'wedding' | 'reunion'

export type Integration =
  | 'google-maps'
  | 'gmail'
  | 'google-calendar'
  | 'google-contacts'
  | 'google-slides'
  | 'web'

export type TaskStatus = 'idle' | 'queued' | 'running' | 'done' | 'blocked' | 'error'

export interface TaskResult {
  title: string
  subtitle: string
  meta?: string
  // Place results (venues, caterers, …) from Google Maps.
  address?: string
  rating?: number
  capacity?: string
  price?: string
  distance?: string
  tags?: string[]
  // Set for physical places; enables the Google Maps link.
  pin?: { x: number; y: number }
  // Shown when the option's node is expanded.
  why?: string
  todo?: string[]
  contact?: { name: string; role?: string; email?: string; phone?: string }
  draft?: string
}

export interface Task {
  id: string
  title: string
  description: string
  agent: string
  integration: Integration
  dependsOn: string[]
  status: TaskStatus
  // Why a 'blocked' task can't run: it needs a Google connection, or a step it depends on is stuck.
  blockedBy?: 'google' | 'deps'
  // Set when the agent run failed.
  error?: string
  results?: TaskResult[]
}

export interface EventDetails {
  type: EventType
  headcount: number
  city: string
  date: string
}

export interface ChatMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}
