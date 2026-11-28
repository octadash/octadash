'use client'

import { useId, useState } from 'react'
import { saveRuleAction } from '@/actions/alerts'
import { ActionForm } from './action-form'
import { SubmitButton } from './submit-button'
import { Badge } from './ui/badge'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

type Level = 'emergency' | 'signal' | 'off'

export interface RuleFormLabels {
  title: string
  body: string
  level: string
  levels: Record<Level, string>
  levelHint: Record<Level, string>
  /** One entry per number the rule takes: label and unit. */
  params: Record<string, { label: string; unit: string }>
  channels: string
  allChannels: string
  noChannels: string
  save: string
  saved: string
  reset: string
  custom: string
}

/** One alert rule: how serious, after how long, and to which channels. */
export function RuleForm({
  kind,
  slug,
  rule,
  channels,
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
  canEdit: boolean
  labels: RuleFormLabels
}) {
  const [level, setLevel] = useState<Level>(rule.level)
  const [savedAt, setSavedAt] = useState(0)
  const ids = { level: useId(), param: useId() }
  const paramKeys = Object.keys(rule.params)

  return (
    <ActionForm
      action={saveRuleAction}
      onDone={() => setSavedAt(Date.now())}
      className="flex flex-col gap-4 px-4 py-4"
    >
      <input type="hidden" name="kind" value={kind} />
      {slug && <input type="hidden" name="slug" value={slug} />}
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 font-medium">
            {labels.title}
            {slug && rule.overridden && <Badge variant="secondary">{labels.custom}</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">{labels.body}</p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.level}>{labels.level}</Label>
            <Select name="level" value={level} onValueChange={(value) => setLevel(value as Level)}>
              <SelectTrigger id={ids.level} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['emergency', 'signal', 'off'] as const).map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.levels[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {paramKeys.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids.param}-${key}`}>{labels.params[key]?.label ?? key}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${ids.param}-${key}`}
                  name={`param.${key}`}
                  type="number"
                  min={0}
                  max={1440}
                  defaultValue={rule.params[key]}
                  className="w-24"
                  required
                />
                <span className="text-sm text-muted-foreground">{labels.params[key]?.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">{labels.levelHint[level]}</p>

        {level === 'emergency' && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{labels.channels}</legend>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">{labels.noChannels}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {channels.map((channel) => (
                    <ChannelCheck
                      key={channel.id}
                      channel={channel}
                      checked={rule.channelIds?.includes(channel.id) ?? false}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{labels.allChannels}</p>
              </>
            )}
          </fieldset>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton size="sm">{labels.save}</SubmitButton>
            {slug && rule.overridden && (
              <SubmitButton size="sm" variant="ghost" name="intent" value="reset">
                {labels.reset}
              </SubmitButton>
            )}
            {savedAt > 0 && (
              <span role="status" className="text-xs text-ok">
                {labels.saved}
              </span>
            )}
          </div>
        )}
      </fieldset>
    </ActionForm>
  )
}

function ChannelCheck({
  channel,
  checked,
}: {
  channel: { id: string; name: string }
  checked: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} name="channel" value={channel.id} defaultChecked={checked} />
      <Label htmlFor={id} className="font-normal">
        {channel.name}
      </Label>
    </div>
  )
}
