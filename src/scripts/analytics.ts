// Privacy-friendly click tracking.
// No cookies, no persistent identifiers, no fingerprinting.
// Every tracked click sends one row to the Apps Script endpoint.

const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbxnQDCv_RF0VpbioBbyfsHYH9ogcf764ahpD5qOpqbLr3YEjiDoF9qnVi4J480kILY/exec';

// page_visit_id — an EPHEMERAL, random per-page-lifecycle id used only to group
// the events of a single page visit into one journey (page_view → book_60min →
// cal_opened → …). It lives ONLY in this module's memory: it is never written
// to cookies / sessionStorage / localStorage / IndexedDB / the URL / the DOM,
// and is never derived from the visitor (UA, IP, screen, language, referrer,
// device). A full reload / navigation reloads this module and mints a new id —
// which is intentional; the same visitor is deliberately NOT re-identifiable
// across reloads. It is generated ONCE here so callers/components never make
// their own id.
//
// Format: a random 6-character uppercase alphanumeric id (A–Z, 0–9), e.g.
// "A7K3QF". Randomness comes from crypto.getRandomValues; rejection sampling
// (bytes >= 252 are discarded) keeps every character uniformly distributed over
// the 36-char alphabet with no modulo bias.
function generatePageVisitId(): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // 36 chars
  const LEN = 6;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const out: string[] = [];
      while (out.length < LEN) {
        const bytes = new Uint8Array(LEN);
        crypto.getRandomValues(bytes);
        for (let i = 0; i < bytes.length && out.length < LEN; i++) {
          // 252 is the largest multiple of 36 that fits in a byte (0–255);
          // discard higher values so no character is more likely than another.
          if (bytes[i] < 252) out.push(ALPHABET[bytes[i] % 36]);
        }
      }
      return out.join('');
    }
  } catch {
    /* fall through to Math.random */
  }
  // Last-resort fallback when Web Crypto is entirely unavailable. Same shape and
  // alphabet; purely in-memory and ephemeral, only the randomness quality is lower.
  let s = '';
  for (let i = 0; i < LEN; i++) s += ALPHABET[(Math.random() * 36) | 0];
  return s;
}

// Minted ONCE per page lifecycle, held only in JS memory.
const PAGE_VISIT_ID = generatePageVisitId();

// creative — the ad/campaign creative identifier, resolved ONLY from the current
// page URL's query string. It is never persisted anywhere (no cookies /
// sessionStorage / localStorage / IndexedDB) and is not derived from the visitor
// — it is purely a function of the URL this page was loaded with. Read once per
// page lifecycle here so every event of this visit reports the same value and no
// caller/component ever passes it in.
//
// Resolution priority:
//   A. An explicit non-empty ?creative=<value> wins (e.g. ?creative=head → "head").
//   B. Otherwise, Instagram bio traffic is recognized via ?utm_content=link_in_bio
//      → "link_in_bio". Only that exact utm_content value triggers this fallback;
//      fbclid / referrer / utm_source are never used to infer a creative.
//   C. Otherwise → null.
// An explicit creative always beats utm_content, so
// ?creative=head&utm_content=link_in_bio resolves to "head".
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
  // Tablet detection first (some tablets also match /Mobi/).
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

// The tracker accepts ONE object argument matching the sheet columns 1:1.
// `timestamp` is added here so the caller doesn't have to worry about it.
export function trackEvent(details: TrackDetails): void {
  const payload = {
    timestamp: new Date().toISOString(),
    event: details.event,
    page: details.page,
    button_id: details.button_id,
    language: details.language,
    device: details.device,
    referrer: details.referrer,
    // Injected centrally so every event of this page visit shares one id and no
    // caller/component ever generates its own. Sits between referrer and
    // creative to match the destination Sheet's column order.
    page_visit_id: PAGE_VISIT_ID,
    // Injected centrally (like page_visit_id) so every event automatically
    // carries the current page's ?creative= value; components never pass it.
    // Sits between page_visit_id and user_agent to match the Sheet column order.
    creative: CREATIVE,
    user_agent: details.user_agent,
    screen_width: details.screen_width,
  };

  console.log('TRACKING PAYLOAD', payload);

  const body = JSON.stringify(payload);

  // sendBeacon is the recommended API: fires reliably even during navigation,
  // never blocks. Apps Script accepts text/plain; using that content-type
  // avoids the CORS preflight that application/json would trigger.
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
  } catch {
    // fall through to fetch
  }

  // Fallback for older browsers / cases where sendBeacon rejects the payload.
  // keepalive lets the request survive page navigation.
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

