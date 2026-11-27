import type { Logger } from '@octadash/core'
import {
  claimNextDiagnosis,
  completeDiagnosis,
  type Db,
  DIAGNOSIS_CHANNEL,
  failDiagnosis,
  recoverStaleDiagnoses,
} from '@octadash/db'
import { diagnose } from '@octadash/diagnosis'
import type pg from 'pg'

const CONCURRENCY = 2
const POLL_MS = 30_000

/**
 * Runs queued diagnoses. Wakes on NOTIFY from the panel, and polls every 30s
 * in case a notification was missed (worker restart, dropped connection). The
 * poll is one indexed query on a partial index, so it costs next to nothing.
 */
export function startDiagnosisRunner(
  db: Db,
  pool: pg.Pool,
  log: Logger,
  options: { allowPrivate: boolean },
) {
  let running = 0
  let stopped = false
  let listener: pg.PoolClient | null = null

  async function runOne(): Promise<boolean> {
    const job = await claimNextDiagnosis(db)
    if (!job) return false
    const started = Date.now()
    try {
      const report = await diagnose(job.url, { allowPrivate: options.allowPrivate })
      await completeDiagnosis(db, job.id, report)
      log.info(
        {
          diagnosis: job.id,
          project: job.project_id,
          score: report.score,
          ms: Date.now() - started,
        },
        'diagnosis done',
      )
    } catch (err) {
      log.error({ err, diagnosis: job.id }, 'diagnosis failed')
      await failDiagnosis(db, job.id, err instanceof Error ? err.message : String(err))
    }
    return true
  }

  /** Fills free slots until the queue is empty. */
  function drain() {
    while (!stopped && running < CONCURRENCY) {
      running++
      void (async () => {
        try {
          while (!stopped && (await runOne())) {
            // keep going while there is work
          }
        } catch (err) {
          log.error({ err }, 'diagnosis queue error')
        } finally {
          running--
        }
      })()
    }
  }

  async function listen() {
    try {
      listener = await pool.connect()
      listener.on('notification', () => drain())
      listener.on('error', (err) => {
        log.warn({ err }, 'diagnosis listener lost, reconnecting')
        listener?.release(true)
        listener = null
        if (!stopped) setTimeout(() => void listen(), 5_000)
      })
      await listener.query(`listen ${DIAGNOSIS_CHANNEL}`)
    } catch (err) {
      log.warn({ err }, 'diagnosis listener failed, retrying')
      listener?.release(true)
      listener = null
      if (!stopped) setTimeout(() => void listen(), 5_000)
    }
  }

  const poll = setInterval(() => {
    void recoverStaleDiagnoses(db)
      .catch((err) => log.error({ err }, 'diagnosis recovery failed'))
      .finally(drain)
  }, POLL_MS)

  void listen()
  void recoverStaleDiagnoses(db)
    .catch((err) => log.error({ err }, 'diagnosis recovery failed'))
    .finally(drain)

  return {
    async stop() {
      stopped = true
      clearInterval(poll)
      if (listener) {
        await listener.query(`unlisten ${DIAGNOSIS_CHANNEL}`).catch(() => {})
        listener.release()
        listener = null
      }
      const deadline = Date.now() + 20_000
      while (running > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    },
  }
}
