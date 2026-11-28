'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function CopyField({
  value,
  copyLabel,
  copiedLabel,
  multiline = false,
  label,
}: {
  value: string
  /** What the field holds, for screen readers: "Key". Defaults to the copy label. */
  label?: string
  copyLabel: string
  copiedLabel: string
  /** Shows the whole text (a prompt, a snippet) instead of a one-line field. */
  multiline?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={multiline ? 'flex flex-col items-start gap-2' : 'flex items-center gap-2'}>
      {multiline ? (
        <p className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere select-all">
          {value}
        </p>
      ) : (
        <Input
          value={value}
          readOnly
          aria-label={label ?? copyLabel}
          className="font-mono text-xs md:text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <Button
        type="button"
        variant="outline"
        className="w-24"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  )
}
