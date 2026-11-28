'use client'

import { MailIcon, MessageCircleIcon, SendIcon, WebhookIcon } from 'lucide-react'
import { type ReactNode, useId, useState, useTransition } from 'react'
import { type FindChatsState, findTelegramChatsAction, saveChannelAction } from '@/actions/channels'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { Field } from './field'
import { FormNotice } from './form-notice'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'

/** One input of an integration's form, with its words already translated. */
export interface ChannelField {
  key: string
  type: 'text' | 'number' | 'boolean'
  required: boolean
  secret: boolean
  default?: string | number | boolean
  label: string
  hint?: string
  placeholder?: string
  /** The longer explanation behind the "i". */
  info?: { title: string; body: string; label: string }
}

export interface ChannelType {
  id: string
  name: string
  description: string
  docsUrl?: string
  fields: ChannelField[]
}

export interface ChannelValues {
  id?: string
  integration: string
  name: string
  locale: string
  config: Record<string, unknown>
  /** Keys of the secrets already saved; their values never reach the browser. */
  savedSecrets: string[]
}

export interface ChannelDialogLabels {
  title: string
  intro: string
  type: string
  kinds: Record<Kind, string>
  later: string
  sendThrough: string
  name: string
  namePlaceholder: Record<'email' | 'telegram' | 'webhook', string>
  locale: string
  locales: { value: string; label: string }[]
  secretSaved: string
  docs: string
  cancel: string
  test: string
  submit: string
  find: {
    trigger: string
    searching: string
    pick: string
    topic: string
    kinds: Record<'private' | 'group' | 'channel', string>
  }
}

type Kind = 'email' | 'telegram' | 'webhook' | 'whatsapp'

/** The types people choose from. Email is one type; SMTP and Resend are how it is sent. */
const KINDS: { id: Kind; integrations: string[]; icon: ReactNode }[] = [
  { id: 'email', integrations: ['smtp', 'resend'], icon: <MailIcon className="size-4" /> },
  { id: 'telegram', integrations: ['telegram'], icon: <SendIcon className="size-4" /> },
  { id: 'webhook', integrations: ['webhook'], icon: <WebhookIcon className="size-4" /> },
  { id: 'whatsapp', integrations: [], icon: <MessageCircleIcon className="size-4" /> },
]

const kindOf = (integration: string) =>
  KINDS.find((k) => k.integrations.includes(integration))?.id ?? 'email'

/** Fields the form fills by itself (SMTP's TLS mode comes from the port). */
const HIDDEN = new Set(['smtp.secure'])

