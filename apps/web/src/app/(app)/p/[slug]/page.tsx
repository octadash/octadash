import { getProjectBySlug, listProjectKeys, sentryDsn } from '@octadash/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CopyField } from '@/components/copy-field'
import { Badge, Card } from '@/components/ui'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

const modules = [
  'diagnosis',
  'uptime',
  'web',
  'errors',
  'product',
  'revenue',
  'ai',
  'logs',
] as const

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
              className="text-sm text-muted hover:text-accent"
              rel="noreferrer"
              target="_blank"
            >
              {project.url.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <span className="text-sm text-muted">{t('projects.noUrl')}</span>
          )}
        </div>
        <Link href={`/p/${project.slug}/settings`} className="text-sm text-muted hover:text-text">
          {t('common.settings')}
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold">{t('projects.modulesTitle')}</h2>
          <p className="text-sm text-muted">{t('projects.modulesIntro')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((m) => (
            <Card key={m} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{t(`modules.${m}.name`)}</h3>
                <Badge>{t('common.comingSoon')}</Badge>
              </div>
              <p className="text-sm text-muted">{t(`modules.${m}.body`)}</p>
            </Card>
          ))}
        </div>
      </section>

      {key && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-semibold">{t('projects.keysTitle')}</h2>
            <p className="text-sm text-muted">{t('projects.keysIntro')}</p>
          </div>
          <KeyRow label={t('projects.publicKey')} value={key.public_key} t={t} />
          <KeyRow
            label={t('projects.sentryDsn')}
            value={sentryDsn(env.OCTADASH_INGEST_URL, key.public_key, String(project.ingest_id))}
            t={t}
          />
          <KeyRow label={t('projects.ingestUrl')} value={env.OCTADASH_INGEST_URL} t={t} />
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
      <span className="text-xs font-medium text-muted">{label}</span>
      <CopyField value={value} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
    </div>
  )
}
