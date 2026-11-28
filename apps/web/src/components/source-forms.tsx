'use client'

import { KeyRoundIcon, PlusIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import {
  addSourceAction,
  deleteSourceAction,
  rotateKeyAction,
  updateSourceAction,
} from '@/actions/sources'
import { ROTATE_OVERLAPS, type RotateOverlap, SOURCE_PLATFORMS } from '@/lib/sources'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog'
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
import { NativeSelect, NativeSelectOption } from './ui/native-select'

function PlatformSelect({ defaultValue }: { defaultValue?: string }) {
  const tp = useTranslations('platforms')
  return (
    <NativeSelect name="platform" defaultValue={defaultValue ?? 'other'} className="w-full">
      {SOURCE_PLATFORMS.map((p) => (
        <NativeSelectOption key={p} value={p}>
          {tp(p)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

/** "Add source" on the Sources page. */
export function AddSourceDialog({ slug }: { slug: string }) {
  const t = useTranslations('productSettings.sourcesPage')
  const tc = useTranslations('common')
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" aria-hidden />
          {t('add')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addBody')}</DialogDescription>
        </DialogHeader>
        <ActionForm action={addSourceAction}>
          <input type="hidden" name="slug" value={slug} />
          <Field label={t('name')}>
            <Input name="name" required maxLength={80} placeholder={t('namePlaceholder')} />
          </Field>
          <Field label={t('platform')}>
            <PlatformSelect />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton>{t('create')}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}

/** Name and platform of one source. */
export function SourceDetailsForm({
  slug,
  sourceId,
  name,
  platform,
  product,
  disabled,
}: {
  slug: string
  sourceId: string
  name: string
  platform: string
  product: string
  disabled: boolean
}) {
  const t = useTranslations('productSettings.source')
  const ts = useTranslations('productSettings.sourcesPage')
  const tc = useTranslations('common')
  const [typed, setTyped] = useState(name)
  return (
    <ActionForm action={updateSourceAction} doneMessage={tc('saved')}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="source" value={sourceId} />
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label={ts('name')} hint={t('nameHint', { product, name: typed || name })}>
          <Input
            name="name"
            required
            maxLength={80}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        <Field label={ts('platform')} hint={t('platformHint')}>
          <PlatformSelect defaultValue={platform} />
        </Field>
      </fieldset>
      {!disabled && <SubmitButton className="self-start">{tc('save')}</SubmitButton>}
    </ActionForm>
  )
}

/** "Rotate key": a new key now, the old one working for the overlap picked. */
export function RotateKeyDialog({
  slug,
  sourceId,
  name,
}: {
  slug: string
  sourceId: string
  name: string
}) {
  const t = useTranslations('productSettings.source')
  const tc = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [overlap, setOverlap] = useState<RotateOverlap>('day')
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCwIcon data-icon="inline-start" aria-hidden />
          {t('rotate')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('rotateTitle', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('rotateBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={rotateKeyAction} onDone={() => setOpen(false)}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="source" value={sourceId} />
          <OptionGroup legend={t('rotateWhen')}>
            {(Object.keys(ROTATE_OVERLAPS) as RotateOverlap[]).map((o) => (
              <Option
                key={o}
                name="overlap"
                value={o}
                checked={overlap === o}
                onChange={() => setOverlap(o)}
              >
                {t(`when.${o}`)}
              </Option>
            ))}
          </OptionGroup>
          <div className="flex gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">{t('leakTitle')}</p>
              <p className="text-muted-foreground">{t('leakBody')}</p>
            </div>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium">{t('afterTitle')}</p>
            <p className="text-muted-foreground">{t('afterBody')}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <SubmitButton>
              <KeyRoundIcon data-icon="inline-start" aria-hidden />
              {t('rotate')}
            </SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** "Delete source", confirmed in a dialog. */
export function DeleteSourceDialog({
  slug,
  sourceId,
  name,
}: {
  slug: string
  sourceId: string
  name: string
}) {
  const t = useTranslations('productSettings.source')
  const tc = useTranslations('common')
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="shrink-0 border-destructive/50 text-destructive">
          {t('delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteConfirmTitle', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={deleteSourceAction} className="flex flex-col gap-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="source" value={sourceId} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <SubmitButton variant="destructive">{t('delete')}</SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  )
}
