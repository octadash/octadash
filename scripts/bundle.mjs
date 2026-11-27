// Bundles a Node service (ingest, worker) into self-contained ESM files in dist/.
// Everything is inlined so the Docker image needs no node_modules for these services.
import { build } from 'esbuild'

const entries = process.argv.slice(2)
if (entries.length === 0) {
  console.error('usage: node scripts/bundle.mjs <entry.ts> [...]')
  process.exit(1)
}

await build({
  entryPoints: entries,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // pg loads pg-native lazily and only when asked; it is never used here.
  external: ['pg-native'],
  // Some CommonJS dependencies call require(); give ESM output a require().
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
})
