'use client'

import { ChevronDownIcon, CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { startTransition, useActionState, useState } from 'react'
import {
  type CheckNowState,
  checkNowAction,
  createMonitorAction,
  updateMonitorAction,
} from '@/actions/monitors'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { CodeTabs } from './code-tabs'
import { CopyField } from './copy-field'
import { Field } from './field'
import { HealthSnippets, heartbeatSnippets } from './health-snippets'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Input } from './ui/input'
import { NativeSelect, NativeSelectOption } from './ui/native-select'

export type MonitorKind = 'site' | 'health' | 'heartbeat'
type Expect = 'interval' | 'daily' | 'cron'

export interface MonitorFormValues {
  id?: string
  name: string
  kind: MonitorKind
  url: string
  interval: number
  timeout: number
  grace: number
  /** Heartbeats: "0 3 * * *" or null for every interval. */
  schedule: string | null
  token: string
  /** The product's source this monitor checks ("Docs"), or null. */
  sourceId: string | null
}

export interface MonitorFormLabels {
  what: string
  kinds: Record<MonitorKind | 'tcp', { label: string; hint: string }>
  later: string
  name: string
  /** With {name} replaced as the person types. */
  nameHint: string
  url: string
  urlHint: Record<'site' | 'health', string>
  homeTitle: string
  homeMore: string
  homeBody: string
  source: string
  sourceHint: string
  sourceNone: string
  sourceInfo: { label: string; body: string }
  snippetsTitle: string
  framework: string
  runner: string
  other: string
  every: string
  timeout: string
  checkNow: string
  expected: string
  expectedHint: string
  expectModes: Record<Expect, string>
  at: string
  cron: string
  cronHint: string
  grace: string
  graceHint: string
  graceInfo: { label: string; title: string; body: string }
  callTitle: string
  failHint: string
  submit: string
  cancel: string
  copy: string
  copied: string
}

/** "0 3 * * *" → "03:00"; anything else is a cron expression. */
function dailyTime(schedule: string | null): string | null {
  const match = schedule?.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/)
  if (!match) return null
  return `${match[2]?.padStart(2, '0')}:${match[1]?.padStart(2, '0')}`
}

/**
 * Adds or edits a monitor, as closed in the Uptime canvas: the type as a
 * single choice, the address with a warning when it is the home page, "Check
 * now" before saving, and for heartbeats the schedule, the grace and the
 * address to call, shown before saving.
 */