// Fire a tracking event for a given button_id, building the exact same payload
// structure every tracked click uses. Shared by the DOM click delegation and by
// non-DOM sources (e.g. the Cal.com Embed Events API) so the payload is identical
// across all events.
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

// Build the payload object from a triggering element and fire trackEvent.
function trackFromElement(el: HTMLElement): void {
  const buttonId = el.dataset.track;
  if (!buttonId) return;
  trackById(buttonId, el.dataset.trackEvent || 'click');
}

// Carry the resolved creative across INTERNAL navigation by writing it into the
// href of same-origin links. This is the ONLY mechanism that preserves
// attribution across page loads — nothing is stored in the browser; each page
// lifecycle re-resolves creative from its own URL (see getCreative). When
// creative is null we touch nothing, so plain visits never start growing a
// ?creative= parameter.
//
// Deliberately skipped: cross-origin/external links (Cal.com, WhatsApp,
// Instagram, Google, …), in-page #anchors, mailto:/tel:/javascript: links, and
// anything that isn't a real navigation to another same-origin document. Links
// are decorated in place so the visible href, middle-click, and the address bar
// all stay consistent. An explicit, different creative already present on a
// destination link is left untouched.
function decorateInternalLinks(): void {
  if (!CREATIVE) return;
  const anchors = document.querySelectorAll('a[href]');
  for (let i = 0; i < anchors.length; i++) {
    decorateAnchor(anchors[i] as HTMLAnchorElement);
  }
}

function decorateAnchor(a: HTMLAnchorElement): void {
  const rawHref = a.getAttribute('href');
  if (!rawHref) return;
  // In-page anchors and non-navigation schemes are never rewritten.
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
    // a.href is already resolved to an absolute URL against the current page.
    url = new URL(a.href, window.location.href);
  } catch {
    return;
  }

  // Internal only — same origin as the page the visitor is currently on.
  if (url.origin !== window.location.origin) return;

  // Preserve an explicit, non-empty creative the destination already carries
  // rather than overwriting it; otherwise add/set ours (no duplicates).
  const existing = url.searchParams.get('creative');
  if (existing && existing.trim() !== '') return;
  url.searchParams.set('creative', CREATIVE as string);

  // Keep it same-origin-relative; existing query params are preserved by URL.
  a.setAttribute('href', url.pathname + url.search + url.hash);
}

// Auto-init: attach a single delegated click listener that fires trackEvent
// for any element carrying data-track (or a descendant of one).
// Runs on every page because this module is imported from BaseLayout.
function init(): void {
  // Guard against double-initialization (Astro dev HMR, view transitions).
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
    // Capture=true so we fire before any handler that might stopPropagation
    // (e.g. Cal.com's popup opener).
    true,
  );

  // Central page-view: record ONE custom page-view per load so landing-only
  // visits (e.g. from Meta ads) are captured even without any interaction.
  // Uses the same payload/schema as every other event. Pages that send their
  // own funnel-specific page-view (e.g. /hotel → hotel_page_view) set
  // window.__gtDisableAutoPageView synchronously in <head> to opt out, so a
  // page never produces two page-view events.
  if (!(window as any).__gtDisableAutoPageView) {
    trackById('page_view', 'page_view');
  }

  // Carry the resolved creative into internal links so attribution survives
  // navigation without any browser storage. No-op when creative is null.
  decorateInternalLinks();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  // Expose on window for ad-hoc console debugging and for non-DOM event sources
  // (e.g. the Cal.com Embed Events API wired up in BaseLayout).
  (window as any).trackEvent = trackEvent;
  (window as any).trackById = trackById;
}
