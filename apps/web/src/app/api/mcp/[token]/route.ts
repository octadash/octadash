import { serveMcp } from '@/server/mcp-http'

export const dynamic = 'force-dynamic'

/**
 * The MCP server with the token in the address, for apps that cannot send a
 * header: Claude's and ChatGPT's custom connectors take only a URL.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return serveMcp(request, token)
}

export function GET() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } })
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } })
}
