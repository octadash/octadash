import { describe, expect, it } from 'vitest'
import { compileLogQuery, levelOf, levelOfSeverity, parseLogQuery } from './log-query'

describe('the Logs search box', () => {
  it('reads words, phrases, fields, comparisons and negation', () => {
    expect(
      parseLogQuery('level:error "time out" product:acme-pay duration_ms>2000 -service:worker x'),
    ).toEqual([
      { kind: 'field', field: 'level', op: ':', value: 'error', not: false },
      { kind: 'text', value: 'time out', not: false },
      { kind: 'field', field: 'product', op: ':', value: 'acme-pay', not: false },
      { kind: 'field', field: 'duration_ms', op: '>', value: '2000', not: false },
      { kind: 'field', field: 'service', op: ':', value: 'worker', not: true },
      { kind: 'text', value: 'x', not: false },
    ])
    expect(parseLogQuery('level>=warn http.route:"POST /orders"')).toEqual([
      { kind: 'field', field: 'level', op: '>=', value: 'warn', not: false },
      { kind: 'field', field: 'http.route', op: ':', value: 'POST /orders', not: false },
    ])
    // A URL is a word, not the field "https".
    expect(parseLogQuery('https://shop.example')).toEqual([
      { kind: 'text', value: 'https://shop.example', not: false },
    ])
  })

  it('compiles to parameters, never to SQL text', () => {
    const products = new Map([['acme-pay', '00000000-0000-4000-8000-000000000001']])
    const compiled = compileLogQuery(
      parseLogQuery(`level>=warn "'; DROP TABLE logs" product:acme-pay user.id:4* x:*`),
      products,
    )
    expect(compiled.where).not.toContain('DROP')
    expect(Object.values(compiled.params)).toContain("'; DROP TABLE logs")
    expect(Object.values(compiled.params)).toContain('4%')
    expect(compiled.params.q0).toBe(3)
    expect(compileLogQuery([]).where).toBe('1')
    expect(compileLogQuery(parseLogQuery('product:nope')).where).toBe('(0)')
  })

  it('maps levels from words and severity numbers', () => {
    expect(levelOf('Information')).toBe('info')
    expect(levelOf('WARNING')).toBe('warn')
    expect(levelOf('crit')).toBe('fatal')
    expect(levelOf('loud')).toBeNull()
    expect(levelOfSeverity(1)).toBe('trace')
    expect(levelOfSeverity(9)).toBe('info')
    expect(levelOfSeverity(17)).toBe('error')
    expect(levelOfSeverity(24)).toBe('fatal')
    expect(levelOfSeverity(0)).toBeNull()
  })
})
