import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import { Untranslated } from '@/components/untranslated'
import { i18n, isLang, type Lang } from '@/lib/i18n'
import { gitConfig, localeUrl } from '@/lib/shared'
import { source } from '@/lib/source'

function find(lang: string, slug: string[] | undefined) {
  if (!isLang(lang)) return null
  const page = source.getPage(slug, lang)
  return page ? { page, lang } : null
}

export default async function Page(props: PageProps<'/[lang]/[[...slug]]'>) {
  const { lang, slug } = await props.params
  const found = find(lang, slug)
  if (!found) notFound()
  const { page } = found
  const MDX = page.data.body
  // A Portuguese URL whose page has no .pt file shows the English one.
  const translated = found.lang === i18n.defaultLanguage || /\.[a-z]+\.mdx$/.test(page.path)
  const markdownUrl = `/llms.mdx${page.url === '/' ? '/index' : page.url}.md`

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      // The table of contents is a landmark, named by its own heading.
      tableOfContent={{ container: { role: 'navigation', 'aria-labelledby': 'toc-title' } }}
      tableOfContentPopover={{ container: { role: 'navigation' } }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${gitConfig.contentDir}/${encodeURI(page.path)}`}
        />
      </div>
      {!translated && <Untranslated />}
      <DocsBody>
        <MDX components={getMDXComponents(found.lang, { a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams('slug', 'lang')
}

export async function generateMetadata(props: PageProps<'/[lang]/[[...slug]]'>): Promise<Metadata> {
  const { lang, slug } = await props.params
  const found = find(lang, slug)
  if (!found) notFound()
  const { page } = found
  // The page's address without the language prefix.
  const path = `/${page.slugs.join('/')}`
  const languages: Record<string, string> = {}
  for (const l of i18n.languages as readonly Lang[]) {
    languages[l === 'pt' ? 'pt-BR' : l] = localeUrl(path, l)
  }
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: localeUrl(path, found.lang),
      languages: { ...languages, 'x-default': localeUrl(path, 'en') },
    },
  }
}
