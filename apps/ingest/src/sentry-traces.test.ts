import { describe, expect, it } from 'vitest'
import { sentryLogs, sentryNanos, transactionSpans } from './sentry-traces'

const TRACE = 'a'.repeat(32)

describe('Sentry tracing and logs', () => {
  it('reads a transaction as its root span and child spans', () => {
    const [root, child] = transactionSpans({
      transaction: 'GET /orders',
      start_timestamp: 1_795_000_000.5,
      timestamp: 1_795_000_001,
      release: 'shop@1.2.0',
      measurements: { lcp: { value: 1200, unit: 'millisecond' } },
      contexts: { trace: { trace_id: TRACE, span_id: 'b'.repeat(16), op: 'http.server' } },
      spans: [
        {
          span_id: 'c'.repeat(16),
          parent_span_id: 'b'.repeat(16),
          op: 'db.query',
          description: 'select * from orders',
          start_timestamp: 1_795_000_000.6,
          timestamp: 1_795_000_000.7,
          status: 'internal_error',
          data: { 'db.system': 'postgresql' },
        },
      ],
    })
    expect(root).toMatchObject({
      traceId: TRACE,
      name: 'GET /orders',
      kind: 2,
      startTimeUnixNano: 1_795_000_000_500_000_000n,
      resource: { 'service.version': 'shop@1.2.0' },
      attributes: { 'sentry.measurement.lcp': '1200', 'sentry.op': 'http.server' },
    })
    expect(child).toMatchObject({
      traceId: TRACE,
      parentSpanId: 'b'.repeat(16),
      name: 'select * from orders',
      statusCode: 2,
      statusMessage: 'internal_error',
      attributes: { 'db.system': 'postgresql', 'sentry.op': 'db.query' },
    })
  })

  it('reads a log item with typed attributes', () => {
    const [log] = sentryLogs({
      items: [
        {
          timestamp: 1_795_000_000,
          level: 'warn',
          body: 'slow checkout',
          trace_id: TRACE,
          attributes: { 'sentry.release': { value: '1.2.0', type: 'string' }, n: { value: 3 } },
        },
      ],
    })
    expect(log).toMatchObject({
      severityNumber: 13,
      body: 'slow checkout',
      traceId: TRACE,
      attributes: { 'sentry.release': '1.2.0', n: '3' },
      resource: { 'service.version': '1.2.0' },
    })
  })

  it('reads seconds and ISO dates as nanoseconds', () => {
    expect(sentryNanos(1.5)).toBe(1_500_000_000n)
    expect(sentryNanos('1970-01-01T00:00:02Z')).toBe(2_000_000_000n)
    expect(sentryNanos('nope')).toBe(0n)
  })
})
