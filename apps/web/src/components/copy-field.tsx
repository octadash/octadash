'use client'

import { useState } from 'react'

export function CopyField({
  value,
  copyLabel,
  copiedLabel,
}: {
  value: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-ink px-3 py-2 font-mono text-xs">
        {value}
      </code>
      <button
        type="button"
        className="shrink-0 text-xs text-muted hover:text-accent"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  )
}
