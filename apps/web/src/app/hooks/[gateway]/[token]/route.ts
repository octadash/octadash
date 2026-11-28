import { decryptSecret } from '@octadash/core'
import { connectionByToken, listConnectionProjects, markConnection, storeMoney } from '@octadash/db'
import { matchProject, moneyGateway, WebhookSignatureError } from '@octadash/integrations'
import { services } from '@/server/context'

/**
 * Webhooks from the payment gateways: /hooks/<gateway>/<token>. The token
 * finds the connection; the gateway's signature (or Asaas's access token)
 * proves it came from there. A payment shows in seconds instead of at the
 * next 5-minute read. When storing fails the answer is 500, so the gateway
 * sends it again: its retries are the queue.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateway: string; token: string }> },
) {
  const { gateway: id, token } = await params
  const gateway = moneyGateway(id)
  if (!gateway || !/^[a-f0-9]{32,64}$/.test(token)) return new Response(null, { status: 404 })
  const { db, clickhouse, env } = services()
  const connection = await connectionByToken(db, gateway.id, token)
  if (!connection) return new Response(null, { status: 404 })

  const received = new Date()
  const body = await request.text()
  const stored = JSON.parse(connection.secrets) as Record<string, string>
  const config = {
    key: stored.key ? decryptSecret(stored.key, env.OCTADASH_SECRET) : '',
    webhookSecret: stored.webhookSecret
      ? decryptSecret(stored.webhookSecret, env.OCTADASH_SECRET)
      : undefined,
  }
  try {
    const result = await gateway.webhook({ body, headers: request.headers, received }, config, {
      fetch,
    })
    const rules = (await listConnectionProjects(db, connection.org_id))
      .filter((p) => p.connectionId === connection.id)
      .map((p) => ({ projectId: p.projectId, rule: p.rule }))
    await storeMoney(
      clickhouse,
      { orgId: connection.org_id, connectionId: connection.id, gateway: gateway.id },
      (item) => matchProject(item, rules),
      result,
      received,
    )
    await markConnection(db, connection.id, { webhookAt: received })
    return Response.json({ received: true })
  } catch (err) {
    if (err instanceof WebhookSignatureError)
      return Response.json({ error: err.message }, { status: 401 })
    console.error('webhook failed', { gateway: gateway.id, connection: connection.id, err })
    return Response.json({ error: 'could not store it; send it again' }, { status: 500 })
  }
}
