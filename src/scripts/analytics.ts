// Privacy-friendly click tracking.
// No cookies, no persistent identifiers, no fingerprinting.
// Every tracked click sends one row to the Apps Script endpoint.

const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbwyuXck-XRXeBCwC4tVT1WBGwTMvwIogVO_j2hQhI2KgSnK0ThRckYCpE3AZeB8BPVH/exec';

type DeviceKind = 'mobile' | 'tablet' | 'desktop';

function detectDevice(): DeviceKind {
  const ua = navigator.userAgent || '';
  // Tablet first (some tablets also match /Mobi/).
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function trackEvent(eventName: string, buttonId: string): void {
  const payload = {
    timestamp: new Date().toISOString(),
    event: eventName,
    page: window.location.pathname,
    button_id: buttonId,
    language: document.documentElement.lang || '',
    device: detectDevice(),
    referrer: document.referrer || '',
    user_agent: navigator.userAgent || '',
    screen_width: window.innerWidth,
  };

  const body = JSON.stringify(payload);

  // sendBeacon is the recommended API for firing an event that must not
  // block navigation. Apps Script accepts text/plain; using that content-type
  // avoids the extra CORS preflight that application/json triggers.
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
      const buttonId = el.dataset.track;
      if (!buttonId) return;
      const eventName = el.dataset.trackEvent || 'click';
      trackEvent(eventName, buttonId);
    },
    // Capture=true so we fire before any click handler that might
    // stopPropagation (e.g. Cal.com's popup opener).
    true,
  );
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

// Expose on window for ad-hoc console debugging: `window.trackEvent('test','x')`.
if (typeof window !== 'undefined') {
  (window as any).trackEvent = trackEvent;
}
