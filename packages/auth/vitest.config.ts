import { defineConfig } from 'vitest/config'

// The tests here share the auth tables and clear them, so they run one file at a time.
export default defineConfig({ test: { fileParallelism: false } })
