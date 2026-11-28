'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { Option } from './choice'
import { Field } from './field'
import { InfoTip } from './info-tip'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'

export type Split = 'equal' | 'traffic' | 'percent'

export interface ShareInitial {
  tags: string[]
  rest: boolean
  percent: number | null
}

/**
 * Which part of a connection's cost is this product's: the provider's own
 * projects or workspaces it claims (they go whole to it), and whether it
 * shares the rest with the other products, split equally, by traffic or by
 * a fixed percent. A fixed bill has no tags: it is all rest.
 */
export function CostShareFields({
  product,
  tagName,
  tags,
  initial,
  split: initialSplit = 'equal',
  others,
}: {
  product: string
  /** "OpenAI project"; null for a fixed bill. */
  tagName: string | null
  /** The provider's projects after "Test key"; null when not read, so ids are typed. */
  tags: { id: string; name: string }[] | null
  initial?: ShareInitial
  split?: Split
  /** How many other products share this connection. */
  others: number
}) {
  const t = useTranslations('costsSetup.share')
  const id = useId()
  const [picked, setPicked] = useState<string[]>(initial?.tags ?? [])
  const [rest, setRest] = useState(initial?.rest ?? true)
  const [split, setSplit] = useState<Split>(initialSplit)
  const showSplit = tagName === null || rest

  return (
    <div className="flex flex-col gap-4">
      {tagName !== null && (
        <>
          {tags && tags.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">
                {t('tags', { tag: tagName, product })}
              </legend>
              <p className="text-xs text-muted-foreground">{t('tagsHint', { product })}</p>
              <div className="flex max-h-56 flex-col gap-1.5 overflow-auto">
                {tags.map((tag) => (
                  <div key={tag.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-t-${tag.id}`}
                      name="tag"
                      value={tag.id}
                      checked={picked.includes(tag.id)}
                      onCheckedChange={(on) =>
                        setPicked((list) =>
                          on ? [...list, tag.id] : list.filter((v) => v !== tag.id),
                        )
                      }
                    />
                    <Label htmlFor={`${id}-t-${tag.id}`} className="font-normal">
                      {tag.name}
                      <span className="font-mono text-xs text-muted-foreground">{tag.id}</span>
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : (
            <Field label={t('tags', { tag: tagName, product })} hint={t('tagIdsHint', { product })}>
              <Input
                name="tagIds"
                defaultValue={initial?.tags.join(', ') ?? ''}
                placeholder="proj_abc…, wrkspc_01…"
                className="font-mono text-xs md:text-xs"
              />
            </Field>
          )}
          <div className="flex items-start gap-2">
            <input type="hidden" name="restShown" value="1" />
            <Checkbox
              id={`${id}-rest`}
              name="rest"
              value="on"
              checked={rest}
              onCheckedChange={(on) => setRest(on === true)}
              aria-describedby={`${id}-rest-hint`}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <Label htmlFor={`${id}-rest`}>{t('rest', { product })}</Label>
              <span id={`${id}-rest-hint`} className="text-xs text-muted-foreground">
                {t('restHint', { tag: tagName })}
              </span>
            </span>
          </div>
        </>
      )}

      {showSplit && (
        <div className="flex flex-col gap-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 flex items-center gap-1 text-sm font-medium">
              {t('split')}
              <InfoTip label={t('splitInfoLabel')} title={t('split')}>
                {t('splitInfo')}
              </InfoTip>
            </legend>
            <div className="flex flex-wrap gap-2">
              {(['equal', 'traffic', 'percent'] as const).map((mode) => (
                <Option
                  key={mode}
                  name="split"
                  value={mode}
                  checked={split === mode}
                  onChange={() => setSplit(mode)}
                >
                  {t(`splits.${mode}`)}
                </Option>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {t(`splitsBody.${split}`)} {others > 0 ? t('splitShared', { count: others }) : ''}
          </p>
          {split === 'percent' && (
            <Field label={t('percent', { product })} hint={t('percentHint')}>
              <Input
                name="percent"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="any"
                defaultValue={initial?.percent ?? ''}
                className="w-28"
              />
            </Field>
          )}
        </div>
      )}
    </div>
  )
}
