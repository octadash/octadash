'use client'

import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { areaOf, scopeOf } from '@/lib/areas'
import type { ProductStatus } from '@/lib/monitors'
import { cn } from '@/lib/utils'
import type { GroupFormLabels } from './group-form'
import { NewGroupDialog, type NewGroupLabels } from './new-group-dialog'
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
  groups: string
  products: string
  newGroup: string
}

interface PickerProduct {
  id: string
  slug: string
  name: string
  status: ProductStatus
}

interface PickerGroup {
  slug: string
  name: string
  status: ProductStatus
}

/**
 * Chooses what the menu areas apply to: every product, a group of products or
 * one product. Switching keeps the open area: Errors of one product leads to
 * Errors of the next.
 */
export function ProductPicker({
  products,
  groups,
  canCreate,
  labels,
  newProductLabels,
  newGroupLabels,
  groupFormLabels,
}: {
  products: PickerProduct[]
  groups: PickerGroup[]
  canCreate: boolean
  labels: PickerLabels
  newProductLabels: NewProductLabels
  newGroupLabels: NewGroupLabels
  groupFormLabels: GroupFormLabels
}) {
  const pathname = usePathname()
  const scope = scopeOf(pathname)
  const area = areaOf(pathname)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState<'product' | 'group' | null>(null)
  const [query, setQuery] = useState('')
  const current =
    scope.kind === 'product'
      ? products.find((p) => p.slug === scope.slug)
      : scope.kind === 'group'
        ? groups.find((g) => g.slug === scope.slug)
        : null
  const needle = query.trim().toLocaleLowerCase()
  const matches = (name: string) => !needle || name.toLocaleLowerCase().includes(needle)
  const shown = products.filter((p) => matches(p.name))
  const shownGroups = groups.filter((g) => matches(g.name))
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
            {scope.kind === 'group' ? (
              <FolderIcon className="text-muted-foreground" />
            ) : current ? (
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
                active={scope.kind === 'all'}
                onSelect={() => setOpen(false)}
                icon={<LayersIcon className="size-4 text-muted-foreground" />}
              >
                {labels.all}
              </PickerItem>
            )}
            {shownGroups.length > 0 && <PickerHeading>{labels.groups}</PickerHeading>}
            {shownGroups.map((group) => (
              <PickerItem
                key={`g:${group.slug}`}
                href={hrefFor(`/g/${group.slug}`)}
                active={scope.kind === 'group' && group.slug === scope.slug}
                onSelect={() => setOpen(false)}
                icon={<FolderIcon className="size-4 text-muted-foreground" />}
                trailing={<StatusDot status={group.status} />}
              >
                {group.name}
              </PickerItem>
            ))}
            {shownGroups.length > 0 && shown.length > 0 && (
              <PickerHeading>{labels.products}</PickerHeading>
            )}
            {shown.map((product) => (
              <PickerItem
                key={product.slug}
                href={hrefFor(`/p/${product.slug}`)}
                active={scope.kind === 'product' && product.slug === scope.slug}
                onSelect={() => setOpen(false)}
                icon={<StatusDot status={product.status} />}
              >
                {product.name}
              </PickerItem>
            ))}
            {needle && shown.length === 0 && shownGroups.length === 0 && (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">{labels.none}</li>
            )}
          </ul>
          {canCreate && (
            <div className="flex flex-col border-t border-border pt-1">
              <CreateButton
                onClick={() => {
                  setOpen(false)
                  setCreating('product')
                }}
              >
                {labels.new}
              </CreateButton>
              {products.length > 0 && (
                <CreateButton
                  onClick={() => {
                    setOpen(false)
                    setCreating('group')
                  }}
                >
                  {labels.newGroup}
                </CreateButton>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {canCreate && (
        <>
          <NewProductDialog
            open={creating === 'product'}
            onOpenChange={(next) => setCreating(next ? 'product' : null)}
            labels={newProductLabels}
          />
          <NewGroupDialog
            key={creating === 'group' ? 'open' : 'closed'}
            open={creating === 'group'}
            onOpenChange={(next) => setCreating(next ? 'group' : null)}
            products={products}
            labels={newGroupLabels}
            formLabels={groupFormLabels}
          />
        </>
      )}
    </>
  )
}

function PickerHeading({ children }: { children: React.ReactNode }) {
  return (
    <li
      className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-muted-foreground"
      role="presentation"
    >
      {children}
    </li>
  )
}

function CreateButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-brand hover:bg-secondary"
    >
      <PlusIcon className="size-4" />
      {children}
    </button>
  )
}

function PickerItem({
  href,
  active,
  icon,
  trailing,
  onSelect,
  children,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  trailing?: React.ReactNode
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
        <span className="ml-auto flex items-center gap-2">
          {trailing}
          {active && <CheckIcon className="size-4 text-brand" />}
        </span>
      </Link>
    </li>
  )
}