export function MonitorForm({
  slug,
  values,
  intervals,
  timeouts,
  graces,
  heartbeatUrl,
  cancelHref,
  labels,
  sources,
  children,
  aside,
}: {
  slug: string
  values: MonitorFormValues
  intervals: { value: number; label: string }[]
  timeouts: { value: number; label: string }[]
  graces: { value: number; label: string }[]
  heartbeatUrl: string
  cancelHref: string
  labels: MonitorFormLabels
  /** The product's sources, for the optional "Source" field. */
  sources: { id: string; name: string }[]
  /** Shown under the heartbeat address: whether calls arrive. */
  children?: React.ReactNode
  /** The right column: an example, then how checks work or why heartbeats. */
  aside: { preview: React.ReactNode; how: React.ReactNode; why: React.ReactNode }
}) {
  const editing = Boolean(values.id)
  const [kind, setKind] = useState<MonitorKind>(values.kind)
  const [name, setName] = useState(values.name)
  const [url, setUrl] = useState(values.url)
  const [interval, setIntervalValue] = useState(String(values.interval))
  const [timeout, setTimeoutValue] = useState(String(values.timeout))
  const daily = dailyTime(values.schedule)
  const [expect, setExpect] = useState<Expect>(
    values.schedule ? (daily ? 'daily' : 'cron') : 'interval',
  )
  const [check, checkAction, checking] = useActionState<CheckNowState, FormData>(
    checkNowAction,
    undefined,
  )
  const home = kind === 'site' && isHomePage(url)

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardContent>
          <ActionForm
            action={editing ? updateMonitorAction : createMonitorAction}
            className="flex flex-col gap-5"
          >
            <input type="hidden" name="slug" value={slug} />
            {values.id && <input type="hidden" name="monitorId" value={values.id} />}
            <input type="hidden" name="token" value={values.token} />

            <OptionGroup legend={labels.what}>
              {(['site', 'health', 'heartbeat'] as const).map((option) => (
                <Option
                  key={option}
                  name="kind"
                  value={option}
                  checked={kind === option}
                  disabled={editing && kind !== option}
                  onChange={() => {
                    if (!name || name === labels.kinds[kind].label)
                      setName(labels.kinds[option].label)
                    setKind(option)
                  }}
                >
                  <span className="flex flex-col items-start gap-0.5 py-0.5">
                    <span>{labels.kinds[option].label}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {labels.kinds[option].hint}
                    </span>
                  </span>
                </Option>
              ))}
              <Option
                name="kind-later"
                checked={false}
                disabled
                badge={labels.later}
                onChange={() => {}}
              >
                <span className="flex flex-col items-start gap-0.5 py-0.5">
                  <span>{labels.kinds.tcp.label}</span>
                  <span className="text-xs font-normal">{labels.kinds.tcp.hint}</span>
                </span>
              </Option>
            </OptionGroup>
            {editing && <input type="hidden" name="kind" value={kind} />}

            <Field
              label={labels.name}
              hint={labels.nameHint.replace('{name}', name || labels.kinds[kind].label)}
            >
              <Input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
              />
            </Field>

            {sources.length > 0 && (
              <Field
                label={labels.source}
                hint={labels.sourceHint}
                info={{
                  label: labels.sourceInfo.label,
                  title: labels.source,
                  body: labels.sourceInfo.body,
                }}
              >
                <NativeSelect name="source" defaultValue={values.sourceId ?? ''} className="w-60">
                  <NativeSelectOption value="">{labels.sourceNone}</NativeSelectOption>
                  {sources.map((source) => (
                    <NativeSelectOption key={source.id} value={source.id}>
                      {source.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}

            {kind !== 'heartbeat' ? (
              <>
                <Field label={labels.url} hint={labels.urlHint[kind]}>
                  <Input
                    name="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder={
                      kind === 'health' ? 'https://api.example.com/health' : 'https://example.com'
                    }
                    inputMode="url"
                    autoComplete="off"
                    required
                  />
                </Field>

                {home && (
                  <Collapsible className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <TriangleAlertIcon className="size-4 shrink-0 text-warn" aria-hidden />
                      <p className="flex-1 font-medium">{labels.homeTitle}</p>
                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="group -mr-1">
                          {labels.homeMore}
                          <ChevronDownIcon
                            className="transition-transform group-data-[state=open]:rotate-180"
                            aria-hidden
                          />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent className="flex flex-col gap-3 pt-2 pb-2">
                      <p className="text-muted-foreground">{labels.homeBody}</p>
                      <p className="font-medium">{labels.snippetsTitle}</p>
                      <HealthSnippets
                        copy={labels.copy}
                        copied={labels.copied}
                        label={labels.framework}
                        other={labels.other}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                )}

                <div className="flex flex-wrap items-end gap-4">
                  <Field label={labels.every}>
                    <NativeSelect
                      name="interval"
                      value={interval}
                      onChange={(event) => setIntervalValue(event.target.value)}
                      className="w-40"
                    >
                      {intervals
                        .filter((option) => option.value >= 60 && option.value <= 3600)
                        .map((option) => (
                          <NativeSelectOption key={option.value} value={String(option.value)}>
                            {option.label}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </Field>
                  <Field label={labels.timeout}>
                    <NativeSelect
                      name="timeout"
                      value={timeout}
                      onChange={(event) => setTimeoutValue(event.target.value)}
                      className="w-36"
                    >
                      {timeouts.map((option) => (
                        <NativeSelectOption key={option.value} value={String(option.value)}>
                          {option.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={checking || !url.trim()}
                    onClick={() => {
                      const data = new FormData()
                      data.set('url', url)
                      data.set('kind', kind)
                      data.set('timeout', timeout)
                      startTransition(() => checkAction(data))
                    }}
                  >
                    {labels.checkNow}
                  </Button>
                </div>
                <p role="status" className="-mt-2 flex items-center gap-1.5 text-sm">
                  {check && !checking && (
                    <>
                      {check.ok ? (
                        <CircleCheckIcon className="size-4 shrink-0 text-ok" aria-hidden />
                      ) : (
                        <TriangleAlertIcon className="size-4 shrink-0 text-error" aria-hidden />
                      )}
                      <span className={check.ok ? 'text-ok' : 'text-error'}>{check.text}</span>
                    </>
                  )}
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label={labels.expected}>
                    <NativeSelect
                      name="expect"
                      value={expect}
                      onChange={(event) => setExpect(event.target.value as Expect)}
                      className="w-44"
                    >
                      {(['interval', 'daily', 'cron'] as const).map((mode) => (
                        <NativeSelectOption key={mode} value={mode}>
                          {labels.expectModes[mode]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  {expect === 'interval' && (
                    <Field label={labels.every}>
                      <NativeSelect
                        name="interval"
                        defaultValue={String(values.interval)}
                        className="w-40"
                      >
                        {intervals.map((option) => (
                          <NativeSelectOption key={option.value} value={String(option.value)}>
                            {option.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                  {expect === 'daily' && (
                    <Field label={labels.at}>
                      <Input
                        name="at"
                        type="time"
                        defaultValue={daily ?? '03:00'}
                        className="w-32"
                        required
                      />
                    </Field>
                  )}
                  {expect === 'cron' && (
                    <Field label={labels.cron} hint={labels.cronHint}>
                      <Input
                        name="cron"
                        defaultValue={daily ? '' : (values.schedule ?? '')}
                        placeholder="0 3 * * *"
                        className="w-48 font-mono"
                        autoComplete="off"
                        required
                      />
                    </Field>
                  )}
                  {expect !== 'interval' && <input type="hidden" name="interval" value="86400" />}
                </div>
                <p className="-mt-3 text-xs text-muted-foreground">{labels.expectedHint}</p>

                <Field
                  label={labels.grace}
                  hint={labels.graceHint}
                  info={{
                    label: labels.graceInfo.label,
                    title: labels.graceInfo.title,
                    body: labels.graceInfo.body,
                  }}
                >
                  <NativeSelect name="grace" defaultValue={String(values.grace)} className="w-40">
                    {graces.map((option) => (
                      <NativeSelectOption key={option.value} value={String(option.value)}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>

                <section aria-labelledby="call-title" className="flex flex-col gap-2">
                  <h2 id="call-title" className="text-sm font-medium">
                    {labels.callTitle}
                  </h2>
                  <CopyField
                    value={heartbeatUrl}
                    copyLabel={labels.copy}
                    copiedLabel={labels.copied}
                  />
                  <p className="text-xs text-muted-foreground">{labels.failHint}</p>
                  <CodeTabs
                    tabs={heartbeatSnippets(heartbeatUrl, labels.other)}
                    label={labels.runner}
                    copy={labels.copy}
                    copied={labels.copied}
                  />
                  {children}
                </section>
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" asChild>
                <Link href={cancelHref}>{labels.cancel}</Link>
              </Button>
              <SubmitButton>{labels.submit}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        {aside.preview}
        {kind === 'heartbeat' ? aside.why : aside.how}
      </div>
    </div>
  )
}

/** The site's root: "https://acme.com" or "https://acme.com/". */
function isHomePage(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  try {
    const url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`)
    return (url.pathname === '/' || url.pathname === '') && !url.search
  } catch {
    return false
  }
}
