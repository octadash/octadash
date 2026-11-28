import { OCTADASH_VERSION } from '@octadash/core'
import { findApiToken } from '@octadash/db'
import { handleMcp, RPC } from '@/lib/mcp'
import { services } from '@/server/context'
import { instructionsFor, toolsFor } from '@/server/mcp-tools'

function unauthorized() {
  return Response.json(
    {
      error:
        'A token from Octadash settings > API tokens is needed: Authorization: Bearer oct_..., or the address /api/mcp/oct_...',
    },
    { status: 401, headers: { 'www-authenticate': 'Bearer realm="octadash"' } },
  )
}

/**
 * Octadash's MCP server (Streamable HTTP, JSON answers, no session): an AI
 * assistant reads uptime, emergencies, traffic and logs with an organization's
 * token; it sees only the tools the token's scopes allow. The token comes in
 * the Authorization header, or in the address for apps that cannot send a
 * header (Claude and ChatGPT custom connectors).
 */
export async function serveMcp(request: Request, pathToken?: string) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : (pathToken ?? '')
  const found = token ? await findApiToken(services().db, token) : null
  if (!found) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: RPC.parse, message: 'Invalid JSON' } },
      { status: 400 },
    )
  }
  const messages = Array.isArray(body) ? body : [body]
  const tools = toolsFor(found.scopes)
  const server = {
    name: 'octadash',
    version: OCTADASH_VERSION,
    instructions: instructionsFor(found.scopes),
  }
  const ctx = { orgId: found.orgId }
  // One at a time: a batch that creates a product, then its source, keeps its order.
  const answers = []
  for (const m of messages) {
    const answer = await handleMcp(m, tools, ctx, server)
    if (answer !== null) answers.push(answer)
  }
  // Only notifications: accepted, nothing to say.
  if (answers.length === 0) return new Response(null, { status: 202 })
  return Response.json(Array.isArray(body) ? answers : answers[0])
}
