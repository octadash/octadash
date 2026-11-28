'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'

/** A button that copies a value and says so for a moment, to sighted and screen reader users. */
export function CopyButton({
  value,
  label,
  copiedLabel,
  name,
}: {
  value: string
  label: string
  copiedLabel: string
  /** Added for screen readers when several buttons share the label: "Copy link, ana@acme.com". */
  name?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={name ? `${label}, ${name}` : undefined}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  )
}
