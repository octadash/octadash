import { listProjects } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import { createProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/**
 * A new product, by name only. With no product yet it is step 2 of the first
 * run, and says what comes next.
 */
export default async function NewProductPage() {
  const { org } = await requireManager()
  const [t, projects] = await Promise.all([getTranslations(), listProjects(services().db, org.id)])
  const first = projects.length === 0
  return (
    <div className="flex flex-col gap-4 self-center py-8 sm:w-[32rem]">
      <Card>
        <CardHeader>
          {first && (
            <p className="text-sm text-muted-foreground">{t('auth.step', { step: 2, total: 2 })}</p>
          )}
          <CardTitle>
            <h1 className="font-display text-xl font-semibold">
              {t(first ? 'newProduct.firstTitle' : 'newProduct.title')}
            </h1>
          </CardTitle>
          <CardDescription>
            {t(first ? 'newProduct.firstIntro' : 'newProduct.intro')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createProjectAction}>
            <Field label={t('newProduct.name')}>
              <Input
                name="name"
                maxLength={80}
                required
                autoFocus
                placeholder={t('newProduct.placeholder')}
              />
            </Field>
            <SubmitButton className="self-start">{t('projects.create')}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      {first && (
        <section
          aria-labelledby="next-title"
          className="rounded-xl border border-dashed border-border p-4 text-sm"
        >
          <h2 id="next-title" className="font-semibold">
            {t('newProduct.nextTitle')}
          </h2>
          <p className="mt-1 text-muted-foreground">{t('newProduct.nextBody')}</p>
        </section>
      )}
    </div>
  )
}
