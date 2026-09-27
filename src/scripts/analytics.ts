// Consent-based DETAILED analytics for Grounded Touch.
//
// This module is the SINGLE, central layer for the OPTIONAL detailed
// first-party analytics ONLY. Nothing here runs — no custom events, no
// page_visit_id, no journey_id — unless the visitor has explicitly granted
// consent. Consent is the only gate; individual components never check consent
// themselves. They keep calling the shared API (window.trackById / trackEvent),
// and when consent is not granted those calls safely do nothing (no queue, no
// replay).
//
// NOTE: basic Vercel Web Analytics (aggregated reach/audience measurement) is a
// SEPARATE, always-on system. It is rendered via the <Analytics /> component in
// the shared layouts and is deliberately NOT controlled by this module or by
// the gt_analytics_consent cookie. This module never touches Vercel.
//
// Three distinct concepts, kept strictly separate:
//   • consent      — granted | denied | undecided. Persisted in a first-party
//                    cookie (gt_analytics_consent) that stores ONLY the literal
//                    word "granted" or "denied" — nothing else.
//   • page_visit_id — one id per document lifecycle (this load). Memory-only.
//   • journey_id    — one id per browsing journey in this tab/session. Stored in
//                    sessionStorage (gt_analytics_journey_id) so it survives
//                    reloads and internal navigation within the tab.
//   • creative      — campaign attribution, resolved from the page URL.

const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbzF0CTgaaQhtSGCfJkZlabiLrNbsyzUXGuFnUOzaNcOBdXhQtas5kUsh27RuKyXFMBP/exec';

// First-party consent cookie. Stores ONLY "granted" | "denied" (never any id,
// campaign, timestamp, or visitor data). ~6 months so the choice is remembered.
const CONSENT_COOKIE = 'gt_analytics_consent';
const CONSENT_MAX_AGE = 60 * 60 * 24 * 180; // seconds (~180 days)

// sessionStorage key for journey_id — scoped to the tab/session only.
const JOURNEY_KEY = 'gt_analytics_journey_id';

// ---------------------------------------------------------------------------
// Random 6-character uppercase alphanumeric id (A–Z, 0–9), e.g. "A7K3QF".
// Shared by page_visit_id and journey_id. Randomness from crypto.getRandomValues
// with rejection sampling (bytes >= 252 discarded) so every character is
// uniformly distributed over the 36-char alphabet with no modulo bias.
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
// Consent cookie helpers. The cookie holds ONLY "granted" | "denied".
// ---------------------------------------------------------------------------
type Consent = 'granted' | 'denied' | 'undecided';

function readConsentCookie(): 'granted' | 'denied' | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)gt_analytics_consent=(granted|denied)(?:;|$)/);
    return m ? (m[1] as 'granted' | 'denied') : null;
  } catch {
    return null;
  }
}

function writeConsentCookie(value: 'granted' | 'denied'): void {
  try {
    // Secure only over HTTPS (so it still works on http://localhost in dev).
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    /* if cookies are unavailable we simply behave as undecided */
  }
}

function consentState(): Consent {
  return readConsentCookie() ?? 'undecided';
}

// ---------------------------------------------------------------------------
// Analytics runtime state — all memory-only, reset on every document load.
// ---------------------------------------------------------------------------
let analyticsActive = false;      // the single central gate
let pageVisitId: string | null = null; // memory-only, one per document lifecycle
let journeyId: string | null = null;    // mirrors sessionStorage[JOURNEY_KEY]
let pageViewSent = false;         // ensures exactly one page_view per lifecycle

// ---------------------------------------------------------------------------
// creative — resolved ONLY from the current page URL's query string, once per
// lifecycle. Never persisted; never derived from the visitor.
//   A. explicit non-empty ?creative=<value> wins (e.g. ?creative=head).
//   B. otherwise ?utm_content=link_in_bio → "link_in_bio" (Instagram bio).
//      Only that exact value; fbclid / referrer / utm_source never infer it.
//   C. otherwise → null.
// An explicit creative always beats utm_content.
// (Resolved eagerly so it is available regardless of consent, but it is only
// ever ATTACHED to payloads / links while analyticsActive.)
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
// journey_id — created / read / written ONLY when consent is granted. Lives in
// sessionStorage so it persists across reloads and internal navigation within
// the tab, while page_visit_id changes each load. Never placed in the URL or a
// cookie; never derived from UA / IP / referrer / device / viewport / language
// / timestamps. If sessionStorage is unavailable we return null and send
// journey_id as empty — no fingerprint fallback, and the page never breaks.
// ---------------------------------------------------------------------------
function getOrCreateJourneyId(): string | null {
  try {
    const existing = sessionStorage.getItem(JOURNEY_KEY);
    if (existing && /^[A-Z0-9]{6}$/.test(existing)) return existing;
    const id = generateId6();
    sessionStorage.setItem(JOURNEY_KEY, id);
    return id;
  } catch {
    return null; // storage blocked/full → journey_id null, no fallback
  }
}

