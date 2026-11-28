import { openTvLink } from '@octadash/db'
import type { LiveEvent } from '@octadash/queue'
import { services } from '@/server/context'
import { live } from '@/server/live'
import { getViewer, listMemberships } from '@/server/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Whose events to send: the signed-in viewer's organization, or the one a
 * private TV link (`?tv=<token>`) belongs to.
 */
async function orgOf(request: Request): Promise<string | Response> {
  const token = new URL(request.url).searchParams.get('tv')
  if (token) {
    const link = await openTvLink(services().db, token)
    return link ? link.orgId : new Response(null, { status: 404 })
  }
  const viewer = await getViewer()
  if (!viewer) return new Response(null, { status: 401 })
  const orgs = await listMemberships(viewer.user.id)
  const org = orgs.find((o) => o.id === viewer.session.activeOrganizationId) ?? orgs[0]
  return org ? org.id : new Response(null, { status: 403 })
}

/** Comment line that keeps proxies from closing a quiet connection. */
const KEEPALIVE_MS = 25_000

/**
 * Server-Sent Events for the open screens of the viewer's organization. Each
 * event only names what changed (incidents, monitors, watcher); the screen
 * reloads its own data, so it never receives anything its viewer may not see.
 */
export async function GET(request: Request) {
  const orgId = await orgOf(request)
  if (orgId instanceof Response) return orgId

  const encoder = new TextEncoder()
  let close = () => {}
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          close()
        }
      }
      const send = (event: LiveEvent) =>
        write(`event: ${event.topic}\ndata: ${JSON.stringify(event)}\n\n`)
      // Reconnect after 5 s when the connection drops; the browser does it by itself.
      write('retry: 5000\n\n')
      let unsubscribe: () => void = () => {}
      try {
        unsubscribe = await live().hub.subscribe([orgId, null], send)
      } catch {
        controller.close()
        return
      }
      const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS)
      close = () => {
        clearInterval(keepalive)
        unsubscribe()
        close = () => {}
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }
      if (request.signal.aborted) close()
      request.signal.addEventListener('abort', () => close())
    },
    cancel() {
      close()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx would hold the events in its buffer otherwise.
      'x-accel-buffering': 'no',
    },
  })
}
