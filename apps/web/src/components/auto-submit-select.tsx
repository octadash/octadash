'use client'

import type { ReactNode } from 'react'
import { Select } from './ui'

/** A select that submits its form as soon as the value changes. */
export function AutoSubmitSelect({
  name,
  defaultValue,
  label,
  children,
}: {
  name: string
  defaultValue: string
  label: string
  children: ReactNode
}) {
  return (
    <Select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      className="h-8 text-xs"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {children}
    </Select>
  )
}
