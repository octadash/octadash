'use client'

import { type ReactNode, use } from 'react'
import { useFormStatus } from 'react-dom'
import { PendingContext } from './action-form'
import { Button } from './ui'

export function SubmitButton({
  children,
  variant,
  className,
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
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
