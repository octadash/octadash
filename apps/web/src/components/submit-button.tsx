'use client'

import { type ComponentProps, type ReactNode, use } from 'react'
import { useFormStatus } from 'react-dom'
import { PendingContext } from './action-form'
import { Button } from './ui/button'

export function SubmitButton({
  children,
  variant,
  className,
  disabled,
}: {
  children: ReactNode
  variant?: ComponentProps<typeof Button>['variant']
  className?: string
  disabled?: boolean
}) {
  const inActionForm = use(PendingContext)
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      disabled={disabled || inActionForm || pending}
    >
      {children}
    </Button>
  )
}
