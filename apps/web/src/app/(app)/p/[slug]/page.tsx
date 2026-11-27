import { getProjectBySlug, listProjectKeys, sentryDsn } from '@octadash/db'
import { SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CopyField } from '@/components/copy-field'
import { DiagnosisCard } from '@/components/diagnosis/diagnosis-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

const modules = ['uptime', 'web', 'errors', 'product', 'revenue', 'ai', 'logs'] as const

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db, env } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const [keys, t] = await Promise.all([listProjectKeys(db, org.id, project.id), getTranslations()])
  const key = keys.find((k) => !k.revoked_at)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold">{project.name}</h1>
          {project.url ? (
            <a
              href={project.url}
              className="text-sm text-muted-foreground hover:text-brand"
              rel="noreferrer"
              target="_blank"
            >
              {project.url.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">{t('projects.noUrl')}</span>
          )}
        </div>
        <Button asChild variant="outline">
          <Link href={`/p/${project.slug}/settings`}>
            <SettingsIcon data-icon="inline-start" />
            {t('common.settings')}
          </Link>
        </Button>
      </div>

      <DiagnosisCard orgId={org.id} project={project} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold">{t('projects.modulesTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('projects.modulesIntro')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((m) => (
            <Card key={m} size="sm">
              <CardHeader>
                <CardTitle>
                  <h3>{t(`modules.${m}.name`)}</h3>
                </CardTitle>
                <CardDescription>{t(`modules.${m}.body`)}</CardDescription>
                <CardAction>
                  <Badge variant="secondary">{t('common.comingSoon')}</Badge>
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {key && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-lg font-semibold">{t('projects.keysTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('projects.keysIntro')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <KeyRow label={t('projects.publicKey')} value={key.public_key} t={t} />
            <KeyRow
              label={t('projects.sentryDsn')}
              value={sentryDsn(env.OCTADASH_INGEST_URL, key.public_key, String(project.ingest_id))}
              t={t}
            />
            <KeyRow label={t('projects.ingestUrl')} value={env.OCTADASH_INGEST_URL} t={t} />
          </CardContent>
        </Card>
      )}
    </>
  )
}

function KeyRow({
  label,
  value,
  t,
}: {
  label: string
  value: string
  t: (key: 'common.copy' | 'common.copied') => string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <CopyField value={value} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
    </div>
  )
}
