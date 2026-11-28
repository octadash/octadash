'use client'

import type { ConnectionRule } from '@octadash/db'
import { useTranslations } from 'next-intl'
import { serveMoneyAction, stopMoneyAction, updateMoneyKeysAction } from '@/actions/money'
import { ActionForm } from './action-form'
import { Field } from './field'
import { MoneyRuleFields } from './money-rule-fields'
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

interface Gateway {
  id: string
  name: string
  hasProducts: boolean
}

/** Which payments are this product's, on a connection it already uses. */
export function MoneyRuleForm({
  slug,
  connectionId,
  gateway,
  product,
  rule,
}: {
  slug: string
  connectionId: string
  gateway: Gateway
  product: string
  rule: ConnectionRule
}) {
  const t = useTranslations('moneySetup')
  return (
    <ActionForm action={serveMoneyAction} doneMessage={t('saved')}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="connection" value={connectionId} />
      <MoneyRuleFields gateway={gateway} product={product} products={null} initial={rule} />
      <p className="text-xs text-muted-foreground">{t('ruleNote')}</p>
      <SubmitButton variant="outline" className="self-start">
        {t('saveRule')}
      </SubmitButton>
    </ActionForm>
  )
}

/** "Already connected for another product": the same account serves this one too. */
export function MoneyReuseForm({
  slug,
  connectionId,
  gateway,
  product,
  initial,
}: {
  slug: string
  connectionId: string
  gateway: Gateway
  product: string
  /** Products or metadata when another product already takes All. */
  initial?: ConnectionRule
}) {
  const t = useTranslations('moneySetup')
  return (
    <ActionForm action={serveMoneyAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="connection" value={connectionId} />
      <MoneyRuleFields gateway={gateway} product={product} products={null} initial={initial} />
      <SubmitButton name="intent" value="reuse" className="self-start">
        {t('reuse.button')}
      </SubmitButton>
    </ActionForm>
  )
}

/** A new read-only key or webhook secret, when one was rotated or was wrong. */
export function MoneyKeysForm({
  slug,
  connectionId,
  gateway,
}: {
  slug: string
  connectionId: string
  gateway: Gateway
}) {
  const t = useTranslations('moneySetup')
  return (
    <ActionForm action={updateMoneyKeysAction} doneMessage={t('saved')}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="connection" value={connectionId} />
      <Field label={t('key', { gateway: gateway.name })} hint={t('keysKeep')}>
        <Input name="key" autoComplete="off" spellCheck={false} className="font-mono" />
      </Field>
      {gateway.id !== 'asaas' && (
        <Field label={t('signingSecret')} hint={t('keysKeep')}>
          <Input name="webhookSecret" autoComplete="off" spellCheck={false} className="font-mono" />
        </Field>
      )}
      <SubmitButton variant="outline" className="self-start">
        {t('updateKeys')}
      </SubmitButton>
    </ActionForm>
  )
}

/** "Stop using here", confirmed: the last product to stop deletes what was read. */
export function StopMoneyDialog({
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
  const t = useTranslations('moneySetup.stop')
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
        <ActionForm action={stopMoneyAction} className="flex flex-col gap-3">
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
