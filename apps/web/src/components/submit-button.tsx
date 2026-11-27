'use client'

import { type ComponentProps, type ReactNode, use } from 'react'
import { useFormStatus } from 'react-dom'
import { PendingContext } from './action-form'
import { Button } from './ui/button'

export function SubmitButton({
  children,
  variant,
  className,
}: {
  children: ReactNode
  variant?: ComponentProps<typeof Button>['variant']
  className?: string
}) {
  const inActionForm = use(PendingContext)
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      disabled={inActionForm || pending}
    >
      {children}
    </Button>
  )
}
