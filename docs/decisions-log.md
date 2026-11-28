# Decisions log

Decisions taken without the owner while he was away, so he can review them in
one place. Newest at the bottom of each night. Each line says what was decided
and why; anything here can be reversed.

## Night of 2026-11-28

- **Uptime board shows "Slow" as a display state, not an emergency.** The
  emergencies canvas lists slow responses as a signal that never sends a
  message. Until signals have their engine, a monitor reads "Slow" on the
  Uptime board when its median over the last hour is at least 2 s and at least
  twice its median over the period shown.
- **"Late" on the board** means a heartbeat is past its due time but still
  inside its grace. After the grace it is down, as before.
- **Same-IP note.** Each check remembers the address the host resolved to, and
  a monitor that goes down keeps it on its emergency. When two or more open
  emergencies of different products share an address and started within 10
  minutes of each other, the board says so. They are never merged.
- **Certificates tile** counts certificates that expire in 14 days or less,
  the same line where the board already paints them in amber.
- **Cloud sign-up** (decided by the project coordinator): open sign-up with the
  email confirmed before the first step. Self-hosted stays owner plus
  invitations.
- **Emergency page.** Anyone in the organization can take an emergency over
  from someone else ("Take over"): at night, whoever is awake fixes it. Each
  take, note and manual close is kept as an event (`incident_event`), so the
  page reads as a record and nothing is overwritten.
- **"Close anyway" asks why**, and the reason goes on the record. Closing an
  emergency whose monitor is still failing does not open a new one until the
  monitor recovers and fails again.
- **What Octadash checked** runs once, when a site or API goes down: where the
  name resolves, the certificate, the last answer, the control addresses
  (`OCTADASH_UPTIME_REFERENCE_URLS`) with their times, and whether the address
  is Octadash's own server. It is kept on the emergency, not repeated.
- **"Down at the same time"** lists the other open emergencies that started
  within an hour of this one, those on the same address first. Ticking them
  and pressing "I'm on these too" takes them all at once.
- **CI runs the migrations before the tests.** Tests in several packages read
  the auth tables, and the order of parallel runs decided whether they existed.
- **The emergency strip shows an emergency once its rule's wait is over**
  (2 minutes for a site down by default), the same moment the message goes
  out. A blip shorter than that never reaches the strip, and never turns it
  green.
- **"Octadash can't reach its outside watcher"** is a second strip line, shown
  only to owners and admins: it is about the install, not a product, and a
  member cannot fix it.
- **The strip names up to 3 emergencies**; from 4 on it counts them, says when
  they started together and which server most of them share. "See all" lists
  every one; nothing is grouped.
- **Ended by hand turns the strip green too**, saying "closed by Ana" instead of
  "is back", so nobody reads a closed emergency as a recovery.
- **Link-style buttons use the brand accent** (`--brand`) instead of the
  primary magenta: the primary failed contrast on the dark theme.
- **The 11 kinds of emergency**: the rules list shows the 8 not built yet,
  dimmed and already set, each in its area (domain expiring sits under Uptime
  as coming later). "Octadash itself" stays the outside watcher for now; the
  queue and disk checks come with the install health page, since the worker
  cannot see the database disks from its container.
- **A visit is a visitor on one calendar day** (in the organization's time
  zone). Entry page, channel, source and campaign come from the visit's first
  page view, so a click inside the site never counts as "Direct".
- **Channels** are worked out from the referrer and UTM tags, in this order:
  paid, email, AI assistants, search, social, direct, other sites.
- **Returning visitors** are counted only for sources that turned on "Count
  returning visitors"; the tile says how many sources count them. A visitor
  returns when the same id was seen on an earlier day in the last 90 days.
- **Today compares with yesterday up to the same hour**, so the numbers are
  fair in the morning. Periods are Today, 24 hours, 7 and 30 days; a custom
  range comes later.
- **Places show countries only** for now. Regions and cities need a larger
  location database in the ingest; the list is built so they fit as tabs.
- **The chart has no split by product yet**; the Products card lists each
  product's numbers and filters by it.
