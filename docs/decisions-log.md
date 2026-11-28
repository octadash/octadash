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
