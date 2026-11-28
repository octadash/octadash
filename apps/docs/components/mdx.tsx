import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import type { Lang } from '@/lib/i18n'
import { Snippets } from './snippets'

type SnippetsProps = Omit<Parameters<typeof Snippets>[0], 'lang'>

/** <Snippets area="errors" /> in a page, with the page's language. */
const SNIPPETS: Record<Lang, (props: SnippetsProps) => React.JSX.Element> = {
  en: (props) => <Snippets {...props} lang="en" />,
  pt: (props) => <Snippets {...props} lang="pt" />,
}

export function getMDXComponents(lang: Lang = 'en', components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Steps,
    Step,
    Tabs,
    Tab,
    Snippets: SNIPPETS[lang],
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = () => getMDXComponents()

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
