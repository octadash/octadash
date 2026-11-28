'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Several changes in a burst (ten monitors down together) cause one reload. */
const BURST_MS = 500

/**
 * Keeps the open screen current: when the worker or another person changes
 * incidents or monitors, the server data of this page is fetched again, with
 * no full reload and nothing lost in forms. Renders nothing.
 */
export function LiveRefresh() {
  const router = useRouter()
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource('/api/live')
    let timer: ReturnType<typeof setTimeout> | undefined
    let opened = false
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), BURST_MS)
    }
    for (const topic of ['incidents', 'monitors', 'watcher', 'errors']) {
      source.addEventListener(topic, refresh)
    }
    // After a dropped connection, events may have been missed: catch up once.
    source.addEventListener('open', () => {
      if (opened) refresh()
      opened = true
    })
    return () => {
      clearTimeout(timer)
      source.close()
    }
  }, [router])
  return null
}
