// Privacy-friendly click tracking.
// No cookies, no persistent identifiers, no fingerprinting.
// Every tracked click sends one row to the Apps Script endpoint.

const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbyw-Cpzl1jIEDggnF4aPRuxXet9S1x4fsmxNkjkxOhWgV8QaLTsmZ06FSAZotf5UxV1/exec';

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

// Build the payload object from a triggering element and fire trackEvent.
function trackFromElement(el: HTMLElement): void {
  const buttonId = el.dataset.track;
  if (!buttonId) return;
  trackEvent({
    event: el.dataset.trackEvent || 'click',
    page: window.location.pathname,
    button_id: buttonId,
    language: document.documentElement.lang || 'unknown',
    device: getDeviceType(),
    referrer: document.referrer || '',
    user_agent: navigator.userAgent,
    screen_width: window.innerWidth,
  });
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
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  // Expose on window for ad-hoc console debugging.
  (window as any).trackEvent = trackEvent;
}
