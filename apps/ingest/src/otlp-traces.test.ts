import { MemoryHeartbeats, MemorySalts, MemorySink } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { staticResolver } from './keys'
import { decodeTracesJson, decodeTracesProtobuf } from './otlp-traces'

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
const fixed64 = (field: number, n: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, true)
  return [...tag(field, 1), ...b]
}
const hexBytes = (h: string) => h.match(/../g)?.map((x) => Number.parseInt(x, 16)) ?? []
const keyValue = (key: string, value: string) => [...str(1, key), ...bytes(2, str(1, value))]

const TRACE = '0af7651916cd43dd8448eb211c80319c'
const SPAN = 'b7ad6b7169203331'
const PARENT = '00f067aa0ba902b7'
const START = 1_795_000_000_000_000_000n

function protobufRequest() {
  const span = [
    ...bytes(1, hexBytes(TRACE)),
    ...bytes(2, hexBytes(SPAN)),
    ...bytes(4, hexBytes(PARENT)),
    ...str(5, 'GET /orders'),
    ...num(6, 2),
    ...fixed64(7, START),
    ...fixed64(8, START + 250_000_000n),
    ...bytes(9, keyValue('http.route', '/orders')),
    ...bytes(9, keyValue('user.email', 'ana@example.com')),
    ...num(10, 3),
    ...bytes(11, [...fixed64(1, START + 1_000n), ...str(2, 'exception')]),
    ...bytes(15, [...str(2, 'boom'), ...num(3, 2)]),
  ]
  const scopeSpans = [
    ...bytes(1, [...str(1, '@opentelemetry/http'), ...str(2, '0.200.0')]),
    ...bytes(2, span),
  ]
  const resourceSpans = [
    ...bytes(1, bytes(1, keyValue('service.name', 'api'))),
    ...bytes(2, scopeSpans),
  ]
  return new Uint8Array(bytes(1, resourceSpans))
}

describe('OTLP traces', () => {
  it('reads protobuf spans with resource, scope, events, status and dropped counts', () => {
    const [span] = decodeTracesProtobuf(protobufRequest())
    expect(span).toMatchObject({
      traceId: TRACE,
      spanId: SPAN,
      parentSpanId: PARENT,
      name: 'GET /orders',
      kind: 2,
      statusCode: 2,
      statusMessage: 'boom',
      scope: '@opentelemetry/http',
      scopeVersion: '0.200.0',
      resource: { 'service.name': 'api' },
      dropped: 3,
    })
    expect(span?.events.map((e) => e.name)).toEqual(['exception'])
    expect(span?.endTimeUnixNano).toBe(START + 250_000_000n)
  })

  it('reads OTLP/JSON with enum names and string nanos', () => {
    const [span] = decodeTracesJson({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'web' } }] },
          scopeSpans: [
            {
              scope: { name: 'next' },
              spans: [
                {
                  traceId: TRACE.toUpperCase(),
                  spanId: SPAN,
                  name: 'render',
                  kind: 'SPAN_KIND_CLIENT',
                  startTimeUnixNano: String(START),
                  endTimeUnixNano: String(START + 5n),
                  status: { code: 'STATUS_CODE_OK' },
                  links: [{ traceId: TRACE, spanId: PARENT }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(span).toMatchObject({ traceId: TRACE, kind: 3, statusCode: 1, scope: 'next' })
    expect(span?.links).toHaveLength(1)
  })

  it('keeps spans posted to /v1/traces, masked, and rejects those without ids', async () => {
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
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf', 'x-octadash-key': 'a'.repeat(32) },
      body: protobufRequest(),
    })
    expect(res.status).toBe(200)
    expect(sink.batches[0]?.kind).toBe('spans')
    expect(sink.batches[0]?.rows[0]).toMatchObject({
      trace_id: TRACE,
      kind: 'server',
      status_code: 'error',
      service: 'api',
      duration_ns: 250_000_000,
      timestamp: '2026-11-18 11:06:40.000000000',
      attributes: { 'http.route': '/orders', 'user.email': '[email]' },
    })

    const json = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-octadash-key': 'a'.repeat(32) },
      body: JSON.stringify({
        resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: '', spanId: '', name: 'x' }] }] }],
      }),
    })
    expect(await json.json()).toMatchObject({ partialSuccess: { rejectedSpans: '1' } })
  })
})
