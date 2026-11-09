// Presentations feature: deck-building runner for the slide steps + the "Open deck" result action.
import { registerResultAction } from '../../lib/resultActions'
import { registerRunner } from '../../lib/runners'
import OpenDeckAction from './OpenDeckAction'
import { runDeckTask } from './runner'

// The integration covers every deck step; the task ids make the mapping explicit (ids win over integrations).
for (const key of ['google-slides', 'presentation', 'slides', 'dayof', 'memories']) registerRunner(key, runDeckTask)

registerResultAction({
  id: 'open-deck',
  applies: (_task, result, ctx) => !!result.presentationId && !!ctx,
  Component: OpenDeckAction,
})

export { hostTokenKey } from './live'
