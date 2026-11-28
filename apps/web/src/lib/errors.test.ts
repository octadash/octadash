import { describe, expect, it } from 'vitest'
import { errorsHref, issueTitle, parseErrorsState, personLabel, sortIssues } from './errors'

describe('errors list state', () => {
  it('reads the address and keeps defaults out of links', () => {
    const state = parseErrorsState({ tab: 'mine', sort: 'nope', show: '100' })
    expect(state).toEqual({
      period: '24h',
      tab: 'mine',
      sort: 'people',
      metric: 'events',
      show: 100,
      source: null,
    })
    expect(errorsHref('/all/errors', state, { tab: 'unresolved', show: 50 })).toBe('/all/errors')
    expect(errorsHref('/all/errors', state, { period: '7d' })).toBe(
      '/all/errors?period=7d&tab=mine&show=100',
    )
    expect(parseErrorsState({ show: '-3' }).show).toBe(50)
    const one = parseErrorsState({ source: '0b6f3c1e-9a2d-4c7b-8e5f-1d2a3b4c5d6e' })
    expect(one.source).toBe('0b6f3c1e-9a2d-4c7b-8e5f-1d2a3b4c5d6e')
    expect(errorsHref('/all/errors', one, {})).toBe(
      '/all/errors?source=0b6f3c1e-9a2d-4c7b-8e5f-1d2a3b4c5d6e',
    )
    expect(errorsHref('/all/errors', one, { source: null })).toBe('/all/errors')
    expect(parseErrorsState({ source: "x' OR 1=1" }).source).toBeNull()
  })

  it('sorts by people, then events', () => {
    const at = new Date(0)
    const issues = [
      { id: 'a', events: 9, people: 1, first_seen: at, last_seen: at },
      { id: 'b', events: 2, people: 5, first_seen: at, last_seen: at },
      { id: 'c', events: 3, people: 5, first_seen: at, last_seen: at },
    ]
    expect(sortIssues(issues, 'people').map((i) => i.id)).toEqual(['c', 'b', 'a'])
    expect(sortIssues(issues, 'events').map((i) => i.id)).toEqual(['a', 'c', 'b'])
  })

  it('titles issues and names people', () => {
    expect(issueTitle({ type: 'TypeError', value: 'x\nmore' })).toBe('TypeError: x')
    expect(issueTitle({ type: '', value: 'Webhook rejected' })).toBe('Webhook rejected')
    expect(personLabel(`v:${'3f9a'.padEnd(32, '0')}`)).toEqual({ anonymous: true, label: '3f9a' })
    expect(personLabel('u_77')).toEqual({ anonymous: false, label: 'u_77' })
  })
})
