import type { LiveEvent } from '@octadash/queue'
import { live } from '@/server/live'
import { getViewer, listMemberships } from '@/server/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Comment line that keeps proxies from closing a quiet connection. */
const KEEPALIVE_MS = 25_000

/**
 * Server-Sent Events for the open screens of the viewer's organization. Each
 * event only names what changed (incidents, monitors, watcher); the screen
 * reloads its own data, so it never receives anything its viewer may not see.
 */
export async function GET(request: Request) {
  const viewer = await getViewer()
  if (!viewer) return new Response(null, { status: 401 })
  const orgs = await listMemberships(viewer.user.id)
  const org = orgs.find((o) => o.id === viewer.session.activeOrganizationId) ?? orgs[0]
  if (!org) return new Response(null, { status: 403 })

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
        unsubscribe = await live().hub.subscribe([org.id, null], send)
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
