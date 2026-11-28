'use client'

import { useState } from 'react'
import { startAreaAction } from '@/actions/area-sources'
import { Option, OptionGroup } from './choice'
import { SubmitButton } from './submit-button'

/**
 * The first step of an empty area page when the product has no source: where
 * the code runs. One click makes the source and the page shows its code.
 */
export function AreaStartForm({
  slug,
  area,
  legend,
  submit,
  platforms,
}: {
  slug: string
  area: string
  legend: string
  submit: string
  /** In the order shown; the first is chosen. Each says what its code is. */
  platforms: { id: string; label: string; note: string }[]
}) {
  const [platform, setPlatform] = useState(platforms[0]?.id ?? '')
  const note = platforms.find((p) => p.id === platform)?.note
  return (
    <form action={startAreaAction} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="area" value={area} />
      <OptionGroup legend={legend}>
        {platforms.map((p) => (
          <Option
            key={p.id}
            name="platform"
            value={p.id}
            checked={platform === p.id}
            onChange={() => setPlatform(p.id)}
          >
            {p.label}
          </Option>
        ))}
      </OptionGroup>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      <SubmitButton className="self-start">{submit}</SubmitButton>
    </form>
  )
}
