import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export interface SourceOption {
  id: string
  name: string
  /** The product it belongs to; shown as a heading when there are several. */
  product: string
  href: string
}

/**
 * "Source: Site ▾" at the top of an area: which source the numbers and lists
 * below come from, every source by default. Sources are grouped by product
 * when the scope has more than one.
 */
export function SourceFilter({
  label,
  all,
  allHref,
  current,
  options,
}: {
  /** "Source". */
  label: string
  /** "All sources". */
  all: string
  allHref: string
  /** The chosen source's id, or null for every source. */
  current: string | null
  options: SourceOption[]
}) {
  if (options.length === 0) return null
  const chosen = options.find((o) => o.id === current)
  const products = [...new Set(options.map((o) => o.product))]
  const several = products.length > 1
  const item = (o: { key: string; name: string; href: string; on: boolean }) => (
    <DropdownMenuItem key={o.key} asChild>
      <Link href={o.href} aria-current={o.on ? 'true' : undefined}>
        <CheckIcon aria-hidden className={o.on ? 'opacity-100' : 'opacity-0'} />
        {o.name}
      </Link>
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`${label}: ${chosen?.name ?? all}`}>
          <span className="text-muted-foreground">{label}:</span>
          <span className="font-medium">
            {chosen ? (several ? `${chosen.product} · ${chosen.name}` : chosen.name) : all}
          </span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
        {item({ key: 'all', name: all, href: allHref, on: !chosen })}
        <DropdownMenuSeparator />
        {products.map((product) => (
          <DropdownMenuGroup key={product}>
            {several && <DropdownMenuLabel>{product}</DropdownMenuLabel>}
            {options
              .filter((o) => o.product === product)
              .map((o) => item({ key: o.id, name: o.name, href: o.href, on: o.id === current }))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
