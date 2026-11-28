'use client'

import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

export interface LatestPaymentItem {
  id: string
  gateway: string
  status: string
  amount: number
  currency: string
  method: string
  subscription: boolean
  /** ISO. */
  at: string
  product: { name: string; slug: string }
}

/** Shape and word for each status: never the color alone. */
const STATUS_ICON: Record<string, { icon: typeof CircleIcon; className: string }> = {
  paid: { icon: CircleCheckIcon, className: 'text-ok' },
  failed: { icon: TriangleAlertIcon, className: 'text-error' },
  refunded: { icon: RotateCcwIcon, className: 'text-warn' },
  pending: { icon: CircleDashedIcon, className: 'text-muted-foreground' },
  overdue: { icon: CircleDashedIcon, className: 'text-warn' },
  canceled: { icon: CircleIcon, className: 'text-muted-foreground' },
}

/** How often the list asks for new payments. */
const POLL_MS = 15_000

/**
 * "Latest payments" on Money: newest first, asking for new ones every 15
 * seconds; new payments are announced politely.
 */
export function LatestPayments({
  initial,
  scope,
  several,
  locale,
  timeZone,
  labels,
}: {
  initial: LatestPaymentItem[]
  scope: string
  several: boolean
  locale: string
  timeZone: string
  labels: {
    title: string
    live: string
    empty: string
    status: Record<string, string>
    gateways: Record<string, string>
    newPayments: string
  }
}) {
  const [items, setItems] = useState(initial)
  const [announce, setAnnounce] = useState('')

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      try {
        const response = await fetch(`/api/money/latest?scope=${encodeURIComponent(scope)}`, {
          cache: 'no-store',
        })
        if (response.ok) {
          const fresh = (await response.json()) as LatestPaymentItem[]
          if (!stop)
            setItems((current) => {
              const known = new Set(current.map((p) => `${p.id}:${p.status}`))
              const added = fresh.filter((p) => !known.has(`${p.id}:${p.status}`)).length
              if (added > 0) setAnnounce(labels.newPayments.replace('#', String(added)))
              return fresh
            })
        }
      } catch {
        // Asks again on the next round.
      }
      if (!stop) timer = setTimeout(ask, POLL_MS)
    }
    timer = setTimeout(ask, POLL_MS)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [scope, labels.newPayments])

  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone })
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone })
  const today = date.format(new Date())

  return (
    <section aria-labelledby="latest-payments" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="latest-payments" className="text-base font-semibold">
          {labels.title}
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-ok" />
          {labels.live}
        </span>
      </div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((p) => {
            const status = STATUS_ICON[p.status] ?? STATUS_ICON.pending
            const Icon = status?.icon ?? CircleIcon
            const at = new Date(p.at)
            const day = date.format(at)
            return (
              <li key={`${p.gateway}:${p.id}`} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {day === today ? time.format(at) : day}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  {several && <span className="truncate font-medium">{p.product.name}</span>}
                  <span className="truncate text-xs text-muted-foreground">
                    {labels.gateways[p.gateway] ?? p.gateway}
                    {p.method ? ` · ${p.method}` : ''}
                  </span>
                </span>
                <span className="tabular-nums">{formatMoney(p.amount, p.currency, locale)}</span>
                <span className={cn('flex w-24 items-center gap-1 text-xs', status?.className)}>
                  <Icon aria-hidden className="size-3.5" />
                  <span className="text-foreground">{labels.status[p.status] ?? p.status}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
