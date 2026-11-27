import { describe, expect, it } from 'vitest'
import { dailyPartitionName, dailyPartitionRange, partitionDay, partitionDays } from './partitions'

const day = new Date('2026-11-27T15:30:00Z')

describe('daily partitions', () => {
  it('names a partition after its UTC day', () => {
    expect(dailyPartitionName('events', day)).toBe('events_p20261127')
  })

  it('rejects unsafe table names', () => {
    expect(() => dailyPartitionName('events; drop table x', day)).toThrow()
  })

  it('covers a half-open UTC day', () => {
    const { from, to } = dailyPartitionRange(day)
    expect(from.toISOString()).toBe('2026-11-27T00:00:00.000Z')
    expect(to.toISOString()).toBe('2026-11-28T00:00:00.000Z')
  })

  it('lists today plus the days ahead, across month ends', () => {
    const days = partitionDays(new Date('2026-11-30T23:00:00Z'), 2).map((d) =>
      d.toISOString().slice(0, 10),
    )
    expect(days).toEqual(['2026-11-30', '2026-12-01', '2026-12-02'])
  })

  it('reads the day back from a partition name', () => {
    expect(partitionDay('events', 'events_p20261127')?.toISOString()).toBe(
      '2026-11-27T00:00:00.000Z',
    )
    expect(partitionDay('events', 'logs_p20261127')).toBeNull()
  })
})
