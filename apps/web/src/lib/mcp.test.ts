import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { handleMcp, type McpTool } from './mcp'

const tools: McpTool<{ orgId: string }>[] = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Says it back',
    input: z.object({ text: z.string(), times: z.number().int().default(1) }),
    async run(input, ctx) {
      return { text: String(input.text).repeat(Number(input.times)), org: ctx.orgId }
    },
  },
  {
    name: 'add',
    title: 'Add',
    description: 'Adds a thing',
    input: z.object({}),
    writes: true,
    async run() {
      return { added: true }
    },
  },
  {
    name: 'broken',
    title: 'Broken',
    description: 'Fails',
    input: z.object({}),
    async run() {
      throw new Error('ClickHouse did not answer')
    },
  },
]
const server = { name: 'octadash', version: 'test', instructions: 'Ask.' }
const call = (message: unknown) => handleMcp(message, tools, { orgId: 'o1' }, server)

describe('handleMcp', () => {
  it('agrees on a version the client asked for, else the latest', async () => {
    const asked = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })
    expect(asked).toMatchObject({ result: { protocolVersion: '2025-06-18' } })
    const unknown = await call({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    })
    expect(unknown).toMatchObject({
      result: { protocolVersion: '2025-11-25', capabilities: { tools: {} } },
    })
  })

  it('lists tools with a JSON Schema and marks them read-only', async () => {
    const answer = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    const listed = (answer as { result: { tools: unknown[] } }).result.tools
    expect(listed[0]).toMatchObject({
      name: 'echo',
      inputSchema: { type: 'object', required: ['text'] },
      annotations: { readOnlyHint: true },
    })
    expect(listed[1]).toMatchObject({
      name: 'add',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    })
  })

  it('runs a tool with defaults filled and the caller organization', async () => {
    const answer = await call({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'ab', times: 2 } },
    })
    expect(answer).toMatchObject({ result: { structuredContent: { text: 'abab', org: 'o1' } } })
  })

  it('says why: bad arguments, an unknown tool or method, a tool that fails', async () => {
    expect(
      await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo' } }),
    ).toMatchObject({ error: { code: -32602 } })
    expect(
      await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } }),
    ).toMatchObject({ error: { code: -32602 } })
    expect(await call({ jsonrpc: '2.0', id: 7, method: 'resources/list' })).toMatchObject({
      error: { code: -32601 },
    })
    expect(
      await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'broken' } }),
    ).toMatchObject({ result: { isError: true, content: [{ text: 'ClickHouse did not answer' }] } })
  })

  it('does not answer notifications and refuses what is not JSON-RPC', async () => {
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(await call({ hello: 1 })).toMatchObject({ error: { code: -32600 } })
  })
})
