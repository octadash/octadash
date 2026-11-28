'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { CopyField } from './copy-field'

/** Ready /health endpoints that answer without touching the database. */
const SNIPPETS = [
  {
    id: 'next',
    label: 'Next.js',
    file: 'app/api/health/route.ts',
    code: `export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ status: 'ok' })
}`,
  },
  {
    id: 'node',
    label: 'Node (Express, Hono)',
    file: 'server.ts',
    code: `// Express
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// Hono
app.get('/health', (c) => c.json({ status: 'ok' }))`,
  },
  {
    id: 'dotnet',
    label: '.NET',
    file: 'Program.cs',
    code: `app.MapGet("/health", () => Results.Ok(new { status = "ok" }));`,
  },
  {
    id: 'python',
    label: 'Python (FastAPI)',
    file: 'main.py',
    code: `@app.get("/health")
def health():
    return {"status": "ok"}`,
  },
  {
    id: 'php',
    label: 'PHP (Laravel)',
    file: 'routes/web.php',
    code: `Route::get('/health', fn () => response()->json(['status' => 'ok']));`,
  },
] as const

export function HealthSnippets({ copy, copied }: { copy: string; copied: string }) {
  const [active, setActive] = useState<string>(SNIPPETS[0].id)
  const snippet = SNIPPETS.find((s) => s.id === active) ?? SNIPPETS[0]
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap gap-1">
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === active}
            onClick={() => setActive(s.id)}
            className={cn(
              'h-8 rounded-lg px-3 text-sm transition-colors',
              s.id === active
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="font-mono text-xs text-muted-foreground">{snippet.file}</p>
      <CopyField value={snippet.code} copyLabel={copy} copiedLabel={copied} multiline />
    </div>
  )
}
