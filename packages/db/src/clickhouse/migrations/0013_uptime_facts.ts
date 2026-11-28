import type { ClickHouseMigration } from '../migrate'

/**
 * What a check learned besides up or down: where the name resolved, where the
 * redirects led, whether http sends people to https, who issued the
 * certificate and whether it is trusted, and `detail`: what the server
 * answered when a check failed (headers and the start of the body), or what a
 * heartbeat's job sent with its ping (its output).
 */
export const migration: ClickHouseMigration = {
  name: '0013_uptime_facts',
  statements: [
    `ALTER TABLE uptime_checks ADD COLUMN IF NOT EXISTS ip String DEFAULT ''`,
    `ALTER TABLE uptime_checks ADD COLUMN IF NOT EXISTS final_url String DEFAULT ''`,
    `ALTER TABLE uptime_checks ADD COLUMN IF NOT EXISTS redirects Array(String) DEFAULT []`,
    `ALTER TABLE uptime_checks ADD COLUMN IF NOT EXISTS https_redirect Nullable(UInt8)`,
    `ALTER TABLE uptime_checks ADD COLUMN IF NOT EXISTS tls_issuer String DEFAULT ''`,
    `ALTER TABLE uptime_checks ADD COLUMN IF NOT EXISTS tls_trusted Nullable(UInt8)`,
    `ALTER TABLE uptime_checks ADD COLUMN IF NOT EXISTS detail String DEFAULT '' CODEC(ZSTD(3))`,
  ],
}
