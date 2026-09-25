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
function generatePageVisitId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to getRandomValues */
  }
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      // Format as an RFC-4122 v4-style string (purely cosmetic — any random
      // value works; this just keeps the shape consistent with randomUUID()).
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h: string[] = [];
      for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
      return (
        h[0] + h[1] + h[2] + h[3] + '-' +
        h[4] + h[5] + '-' +
        h[6] + h[7] + '-' +
        h[8] + h[9] + '-' +
        h[10] + h[11] + h[12] + h[13] + h[14] + h[15]
      );
    }
  } catch {
    /* fall through to Math.random */
  }
  // Last-resort fallback when Web Crypto is entirely unavailable. Still purely
  // in-memory and ephemeral; only the randomness quality is lower.
  return 'pv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Minted ONCE per page lifecycle, held only in JS memory.
const PAGE_VISIT_ID = generatePageVisitId();

// creative — the ad/campaign creative identifier, read ONLY from the current
// page URL's ?creative= query parameter (e.g. ?creative=head → "head"). It is
// never persisted anywhere (no cookies / sessionStorage / localStorage /
// IndexedDB) and is not derived from the visitor — it is purely the query
// parameter of the URL this page was loaded with. Absent parameter → null.
// Read once per page lifecycle here so every event of this visit reports the
// same value and no caller/component ever passes it in.
function getCreative(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('creative');
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
