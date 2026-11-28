import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * One install per source: a source whose code is the Octadash page script
 * feeds Traffic, Errors and Product usage, so no area asks to install it
 * again. Existing page sources get the areas the script already sends (the
 * same rule as `sourceAreas`).
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    update source
    set areas = (
      select array_agg(distinct a order by a)
      from unnest(areas || array['errors', 'traffic', 'usage']) a
    ),
    updated_at = now()
    where platform in ('html', 'nextjs', 'react', 'wordpress', 'gtm')
      and (
        'traffic' = any(areas)
        or 'usage' = any(areas)
        or (platform = 'html' and 'errors' = any(areas))
      )
      and not (areas @> array['errors', 'traffic', 'usage'])`.execute(db)
}

/** Nothing to undo: the areas only say what the script already sends. */
export async function down(_db: AnyDb): Promise<void> {}
