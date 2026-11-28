import { describe, expect, it } from 'vitest'
import { alertMessage } from './alert-text'
import { paymentsFailing } from './alerts'
import { fillRates, moneyWork } from './money'

describe('money sync', () => {
  const now = new Date('2026-11-28T12:00:00Z')
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

  it('imports first, then reads what is due', () => {
    const fresh = {
      status: 'importing',
      imported_at: null,
      synced_at: null,
      subscriptions_synced_at: null,
    }
    expect(moneyWork(fresh, now)).toEqual({ kind: 'import' })
    // A failed import waits 15 minutes.
    expect(moneyWork({ ...fresh, status: 'failing', synced_at: ago(5) }, now)).toBeNull()
    expect(moneyWork({ ...fresh, status: 'failing', synced_at: ago(16) }, now)).toEqual({
      kind: 'import',
    })
    expect(
      moneyWork(
        { status: 'ok', imported_at: ago(60), synced_at: ago(2), subscriptions_synced_at: ago(10) },
        now,
      ),
    ).toBeNull()
    const due = moneyWork(
      { status: 'ok', imported_at: ago(600), synced_at: ago(6), subscriptions_synced_at: ago(61) },
      now,
    )
    expect(due).toMatchObject({ kind: 'sync', subscriptions: true })
    // Three days back from the last sync, so a late refund is seen.
    expect(due && 'since' in due && due.since.getTime()).toBe(ago(6).getTime() - 3 * 86_400_000)
  })

  it('fills weekends with the last rates and adds the dollar', () => {
    const rows = fillRates(
      { '2026-11-20': { BRL: 5.4 }, '2026-11-23': { BRL: 5.5 } },
      '2026-11-21',
      '2026-11-23',
    )
    expect(rows.filter((r) => r.currency === 'BRL').map((r) => [r.day, r.perUsd])).toEqual([
      ['2026-11-21', 5.4],
      ['2026-11-22', 5.4],
      ['2026-11-23', 5.5],
    ])
    expect(rows.filter((r) => r.currency === 'USD')).toHaveLength(3)
  })
})

describe('payments failing', () => {
  it('needs both the share and the number of charges', () => {
    const rule = { percent: 20, charges: 10 }
    expect(paymentsFailing({ paid: 8, failed: 2 }, rule)).toBe(true)
    expect(paymentsFailing({ paid: 9, failed: 1 }, rule)).toBe(false)
    expect(paymentsFailing({ paid: 1, failed: 4 }, rule)).toBe(false)
    expect(paymentsFailing({ paid: 0, failed: 0 }, rule)).toBe(false)
  })

  it('says how many failed and when it is over', () => {
    const incident = {
      id: 'i1',
      kind: 'payments_failing',
      project_id: 'p1',
      project_name: 'Acme Pay',
      project_slug: 'acme-pay',
      started_at: new Date('2026-11-28T11:30:00Z'),
      resolved_at: null,
      data: { failed: 6, total: 16, percent: 38, minutes: 15 },
    }
    const open = alertMessage([incident as never], 'open', {
      now: new Date('2026-11-28T11:31:00Z'),
      locale: 'en',
      panelUrl: 'https://octadash.example.com',
    })
    expect(open.title).toBe('Payments failing on Acme Pay: 38% of charges')
    expect(open.body).toBe('6 of 16 charges failed in the last 15 min.')
    expect(open.url).toBe('https://octadash.example.com/p/acme-pay/emergencies/i1')
    const over = alertMessage(
      [{ ...incident, resolved_at: new Date('2026-11-28T12:00:00Z') } as never],
      'resolve',
      { now: new Date('2026-11-28T12:00:00Z'), locale: 'pt-BR', panelUrl: 'https://x.example.com' },
    )
    expect(over.title).toBe('Os pagamentos voltaram a passar em Acme Pay')
  })
})
