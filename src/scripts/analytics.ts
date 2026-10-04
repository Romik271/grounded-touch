// First-party, privacy-minimised analytics for Grounded Touch.
//
// This module is the SINGLE, central layer for the detailed first-party
// analytics. It starts automatically on page load — there is NO consent gate,
// NO banner, and NO cookie/storage of any kind. Individual components never
// track directly; they call the shared API (window.trackById / window.trackEvent
// / [data-track] click delegation) and this module injects the ids + creative.
//
// NOTE: basic Vercel Web Analytics (aggregated reach/audience measurement) is a
// SEPARATE, always-on system rendered via the <Analytics /> component in the
// shared layouts. This module never touches Vercel.
//
// Identifiers — both random, both NON-persistent (never a cookie, never
// localStorage / sessionStorage / IndexedDB, never derived from IP / UA /
// screen / fonts / canvas / device fingerprint):
//   • page_visit_id — one id per document lifecycle (this load). Memory-only,
//                     minted on every load.
//   • journey_id    — one id per browsing journey. Memory-only. To let a journey
//                     span internal, same-origin navigations (full-document
//                     loads on this static Astro site), it is briefly handed off
//                     through a `gt_jid` query parameter that the destination
//                     reads and then immediately strips from the visible URL via
//                     history.replaceState(). Never sent to external sites.
//   • creative      — campaign attribution, resolved from the page URL.

const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbzF0CTgaaQhtSGCfJkZlabiLrNbsyzUXGuFnUOzaNcOBdXhQtas5kUsh27RuKyXFMBP/exec';

// Query parameter used ONLY to carry journey_id across internal, same-origin
// navigation. It is read on arrival and removed from the URL immediately; it is
// never written to external links and never becomes part of the recorded page
// path, canonical URL or SEO URL.
const JOURNEY_PARAM = 'gt_jid';

// ---------------------------------------------------------------------------
// Random 6-character uppercase alphanumeric id (A–Z, 0–9), e.g. "A7K3QF".
// Used for page_visit_id. Randomness from crypto.getRandomValues with rejection
// sampling (bytes >= 252 discarded) so every character is uniformly distributed
// over the 36-char alphabet with no modulo bias.
// ---------------------------------------------------------------------------
function generateId6(): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // 36 chars
  const LEN = 6;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const out: string[] = [];
      while (out.length < LEN) {
        const bytes = new Uint8Array(LEN);
        crypto.getRandomValues(bytes);
        for (let i = 0; i < bytes.length && out.length < LEN; i++) {
          // 252 is the largest multiple of 36 that fits in a byte (0–255).
          if (bytes[i] < 252) out.push(ALPHABET[bytes[i] % 36]);
        }
      }
      return out.join('');
    }
  } catch {
    /* fall through to Math.random */
  }
  // Last-resort fallback when Web Crypto is entirely unavailable. Same shape.
  let s = '';
  for (let i = 0; i < LEN; i++) s += ALPHABET[(Math.random() * 36) | 0];
  return s;
}

// ---------------------------------------------------------------------------
// journey_id generator — a short, cryptographically random value: exactly 8
// characters, lowercase letters + digits only (e.g. "a7f3k2m9"). Randomness
// from crypto.getRandomValues with rejection sampling (bytes >= 252 discarded)
// so every character is uniformly distributed over the 36-char alphabet with no
// modulo bias. Never derived from IP / UA / device / screen / timestamp /
// fingerprint; contains no PII.
// ---------------------------------------------------------------------------
function generateJourneyId(): string {
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'; // 36 chars, lowercase
  const LEN = 8;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const out: string[] = [];
      while (out.length < LEN) {
        const bytes = new Uint8Array(LEN);
        crypto.getRandomValues(bytes);
        for (let i = 0; i < bytes.length && out.length < LEN; i++) {
          // 252 is the largest multiple of 36 that fits in a byte (0–255).
          if (bytes[i] < 252) out.push(ALPHABET[bytes[i] % 36]);
        }
      }
      return out.join('');
    }
  } catch {
    /* fall through to Math.random */
  }
  // Last-resort fallback when Web Crypto is entirely unavailable. Same shape.
  let s = '';
  for (let i = 0; i < LEN; i++) s += ALPHABET[(Math.random() * 36) | 0];
  return s;
}

