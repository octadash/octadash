'use client'

import { CheckIcon, XIcon } from 'lucide-react'
import { useActionState } from 'react'
import { testChannelAction } from '@/actions/channels'
import { Button } from './ui/button'

/** Sends a test message and shows the answer next to the button. */
export function TestChannelButton({
  channelId,
  labels,
}: {
  channelId: string
  labels: { trigger: string; sending: string; ok: string }
}) {
  const [state, action, pending] = useActionState(testChannelAction, undefined)
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="channelId" value={channelId} />
      {state && !pending && (
        <span
          role="status"
          className={
            state.ok
              ? 'flex items-center gap-1 text-xs text-ok'
              : 'flex max-w-64 items-center gap-1 truncate text-xs text-error'
          }
          title={state.message}
        >
          {state.ok ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5 shrink-0" />}
          {state.ok ? labels.ok : state.message}
        </span>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? labels.sending : labels.trigger}
      </Button>
    </form>
  )
}
