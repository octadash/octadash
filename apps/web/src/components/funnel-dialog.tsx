'use client'

import { PencilIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { deleteFunnelAction, saveFunnelAction } from '@/actions/usage'
import { ActionForm } from './action-form'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
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
import { NativeSelect } from './ui/native-select'
import { Textarea } from './ui/textarea'

export interface FunnelValue {
  id: string
  slug: string
  name: string
  steps: string[]
  windowDays: number
}

/**
 * "New funnel" and "Edit": a name, events in order (one per line) and the
 * days a person has to go from the first to the last. A funnel belongs to one
 * product; with several in view, the form asks which.
 */
export function FunnelDialog({
  products,
  events,
  funnel,
}: {
  products: { slug: string; name: string }[]
  /** Event names seen lately, offered as suggestions. */
  events: string[]
  funnel?: FunnelValue
}) {
  const t = useTranslations('usageArea.funnel')
  const [open, setOpen] = useState(false)
  const [deleting, startTransition] = useTransition()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {funnel ? (
          <Button variant="ghost" size="icon-sm" aria-label={t('edit', { name: funnel.name })}>
            <PencilIcon aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <PlusIcon data-icon="inline-start" aria-hidden />
            {t('new')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{funnel ? t('editTitle') : t('newTitle')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <ActionForm action={saveFunnelAction} onDone={() => setOpen(false)}>
          {funnel && <input type="hidden" name="id" value={funnel.id} />}
          {funnel || products.length === 1 ? (
            <input type="hidden" name="slug" value={funnel?.slug ?? products[0]?.slug ?? ''} />
          ) : (
            <Field label={t('product')}>
              <NativeSelect name="slug" required className="w-full">
                {products.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label={t('name')}>
            <Input
              name="name"
              required
              maxLength={80}
              defaultValue={funnel?.name}
              placeholder={t('namePlaceholder')}
            />
          </Field>
          <Field
            label={t('steps')}
            hint={
              events.length > 0
                ? t('stepsHintSeen', { events: events.slice(0, 8).join(', ') })
                : t('stepsHint')
            }
          >
            <Textarea
              name="steps"
              required
              rows={4}
              defaultValue={funnel?.steps.join('\n')}
              placeholder={'$pageview\ncart_item_added\npurchase_completed'}
              className="font-mono"
            />
          </Field>
          <Field label={t('window')} hint={t('windowHint')}>
            <Input
              name="windowDays"
              type="number"
              min={1}
              max={90}
              required
              defaultValue={funnel?.windowDays ?? 7}
              className="w-24"
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {funnel && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={deleting}
                onClick={() =>
                  startTransition(async () => {
                    const data = new FormData()
                    data.set('slug', funnel.slug)
                    data.set('id', funnel.id)
                    await deleteFunnelAction(data)
                    setOpen(false)
                  })
                }
              >
                {t('delete')}
              </Button>
            )}
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton>{funnel ? t('save') : t('create')}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
