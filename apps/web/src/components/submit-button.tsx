'use client'

import { type ComponentProps, type ReactNode, use } from 'react'
import { useFormStatus } from 'react-dom'
import { PendingContext } from './action-form'
import { Button } from './ui/button'

export function SubmitButton({
  children,
  variant,
  size,
  className,
  disabled,
  name,
  value,
}: {
  children: ReactNode
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string
  disabled?: boolean
  /** Tells the action which button sent the form. */
  name?: string
  value?: string
}) {
  const inActionForm = use(PendingContext)
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      name={name}
      value={value}
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || inActionForm || pending}
    >
      {children}
    </Button>
  )
}
