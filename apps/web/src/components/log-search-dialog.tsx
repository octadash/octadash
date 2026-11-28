'use client'

import { BookmarkPlusIcon, PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'
import { deleteLogSearchAction, saveLogSearchAction } from '@/actions/logs'
import { ActionForm } from './action-form'
import { Field } from './field'
import { InfoTip } from './info-tip'
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
import { Label } from './ui/label'
import { Switch } from './ui/switch'

export interface SavedSearchValue {
  id: string
  name: string
  query: string
  alert: boolean
}

/**
 * "Save search" and "Edit": a name for what is in the search box, and Alert,
 * which makes it the "Log alert" emergency. Only owners and admins can turn
 * Alert on, since it tells everyone.
 */
export function LogSearchDialog({
  query,
  search,
  canAlert,
}: {
  /** What is in the box now, for a new search. */
  query: string
  search?: SavedSearchValue
  canAlert: boolean
}) {
  const t = useTranslations('logsArea.save')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [deleting, startTransition] = useTransition()
  const locked = !canAlert
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {search ? (
          <Button variant="ghost" size="icon-sm" aria-label={t('edit', { name: search.name })}>
            <PencilIcon aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" disabled={!query}>
            <BookmarkPlusIcon data-icon="inline-start" aria-hidden />
            {t('button')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{search ? t('editTitle') : t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <ActionForm action={saveLogSearchAction} onDone={() => setOpen(false)}>
          {search && <input type="hidden" name="id" value={search.id} />}
          <Field label={t('name')}>
            <Input
              name="name"
              required
              maxLength={80}
              defaultValue={search?.name}
              placeholder={t('namePlaceholder')}
            />
          </Field>
          <Field label={t('query')}>
            <Input
              name="query"
              required
              maxLength={2000}
              defaultValue={search?.query ?? query}
              className="font-mono"
            />
          </Field>
          <div className="flex items-start gap-3">
            <Switch
              id={id}
              name="alert"
              defaultChecked={search?.alert ?? false}
              disabled={locked}
              aria-describedby={`${id}-body`}
            />
            {/* A disabled switch sends nothing: keep the current value. */}
            {locked && search?.alert && <input type="hidden" name="alert" value="on" />}
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1">
                <Label htmlFor={id}>{t('alert')}</Label>
                <InfoTip label={t('alertInfoLabel')} title={t('alert')}>
                  {t('alertInfo')}
                </InfoTip>
              </span>
              <p id={`${id}-body`} className="text-xs text-muted-foreground">
                {locked ? t('alertLocked') : t('alertBody')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {search && (canAlert || !search.alert) && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={deleting}
                onClick={() =>
                  startTransition(async () => {
                    const data = new FormData()
                    data.set('id', search.id)
                    await deleteLogSearchAction(data)
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
            <SubmitButton>{t('save')}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
