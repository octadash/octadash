import { describe, expect, it } from 'vitest'
import { scopeSources, sourceParam } from './source-scope'

const SITE = '0b6f3c1e-9a2d-4c7b-8e5f-1d2a3b4c5d6e'
const API = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('source filter', () => {
  const sources = [
    { id: SITE, name: 'Site', project_id: 'p1' },
    { id: API, name: 'API', project_id: 'p1' },
    { id: OTHER, name: 'Site', project_id: 'p2' },
  ]
  const projects = [{ id: 'p1', name: 'Pagebird' }]

  it('lists the sources of the products in scope, with their product', () => {
    const { sources: list, source } = scopeSources(sources, projects, null)
    expect(list).toEqual([
      { id: SITE, name: 'Site', product: 'Pagebird' },
      { id: API, name: 'API', product: 'Pagebird' },
    ])
    expect(source).toBeNull()
  })

  it('filters by a source of the scope, never by one of another product', () => {
    expect(scopeSources(sources, projects, API).source?.name).toBe('API')
    expect(scopeSources(sources, projects, OTHER).source).toBeNull()
  })

  it('reads only ids from the address', () => {
    expect(sourceParam(SITE)).toBe(SITE)
    expect(sourceParam([SITE, API])).toBe(SITE)
    expect(sourceParam('site')).toBeNull()
    expect(sourceParam(undefined)).toBeNull()
  })
})
