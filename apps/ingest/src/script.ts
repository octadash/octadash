/**
 * The Octadash browser script, served at /o/v1/script.js:
 *
 *   <script defer src="https://ingest.example.com/o/v1/script.js" data-key="SOURCE_KEY"></script>
 *
 * It sends a page view on load and on every client-side navigation (Next.js,
 * React Router), sets no cookie and stores nothing in the browser, and gives
 * the page `window.octadash.track(name, properties)` for product events.
 * `window.octadash.identify(userId)` ties the events after it to a person
 * (the ingest keeps only a hash of the id); it lives in memory, so the app
 * calls it on each page load once it knows the user, and `reset()` on logout.
 * Visits from localhost are skipped unless the tag has `data-local`.
 *
 * With `data-visitor="persistent"` (a source that counts returning visitors)
 * it keeps a random id in the site's localStorage and sends it as
 * `$visitor_id`; the ingest uses it only when the source allows it.
 *
 * It also reports uncaught errors and rejected promises to /o/v1/errors in the
 * Sentry event format (at most 10 per page, each message once), and gives
 * `window.octadash.captureException(error)` for handled ones. `data-release`
 * and `data-environment` on the tag mark them, so an issue knows the release
 * it started in.
 *
 * Kept as plain ES2017 in a string so the ingest bundle serves it as is; under
 * 5 KB before gzip (about 2 KB gzipped).
 */
export const BROWSER_SCRIPT = `(function () {
  'use strict';
  var tag = document.currentScript;
  if (!tag || window.octadash) return;
  var key = tag.getAttribute('data-key');
  if (!key) return;
  var api = (tag.getAttribute('data-api') || new URL(tag.src).origin) + '/o/v1/events';
  var local = /^(localhost|127\\.|\\[::1\\]|0\\.0\\.0\\.0)/.test(location.hostname);
  var off = local && !tag.hasAttribute('data-local');
  var last = null;
  var uid = '';
  var vid = '';
  if (tag.getAttribute('data-visitor') === 'persistent') {
    try {
      vid = localStorage.getItem('octadash_vid') || '';
      if (!/^[0-9a-f]{32}$/.test(vid)) {
        var bytes = crypto.getRandomValues(new Uint8Array(16));
        vid = '';
        for (var i = 0; i < 16; i++) vid += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        localStorage.setItem('octadash_vid', vid);
      }
    } catch (e) {
      vid = '';
    }
  }

  function send(name, properties) {
    if (off) return;
    var props = { $current_url: location.href, $title: document.title, $screen_width: screen.width };
    if (vid) props.$visitor_id = vid;
    for (var k in properties) props[k] = properties[k];
    var event = { event: name, timestamp: Date.now(), properties: props };
    if (uid) event.distinct_id = uid;
    var body = JSON.stringify({ key: key, events: [event] });
    if (navigator.sendBeacon && navigator.sendBeacon(api, body)) return;
    fetch(api, { method: 'POST', body: body, keepalive: true, credentials: 'omit' }).catch(function () {});
  }

  function page() {
    var url = location.href;
    if (url === last) return;
    var referrer = last === null ? document.referrer : last;
    last = url;
    send('$pageview', { $referrer: referrer });
  }

  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      page();
      return result;
    };
  });
  window.addEventListener('popstate', page);

  var errors = api.replace(/events$/, 'errors');
  var reported = 0;
  var seen = {};
  function frames(stack) {
    var out = [];
    String(stack || '').split('\\n').forEach(function (line) {
      var m = /^\\s*at (?:(.+?) \\()?(.+?):(\\d+):(\\d+)\\)?$/.exec(line) || /^(.*?)@(.+?):(\\d+):(\\d+)$/.exec(line);
      if (m) out.unshift({ function: m[1] || '', filename: m[2], lineno: +m[3], colno: +m[4] });
    });
    return out.slice(-50);
  }
  function report(error, handled, mechanism) {
    var type = (error && error.name) || 'Error';
    var value = String((error && error.message) || error || '');
    if (off || reported >= 10 || !value || value === 'Script error.' || seen[type + value]) return;
    seen[type + value] = 1;
    reported++;
    var event = {
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      release: tag.getAttribute('data-release') || undefined,
      environment: tag.getAttribute('data-environment') || undefined,
      sdk: { name: 'octadash.browser' },
      request: { url: location.href },
      user: uid ? { id: uid } : undefined,
      exception: { values: [{ type: type, value: value, mechanism: { type: mechanism, handled: handled }, stacktrace: { frames: frames(error && error.stack) } }] },
    };
    var body = JSON.stringify({ key: key, events: [event] });
    if (navigator.sendBeacon && navigator.sendBeacon(errors, body)) return;
    fetch(errors, { method: 'POST', body: body, keepalive: true, credentials: 'omit' }).catch(function () {});
  }
  window.addEventListener('error', function (e) {
    // Images and scripts that fail to load fire this too, without a message.
    if (e.error || e.message) report(e.error || { message: e.message }, false, 'onerror');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    report(reason instanceof Error ? reason : { name: 'UnhandledRejection', message: String(reason) }, false, 'onunhandledrejection');
  });

  window.octadash = {
    track: function (name, properties) {
      if (typeof name === 'string' && name) send(name, properties || {});
    },
    captureException: function (error) {
      report(error, true, 'generic');
    },
    identify: function (id) {
      if (id === undefined || id === null || id === '') return;
      var next = String(id).slice(0, 200);
      if (next !== uid) {
        uid = next;
        send('$identify', {});
      }
    },
    reset: function () {
      uid = '';
    },
  };

  if (document.visibilityState === 'prerender') {
    document.addEventListener('visibilitychange', function once() {
      if (document.visibilityState === 'prerender') return;
      document.removeEventListener('visibilitychange', once);
      page();
    });
  } else {
    page();
  }
})();
`