- **Filters** are one value per list (up to 6 at once), kept in the address so
  a link shows the same view. Details opens a side sheet with search, "load
  more" and CSV export (up to 10,000 rows).
- **Set up Traffic** reuses a product's existing source ("Use for Traffic")
  before asking for a new one, so the same key sends errors, events and page
  views. Step 3 asks every 3 seconds whether a page view arrived.
- **Product settings** follow the ProductSettings canvas: General (name,
  address, every area with its state, rules, danger zone), Sources (list, one
  page per source) and Alert rules (the rules list moved there from the
  General page).
- **Old product keys became a source named "Main"**, with platform "Other",
  so every key belongs to a source and shows on the Sources page. Products
  that never used that key show "Main · Never received"; delete it there.
  New products start with no key.
- **Renaming keeps old links working** through an alias table. If another
  product later takes the old address, that product wins.
- **Deleting a product asks for its name**, typed, as the canvas says.
- **Key rotation** offers Now, 1 hour, 24 hours (default) and 7 days. Old keys
  still working show with when they stop and a "Stop now" button.
- **Not built yet from the canvas**: the OpenTelemetry endpoint (the ingest
  does not take OTLP yet), counting data sent with an old or deleted key, who
  marked an area "not used" and when, and payment connections under "Also
  sending data". Each comes with its engine. "What it sends" shows Errors and
  Logs as "coming later".
- **A source "went quiet"** after 24 hours without data: the Sources page then
  says "Nothing for 3 days" with a diamond, instead of the green dot.
- **TV mode** follows the TV canvas: the strip of emergencies on top, one tile
  per product (status in word and icon, who is on it, 4 hours of checks, three
  numbers, a sparkline), "What happened" in the footer. Products in trouble
  come first and stay on every page; the screen turns the page every 20
  seconds. It opens from "TV mode" on the Overview, a group and a product.
- **The numbers offered on a tile are only the ones already built**: online
  now, page views today, events today and response time. Errors, sales and
  sign-ups join the list when their areas exist.
- **One private link per organization**. Making a new one stops the old one;
  "Stop link" turns it off. The token is shown once and only its hash is
  stored. The link opens the screen with the settings chosen when it was made,
  and shows nothing else. "Last opened" has no place or device, only the time.
- **Sound is off by default.** Browsers only play sound after a click, so the
  TV shows "Allow sound" once.
- **A product whose monitor is down counts as down** on the TV, even before
  its emergency opens, so the header never says "all up" while a tile says
  "Down".
- **Errors engine first, screens next.** The ingest takes Sentry envelopes and
  `/store/` (tested with the real `@sentry/node` 9) and the Octadash script now
  reports uncaught errors and rejected promises (at most 10 per page, each
  message once) plus `octadash.captureException`. `data-release` and
  `data-environment` on the script tag mark the release.
