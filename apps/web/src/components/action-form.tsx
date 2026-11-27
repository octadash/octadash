'use client'

import { createContext, type ReactNode, startTransition, useActionState } from 'react'

export type FormState = { error?: string } | undefined

/** True while the surrounding ActionForm waits for its server action. */
export const PendingContext = createContext(false)

/**
 * A form bound to a server action that returns `{ error }` on failure and
 * redirects on success. Errors are already translated by the action.
 *
 * Submits through a transition instead of the form's `action`, so React does
 * not clear the fields when the server answers with an error.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  children: ReactNode
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, undefined)
  return (
    // No `action` prop: with one, React resets the form after any transition
    // started from onSubmit, which would wipe the fields on an error.
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const formData = new FormData(event.currentTarget, submitter)
        startTransition(() => formAction(formData))
      }}
      className={className ?? 'flex flex-col gap-4'}
    >
      <PendingContext value={pending}>
        {children}
        {state?.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </PendingContext>
    </form>
  )
}
