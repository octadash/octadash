import { listProjects } from '@octadash/db'
import { ChevronDownIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { RulesList } from '@/components/rules-list'
import { SettingsHeader } from '@/components/settings-page'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/**
 * Settings › Alert rules: the organization's rules, grouped by area. "Rules
 * for" goes to one product's own rules, on that product's settings.
 */
export default async function AlertsPage() {
  const { org } = await requireOrg()
  const [t, products] = await Promise.all([
    getTranslations('alerts'),
    listProjects(services().db, org.id),
  ])
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader
        title={t('title')}
        intro={t('intro')}
        action={
          products.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('rulesFor')}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    {t('allProducts')}
                    <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-auto">
                  <DropdownMenuItem asChild>
                    <Link href="/settings/alerts" aria-current="page">
                      {t('allProducts')}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t('oneProduct')}
                  </DropdownMenuLabel>
                  {products.map((product) => (
                    <DropdownMenuItem key={product.id} asChild>
                      <Link href={`/p/${product.slug}/settings#alerts`}>{product.name}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      <RulesList orgId={org.id} canEdit={canManage(org.role)} />
    </div>
  )
}