- **Errors keep 90 days** by default (Sentry's paid plans keep 90). Per-area
  retention will change it.
- **The person hit is what the app sends as its user**, as Sentry does; with
  no user, the daily visitor hash. E-mails and names are stored only when the
  app sends them. Masking comes with the retention settings.
- **"Resolve in next release"** follows Sentry: events from the release the
  issue was last seen in, or with no release, do not reopen it.
- **A batch retried after a failure counts twice in the issue's total** in
  Postgres; screens read counts from ClickHouse, which drops the repeated
  insert, so only the "ignore until N more events" condition can fire early.
- **Errors screens follow the canvas**: four numbers on top (errors, issues
  hit, new issues, people hit), the chart with the period before, then the
  issues table with tabs (Unresolved, New, Regressed, Mine, Resolved, Ignored)
  and the order by people hit first. The issue page has its actions, numbers,
  30 days in bars, where it happened (only the app's frames by default), what
  the person did before, who it hits and the event itself.
- **Question for Luciano: pt-BR keeps the word "issue"** ("issues", "Abertas",
  "Voltaram"). It is the word Sentry, GitHub and developers in Brazil use.
  "Problema" would read well but needs gendered rewording on every label.
- **Not built yet, on purpose**: release marks on the chart and a SPIKE badge
  (they need the alert rule first), a search box for filters, source maps and
  commit details on the stack. "Set up Errors" is not a page yet: the empty
  state points to the source settings, where the DSN is.
- **Error spike follows the Emergencies canvas** (5× normal, at least 20
  errors, in 15 minutes). "Normal" is the same hour on each of the last 7 days,
  not the shape × level of signals: an emergency must be simple to explain. A
  product with no history fires on the minimum alone. Errors of ignored issues
  never count, as the Ignore dialog promises. The multiple and the minimum are
  editable per product (at least 1, so a rule cannot fire on every error).
- **A new issue is not an emergency.** Sentry tells on every new issue by
  default; here a new issue is data (the New tab and the number on top) and only
  a spike sends a message, so a busy product does not flood the channels.
- **The warning badge text now uses the theme's warning color**: the amber on
  its pale background failed contrast in the light theme.
- **Set up Errors is built** (`/p/<product>/errors/setup`, as in the Configure
  canvas): sources with "Use for Errors", a new source, the DSN, the code for
  11 platforms (the Octadash script for plain sites, the Sentry SDK for the
  rest), "Send test error" from the browser and a live wait for the first one.
  The snippets say plainly which SDKs were tested (so far `@sentry/node` 9).
  "Set up" on a product's Errors and Traffic cards now opens their setup page.
- **Errors joins the Overview and the product page**: an Errors number (fewer
  reads as good, so a drop is green), an Errors tab on the chart, an Errors
  column in the products table (events and issues hit) and, on the product
  page, an Errors card with the 3 unresolved issues hit most and errors per day
  over 14 days. Deploy marks and "out of normal" signals wait for their engine.
- **Product usage engine first, screens next.** The ingest takes PostHog SDKs
  (checked live with posthog-js and posthog-node), the script gains
  `identify(id)` and `reset()`, and the worker runs "Key event stopped".
  Recent posthog-js gzips its batches without saying so in the address or a
  header, so the ingest also recognizes gzip by its first bytes.
- **Person ids are stored as hashes, for every event.** `distinct_id` was kept
  as sent; now it is a hash of the product and the id, as the Product usage
  canvas promises ("Person ids are kept as hashes"). Traffic counts the same
  people as before, since it only needs the id to be stable.
- **Personal data is dropped at the door, not masked later.** Properties named
  like e-mail, phone, CPF, CNPJ, password or address, values that look like an
  e-mail or a document number, and PostHog's person properties never reach the
  queue. URL properties are kept as sent. Errors keep a plain user id (it finds
  the support case) but hash an e-mail.
- **Octadash keeps no person profiles.** PostHog's `$set`, `/engage/` and
  person properties are accepted and dropped. Funnels and retention work on the
  hashed id alone.
- **PostHog's extras are switched off by our flags answer** (autocapture,
  session recording, surveys, heatmaps), and the events they would send are
  dropped if they come anyway. Product usage is the events the app chooses to
  send; recordings and heatmaps are not on the roadmap.
- **Sign-ups need no setting**: `signup.completed` (the standard name),
  `signed_up` (the name the setup suggests) and the names other tools use all
  count. The canvas and the roadmap differed (snake_case or dotted); both work.
- **Key event stopped waits by the event's own pace**: the silence must pass
  the time 5 events normally take at this hour, and at least 30 minutes. A
  checkout that comes 60 times an hour fires after 30 minutes; one that comes
  twice an hour after 2.5 hours; one rarer than 5 a day at that hour never
  fires. It closes only when the next event arrives, so a night that turns
  quiet does not say "back". The minimum is called `silence`, not `minutes`,
  because `minutes` already means "wait before telling" on every rule.
- **"Key event" is "evento importante" in pt-BR**, as the rules preview
  already said.
- **The browser script grew to about 5 KB before gzip** (2 KB gzipped) with
  `identify`; the budget in the test moved from 4.5 KB to 5 KB.
