import { ArrowUp, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EVENT_TYPES } from '../data/workflows'
import type { ChatMessage, EventDetails } from '../types'

interface Props {
  event: EventDetails
  messages: ChatMessage[]
  onSend: (text: string) => void
  onClose: () => void
}

const SUGGESTIONS = ['300 people in Austin', 'add photo booth after location', 'remove judges', 'approve plan']

export default function ChatPanel({ event, messages, onSend, onClose }: Props) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const meta = EVENT_TYPES.find((e) => e.id === event.type)!

  // Scroll only the message list; scrollIntoView would also scroll the clipped panel itself.
  useEffect(() => {
    const el = listRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = (text = draft) => {
    if (!text.trim()) return
    onSend(text.trim())
    setDraft('')
  }

  return (
    <section className="glow flex h-full min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 shadow-indigo-500/10 ring-gray-900/10">
      <header className="flex items-center gap-3 border-b border-line bg-white/70 px-5 py-3.5 backdrop-blur">
        <span className="grid size-8 place-items-center rounded-full bg-accent text-white">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold tracking-tight">Evently assistant</div>
          <div className="truncate text-xs text-muted">
            {meta.label} · {event.headcount} people · {event.city}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close chat" className="rounded-full p-2 text-muted hover:bg-line/60 hover:text-ink">
          <X size={18} />
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {messages.map((m) => (
          <div key={m.id} className={`flex animate-rise ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' ? (
              <div className="max-w-[85%] rounded-3xl rounded-bl-lg bg-white px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ring-1 ring-gray-900/5">
                <div className="mb-1 text-xs font-semibold text-accent">Evently</div>
                <div className="whitespace-pre-line">{m.text}</div>
              </div>
            ) : (
              <div className="max-w-[80%] rounded-3xl rounded-br-lg bg-accent px-4 py-2.5 text-[15px] text-white">{m.text}</div>
            )}
          </div>
        ))}
      </div>

      <div className="px-5 pb-5">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-gray-900/10 transition hover:text-accent hover:ring-accent"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-[28px] bg-white p-2 shadow-sm ring-1 ring-gray-900/10 focus-within:ring-2 focus-within:ring-accent">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="What would you like to edit?"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 outline-none placeholder:text-muted/70"
          />
          <button
            onClick={() => send()}
            disabled={!draft.trim()}
            aria-label="Send"
            className="grid size-9 place-items-center rounded-full bg-accent text-white disabled:opacity-25"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
