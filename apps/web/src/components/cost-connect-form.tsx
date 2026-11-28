'use client'

import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ReactNode, useState, useTransition } from 'react'
import { type CostKeyTest, connectCostAction, testCostKeyAction } from '@/actions/costs'
import { ActionForm } from './action-form'
import { Option } from './choice'
import { CostShareFields } from './cost-share-fields'
import { Field } from './field'
import { FixedBillFields } from './fixed-bill-fields'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
import { Input } from './ui/input'

export interface CostProviderChoice {
  id: 'openai' | 'anthropic'
  name: string
  keyPlaceholder: string
  /** In the viewer's language. */
  keyHelp: string
  /** "OpenAI project", in the viewer's language. */
  tagName: string
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold"
      >
        {n}
      </span>
      <section className="flex min-w-0 flex-1 flex-col gap-3 pb-2">
        <h3 className="font-medium">{title}</h3>
        {children}
      </section>
    </li>
  )
}

/** Providers on the roadmap, shown so nobody looks for them in vain. */
const LATER = ['AWS', 'Neon', 'Vercel', 'Google Cloud']

/**
 * Connect a cost, as closed in the Costs canvas: the provider, a read-only
 * key checked before saving (or the bill, for what has no API), and which
 * part is this product's.
 */
export function CostConnectForm({
  slug,
  product,
  providers,
  currency,
  today,
}: {
  slug: string
  product: string
  providers: CostProviderChoice[]
  /** The organization's currency, the bill's default. */
  currency: string
  /** "2026-11-28", the bill's default start. */
  today: string
}) {
  const t = useTranslations('costsSetup')
  const [kind, setKind] = useState<CostProviderChoice['id'] | 'fixed'>('openai')
  const [key, setKey] = useState('')
  const [test, setTest] = useState<(CostKeyTest & { key: string; provider: string }) | null>(null)
  const [testing, startTest] = useTransition()
  const provider = providers.find((p) => p.id === kind) ?? null
  const tested =
    provider && test && test.key === key.trim() && test.provider === provider.id ? test : null

  return (
    <ActionForm action={connectCostAction}>
      <input type="hidden" name="slug" value={slug} />
      <ol className="flex flex-col gap-5">
        <Step n={1} title={t('steps.provider')}>
          <fieldset>
            <legend className="sr-only">{t('steps.provider')}</legend>
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <Option
                  key={p.id}
                  name="provider"
                  value={p.id}
                  checked={kind === p.id}
                  onChange={() => setKind(p.id)}
                >
                  {p.name}
                </Option>
              ))}
              <Option
                name="provider"
                value="fixed"
                checked={kind === 'fixed'}
                onChange={() => setKind('fixed')}
              >
                {t('fixed')}
              </Option>
              {LATER.map((name) => (
                <Option
                  key={name}
                  name="later"
                  checked={false}
                  disabled
                  badge={t('later')}
                  onChange={() => {}}
                >
                  {name}
                </Option>
              ))}
            </div>
          </fieldset>
          {provider && (
            <Field label={t('name')} hint={t('nameHint')}>
              <Input name="name" maxLength={80} placeholder={provider.name} />
            </Field>
          )}
        </Step>

        {provider ? (
          <Step n={2} title={t('steps.key')}>
            <Field
              label={t('key', { provider: provider.name })}
              hint={t('keyHint')}
              info={{
                label: t('keyInfoLabel'),
                title: t('key', { provider: provider.name }),
                body: provider.keyHelp,
              }}
            >
              <Input
                name="key"
                required
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={provider.keyPlaceholder}
                className="font-mono"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={!key.trim() || testing}
                onClick={() =>
                  startTest(async () => {
                    const keyNow = key.trim()
                    const result = await testCostKeyAction({
                      slug,
                      provider: provider.id,
                      key: keyNow,
                    })
                    setTest({ ...result, key: keyNow, provider: provider.id })
                  })
                }
              >
                {testing ? t('testing') : t('test')}
              </Button>
              <p role="status" className="flex min-w-0 items-center gap-1.5 text-sm">
                {tested &&
                  (tested.ok ? (
                    <>
                      <CircleCheckIcon className="size-4 shrink-0 text-ok" aria-hidden />
                      <span className="text-ok">
                        {t('testOk', { count: tested.tags.length, tag: provider.tagName })}
                      </span>
                    </>
                  ) : (
                    <>
                      <TriangleAlertIcon className="size-4 shrink-0 text-error" aria-hidden />
                      <span className="text-error">
                        {t('testFailed', { message: tested.message ?? '' })}
                      </span>
                    </>
                  ))}
              </p>
            </div>
          </Step>
        ) : (
          <Step n={2} title={t('steps.bill')}>
            <FixedBillFields currency={currency} startsOn={today} />
          </Step>
        )}

        <Step n={3} title={t('steps.share', { product })}>
          <CostShareFields
            key={kind}
            product={product}
            tagName={provider ? provider.tagName : null}
            tags={tested?.ok && tested.tags.length > 0 ? tested.tags : null}
            others={0}
          />
        </Step>

        <Step n={4} title={t('steps.connect')}>
          <p className="text-sm text-muted-foreground">
            {provider ? t('history') : t('historyFixed')}
          </p>
          <SubmitButton className="self-start">{t('connect')}</SubmitButton>
        </Step>
      </ol>
    </ActionForm>
  )
}
