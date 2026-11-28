import { OCTADASH_VERSION } from '@octadash/core'
import { findApiToken } from '@octadash/db'
import { handleMcp, RPC } from '@/lib/mcp'
import { services } from '@/server/context'
import { MCP_TOOLS } from '@/server/mcp-tools'

export const dynamic = 'force-dynamic'

const SERVER = { name: 'octadash', version: OCTADASH_VERSION }

function unauthorized() {
  return Response.json(
    {
      error: 'A token from Octadash settings > API tokens is needed: Authorization: Bearer oct_...',
    },
    { status: 401, headers: { 'www-authenticate': 'Bearer realm="octadash"' } },
  )
}

/**
 * Octadash's MCP server (Streamable HTTP, JSON answers, no session): an AI
 * assistant reads uptime, emergencies, traffic and logs with an organization's
 * read-only token.
 */
export async function POST(request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
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
  const answers = (
    await Promise.all(messages.map((m) => handleMcp(m, MCP_TOOLS, found, SERVER)))
  ).filter((a) => a !== null)
  // Only notifications: accepted, nothing to say.
  if (answers.length === 0) return new Response(null, { status: 202 })
  return Response.json(Array.isArray(body) ? answers : answers[0])
}

/** No stream from the server: every answer comes back in the POST. */
export function GET() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } })
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } })
}
