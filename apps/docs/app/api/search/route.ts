import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

export const revalidate = false

// Built once into a static file; the browser searches it, no search service.
export const { staticGET: GET } = createFromSource(source)
