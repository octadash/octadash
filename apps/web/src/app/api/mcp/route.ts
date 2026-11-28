import { serveMcp } from '@/server/mcp-http'

export const dynamic = 'force-dynamic'

/** Octadash's MCP server; the token comes in the Authorization header. */
export function POST(request: Request) {
  return serveMcp(request)
}
/** No stream from the server: every answer comes back in the POST. */
export function GET() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } })
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } })
}
