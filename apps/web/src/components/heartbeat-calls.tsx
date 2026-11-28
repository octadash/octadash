'use client'

import { CircleCheckIcon, CircleDashedIcon, TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useEffect } from 'react'

/**
 * Whether a heartbeat's calls arrive. While none has, the page reloads its
 * data every 5 seconds, so the first call shows up without a refresh.
 */
export function HeartbeatCalls({
  lastAt,
  lastUp,
  labels,
}: {
  lastAt: string | null
  lastUp: boolean | null
  labels: { waiting: string; lastCall: string; lastFail: string }
}) {
  const router = useRouter()
  const locale = useLocale()
  useEffect(() => {
    if (lastAt) return
    const timer = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(timer)
  }, [lastAt, router])

  if (!lastAt) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleDashedIcon className="size-4 shrink-0" aria-hidden />
        {labels.waiting}
      </p>
    )
  }
  const minutes = Math.round((Date.now() - new Date(lastAt).getTime()) / 60_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const when =
    minutes < 60
      ? rtf.format(-minutes, 'minute')
      : minutes < 1440
        ? rtf.format(-Math.round(minutes / 60), 'hour')
        : rtf.format(-Math.round(minutes / 1440), 'day')
  return (
    <p role="status" className="flex items-center gap-2 text-sm">
      {lastUp === false ? (
        <TriangleAlertIcon className="size-4 shrink-0 text-error" aria-hidden />
      ) : (
        <CircleCheckIcon className="size-4 shrink-0 text-ok" aria-hidden />
      )}
      {(lastUp === false ? labels.lastFail : labels.lastCall).replace('{when}', when)}
    </p>
  )
}