/** Adds an alert channel, or edits one when `values.id` is set (the type is then fixed). */
export function ChannelDialog({
  trigger,
  types,
  values,
  labels,
}: {
  trigger: ReactNode
  types: ChannelType[]
  values: ChannelValues
  labels: ChannelDialogLabels
}) {
  const [open, setOpen] = useState(false)
  const [typeId, setTypeId] = useState(values.integration)
  const editing = Boolean(values.id)
  const type = types.find((t) => t.id === typeId) ?? types[0]
  const kind = kindOf(typeId)
  const vias = types.filter((t) => KINDS.find((k) => k.id === kind)?.integrations.includes(t.id))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setTypeId(values.integration)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>
        <ActionForm
          action={saveChannelAction}
          onDone={() => setOpen(false)}
          className="flex flex-col gap-5"
        >
          {values.id && <input type="hidden" name="channelId" value={values.id} />}
          <input type="hidden" name="integration" value={typeId} />

          {!editing && (
            <OptionGroup legend={labels.type}>
              {KINDS.map((option) => (
                <Option
                  key={option.id}
                  name="kind"
                  checked={kind === option.id}
                  disabled={option.integrations.length === 0}
                  badge={option.integrations.length === 0 ? labels.later : undefined}
                  onChange={() => {
                    const first = option.integrations[0]
                    if (first) setTypeId(first)
                  }}
                >
                  {option.icon}
                  {labels.kinds[option.id]}
                </Option>
              ))}
            </OptionGroup>
          )}

          {!editing && vias.length > 1 && (
            <OptionGroup legend={labels.sendThrough}>
              {vias.map((via) => (
                <Option
                  key={via.id}
                  name="via"
                  checked={typeId === via.id}
                  onChange={() => setTypeId(via.id)}
                >
                  {via.name.replace(/^E-mail \((.*)\)$/, '$1')}
                </Option>
              ))}
            </OptionGroup>
          )}

          {type && (
            <p className="text-sm text-muted-foreground">
              {type.description}{' '}
              {type.docsUrl && (
                <a
                  href={type.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand underline-offset-4 hover:underline"
                >
                  {labels.docs}
                </a>
              )}
            </p>
          )}

          {/* Keyed by type so switching type starts the fields fresh. */}
          <div key={type?.id} className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.name}>
              <Input
                name="name"
                defaultValue={values.name}
                placeholder={labels.namePlaceholder[kind === 'whatsapp' ? 'email' : kind]}
                maxLength={80}
                required
              />
            </Field>
            <Field label={labels.locale}>
              <NativeSelect name="locale" defaultValue={values.locale} className="w-full">
                {labels.locales.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {type?.fields
              .filter((field) => !HIDDEN.has(`${type.id}.${field.key}`))
              .map((field) => (
                <ChannelInput
                  key={field.key}
                  field={field}
                  value={editing ? values.config[field.key] : undefined}
                  saved={values.savedSecrets.includes(field.key)}
                  savedLabel={labels.secretSaved}
                  extra={
                    type.id === 'telegram' && field.key === 'chatId' ? (
                      <FindChat channelId={values.id} labels={labels.find} />
                    ) : undefined
                  }
                />
              ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
            <SubmitButton variant="outline" name="intent" value="test">
              <SendIcon />
              {labels.test}
            </SubmitButton>
            <div className="min-w-0 flex-1">
              <FormNotice />
            </div>
            <div className="flex gap-2 sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {labels.cancel}
                </Button>
              </DialogClose>
              <SubmitButton>{labels.submit}</SubmitButton>
            </div>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}

function ChannelInput({
  field,
  value,
  saved,
  savedLabel,
  extra,
}: {
  field: ChannelField
  value: unknown
  saved: boolean
  savedLabel: string
  extra?: ReactNode
}) {
  const id = useId()
  const name = `field.${field.key}`
  if (field.type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : field.default === true
    return (
      <div className="flex items-start gap-2 sm:col-span-2">
        <Checkbox id={id} name={name} defaultChecked={checked} className="mt-0.5" />
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{field.label}</Label>
          {field.hint && <span className="text-xs text-muted-foreground">{field.hint}</span>}
        </div>
      </div>
    )
  }
  const initial = value ?? field.default
  return (
    <div className="flex flex-col gap-2">
      <Field
        label={field.label}
        hint={field.hint}
        info={
          field.info && { label: field.info.label, title: field.info.title, body: field.info.body }
        }
      >
        <Input
          name={name}
          type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
          defaultValue={field.secret || initial === undefined ? undefined : String(initial)}
          placeholder={field.secret && saved ? savedLabel : field.placeholder}
          required={field.required && !(field.secret && saved)}
          autoComplete={field.secret ? 'new-password' : 'off'}
        />
      </Field>
      {extra}
    </div>
  )
}

/**
 * "Find it for me": asks the bot which chats wrote to it and fills the chat ID
 * (and the topic) with the one picked.
 */
function FindChat({
  channelId,
  labels,
}: {
  channelId?: string
  labels: ChannelDialogLabels['find']
}) {
  const [state, setState] = useState<FindChatsState>(undefined)
  const [pending, startTransition] = useTransition()
  const fill = (form: HTMLFormElement | null, key: string, value: string) => {
    const input = form?.elements.namedItem(`field.${key}`)
    if (input instanceof HTMLInputElement) input.value = value
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={pending}
        onClick={(event) => {
          const form = event.currentTarget.form
          const token = form?.elements.namedItem('field.botToken')
          const value = token instanceof HTMLInputElement ? token.value : ''
          startTransition(async () => setState(await findTelegramChatsAction(value, channelId)))
        }}
      >
        {pending ? labels.searching : labels.trigger}
      </Button>
      <div role="status" className="text-xs">
        {state && !state.ok && <span className="text-error">{state.message}</span>}
        {state?.ok && (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">{labels.pick}</span>
            <ul className="flex flex-col gap-1">
              {state.chats.map((chat) => (
                <li key={`${chat.id}:${chat.threadId ?? ''}`}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-border px-2 py-1.5 text-left text-sm hover:border-brand"
                    onClick={(event) => {
                      const form = event.currentTarget.form
                      fill(form, 'chatId', chat.id)
                      fill(form, 'threadId', chat.threadId ?? '')
                      setState(undefined)
                    }}
                  >
                    <span className="font-medium">{chat.title || chat.id}</span>{' '}
                    <span className="text-muted-foreground">
                      · {labels.kinds[chat.kind]}
                      {chat.threadId && ` · ${labels.topic} ${chat.threadTitle ?? chat.threadId}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