// ---------------------------------------------------------------------------
// Analytics runtime state — all memory-only, reset on every document load.
// ---------------------------------------------------------------------------
let analyticsActive = false;            // set true once init() runs
let pageVisitId: string | null = null;  // memory-only, one per document lifecycle
let journeyId: string | null = null;    // memory-only; handed off via gt_jid
let pageViewSent = false;               // ensures exactly one page_view per lifecycle

// ---------------------------------------------------------------------------
// creative — resolved ONLY from the current page URL's query string, once per
// lifecycle. Never persisted; never derived from the visitor.
//   A. explicit non-empty ?creative=<value> wins (e.g. ?creative=head).
//   B. otherwise ?utm_content=link_in_bio → "link_in_bio" (Instagram bio).
//      Only that exact value; fbclid / referrer / utm_source never infer it.
//   C. otherwise → null.
// An explicit creative always beats utm_content.
// ---------------------------------------------------------------------------
function getCreative(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get('creative');
    if (explicit && explicit.trim() !== '') return explicit;
    if (params.get('utm_content') === 'link_in_bio') return 'link_in_bio';
    return null;
  } catch {
    return null;
  }
}
const CREATIVE = getCreative();

// ---------------------------------------------------------------------------
// Bot exclusion — suppress ALL custom analytics for identifiable Meta crawlers.
// Narrow, case-insensitive match on explicit crawler identifier TOKENS only;
// version suffixes such as "/1.1" are tolerated because they follow the token.
// Detection is by the explicit bot identifier, NEVER the claimed OS, so both
// the Windows and the macOS-claiming meta-externalagent are caught.
// Deliberately NOT matched: broad "meta" / "facebook" / "instagram" / "Chrome"
// / device / screen-width signals, nor the in-app browser markers (Instagram,
// FBAN, FBAV, FBIOS), Facebook/Instagram referrers, fbclid or paid-ad UTM —
// real in-app visitors stay fully tracked.
// ---------------------------------------------------------------------------
const BOT_UA_TOKENS = [
  'meta-externalagent',
  'meta-externalfetcher',
  'facebookexternalhit',
  'facebot',
];

function isExcludedBot(ua: string): boolean {
  const s = (ua || '').toLowerCase();
  for (let i = 0; i < BOT_UA_TOKENS.length; i++) {
    if (s.indexOf(BOT_UA_TOKENS[i]) !== -1) return true;
  }
  return false;
}

// Resolved once per load from the real UA string. When true, no ids are minted,
// no listeners / journey-link decoration are attached, and every delivery path
// no-ops before sendBeacon/fetch.
const IS_EXCLUDED_BOT =
  typeof navigator !== 'undefined' && isExcludedBot(navigator.userAgent || '');

type DeviceKind = 'mobile' | 'tablet' | 'desktop';

interface TrackDetails {
  event: string;
  page: string;
  button_id: string;
  language: string;
  device: DeviceKind;
  referrer: string;
  user_agent: string;
  screen_width: number;
}

