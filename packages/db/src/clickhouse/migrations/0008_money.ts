import type { ClickHouseMigration } from '../migrate'

/**
 * Payments and subscriptions read from the gateways. A gateway sends the
 * same payment again when it changes (paid, then refunded), so both tables
 * keep the newest version per id (`updated_at`) and are read with FINAL. No
 * partition by date: a payment whose time is corrected must replace its old
 * row, and merges only meet rows in the same partition. `project_id` is not
 * in the key, so moving an account's payments to another product replaces
 * them instead of counting them twice. `customer` is a hash of the gateway's
 * customer id.
 */
export const migration: ClickHouseMigration = {
  name: '0008_money',
  statements: [
    `CREATE TABLE IF NOT EXISTS payments (
      org_id UUID,
      project_id UUID,
      connection_id UUID,
      gateway LowCardinality(String),
      id String,
      status LowCardinality(String),
      amount Int64,
      refunded Int64,
      fee Nullable(Int64),
      currency LowCardinality(String),
      method LowCardinality(String),
      customer String,
      subscription_id String,
      at DateTime64(3, 'UTC'),
      failure LowCardinality(String),
      updated_at DateTime64(3, 'UTC')
    )
    ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (org_id, connection_id, id)`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      org_id UUID,
      project_id UUID,
      connection_id UUID,
      gateway LowCardinality(String),
      id String,
      status LowCardinality(String),
      mrr Int64,
      currency LowCardinality(String),
      customer String,
      started_at DateTime64(3, 'UTC'),
      canceled_at Nullable(DateTime64(3, 'UTC')),
      updated_at DateTime64(3, 'UTC')
    )
    ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (org_id, connection_id, id)`,
  ],
}
