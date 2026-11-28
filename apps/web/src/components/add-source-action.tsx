import { ChevronDownIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

/**
 * The primary "+ Add source" at the top right of an area. One product: a
 * button to its setup with the dialog open. Several (All products, a group):
 * the same button asks which product first, as "Add monitor" does in Uptime.
 */
export function AddSourceAction({
  area,
  products,
  label,
  pick,
}: {
  area: 'traffic' | 'usage' | 'errors' | 'logs'
  products: { slug: string; name: string }[]
  label: string
  /** Heading of the product list: "Add a source to". */
  pick: string
}) {
  const href = (slug: string) => `/p/${slug}/${area}/setup?add=1`
  const only = products.length === 1 ? products[0] : undefined
  if (only) {
    return (
      <Button asChild>
        <Link href={href(only.slug)}>
          <PlusIcon data-icon="inline-start" aria-hidden />
          {label}
        </Link>
      </Button>
    )
  }
  if (products.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" aria-hidden />
          {label}
          <ChevronDownIcon data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{pick}</DropdownMenuLabel>
        {products.map((product) => (
          <DropdownMenuItem key={product.slug} asChild>
            <Link href={href(product.slug)}>{product.name}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
