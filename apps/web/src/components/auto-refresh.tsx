'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Re-renders the page from the server every few seconds while something is in progress. */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs)
    return () => clearInterval(timer)
  }, [router, everyMs])
  return null
}
