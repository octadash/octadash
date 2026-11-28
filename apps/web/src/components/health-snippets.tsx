'use client'

import { type CodeTab, CodeTabs } from './code-tabs'

/** Ready /health endpoints that answer without touching the database. */
const SNIPPETS: CodeTab[] = [
  {
    id: 'next',
    label: 'Next.js',
    file: 'app/api/health/route.ts',
    code: `export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true })
}`,
  },
  {
    id: 'express',
    label: 'Express',
    file: 'server.ts',
    code: `app.get('/health', (_req, res) => res.json({ ok: true }))`,
  },
  {
    id: 'nest',
    label: 'NestJS',
    file: 'health.controller.ts',
    code: `@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { ok: true }
  }
}`,
  },
  {
    id: 'dotnet',
    label: '.NET',
    file: 'Program.cs',
    code: `app.MapGet("/health", () => Results.Ok(new { ok = true }));`,
  },
  {
    id: 'laravel',
    label: 'Laravel',
    file: 'routes/web.php',
    code: `Route::get('/health', fn () => response()->json(['ok' => true]));`,
  },
  {
    id: 'other',
    label: 'Other',
    code: `GET /health
200 OK
Content-Type: application/json

{"ok": true}

Answer without querying the database, so a check never wakes it.`,
  },
]

export function HealthSnippets({
  copy,
  copied,
  label,
  other,
}: {
  copy: string
  copied: string
  label: string
  /** The "Other" tab's name in the reader's language. */
  other: string
}) {
  return (
    <CodeTabs
      tabs={SNIPPETS.map((s) => (s.id === 'other' ? { ...s, label: other } : s))}
      label={label}
      copy={copy}
      copied={copied}
    />
  )
}

/** What a job runs when it finishes, per runner. `url` is the heartbeat address. */
export function heartbeatSnippets(url: string, other: string): CodeTab[] {
  return [
    {
      id: 'cron',
      label: 'cron',
      file: 'crontab -e',
      code: `0 3 * * * /opt/backup.sh && curl -fsS -m 10 --retry 3 ${url} || curl -fsS -m 10 ${url}/fail`,
    },
    {
      id: 'node',
      label: 'Node',
      code: `try {
  await runJob()
  await fetch('${url}', { method: 'POST' })
} catch (error) {
  await fetch('${url}/fail', { method: 'POST' })
  throw error
}`,
    },
    {
      id: 'github',
      label: 'GitHub Actions',
      file: '.github/workflows/nightly.yml',
      code: `      - name: Tell Octadash
        if: always()
        run: curl -fsS -m 10 --retry 3 "${url}\${{ job.status != 'success' && '/fail' || '' }}"`,
    },
    {
      id: 'coolify',
      label: 'Coolify',
      file: 'Scheduled task command',
      code: `/app/backup.sh && curl -fsS -m 10 ${url} || curl -fsS -m 10 ${url}/fail`,
    },
    {
      id: 'dotnet',
      label: '.NET',
      code: `using var http = new HttpClient();
try
{
    await RunJobAsync();
    await http.PostAsync("${url}", null);
}
catch
{
    await http.PostAsync("${url}/fail", null);
    throw;
}`,
    },
    {
      id: 'other',
      label: other,
      code: `GET or POST ${url}
GET or POST ${url}/fail   (when the job fails)`,
    },
  ]
}
