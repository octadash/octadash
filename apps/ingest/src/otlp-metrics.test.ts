import { MemoryHeartbeats, MemorySalts, MemorySink } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { staticResolver } from './keys'
import { decodeMetricsJson, decodeMetricsProtobuf } from './otlp-metrics'

/** A tiny protobuf writer, enough to build the requests exporters send. */
const enc = new TextEncoder()
function varint(n: number | bigint): number[] {
  let v = BigInt(n)
  const out: number[] = []
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) b |= 0x80
    out.push(b)
  } while (v > 0n)
  return out
}
const tag = (field: number, wire: number) => varint((field << 3) | wire)
const bytes = (field: number, data: number[] | Uint8Array) => [
  ...tag(field, 2),
  ...varint(data.length),
  ...data,
]
const str = (field: number, s: string) => bytes(field, enc.encode(s))
const num = (field: number, n: number) => [...tag(field, 0), ...varint(n)]
const u64 = (n: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, true)
  return [...b]
}
const f64 = (n: number) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setFloat64(0, n, true)
  return [...b]
}
const fixed64 = (field: number, n: bigint) => [...tag(field, 1), ...u64(n)]
const double = (field: number, n: number) => [...tag(field, 1), ...f64(n)]
const keyValue = (key: string, value: string) => [...str(1, key), ...bytes(2, str(1, value))]

const T = 1_795_000_000_000_000_000n

function protobufRequest() {
  const gauge = [
    ...str(1, 'system.memory.usage'),
    ...str(3, 'By'),
    ...bytes(
      5,
      bytes(1, [...fixed64(3, T), ...double(4, 512.5), ...bytes(7, keyValue('state', 'used'))]),
    ),
  ]
  const sum = [
    ...str(1, 'http.requests'),
    ...bytes(7, [
      ...bytes(1, [...fixed64(2, T - 60_000_000_000n), ...fixed64(3, T), ...fixed64(6, 42n)]),
      ...num(2, 2),
      ...num(3, 1),
    ]),
  ]
  const histogram = [
    ...str(1, 'http.server.duration'),
    ...str(3, 'ms'),
    ...bytes(9, [
      ...bytes(1, [
        ...fixed64(3, T),
        ...fixed64(4, 3n),
        ...double(5, 300),
        ...bytes(6, [...u64(1n), ...u64(2n)]),
        ...bytes(7, f64(100)),
        ...double(11, 50),
        ...double(12, 200),
        ...bytes(9, keyValue('http.route', '/orders')),
        ...bytes(8, [...fixed64(2, T), ...double(3, 200), ...bytes(5, new Array(16).fill(0xab))]),
      ]),
      ...num(2, 1),
    ]),
  ]
  const scopeMetrics = [
    ...bytes(1, str(1, 'host')),
    ...bytes(2, gauge),
    ...bytes(2, sum),
    ...bytes(2, histogram),
  ]
  const resourceMetrics = [
    ...bytes(1, bytes(1, keyValue('service.name', 'api'))),
    ...bytes(2, scopeMetrics),
  ]
  return new Uint8Array(bytes(1, resourceMetrics))
}

describe('OTLP metrics', () => {
  it('reads gauges, sums and histograms from protobuf, exemplars included', () => {
    const [gauge, sum, histogram] = decodeMetricsProtobuf(protobufRequest())
    expect(gauge).toMatchObject({
      name: 'system.memory.usage',
      type: 'gauge',
      unit: 'By',
      value: 512.5,
      attributes: { state: 'used' },
      resource: { 'service.name': 'api' },
      scope: 'host',
    })
    expect(sum).toMatchObject({ type: 'sum', value: 42, temporality: 2, isMonotonic: true })
    expect(histogram).toMatchObject({
      type: 'histogram',
      count: 3,
      sum: 300,
      min: 50,
      max: 200,
      bucketCounts: [1, 2],
      explicitBounds: [100],
      temporality: 1,
      attributes: { 'http.route': '/orders' },
    })
    expect(histogram?.extra.exemplars).toEqual([
      expect.objectContaining({ value: 200, trace_id: 'ab'.repeat(16) }),
    ])
  })

  it('reads exponential histograms and summaries from OTLP/JSON', () => {
    const points = decodeMetricsJson({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'latency',
                  exponentialHistogram: {
                    aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
                    dataPoints: [
                      {
                        timeUnixNano: String(T),
                        count: '4',
                        scale: 3,
                        zeroCount: '1',
                        positive: { offset: 2, bucketCounts: ['1', '2'] },
                      },
                    ],
                  },
                },
                {
                  name: 'rpc',
                  summary: {
                    dataPoints: [
                      {
                        count: '10',
                        sum: 5,
                        quantileValues: [{ quantile: 0.99, value: 1.2 }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    expect(points[0]).toMatchObject({
      type: 'exponential_histogram',
      temporality: 1,
      count: 4,
      extra: { scale: 3, zero_count: 1, positive: { offset: 2, bucket_counts: [1, 2] } },
    })
    expect(points[1]).toMatchObject({
      type: 'summary',
      count: 10,
      sum: 5,
      extra: { quantiles: [{ quantile: 0.99, value: 1.2 }] },
    })
  })

  it('keeps points posted to /v1/metrics', async () => {
    const sink = new MemorySink()
    const app = createApp({
      sink,
      keys: staticResolver({
        ['a'.repeat(32)]: {
          org_id: '00000000-0000-4000-8000-00000000000a',
          project_id: '00000000-0000-4000-8000-0000000000b1',
          source_id: null,
          visitor_mode: 'daily',
        },
      }),
      heartbeats: { resolver: { resolve: async () => null }, store: new MemoryHeartbeats() },
      salts: new MemorySalts(),
      now: () => 1_795_000_000_000,
    })
    const res = await app.request('/otlp/v1/metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf', 'x-octadash-key': 'a'.repeat(32) },
      body: protobufRequest(),
    })
    expect(res.status).toBe(200)
    expect(sink.batches[0]?.kind).toBe('metrics')
    expect(sink.batches[0]?.rows).toHaveLength(3)
    expect(sink.batches[0]?.rows[1]).toMatchObject({
      name: 'http.requests',
      type: 'sum',
      temporality: 'cumulative',
      is_monotonic: 1,
      value: 42,
      service: 'api',
    })
  })
})
