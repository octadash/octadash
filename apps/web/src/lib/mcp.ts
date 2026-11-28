import { z } from 'zod'

/**
 * The Model Context Protocol over HTTP, as the panel serves it at /api/mcp:
 * JSON-RPC 2.0 in a POST, answered with JSON (no stream, no session). Enough
 * for an assistant to list the tools and call them. Which tools a caller sees
 * is decided by its token's scopes, before this file.
 */

export const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
const LATEST = MCP_VERSIONS[0]

export interface McpTool<Ctx> {
  name: string
  title: string
  description: string
  input: z.ZodObject
  /** Adds or changes something (a product, a source). */
  writes?: boolean
  /** Deletes something. */
  deletes?: boolean
  run(input: Record<string, unknown>, ctx: Ctx): Promise<unknown>
}

type Id = string | number | null

interface Request {
  jsonrpc: '2.0'
  id?: Id
  method: string
  params?: Record<string, unknown>
}

export type Response =
  | { jsonrpc: '2.0'; id: Id; result: unknown }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string; data?: unknown } }

export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

const fail = (id: Id, code: number, message: string, data?: unknown): Response => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})

function isRequest(value: unknown): value is Request {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Request).jsonrpc === '2.0' &&
    typeof (value as Request).method === 'string'
  )
}

/** The tools as `tools/list` describes them, with a JSON Schema for each input. */
export function describeTools<Ctx>(tools: McpTool<Ctx>[]) {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
    annotations:
      tool.writes || tool.deletes
        ? {
            readOnlyHint: false,
            destructiveHint: Boolean(tool.deletes),
            idempotentHint: !tool.deletes,
            openWorldHint: false,
          }
        : { readOnlyHint: true, openWorldHint: false },
  }))
}

/**
 * Answers one JSON-RPC message. Notifications (no id) get no answer: null.
 * A tool that throws answers with `isError`, so the assistant reads why.
 */
export async function handleMcp<Ctx>(
  message: unknown,
  tools: McpTool<Ctx>[],
  ctx: Ctx,
  server: { name: string; version: string; instructions: string },
): Promise<Response | null> {
  if (!isRequest(message)) return fail(null, RPC.invalidRequest, 'Not a JSON-RPC 2.0 request')
  const { id, method, params = {} } = message
  if (id === undefined) return null
  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '')
      const version = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: 'Octadash', version: server.version },
          instructions: server.instructions,
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: describeTools(tools) } }
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params.name)
      if (!tool) return fail(id, RPC.invalidParams, `Unknown tool: ${String(params.name)}`)
      const parsed = tool.input.safeParse(params.arguments ?? {})
      if (!parsed.success) {
        return fail(id, RPC.invalidParams, 'Invalid arguments', z.treeifyError(parsed.error))
      }
      try {
        const result = await tool.run(parsed.data as Record<string, unknown>, ctx)
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          },
        }
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            isError: true,
          },
        }
      }
    }
    default:
      return fail(id, RPC.methodNotFound, `Method not found: ${method}`)
  }
}
