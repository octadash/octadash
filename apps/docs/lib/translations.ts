import { uiTranslations } from 'fumadocs-ui/i18n'
import { i18n } from './i18n'

/** The docs' own words around the pages, in both languages. */
export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: { displayName: 'English' },
    pt: {
      displayName: 'Português',
      'Back to Home(404 not found page)': 'Voltar ao início',
      'Choose a language(language switcher)': 'Escolha o idioma',
      'Close Search(search dialog)(aria-label)': 'Fechar busca',
      'Close Sidebar(aria-label)': 'Fechar menu lateral',
      'Close Sidebar(sidebar)(aria-label)': 'Fechar menu lateral',
      'Close(image zoom)(aria-label)': 'Fechar',
      'Collapse Sidebar(sidebar)(aria-label)': 'Recolher menu lateral',
      'Copied Anchor Link(heading anchor)(aria-label)': 'Link da seção copiado',
      'Copied Markdown(page actions)': 'Markdown copiado',
      'Copied Text(code block)(aria-label)': 'Código copiado',
      'Copy Anchor Link(heading anchor)(aria-label)': 'Copiar link da seção',
      'Copy Markdown(page actions)': 'Copiar Markdown',
      'Copy Text(code block)(aria-label)': 'Copiar código',
      'Dark(theme switcher)(aria-label)': 'Escuro',
      'Edit on GitHub(edit page)': 'Editar no GitHub',
      'Hide Sidebar(sidebar)': 'Esconder menu lateral',
      'Language(language switcher)': 'Idioma',
      'Last updated on(page footer)': 'Atualizado em',
      'Light(theme switcher)(aria-label)': 'Claro',
      'Next Page(pagination)': 'Próxima',
      'No Headings(table of contents)': 'Sem seções',
      'No results found(search dialog)': 'Nada encontrado',
      'On this page(table of contents)': 'Nesta página',
      'Open Search(search trigger)(aria-label)': 'Abrir busca',
      'Open Sidebar(aria-label)': 'Abrir menu lateral',
      'Open Sidebar(sidebar)(aria-label)': 'Abrir menu lateral',
      'Open in ChatGPT(page actions)': 'Abrir no ChatGPT',
      'Open in Claude(page actions)': 'Abrir no Claude',
      'Open in Cursor(page actions)': 'Abrir no Cursor',
      'Open in GitHub(page actions)': 'Abrir no GitHub',
      'Open(page actions)': 'Abrir',
      'Options(aria-label)': 'Opções',
      'Page Not Found(404 not found page)': 'Página não encontrada',
      'Previous Page(pagination)': 'Anterior',
      'Read {url}, I want to ask questions about it.(page actions)':
        'Leia {url}, quero fazer perguntas sobre ela.',
      'Search failed(search dialog)': 'A busca falhou',
      'Search(search dialog)': 'Buscar',
      'Search(search trigger)': 'Buscar',
      'Show Sidebar(sidebar)': 'Mostrar menu lateral',
      'Skip to Content(skip link)': 'Pular para o conteúdo',
      'System(theme switcher)(aria-label)': 'Sistema',
      'Table of Contents(inline table of contents)': 'Índice',
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)':
        'A página que você procura pode ter sido removida ou mudado de endereço.',
      'Theme(site menu)': 'Tema',
      'Toggle Theme(theme switcher)(aria-label)': 'Trocar tema',
      'View as Markdown(page actions)': 'Ver como Markdown',
    },
  })
