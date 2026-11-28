'use client'

import {
  createContext,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from 'react'

/** `done` tells a form that stays on the page (a dialog) that the action succeeded. */
export type FormState =
  | {
      error?: string
      done?: boolean
      /** A result that keeps the form open, such as a test message: shown by FormNotice. */
      notice?: { ok: boolean; text: string }
    }
  | undefined

/** The last answer of the surrounding ActionForm's action. */
export const FormStateContext = createContext<FormState>(undefined)

/** True while the surrounding ActionForm waits for its server action. */
export const PendingContext = createContext(false)

/**
 * A form bound to a server action that returns `{ error }` on failure and
 * redirects or answers `{ done: true }` on success. Errors are already
 * translated by the action.
 *
 * Submits through a transition instead of the form's `action`, so React does
 * not clear the fields when the server answers with an error.
 */
export function ActionForm({
  action,
  children,
  className,
  onDone,
  doneMessage,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  children: ReactNode
  className?: string
  onDone?: () => void
  /** Said after a success, for forms that stay on the page: "Saved." */
  doneMessage?: string
}) {
  const [state, formAction, pending] = useActionState(action, undefined)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    if (state?.done) onDoneRef.current?.()
  }, [state])
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
        <FormStateContext value={pending ? undefined : state}>
          {children}
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          {doneMessage && (
            <p role="status" className="text-sm text-ok">
              {state?.done && !pending ? doneMessage : ''}
            </p>
          )}
        </FormStateContext>
      </PendingContext>
    </form>
  )
}
