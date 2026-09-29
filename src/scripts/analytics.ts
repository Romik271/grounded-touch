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

  const payload = {
    timestamp: new Date().toISOString(),
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