// ---------------------------------------------------------------------------
// The tracker. Central gate: if analytics is not active, it does nothing.
// The payload maps 1:1 to the Sheet columns; page_visit_id, journey_id and
// creative are injected here so no caller/component ever supplies them.
// ---------------------------------------------------------------------------
export function trackEvent(details: TrackDetails): void {
  if (!analyticsActive) return; // consent gate — no queue, no replay

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
// Events API). Gates automatically via trackEvent.
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
// Creative propagation — carry the resolved creative across INTERNAL navigation
// by writing it into same-origin link hrefs. Runs ONLY while analytics is
// active AND a creative was resolved. Never touches external links (Cal.com,
// WhatsApp, Instagram, Google, …), in-page #anchors, or mailto:/tel:/javascript:.
// Propagates ONLY the normalized creative — never UTM/fbclid/journey_id/
// page_visit_id. Existing query params are preserved; a destination's explicit
// different creative is left untouched; no duplicate creative param is added.
// ---------------------------------------------------------------------------
function decorateInternalLinks(): void {
  if (!analyticsActive || !CREATIVE) return;
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

  // Internal only — same origin. Never append anything to external URLs.
  if (url.origin !== window.location.origin) return;

  const existing = url.searchParams.get('creative');
  if (existing && existing.trim() !== '') return; // keep destination's own creative
  url.searchParams.set('creative', CREATIVE as string);

  a.setAttribute('href', url.pathname + url.search + url.hash);
}

// ---------------------------------------------------------------------------
// Enable / disable the analytics runtime.
// ---------------------------------------------------------------------------
function enableAnalytics(opts: { fresh: boolean }): void {
  analyticsActive = true;

  // page_visit_id: one per document lifecycle. `fresh` (a state transition such
  // as denied→granted) forces a new one; on a normal load it is simply minted
  // because none exists yet.
  if (opts.fresh || !pageVisitId) pageVisitId = generateId6();

  // journey_id: reuse the tab's existing id, or create one now.
  journeyId = getOrCreateJourneyId();

  // Carry creative across internal links (no-op when creative is null).
  decorateInternalLinks();

  // Exactly one page_view per document lifecycle.
  if (!pageViewSent) {
    pageViewSent = true;
    const buttonId = (window as any).__gtPageViewButtonId || 'page_view';
    trackById(buttonId, 'page_view');
  }
}

function disableAnalytics(): void {
  analyticsActive = false; // trackEvent now no-ops (detailed analytics only)
  try {
    sessionStorage.removeItem(JOURNEY_KEY);
  } catch {
    /* ignore */
  }
  journeyId = null;
  pageVisitId = null;
  // Allow a later re-grant in this same lifecycle to send a fresh page_view.
  pageViewSent = false;
}

// ---------------------------------------------------------------------------
// Public consent API (window.gtConsent). The consent UI + the "Privacy
// settings" control drive analytics exclusively through this.
// ---------------------------------------------------------------------------
function grant(): void {
  const previous = consentState();
  writeConsentCookie('granted');
  // A transition into granted (from undecided or denied) starts a fresh visit.
  enableAnalytics({ fresh: previous !== 'granted' });
}

function deny(): void {
  writeConsentCookie('denied');
  disableAnalytics();
  // No withdrawal event is sent.
}

function openSettings(): void {
  try {
    document.dispatchEvent(new CustomEvent('gt:open-consent'));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Init — attaches the delegated click listener always (trackEvent gates), then
// resolves the three page_view cases from the stored consent:
//   A) granted   → initialize now (ids + Vercel + one page_view).
//   B) undecided → nothing yet; the consent banner shows itself. On "Allow"
//                  grant() initializes and sends exactly one page_view.
//   C) denied    → nothing.
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

  if (consentState() === 'granted') {
    enableAnalytics({ fresh: false }); // CASE A
  }
  // CASE B / C: do nothing here.
}

if (typeof window !== 'undefined') {
  (window as any).gtConsent = {
    state: consentState,
    grant,
    deny,
    openSettings,
  };
  // Exposed for non-DOM event sources (Cal.com Embed Events API) and debugging.
  (window as any).trackEvent = trackEvent;
  (window as any).trackById = trackById;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
