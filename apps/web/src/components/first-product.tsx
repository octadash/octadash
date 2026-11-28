import { PackageIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { SubmitButton } from '@/components/submit-button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'

/**
 * The Overview of an organization with no products: the first product's form
 * in place, never an empty dashboard. Members, who can't create one, are told
 * whom to ask.
 */
export async function FirstProduct({
  orgName,
  canCreate,
}: {
  orgName: string
  canCreate: boolean
}) {
  const t = await getTranslations()
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">{orgName}</h1>
      <Empty className="border border-dashed border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon />
          </EmptyMedia>
          <EmptyTitle>
            <h2>{t('projects.emptyTitle')}</h2>
          </EmptyTitle>
          <EmptyDescription>
            {canCreate ? t('projects.emptyBody') : t('projects.emptyMember')}
          </EmptyDescription>
        </EmptyHeader>
        {canCreate && (
          <EmptyContent>
            <ActionForm
              action={createProjectAction}
              className="flex w-full flex-wrap gap-2 text-left"
            >
              <Input
                name="name"
                maxLength={80}
                required
                aria-label={t('newProduct.name')}
                className="min-w-0 flex-1"
                placeholder={t('newProduct.placeholder')}
              />
              <SubmitButton>{t('projects.createShort')}</SubmitButton>
            </ActionForm>
          </EmptyContent>
        )}
      </Empty>
    </div>
  )
}
