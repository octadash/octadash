import { CheckIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { hideGetStartedAction } from '@/actions/get-started'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { GetStarted as GetStartedData } from '@/server/get-started'

/**
 * The first steps of a new install, on top of the first screens. Each step
 * opens where it is done; the next one to do stands out. Hidden for good with
 * "Hide", and gone by itself when every step is done.
 */
export async function GetStarted({ data }: { data: GetStartedData }) {
  const t = await getTranslations('getStarted')
  const total = data.steps.length
  const next = data.steps.find((s) => !s.done)?.id
  const href = {
    product: '/products/new',
    area: data.first ? `/p/${data.first.slug}#areas` : '/products/new',
    alerts: '/settings/channels',
    watcher: '/settings/watcher',
    invite: '/settings/members',
  }
  return (
    <section
      aria-labelledby="get-started-title"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="get-started-title" className="text-base font-semibold">
          {t('title')}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t('progress', { done: data.done, total })}
        </span>
        <Progress
          value={(data.done / total) * 100}
          aria-label={t('progress', { done: data.done, total })}
          className="h-1.5 w-40 [&>[data-slot=progress-indicator]]:bg-brand"
        />
        <form action={hideGetStartedAction} className="ml-auto">
          <Button type="submit" variant="ghost" size="sm">
            {t('hide')}
          </Button>
        </form>
      </div>
      <ol className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,12rem),1fr))]">
        {data.steps.map((step) => (
          <li key={step.id} className="flex">
            <Link
              href={href[step.id]}
              aria-current={step.id === next ? 'step' : undefined}
              className={cn(
                'flex w-full flex-col gap-1.5 rounded-lg border p-3 hover:border-brand focus-visible:border-brand',
                step.id === next ? 'border-brand/60 bg-secondary/40' : 'border-border',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]',
                    step.done
                      ? 'border-ok bg-ok text-background'
                      : step.id === next
                        ? 'border-brand'
                        : 'border-muted-foreground/60',
                  )}
                >
                  {step.done && <CheckIcon className="size-3" strokeWidth={3} />}
                </span>
                <span className={cn(step.done && 'text-muted-foreground line-through')}>
                  {t(`steps.${step.id}.title`)}
                </span>
                <span className="sr-only">{step.done ? t('done') : t('toDo')}</span>
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {step.id === 'product' && data.first ? data.first.name : t(`steps.${step.id}.text`)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
