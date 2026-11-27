import { toNextJsHandler } from 'better-auth/next-js'
import { services } from '@/server/context'

// Built on the first request, so `next build` needs no database.
const handler = () => toNextJsHandler(services().auth)

export function GET(request: Request) {
  return handler().GET(request)
}

export function POST(request: Request) {
  return handler().POST(request)
}
