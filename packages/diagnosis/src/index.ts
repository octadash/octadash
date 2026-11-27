import { type CollectOptions, collectSnapshot } from './collect'
import { buildReport } from './report'
import type { DiagnosisReport } from './types'

export * from './collect'
export { BlockedAddressError, isPrivateAddress } from './net'
export * from './report'
export * from './tools'
export * from './types'

/** Visits the product's site and answers which observability levels it has. */
export async function diagnose(url: string, options?: CollectOptions): Promise<DiagnosisReport> {
  return buildReport(await collectSnapshot(url, options))
}
