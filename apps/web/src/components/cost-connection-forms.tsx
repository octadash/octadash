'use client'

import { useTranslations } from 'next-intl'
import {
  costBudgetAction,
  shareCostAction,
  stopCostAction,
  updateCostKeyAction,
  updateFixedCostAction,
} from '@/actions/costs'
import { ActionForm } from './action-form'
import { CostShareFields, type ShareInitial, type Split } from './cost-share-fields'
import { Field } from './field'
import { FixedBillFields } from './fixed-bill-fields'
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
import { Input } from './ui/input'

interface ShareProps {
  slug: string
  connectionId: string
  product: string
  /** "OpenAI project"; null for a fixed bill. */
  tagName: string | null
  split: Split
  others: number
  initial?: ShareInitial
}

/** Which part of a connection this product takes, on one it already uses. */
export function CostShareForm(props: ShareProps) {
  const t = useTranslations('costsSetup')
  return (
    <ActionForm action={shareCostAction} doneMessage={t('saved')}>
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="connection" value={props.connectionId} />
      <CostShareFields
        product={props.product}
        tagName={props.tagName}
        tags={null}
        initial={props.initial}
        split={props.split}
        others={props.others}
      />
      <p className="text-xs text-muted-foreground">{t('shareNote')}</p>
      <SubmitButton variant="outline" className="self-start">
        {t('saveShare')}
      </SubmitButton>
    </ActionForm>
  )
}

/** "Already connected for another product": the same account or bill serves this one too. */
export function CostReuseForm(props: ShareProps) {
  const t = useTranslations('costsSetup')
  return (
    <ActionForm action={shareCostAction}>
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="connection" value={props.connectionId} />
      <CostShareFields
        product={props.product}
        tagName={props.tagName}
        tags={null}
        split={props.split}
        others={props.others}
      />
      <SubmitButton name="intent" value="reuse" className="self-start">
        {t('reuse.button')}
      </SubmitButton>
    </ActionForm>
  )
}

/** A new read-only key, when one was rotated or was wrong. */
export function CostKeyForm({
  slug,
  connectionId,
  provider,
}: {
  slug: string
  connectionId: string
  provider: string
}) {
  const t = useTranslations('costsSetup')
  return (
    <ActionForm action={updateCostKeyAction} doneMessage={t('saved')}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="connection" value={connectionId} />
      <Field label={t('key', { provider })}>
        <Input name="key" required autoComplete="off" spellCheck={false} className="font-mono" />
      </Field>
      <SubmitButton variant="outline" className="self-start">
        {t('updateKey')}
      </SubmitButton>
    </ActionForm>
  )
}

/** Change a fixed bill: a new price, a change from monthly to yearly. */
export function FixedCostForm({
  slug,
  connectionId,
  bill,
}: {
  slug: string
  connectionId: string
  bill: {
    name: string
    amount: string
    currency: string
    every: 'month' | 'year'
    startsOn: string
  }
}) {
  const t = useTranslations('costsSetup')
  return (
    <ActionForm action={updateFixedCostAction} doneMessage={t('saved')}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="connection" value={connectionId} />
      <FixedBillFields {...bill} />
      <p className="text-xs text-muted-foreground">{t('billNote')}</p>
      <SubmitButton variant="outline" className="self-start">
        {t('saveBill')}
      </SubmitButton>
    </ActionForm>
  )
}

/** The product's monthly budget: the forecast warns before it is reached. */
export function CostBudgetForm({
  slug,
  currency,
  amount,
  warn,
}: {
  slug: string
  currency: string
  /** As typed, in major units; empty without a budget. */
  amount: string
  warn: number
}) {
  const t = useTranslations('costsSetup.budget')
  return (
    <ActionForm action={costBudgetAction} doneMessage={t('saved')}>
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-wrap gap-3">
        <Field label={t('amount', { currency })} hint={t('amountHint')}>
          <Input
            name="amount"
            inputMode="decimal"
            defaultValue={amount}
            placeholder="1500"
            className="w-36 tabular-nums"
          />
        </Field>
        <Field label={t('warn')} hint={t('warnHint')}>
          <Input
            name="warn"
            type="number"
            min={1}
            max={100}
            defaultValue={warn}
            className="w-24 tabular-nums"
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="outline">{t('save')}</SubmitButton>
        {amount && (
          <SubmitButton name="intent" value="clear" variant="ghost">
            {t('clear')}
          </SubmitButton>
        )}
      </div>
    </ActionForm>
  )
}

/** "Stop using here", confirmed: the last product to stop deletes what was read. */
export function StopCostDialog({
  slug,
  connectionId,
  name,
  last,
}: {
  slug: string
  connectionId: string
  name: string
  /** No other product uses the connection. */
  last: boolean
}) {
  const t = useTranslations('costsSetup.stop')
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-muted-foreground hover:text-destructive">
          {t('button')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{last ? t('bodyLast') : t('body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={stopCostAction} className="flex flex-col gap-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="connection" value={connectionId} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <SubmitButton variant="destructive">{t('button')}</SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  )
}
