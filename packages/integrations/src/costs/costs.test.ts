import { describe, expect, it } from 'vitest'
import { anthropicCosts } from './anthropic'
import { openaiCosts } from './openai'
import { splitCost } from './split'

describe('openai costs', () => {
  it('turns daily buckets into items in cents, per project and line item', () => {
    const items = openaiCosts({
      data: [
        {
          start_time: 1_764_288_000,
          end_time: 1_764_374_400,
          results: [
            {
              amount: { value: 1.25, currency: 'usd' },
              line_item: 'gpt-5, input',
              project_id: 'proj_a',
            },
            { amount: { value: 0, currency: 'usd' }, line_item: null, project_id: null },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    })
    expect(items).toEqual([
      {
        at: new Date(1_764_288_000_000),
        hours: 24,
        tag: 'proj_a',
        lineItem: 'gpt-5, input',
        amount: 125,
        currency: 'USD',
      },
    ])
  })
})

describe('anthropic costs', () => {
  it('reads cents from decimal strings, per workspace and model, in hours', () => {
    const items = anthropicCosts({
      data: [
        {
          starting_at: '2026-11-28T10:00:00Z',
          ending_at: '2026-11-28T11:00:00Z',
          group: { workspace_id: 'wrkspc_1', model: 'claude-opus-5-5' },
          cost: { amount: '412.500000', currency: 'USD' },
        },
      ],
      has_more: false,
      next_page: null,
    })
    expect(items[0]).toMatchObject({ hours: 1, tag: 'wrkspc_1', amount: 412.5, currency: 'USD' })
  })
})

describe('splitCost', () => {
  const shares = [
    { projectId: 'shop', tags: ['proj_shop'], rest: true, percent: 75 },
    { projectId: 'app', tags: ['proj_app'], rest: true, percent: 25 },
    { projectId: 'blog', tags: [], rest: false, percent: null },
  ]

  it('gives a tagged cost to the product that claims the tag', () => {
    expect(splitCost({ tag: 'proj_app', amount: 100 }, shares, 'equal')).toEqual(
      new Map([['app', 100]]),
    )
  })

  it('divides the rest equally, by percent or by traffic', () => {
    expect(splitCost({ tag: '', amount: 100 }, shares, 'equal')).toEqual(
      new Map([
        ['shop', 50],
        ['app', 50],
      ]),
    )
    expect(splitCost({ tag: 'proj_other', amount: 100 }, shares, 'percent')).toEqual(
      new Map([
        ['shop', 75],
        ['app', 25],
      ]),
    )
    const traffic = new Map([
      ['shop', 900],
      ['app', 100],
    ])
    expect(splitCost({ tag: '', amount: 100 }, shares, 'traffic', traffic)).toEqual(
      new Map([
        ['shop', 90],
        ['app', 10],
      ]),
    )
  })

  it('falls back to equal parts without traffic, and leaves the rest when nobody takes it', () => {
    expect(splitCost({ tag: '', amount: 10 }, shares, 'traffic', new Map())).toEqual(
      new Map([
        ['shop', 5],
        ['app', 5],
      ]),
    )
    expect(
      splitCost({ tag: '', amount: 10 }, [shares[2] as (typeof shares)[number]], 'equal').size,
    ).toBe(0)
  })
})
