'use client'

import { SearchIcon } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { createGroupAction, updateGroupAction } from '@/actions/groups'
import type { ProductStatus } from '@/lib/monitors'
import { ActionForm } from './action-form'
import { Field } from './field'
import { StatusDot } from './status-dot'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'

export interface GroupFormLabels {
  name: string
  placeholder: string
  products: string
  search: string
  none: string
  /** "# chosen": # becomes the count. */
  selected: string
}

/**
 * The name of a group and which products are in it. Creates one, or edits it
 * when `group` is given. The buttons come from the caller (dialog or page).
 */
export function GroupForm({
  group,
  products,
  labels,
  actions,
}: {
  group?: { id: string; name: string; projectIds: string[] }
  products: { id: string; name: string; status: ProductStatus }[]
  labels: GroupFormLabels
  actions: ReactNode
}) {
  const [chosen, setChosen] = useState(() => new Set(group?.projectIds ?? []))
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const shown = needle
    ? products.filter((p) => p.name.toLocaleLowerCase().includes(needle))
    : products
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <ActionForm
      action={group ? updateGroupAction : createGroupAction}
      className="flex flex-col gap-5"
    >
      {group && <input type="hidden" name="groupId" value={group.id} />}
      {/* Chosen products travel even when the search hides them. */}
      {[...chosen].map((id) => (
        <input key={id} type="hidden" name="project" value={id} />
      ))}
      <Field label={labels.name}>
        <Input
          name="name"
          defaultValue={group?.name}
          maxLength={80}
          required
          autoFocus={!group}
          placeholder={labels.placeholder}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 flex w-full items-center justify-between text-sm font-medium">
          {labels.products}
          <span className="font-normal text-muted-foreground">
            {labels.selected.replace('#', String(chosen.size))}
          </span>
        </legend>
        {products.length > 8 && (
          <div className="flex items-center gap-2 rounded-lg border border-input px-2.5">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.search}
              aria-label={labels.search}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <ul className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-input">
          {shown.map((product) => (
            <ProductCheck
              key={product.id}
              product={product}
              checked={chosen.has(product.id)}
              onChange={(on) => toggle(product.id, on)}
            />
          ))}
          {shown.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{labels.none}</li>
          )}
        </ul>
      </fieldset>
      {actions}
    </ActionForm>
  )
}

function ProductCheck({
  product,
  checked,
  onChange,
}: {
  product: { id: string; name: string; status: ProductStatus }
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <li className="border-b border-input last:border-0">
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-secondary/60"
      >
        <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
        <StatusDot status={product.status} />
        <span className="truncate">{product.name}</span>
      </label>
    </li>
  )
}