function getDeviceType(): DeviceKind {
  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// Timestamp formatting — the receiver stores the submitted `timestamp` string
// verbatim as plain Sheet text (the raw UTC ISO value with its trailing "Z" and
// milliseconds was observed byte-for-byte in the Sheet), so the displayed value
// is whatever this field contains. We therefore emit the event instant as an
// ISO-8601 string in Europe/Berlin WALL-CLOCK time with millisecond precision
// and an explicit numeric UTC offset (+02:00 in summer, +01:00 in winter).
//
// Intl with timeZone 'Europe/Berlin' makes the output independent of the
// visitor's own device timezone and handles DST automatically — the offset is
// derived from the instant, never hardcoded. toISOString() is deliberately NOT
// used for the final string (it emits UTC) and the result is never suffixed
// with "Z". The underlying instant is preserved: the offset-bearing string
// parses back to exactly the same moment as the original UTC timestamp.
// ---------------------------------------------------------------------------
function toBerlinIsoString(d: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(d)
      .reduce((acc: Record<string, string>, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {});

    // Some engines render midnight as hour "24"; normalise to "00".
    const hour = parts.hour === '24' ? '00' : parts.hour;

    // DST-correct offset: reinterpret the Berlin wall-clock as if it were UTC,
    // subtract the real instant → the active offset for this exact date.
    const asUtcMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const offsetMin = Math.round((asUtcMs - d.getTime()) / 60000);
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const offH = String(Math.floor(abs / 60)).padStart(2, '0');
    const offM = String(abs % 60).padStart(2, '0');

    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');

    return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}.${ms}${sign}${offH}:${offM}`;
  } catch {
    // Last-resort fallback for engines lacking Intl time-zone (ICU) data, where
    // the formatter above would throw. Compute the Europe/Berlin offset from the
    // EU DST rule directly so the output still carries a correct +01:00 / +02:00
    // offset instead of silently reverting to UTC — and never drop the event.
    // DST runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the
    // last Sunday of October (CET = UTC+1, CEST = UTC+2). The offset is derived
    // from the instant, never hardcoded; the instant and milliseconds are
    // preserved and the string parses back to the same moment.
    const lastSundayUtcMs = (y: number, monthIndex: number): number => {
      const probe = new Date(Date.UTC(y, monthIndex + 1, 0, 1, 0, 0));
      probe.setUTCDate(probe.getUTCDate() - probe.getUTCDay());
      return probe.getTime();
    };
    const y = d.getUTCFullYear();
    const t = d.getTime();
    const isSummer = t >= lastSundayUtcMs(y, 2) && t < lastSundayUtcMs(y, 9);
    const offsetMin = isSummer ? 120 : 60;
    const local = new Date(t + offsetMin * 60000);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    const offH = p2(Math.floor(offsetMin / 60));
    return (
      `${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}` +
      `T${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}:${p2(local.getUTCSeconds())}.${ms}` +
      `+${offH}:00`
    );
  }
}

// ---------------------------------------------------------------------------
// journey_id handoff across internal navigation (full-document loads).
//   • getInboundJourneyId — read gt_jid from the current URL, if present & sane.
//   • stripJourneyParamFromUrl — remove gt_jid from the visible URL immediately,
//     leaving the recorded page path (pathname) untouched.
// The value is only ever read from / written to same-origin URLs.
// ---------------------------------------------------------------------------
function getInboundJourneyId(): string | null {
  try {
    const jid = new URLSearchParams(window.location.search).get(JOURNEY_PARAM);
    // Accept only our exact journey_id shape (8 lowercase alphanumerics) so a
    // hostile URL cannot inject arbitrary content into the payload.
    if (jid && /^[a-z0-9]{8}$/.test(jid)) return jid;
  } catch {
    /* ignore */
  }
  return null;
}

function stripJourneyParamFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(JOURNEY_PARAM)) return;
    url.searchParams.delete(JOURNEY_PARAM);
    const qs = url.searchParams.toString();
    const clean = url.pathname + (qs ? `?${qs}` : '') + url.hash;
    history.replaceState(history.state, '', clean);
  } catch {
    /* ignore — never break the page over a URL rewrite */
  }
}

// ---------------------------------------------------------------------------
// The tracker. The payload maps 1:1 to the existing Sheet columns; page_visit_id,
// journey_id and creative are injected here so no caller/component ever supplies
// them. Schema is unchanged from the previous implementation.
// ---------------------------------------------------------------------------
export function trackEvent(details: TrackDetails): void {
  if (!analyticsActive) return; // nothing tracks before init() runs
  if (IS_EXCLUDED_BOT) return;  // excluded Meta crawler → never deliver an event

  const payload = {
    timestamp: toBerlinIsoString(new Date()),
    event: details.event,
    page: details.page,
    button_id: details.button_id,
    language: details.language,
    device: details.device,
    referrer: details.referrer,
    // Injected centrally, in Sheet column order:
    page_visit_id: pageVisitId,
    journey_id: journeyId,
    creative: CREATIVE,
    user_agent: details.user_agent,
    screen_width: details.screen_width,
  };

  const body = JSON.stringify(payload);

  // sendBeacon fires reliably even during navigation and never blocks. Apps
  // Script accepts text/plain, which avoids a CORS preflight.
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    fetch(ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
    }).catch(() => {
      /* swallow — tracking must never surface errors */
    });
  } catch {
    /* swallow */
  }
}

// Fire an event for a button_id, building the identical payload every event
// uses. Shared by the DOM click delegation and non-DOM sources (Cal.com Embed
// Events API).
function trackById(buttonId: string, event = 'click'): void {
  if (!buttonId) return;
  trackEvent({
    event,
    page: window.location.pathname,
    button_id: buttonId,
    language: document.documentElement.lang || 'unknown',
    device: getDeviceType(),
    referrer: document.referrer || '',
    user_agent: navigator.userAgent,
    screen_width: window.innerWidth,
  });
}

function trackFromElement(el: HTMLElement): void {
  const buttonId = el.dataset.track;
  if (!buttonId) return;
  trackById(buttonId, el.dataset.trackEvent || 'click');
}

// ---------------------------------------------------------------------------
// Internal-link decoration — carry state across INTERNAL navigation by writing
// it into same-origin link hrefs:
//   • creative — campaign attribution (persists in the URL, unchanged behaviour).
//   • gt_jid   — the journey_id handoff (stripped by the destination on arrival).
// Runs ONLY while analytics is active. NEVER touches external links (Cal.com,
// WhatsApp, Instagram, Google, …), in-page #anchors, or mailto:/tel:/javascript:.
// Never propagates UTM / fbclid / page_visit_id. Existing query params are
// preserved; a destination's explicit different creative is left untouched.
// ---------------------------------------------------------------------------
function decorateInternalLinks(): void {
  if (!analyticsActive) return;
  const anchors = document.querySelectorAll('a[href]');
  for (let i = 0; i < anchors.length; i++) {
    decorateAnchor(anchors[i] as HTMLAnchorElement);
  }
}

function decorateAnchor(a: HTMLAnchorElement): void {
  const rawHref = a.getAttribute('href');
  if (!rawHref) return;
  const lower = rawHref.trim().toLowerCase();
  if (
    lower.startsWith('#') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('javascript:')
  ) {
    return;
  }

  let url: URL;
  try {
    url = new URL(a.href, window.location.href);
  } catch {
    return;
  }

  // Internal only — same origin. Never append anything to external URLs
  // (this is what keeps gt_jid off Cal.com / WhatsApp / Instagram / any
  // external destination).
  if (url.origin !== window.location.origin) return;

  // creative — keep the destination's own explicit creative if it has one.
  if (CREATIVE) {
    const existing = url.searchParams.get('creative');
    if (!existing || existing.trim() === '') {
      url.searchParams.set('creative', CREATIVE);
    }
  }

  // journey_id handoff — always overwrite so every internal hop carries the
  // current journey. The destination reads it and strips it immediately.
  if (journeyId) {
    url.searchParams.set(JOURNEY_PARAM, journeyId);
  }

  a.setAttribute('href', url.pathname + url.search + url.hash);
}

// ---------------------------------------------------------------------------
// Init — attaches the delegated click listener, resolves the ids, cleans the
// URL, decorates internal links, and sends exactly one page_view. Runs
// immediately on load; there is no consent to wait for.
// ---------------------------------------------------------------------------
function init(): void {
  if ((window as any).__gtAnalyticsInit) return;
  (window as any).__gtAnalyticsInit = true;

  // Excluded Meta crawler: skip all custom-analytics setup — no click listener,
  // no page_visit_id / journey_id, no gt_jid stripping, no internal-link
  // decoration, no page_view. analyticsActive stays false, so window.trackById
  // and window.trackEvent remain safe no-ops for any booking/UI caller.
  if (IS_EXCLUDED_BOT) return;

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (!target || !target.closest) return;
      const el = target.closest('[data-track]') as HTMLElement | null;
      if (!el) return;
      trackFromElement(el);
    },
    true, // capture, so we fire before handlers that stopPropagation
  );

  analyticsActive = true;

  // page_visit_id: one per document lifecycle (this load).
  pageVisitId = generateId6();

  // journey_id: reuse an inbound handoff (internal navigation), else start a
  // fresh journey. Then remove gt_jid from the visible URL immediately.
  journeyId = getInboundJourneyId() || generateJourneyId();
  stripJourneyParamFromUrl();

  // Carry creative + journey_id across internal links.
  decorateInternalLinks();

  // Exactly one page_view per document lifecycle.
  if (!pageViewSent) {
    pageViewSent = true;
    const buttonId = (window as any).__gtPageViewButtonId || 'page_view';
    trackById(buttonId, 'page_view');
  }
}

if (typeof window !== 'undefined') {
  // Exposed for non-DOM event sources (Cal.com Embed Events API) and debugging.
  (window as any).trackEvent = trackEvent;
  (window as any).trackById = trackById;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
