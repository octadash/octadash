/**
 * The Octadash browser script, served at /o/v1/script.js:
 *
 *   <script defer src="https://ingest.example.com/o/v1/script.js" data-key="SOURCE_KEY"></script>
 *
 * It sends a page view on load and on every client-side navigation (Next.js,
 * React Router), sets no cookie and stores nothing in the browser, and gives
 * the page `window.octadash.track(name, properties)` for product events.
 * Visits from localhost are skipped unless the tag has `data-local`.
 *
 * With `data-visitor="persistent"` (a source that counts returning visitors)
 * it keeps a random id in the site's localStorage and sends it as
 * `$visitor_id`; the ingest uses it only when the source allows it.
 *
 * Kept as plain ES2017 in a string so the ingest bundle serves it as is; under
 * 2.5 KB before gzip.
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
    var body = JSON.stringify({ key: key, events: [{ event: name, timestamp: Date.now(), properties: props }] });
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

  window.octadash = {
    track: function (name, properties) {
      if (typeof name === 'string' && name) send(name, properties || {});
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
