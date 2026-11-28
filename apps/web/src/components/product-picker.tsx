'use client'

import { CheckIcon, ChevronsUpDownIcon, LayersIcon, PlusIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { areaOf, scopeOf } from '@/lib/areas'
import type { ProductStatus } from '@/lib/monitors'
import { cn } from '@/lib/utils'
import { NewProductDialog, type NewProductLabels } from './new-product-dialog'
import { StatusDot } from './status-dot'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export interface PickerLabels {
  label: string
  all: string
  search: string
  none: string
  new: string
}

/**
 * Chooses the product (or every product) the menu areas apply to. Switching
 * keeps the open area: Errors of one product leads to Errors of the next.
 */
export function ProductPicker({
  products,
  canCreate,
  labels,
  newProductLabels,
}: {
  products: { slug: string; name: string; status: ProductStatus }[]
  canCreate: boolean
  labels: PickerLabels
  newProductLabels: NewProductLabels
}) {
  const pathname = usePathname()
  const scope = scopeOf(pathname)
  const area = areaOf(pathname)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const current = scope.slug ? products.find((p) => p.slug === scope.slug) : null
  const needle = query.trim().toLocaleLowerCase()
  const shown = needle
    ? products.filter((p) => p.name.toLocaleLowerCase().includes(needle))
    : products
  const hrefFor = (base: string) => (area ? `${base}/${area}` : base)

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9.5 max-w-64 gap-2.5 px-3"
            aria-label={labels.label}
          >
            {current ? (
              <StatusDot status={current.status} />
            ) : (
              <LayersIcon className="text-muted-foreground" />
            )}
            <span className="truncate">{current?.name ?? labels.all}</span>
            <ChevronsUpDownIcon data-icon="inline-end" className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-72 flex-col gap-1">
          <div className="flex items-center gap-2 border-b border-border px-2 pb-1.5">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.search}
              aria-label={labels.search}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {!needle && (
              <PickerItem
                href={hrefFor('/all')}
                active={!scope.slug}
                onSelect={() => setOpen(false)}
                icon={<LayersIcon className="size-4 text-muted-foreground" />}
              >
                {labels.all}
              </PickerItem>
            )}
            {shown.map((product) => (
              <PickerItem
                key={product.slug}
                href={hrefFor(`/p/${product.slug}`)}
                active={product.slug === scope.slug}
                onSelect={() => setOpen(false)}
                icon={<StatusDot status={product.status} />}
              >
                {product.name}
              </PickerItem>
            ))}
            {needle && shown.length === 0 && (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">{labels.none}</li>
            )}
          </ul>
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setCreating(true)
              }}
              className="flex h-9 items-center gap-2.5 rounded-lg border-t border-border px-2.5 text-sm text-brand hover:bg-secondary"
            >
              <PlusIcon className="size-4" />
              {labels.new}
            </button>
          )}
        </PopoverContent>
      </Popover>
      {canCreate && (
        <NewProductDialog open={creating} onOpenChange={setCreating} labels={newProductLabels} />
      )}
    </>
  )
}

function PickerItem({
  href,
  active,
  icon,
  onSelect,
  children,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-secondary',
          active && 'font-medium',
        )}
      >
        <span className="flex w-4 justify-center">{icon}</span>
        <span className="truncate">{children}</span>
        {active && <CheckIcon className="ml-auto size-4 text-brand" />}
      </Link>
    </li>
  )
}
