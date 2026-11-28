'use client'

import { ChevronDownIcon } from 'lucide-react'
import Link from 'next/link'
import { use, useEffect, useId, useRef, useState } from 'react'
import { saveRuleAction } from '@/actions/alerts'
import { cn } from '@/lib/utils'
import { ActionForm, FormStateContext } from './action-form'
import { InfoTip } from './info-tip'
import { LEVEL_ICON, type Level } from './level-icon'
import { SubmitButton } from './submit-button'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

export interface RuleFormLabels {
  title: string
  body: string
  info?: { title: string; body: string; label: string }
  /** Under the level when the rule takes no number ("Grace is set on each heartbeat."). */
  note?: string
  level: string
  levels: Record<Level, string>
  /** One entry per number the rule takes: what the field is and the words after it. */
  params: Record<string, { label: string; unit: string }>
  sendTo: string
  allChannels: string
  channelsCount: string
  noChannels: string
  saved: string
  reset: string
  custom: string
  changedOn?: string
}

/**
 * One alert rule: the level as a toggle group with text and a symbol, its wait,
 * and where it sends. Saves itself on each change and says so.
 */
export function RuleForm({
  kind,
  slug,
  rule,
  channels,
  overrides,
  canEdit,
  labels,
}: {
  kind: string
  /** Set on a product's page: the rule then applies to that product only. */
  slug?: string
  rule: {
    level: Level
    params: Record<string, number>
    channelIds: string[] | null
    overridden: boolean
  }
  channels: { id: string; name: string }[]
  /** On the organization's rules: the products that changed this one. */
  overrides?: { name: string; slug: string; summary: string }[]
  canEdit: boolean
  labels: RuleFormLabels
}) {
  const [level, setLevel] = useState<Level>(rule.level)
  const [chosen, setChosen] = useState<string[]>(rule.channelIds ?? [])
  const [changes, setChanges] = useState(0)
  const anchor = useRef<HTMLInputElement>(null)
  const uid = useId()
  const paramKeys = Object.keys(rule.params)

  // Each change saves the form as it is now, after React drew the new values.
  useEffect(() => {
    if (changes > 0) anchor.current?.form?.requestSubmit()
  }, [changes])
  const changed = () => setChanges((n) => n + 1)

  const channelText =
    chosen.length === 0
      ? labels.allChannels
      : chosen.length === 1
        ? (channels.find((c) => c.id === chosen[0])?.name ?? labels.allChannels)
        : labels.channelsCount.replace('#', String(chosen.length))

  return (
    <ActionForm action={saveRuleAction} className="flex flex-col gap-3 px-4 py-4">
      <input ref={anchor} type="hidden" name="kind" value={kind} />
      <input type="hidden" name="level" value={level} />
      {chosen.map((id) => (
        <input key={id} type="hidden" name="channel" value={id} />
      ))}
      {slug && <input type="hidden" name="slug" value={slug} />}
      <fieldset disabled={!canEdit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-md flex-col gap-1">
            <p className="flex items-center gap-1.5 font-medium">
              {labels.title}
              {labels.info && (
                <InfoTip label={labels.info.label} title={labels.info.title}>
                  {labels.info.body}
                </InfoTip>
              )}
              {slug && rule.overridden && <Badge variant="secondary">{labels.custom}</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">{labels.body}</p>
            {overrides && overrides.length > 0 && labels.changedOn && (
              <p className="text-xs text-brand">
                {labels.changedOn}{' '}
                {overrides.map((o, i) => (
                  <span key={o.slug}>
                    {i > 0 && ', '}
                    <Link href={`/p/${o.slug}/settings/rules`} className="hover:underline">
                      {o.name}
                    </Link>{' '}
                    {o.summary && `(${o.summary})`}
                  </span>
                ))}
              </p>
            )}
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={level}
            aria-label={labels.level}
            disabled={!canEdit}
            onValueChange={(value) => {
              if (!value) return
              setLevel(value as Level)
              changed()
            }}
          >
            {(['emergency', 'signal', 'off'] as const).map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="gap-1.5 px-2.5 data-[state=on]:bg-secondary data-[state=on]:font-semibold"
              >
                {LEVEL_ICON[option]}
                {labels.levels[option]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div
          className={cn(
            'flex flex-wrap items-center gap-x-5 gap-y-2 text-sm',
            level === 'off' && 'opacity-60',
          )}
        >
          {paramKeys.map((key) => (
            <span key={key} className="flex items-center gap-2">
              <label htmlFor={`${uid}-${key}`} className="sr-only">
                {labels.params[key]?.label ?? key}
              </label>
              <Input
                id={`${uid}-${key}`}
                aria-describedby={`${uid}-${key}-unit`}
                name={`param.${key}`}
                type="number"
                min={0}
                max={1440}
                defaultValue={rule.params[key]}
                className="h-8 w-16"
                required
                onBlur={(event) => {
                  if (event.currentTarget.value !== event.currentTarget.defaultValue) changed()
                }}
              />
              <span id={`${uid}-${key}-unit`} className="text-muted-foreground">
                {labels.params[key]?.unit}
              </span>
            </span>
          ))}
          {paramKeys.length === 0 && labels.note && (
            <span className="text-muted-foreground">{labels.note}</span>
          )}
          {level === 'emergency' && (
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">{labels.sendTo}</span>
              {channels.length === 0 ? (
                <span className="text-muted-foreground">{labels.noChannels}</span>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!canEdit}>
                      {channelText}
                      <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuCheckboxItem
                      checked={chosen.length === 0}
                      onCheckedChange={() => {
                        setChosen([])
                        changed()
                      }}
                    >
                      {labels.allChannels}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    {channels.map((channel) => (
                      <DropdownMenuCheckboxItem
                        key={channel.id}
                        checked={chosen.includes(channel.id)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(on) => {
                          setChosen((now) =>
                            on ? [...now, channel.id] : now.filter((id) => id !== channel.id),
                          )
                          changed()
                        }}
                      >
                        {channel.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          )}
          <SavedNote text={labels.saved} />
          {canEdit && slug && rule.overridden && (
            <SubmitButton size="sm" variant="ghost" name="intent" value="reset">
              {labels.reset}
            </SubmitButton>
          )}
        </div>
      </fieldset>
    </ActionForm>
  )
}

/** "Saved." after each automatic save, or what went wrong; read by screen readers. */
function SavedNote({ text }: { text: string }) {
  const state = use(FormStateContext)
  return (
    <span role="status" className={state?.error ? 'text-error' : 'text-ok'}>
      {state?.error ?? (state?.done ? text : '')}
    </span>
  )
}
