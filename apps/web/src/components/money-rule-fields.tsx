'use client'

import type { ConnectionRule } from '@octadash/db'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'

/** Which payments of a gateway account are this product's: All, Only these products, By metadata. */
export function MoneyRuleFields({
  gateway,
  product,
  products,
  initial,
}: {
  gateway: { id: string; name: string; hasProducts: boolean }
  product: string
  /** The account's products after "Test key"; null when not read, so ids are typed. */
  products: { id: string; name: string }[] | null
  initial?: ConnectionRule
}) {
  const t = useTranslations('moneySetup.rule')
  const id = useId()
  const [mode, setMode] = useState<ConnectionRule['mode']>(initial?.mode ?? 'all')
  const values = initial && initial.mode !== 'all' ? initial.values : []
  const [picked, setPicked] = useState<string[]>(initial?.mode === 'products' ? values : [])
  const tag = gateway.id === 'asaas' ? 'asaas' : 'other'
  const choices: { mode: ConnectionRule['mode']; label: string; body: string }[] = [
    { mode: 'all', label: t('all', { gateway: gateway.name }), body: t('allBody', { product }) },
    ...(gateway.hasProducts
      ? [
          {
            mode: 'products' as const,
            label: t('products', { gateway: gateway.name }),
            body: t('productsBody'),
          },
        ]
      : []),
    { mode: 'metadata', label: t(`metadata.${tag}`), body: t(`metadataBody.${tag}`) },
  ]
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{t('legend', { product })}</legend>
      {choices.map((c) => (
        <div
          key={c.mode}
          className={cn(
            'flex flex-col gap-2 rounded-lg border p-3',
            mode === c.mode ? 'border-brand bg-brand/5' : 'border-border',
          )}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="mode"
              value={c.mode}
              checked={mode === c.mode}
              onChange={() => setMode(c.mode)}
              aria-describedby={`${id}-${c.mode}`}
              className="mt-0.5 size-4 accent-brand"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{c.label}</span>
              <span id={`${id}-${c.mode}`} className="text-xs text-muted-foreground">
                {c.body}
              </span>
            </span>
          </label>
          {c.mode === 'products' &&
            mode === 'products' &&
            (products && products.length > 0 ? (
              <fieldset className="ml-7 flex flex-col gap-1.5">
                <legend className="mb-1 text-xs text-muted-foreground">
                  {t('found', { picked: picked.length, count: products.length })}
                </legend>
                <div className="flex max-h-56 flex-col gap-1.5 overflow-auto">
                  {products.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-p-${p.id}`}
                        name="product"
                        value={p.id}
                        checked={picked.includes(p.id)}
                        onCheckedChange={(on) =>
                          setPicked((list) =>
                            on ? [...list, p.id] : list.filter((v) => v !== p.id),
                          )
                        }
                      />
                      <Label htmlFor={`${id}-p-${p.id}`} className="font-normal">
                        {p.name}
                        <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                      </Label>
                    </div>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div className="ml-7 flex flex-col gap-1">
                <Label htmlFor={`${id}-ids`} className="text-xs">
                  {t('ids')}
                </Label>
                <Input
                  id={`${id}-ids`}
                  name="productIds"
                  defaultValue={initial?.mode === 'products' ? values.join(', ') : ''}
                  placeholder={
                    gateway.id === 'paddle' ? 'pro_01h…, pro_01j…' : 'prod_P1…, prod_Q2…'
                  }
                  aria-describedby={`${id}-ids-hint`}
                  className="font-mono text-xs md:text-xs"
                />
                <span id={`${id}-ids-hint`} className="text-xs text-muted-foreground">
                  {t('idsHint')}
                </span>
              </div>
            ))}
          {c.mode === 'metadata' && mode === 'metadata' && (
            <div className="ml-7 flex flex-col gap-1">
              <Label htmlFor={`${id}-tags`} className="text-xs">
                {t(`tags.${tag}`)}
              </Label>
              <Input
                id={`${id}-tags`}
                name="tags"
                defaultValue={initial?.mode === 'metadata' ? values.join(', ') : ''}
                placeholder="acme-shop"
                aria-describedby={`${id}-tags-hint`}
                className="font-mono text-xs md:text-xs"
              />
              <span id={`${id}-tags-hint`} className="text-xs text-muted-foreground">
                {t('tagsHint')}
              </span>
            </div>
          )}
        </div>
      ))}
    </fieldset>
  )
}
