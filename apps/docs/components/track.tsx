'use client'

import { useEffect } from 'react'

type Octadash = { track: (name: string, properties?: Record<string, unknown>) => void }

/** The Octadash script on the page, once it loaded (it is deferred). */
export function octadash(): Octadash | undefined {
  return (window as unknown as { octadash?: Octadash }).octadash
}

/**
 * Product usage of the docs themselves: copying a code block sends
 * `code_copied` with the page and the block's title or tab. Nothing about the
 * reader, only where.
 */
export function TrackCopies() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest('button[aria-live]')
      const block = button?.closest('figure')
      if (!button || !block?.querySelector('pre')) return
      // The tab picked above the block ("Next.js"), or its file name.
      const tab = block
        .closest('[role="tabpanel"]')
        ?.parentElement?.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent?.trim()
      const title = tab || block.querySelector('figcaption')?.textContent?.trim() || undefined
      octadash()?.track('code_copied', { page: location.pathname, block: title })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  return null
}
