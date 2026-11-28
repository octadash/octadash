'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'

/**
 * Overlays opened by the address (`?add=1`, `?source=<id>`): a link opens
 * them, the back button and a shared link work, and closing goes back to the
 * page under them without a full reload.
 */
function useClose(closeHref: string) {
  const router = useRouter()
  return (open: boolean) => {
    if (!open) router.replace(closeHref, { scroll: false })
  }
}

/** A short form over the page: "Add source". */
export function RouteDialog({
  closeHref,
  title,
  description,
  children,
}: {
  closeHref: string
  title: string
  description?: string
  children: ReactNode
}) {
  const onOpenChange = useClose(closeHref)
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** A wide panel from the right with what belongs to one row: "View code". */
export function RouteSheet({
  closeHref,
  title,
  description,
  closeLabel,
  children,
}: {
  closeHref: string
  title: string
  description?: string
  closeLabel: string
  children: ReactNode
}) {
  const onOpenChange = useClose(closeHref)
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeLabel={closeLabel}
        className="sm:max-w-3xl"
        // Focus the panel itself: moving it to the first field would select the key.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <SheetHeader className="border-b border-border p-6 pr-12">
          <SheetTitle className="font-display text-xl font-semibold">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-8">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
