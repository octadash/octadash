import { OCTADASH_VERSION } from '@octadash/core'

// Uptime probes hit this often. It must never touch the database.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ status: 'ok', service: 'web', version: OCTADASH_VERSION })
}
