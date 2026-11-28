'use client'

import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ReactNode, useState, useTransition } from 'react'
import { connectMoneyAction, type KeyTest, testMoneyKeyAction } from '@/actions/money'
import { ActionForm } from './action-form'
import { Option } from './choice'
import { CopyField } from './copy-field'
import { Field } from './field'
import { MoneyRuleFields } from './money-rule-fields'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
import { Input } from './ui/input'

export interface GatewayChoice {
  id: 'stripe' | 'asaas' | 'paddle'
  name: string
  keyPlaceholder: string
  /** In the viewer's language. */
  keyHelp: string
  hasProducts: boolean
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

/**
 * Connect a payment gateway, as closed in the Money canvas: gateway, a
 * read-only key checked before saving, which payments are this product's,
 * the webhook for live updates and the 12-month import.
 */
export function MoneyConnectForm({
  slug,
  product,
  gateways,
  token,
  asaasToken,
  hooksUrl,
}: {
  slug: string
  product: string
  gateways: GatewayChoice[]
  /** The webhook URL's token, made on the page so the URL can be added before saving. */
  token: string
  /** The access token Asaas sends with each webhook. */
  asaasToken: string
  /** `${OCTADASH_URL}/hooks`. */
  hooksUrl: string
}) {
  const t = useTranslations('moneySetup')
  const [gatewayId, setGatewayId] = useState<GatewayChoice['id']>('stripe')
  const [key, setKey] = useState('')
  const [test, setTest] = useState<(KeyTest & { key: string; gateway: string }) | null>(null)
  const [testing, startTest] = useTransition()
  const gateway = gateways.find((g) => g.id === gatewayId) ?? (gateways[0] as GatewayChoice)
  const tested = test && test.key === key.trim() && test.gateway === gateway.id ? test : null
  const webhookUrl = `${hooksUrl}/${gateway.id}/${token}`
  const copy = { copyLabel: t('copy'), copiedLabel: t('copied') }

  return (
    <ActionForm action={connectMoneyAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <ol className="flex flex-col gap-5">
        <Step n={1} title={t('steps.gateway')}>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t('steps.gateway')}</legend>
            <div className="flex flex-wrap gap-2">
              {gateways.map((g) => (
                <Option
                  key={g.id}
                  name="gateway"
                  value={g.id}
                  checked={g.id === gateway.id}
                  onChange={() => setGatewayId(g.id)}
                >
                  {g.name}
                </Option>
              ))}
              {['Mercado Pago', 'Hotmart'].map((name) => (
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
          <Field label={t('name')} hint={t('nameHint')}>
            <Input
              name="name"
              maxLength={80}
              placeholder={t('namePlaceholder', { gateway: gateway.name })}
            />
          </Field>
        </Step>

        <Step n={2} title={t('steps.key')}>
          <Field
            label={t('key', { gateway: gateway.name })}
            hint={t('keyHint')}
            info={{
              label: t('keyInfoLabel'),
              title: t('key', { gateway: gateway.name }),
              body: gateway.keyHelp,
            }}
          >
            <Input
              name="key"
              required
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={gateway.keyPlaceholder}
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
                  const result = await testMoneyKeyAction({
                    slug,
                    gateway: gateway.id,
                    key: keyNow,
                  })
                  setTest({ ...result, key: keyNow, gateway: gateway.id })
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
                      {gateway.hasProducts
                        ? t('testOkProducts', { count: tested.products.length })
                        : t('testOk')}
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

        <Step n={3} title={t('steps.rule', { product })}>
          <MoneyRuleFields
            key={gateway.id}
            gateway={gateway}
            product={product}
            products={tested?.ok && tested.products.length > 0 ? tested.products : null}
          />
        </Step>

        <Step n={4} title={t('steps.webhook')}>
          <p className="text-sm text-muted-foreground">{t(`webhook.${gateway.id}`)}</p>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('webhookUrl')}</span>
            <CopyField value={webhookUrl} label={t('webhookUrl')} {...copy} />
          </div>
          {gateway.id === 'asaas' ? (
            <div className="flex flex-col gap-1.5">
              <input type="hidden" name="webhookSecret" value={asaasToken} />
              <span className="text-sm font-medium">{t('asaasToken')}</span>
              <CopyField value={asaasToken} label={t('asaasToken')} {...copy} />
              <span className="text-xs text-muted-foreground">{t('asaasTokenHint')}</span>
            </div>
          ) : (
            <Field label={t('signingSecret')} hint={t(`signingSecretHint.${gateway.id}`)}>
              <Input
                name="webhookSecret"
                autoComplete="off"
                spellCheck={false}
                placeholder={gateway.id === 'stripe' ? 'whsec_...' : 'pdl_ntfset_...'}
                className="font-mono"
              />
            </Field>
          )}
        </Step>

        <Step n={5} title={t('steps.history')}>
          <p className="text-sm text-muted-foreground">{t('history')}</p>
          <SubmitButton className="self-start">{t('connect')}</SubmitButton>
        </Step>
      </ol>
    </ActionForm>
  )
}
