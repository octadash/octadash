'use client'

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useTransition } from 'react'
import { switchOrgAction } from '@/actions/auth'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export function OrgSwitcher({
  current,
  orgs,
  label,
}: {
  current: { id: string; name: string }
  orgs: { id: string; name: string }[]
  label: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending} aria-label={label}>
          {current.name}
          <ChevronsUpDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onSelect={() => {
              if (org.id === current.id) return
              const formData = new FormData()
              formData.set('organizationId', org.id)
              startTransition(() => switchOrgAction(formData))
            }}
          >
            {org.name}
            {org.id === current.id && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
