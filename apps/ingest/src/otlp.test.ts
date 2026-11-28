import { describe, expect, it } from 'vitest'
import { decodeLogsJson, decodeLogsProtobuf, exportAnswer } from './otlp'

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
const fixed64 = (field: number, n: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, true)
  return [...tag(field, 1), ...b]
}
const anyString = (s: string) => str(1, s)
const anyInt = (n: number) => [...tag(3, 0), ...varint(n)]
const keyValue = (key: string, value: number[]) => [...str(1, key), ...bytes(2, value)]

describe('OTLP logs, protobuf', () => {
  it('reads resource, scope, records, attributes and ids', () => {
    const resource = bytes(1, keyValue('service.name', anyString('api')))
    const record = [
      ...fixed64(1, 1_795_000_000_123_456_789n),
      ...tag(2, 0),
      ...varint(17),
      ...str(3, 'Error'),
      ...bytes(5, anyString('Timeout on POST /orders')),
      ...bytes(6, keyValue('duration_ms', anyInt(30012))),
      ...bytes(6, keyValue('http.route', anyString('POST /orders'))),
      ...bytes(9, new Uint8Array(16).fill(0xab)),
      ...bytes(10, new Uint8Array(8).fill(0xcd)),
    ]
    const scopeLogs = [...bytes(1, str(1, 'Npgsql')), ...bytes(2, record)]
    const resourceLogs = [...bytes(1, resource), ...bytes(2, scopeLogs)]
    const request = new Uint8Array(bytes(1, resourceLogs))

    const [log] = decodeLogsProtobuf(request)
    expect(log).toMatchObject({
      timeUnixNano: 1_795_000_000_123_456_789n,
      severityNumber: 17,
      severityText: 'Error',
      body: 'Timeout on POST /orders',
      traceId: 'ab'.repeat(16),
      spanId: 'cd'.repeat(8),
      scope: 'Npgsql',
      attributes: { duration_ms: '30012', 'http.route': 'POST /orders' },
      resource: { 'service.name': 'api' },
    })
  })

  it('refuses a truncated body', () => {
    expect(() => decodeLogsProtobuf(new Uint8Array([0x0a, 0x10, 0x01]))).toThrow()
  })
})

describe('OTLP logs, JSON', () => {
  it('reads camelCase, string nanos, hex ids and nested values', () => {
    const logs = decodeLogsJson({
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'worker' } }] },
          scopeLogs: [
            {
              scope: { name: 'pino' },
              logRecords: [
                {
                  timeUnixNano: '1795000000000000000',
                  severityText: 'WARN',
                  body: { kvlistValue: { values: [{ key: 'msg', value: { stringValue: 'x' } }] } },
                  attributes: [
                    {
                      key: 'job',
                      value: {
                        kvlistValue: {
                          values: [{ key: 'id', value: { intValue: '42' } }],
                        },
                      },
                    },
                  ],
                  traceId: 'ABCDEF0123456789ABCDEF0123456789',
                },
              ],
            },
          ],
        },
      ],
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      timeUnixNano: 1_795_000_000_000_000_000n,
      severityText: 'WARN',
      body: '{"msg":"x"}',
      attributes: { 'job.id': '42' },
      resource: { 'service.name': 'worker' },
      traceId: 'abcdef0123456789abcdef0123456789',
      scope: 'pino',
    })
  })
})

describe('export answers', () => {
  it('is empty when all was accepted, a partial success otherwise', () => {
    expect(exportAnswer(0, '', 'json', 'logs').body).toBe('{}')
    expect(exportAnswer(0, '', 'protobuf', 'logs').body).toHaveLength(0)
    expect(JSON.parse(String(exportAnswer(3, 'too many', 'json', 'logs').body))).toEqual({
      partialSuccess: { rejectedLogRecords: '3', errorMessage: 'too many' },
    })
    const proto = exportAnswer(0, 'not kept', 'protobuf', 'spans').body as Uint8Array
    expect(new TextDecoder().decode(proto)).toContain('not kept')
  })
})
