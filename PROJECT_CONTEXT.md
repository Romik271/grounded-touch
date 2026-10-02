# PROJECT_CONTEXT.md — Grounded Touch

Technical handover reconstructed from the **current code** (source of truth) and local Git history. No application code, config, or deployment was changed to produce this file.

Legend: **[CODE]** = verified in current source · **[HISTORY]** = from Git log · **[ASSUMPTION]** / **[UNKNOWN]** = not verifiable from the repo.

---

## 1. Stack, repo, build, deployment

| Item | Value | Source |
|---|---|---|
| Framework | **Astro ^4.16.0** (static output), **Tailwind** via `@astrojs/tailwind`, `@astrojs/sitemap` | **[CODE]** `package.json`, `astro.config.mjs` |
| Analytics dep | `@vercel/analytics ^2.0.1` (Astro `<Analytics />`) | **[CODE]** `package.json`, layouts |
| Repo | `https://github.com/Romik271/grounded-touch.git` | **[CODE]** `git remote -v` |
| Branch / HEAD | `main` @ **`59e4b6b`** "Refactor anonymous journey tracking" (2026‑09‑29). Working tree **clean**; `main` is **in sync with `origin/main`**. | **[CODE]** `git status`, `git log` |
| Run / build | `npm run dev` · `npm run build` · `npm run preview` | **[CODE]** `package.json` scripts |
| Site URL | `https://www.groundedtouch.de` | **[CODE]** `astro.config.mjs` `site` |
| Deployment | **No `vercel.json`/`netlify.toml` in repo.** Historically GitHub→Vercel. Because HEAD == `origin/main`, production most likely reflects `59e4b6b`. | **[HISTORY]** / **[ASSUMPTION]** |

There is **no backend/API directory** (`src/pages/api`, server, functions all absent). The site is fully static; the only outbound data path is a client→Google Apps Script call (see §4).

---

## 2. Routes, EN/DE, components, styling, mobile

**Routes** (`src/pages/`):

| Route | File | Layout | Indexable |
|---|---|---|---|
| `/` (EN home) | `index.astro` | `BaseLayout` | yes |
| `/de/` (DE home) | `de/index.astro` | `BaseLayout` (lang="de") | yes |
| `/hotel` (EN, in‑hotel funnel) | `hotel.astro` | `HotelLayout` | yes |
| `/long` | `long.astro` | `BaseLayout` with `noindex="noindex, follow"` — experimental booking‑recovery variant with an **inline** Cal embed | no |
| `/impressum`, `/datenschutz` | resp. files | `BaseLayout` | yes (excluded from sitemap) |

**EN/DE model [CODE]:** copy lives in `src/i18n/strings.ts` (`t(lang)`, `as const`); `lang: 'en' | 'de'`. The homepage renders *short* sections; `/long` renders *full* sections. There is **no `/de/hotel`** — `/hotel` is English‑only.

**Main sections** (`src/components/sections/` and `.../short/`): `Hero`, `Approach(Short)`, `About(Short)`, `Legs(Short)`, `Sessions(Short)`, `Reviews(Short)`, `Faq(Short)`/`FAQ`, `Booking`, `BigCTA`, `Contact`, `Trust`, `AskQuestion`. Shared: `Nav`, `Footer`, `Section`, `EditorialImage`, `CalExitFeedback`.

**Styling [CODE]:** Tailwind + `src/styles/global.css`; custom tokens (`ink`, `terra`, `ivory`, `stone`, `line`, `clay`, serif `Fraunces`, `Inter`) in `tailwind.config.mjs`; self‑hosted fonts in `public/fonts` preloaded in both layouts. Reveal‑on‑scroll via `IntersectionObserver` on `.reveal` (inline script in each layout).

**Mobile [CODE]:** Home hero "Book a session" button reparents into a fixed bottom‑right dock below 768px (`src/pages/index.astro` script); it **scrolls to `#sessions`**, it does not open Cal. `/hotel` has its own floating "Book now" button (`hotel-float-book`).

**Where content is maintained:**
- Text/prices/review quotes/FAQ/availability copy → **`src/i18n/strings.ts`** (home) and inline in **`src/pages/hotel.astro`** (hotel copy, `HOTEL_CAL_LINK`, hotel price €160).
- Prices **[CODE]**: 60‑min **€65**, 90‑min **€95** (`strings.ts` `sessions.rows`), in‑hotel 90‑min **€160** (`hotel.astro`).
- Images → `public/images/`, referenced in components; `referecene/` (sic) at repo root holds design reference images, **not** part of the build.

---

## 3. Booking (Cal.com)

**[CODE]** Cal links: `grounded-touch/60-min-thai-massage` (ns `sixty`), `grounded-touch/90-min-thai-massage` (ns `ninety`) — `Sessions.astro`/`SessionsShort.astro`; `grounded-touch/60-90-min-thai-massage` inline on `/long` (`Booking.astro`); `grounded-touch/mobile-massage-session-90-min-160` (ns `hotel`) — `hotel.astro`. Also `grounded-touch/60-min` in `BigCTA`/`Hero`.

**Loading model [CODE]:** `BaseLayout.astro` / `HotelLayout.astro` define a Cal **stub that makes no network request on load**. `embed.js` is fetched **only on the first click** of a `[data-cal-link]` element; `window.calEmbedInit()` then inits namespaces and registers events. `/long`'s inline calendar calls `calEmbedInit()` eagerly.

**Buttons:** home session cards `data-track="book_60min" | "book_90min"`; hotel CTAs `hotel_booking_hero` / `hotel_booking_floating` / `hotel_booking_price`; home hero `book_session_hero` → `book_session_floating` when docked.

**Confirmed booking vs click [CODE]:** a **click** fires `book_60min`/`book_90min`/`hotel_booking_*`. A **confirmed booking** = Cal Embed event **`bookingSuccessfulV2`** → `window.trackById("booking_completed")`, registered per namespace in `calEmbedInit()` (both layouts). No redirect‑based confirmation. `CalExitFeedback.astro` shows a one‑time, in‑memory bottom sheet (WhatsApp fallback) when a visitor opens Cal, views it, and closes without booking.

---

## 4. Tracking (end to end)

**Single module [CODE]: `src/scripts/analytics.ts`**, imported once per layout. There is **no server component**; events POST directly to a **Google Apps Script endpoint** (`ENDPOINT`, `.../macros/s/AKfycbz…/exec`) which writes to a **Google Sheet** (destination owned outside the repo — **[UNKNOWN]** Sheet ID / Apps Script source / columns beyond payload order).

**Delivery [CODE]:** `trackEvent()` sends via `navigator.sendBeacon` (Blob `text/plain`), falling back to `fetch(..., {keepalive:true, mode:'no-cors'})`. All errors are swallowed; tracking never throws. `text/plain` avoids a CORS preflight.

**Payload fields (exact, in order) [CODE]:**
`timestamp, event, page, button_id, language, device, referrer, page_visit_id, journey_id, creative, user_agent, screen_width`.

| Field | Meaning |
|---|---|
| `event` | `page_view`, `click`, scroll ids (`scroll_25/50/75/90`), `booking_completed`, etc. |
| `page` | `window.location.pathname` (no query → no `gt_jid` leakage) |
| `button_id` | `data-track` value, or `page_view` / `hotel_page_view` for page views |
| `device` | `mobile`/`tablet`/`desktop` from UA (`getDeviceType`) |
| `referrer`, `user_agent`, `screen_width` | `document.referrer`, full UA string, `window.innerWidth` |
| `creative` | campaign attribution (see below) |
| `page_visit_id`, `journey_id` | see IDs below |

**Event triggers [CODE]:** delegated capture‑phase `click` on `[data-track]` (`init`); exactly one `page_view` per load (`pageViewSent` guard); hotel‑only scroll milestones (`hotel.astro`); Cal `booking_completed`; `CalExitFeedback` events.

**IDs [CODE]:**
- **`page_visit_id`** — `generateId6()`: **6 chars, A–Z0–9 uppercase**, `crypto.getRandomValues` with rejection sampling (bias‑free). **Memory‑only, one per document load.** *(This matches the historical "≤6 characters/digits" request.)*
- **`journey_id`** — `generateJourneyId()`: **8 chars, lowercase a–z0–9**, same crypto method. **Memory‑only.** To span internal navigation (full‑document loads — the site has **no** Astro ClientRouter), it is handed off via a **`gt_jid` query param** on same‑origin `<a>` links (`decorateInternalLinks`/`decorateAnchor`), read on arrival (`getInboundJourneyId`, regex `^[a-z0-9]{8}$`) and **immediately stripped** from the visible URL via `history.replaceState` (`stripJourneyParamFromUrl`). Never added to external links (Cal/WhatsApp/Instagram) or canonical/page paths. A genuinely new visit (new document, no inbound `gt_jid`) gets a new id.

**Storage [CODE]:** **No cookies, no localStorage, no sessionStorage, no IndexedDB.** Both IDs are in‑memory; reload = new IDs. Guard flag `window.__gtAnalyticsInit` prevents double init (no duplicate page views / listeners).

**creative / UTM / fbclid [CODE]:** `getCreative()` resolves from URL only: explicit `?creative=…` wins; else `?utm_content=link_in_bio` → `"link_in_bio"`; else `null`. **No UTM/fbclid/gclid is stored** as its own field; `fbclid` is explicitly ignored. `referrer` is sent raw (may itself contain source params).

**Bot/internal‑traffic filtering & reliability:** **[UNKNOWN]** — no client‑side bot filter in code; any filtering would be in the (unavailable) Apps Script/Sheet. No retry/queue; a dropped beacon is lost silently.

**Vercel Web Analytics [CODE]:** separate `<Analytics />` in both layouts, always on, independent of the first‑party tracker.

---

## 5. SEO

**[CODE]** Per‑page `<title>`/`<meta description>` via `BaseLayout` props (default title *"Thai Massage in Munich Schwabing | Grounded Touch"*); `/hotel` default *"Hotel Thai Massage Munich | Grounded Touch"*. **H1s:** `Hero.astro` (home/`/long`, `tr.titleA/titleB`), `hotel.astro`, plus legal pages. **Canonical:** `BaseLayout` builds `new URL(path, site)`; hotel hardcodes `/hotel`. **hreflang:** emitted on `/` and `/de/` only (en / de / x‑default). **Sitemap:** `@astrojs/sitemap`, excludes `/long`, `/impressum`, `/datenschutz`. **robots.txt** (`public/robots.txt`): `Allow: /` for all + sitemap reference (no AI‑bot‑specific rules). **Rendered content** is server‑rendered static HTML (prices, reviews, FAQ all crawlable).

**JSON‑LD: NONE.** `grep` for `application/ld+json` / `schema.org` returns nothing. The earlier audit's "JSON‑LD missing" finding is **still true [CODE]**. No `LocalBusiness`, `Service`, `FAQPage`, `Review`, or `geo`. **[SUGGESTION]** biggest SEO/AI‑visibility gap. No `llms.txt`.

---

## 6. Privacy implementation

**[CODE]** **No consent banner exists** — `AnalyticsConsent.astro` is absent and there are no `gtConsent` / `gt_analytics_consent` / `data-gt-open-consent` references in code. First‑party analytics starts automatically on load with **no cookies/localStorage/sessionStorage** (§4). Vercel Web Analytics runs independently.

**Data collected/stored [CODE]:** the §4 payload fields (incl. full `user_agent`, `referrer`, coarse device, screen width, two random non‑persistent IDs, derived `creative`). No name/email/phone collected by the tracker; booking PII is entered directly in Cal.com's own embed, not captured by this site.

**Privacy page [CODE]:** `src/pages/datenschutz.astro`. Analytics sections describe a "selbst betriebene Website‑Analyse": cookieless, no local/session storage, two short‑lived random identifiers, `gt_jid` handoff removed from the URL, data sent to Google Apps Script/Sheets (max 12‑month retention), legal basis stated as Art. 6(1)(f) with an Art. 21 objection right. (Document describes behavior; **this file makes no legal‑compliance judgment.**)

---

## 7. Seasonal content remaining

- **Oktoberfest: fully removed [CODE/HISTORY].** No `oktoberfest/wiesn/dirndl/prost` references in `src/` or `public/`. History shows add→remove: `c9f3b20`/`bf74698` "Add Oktoberfest…" then `e992a81` "no oct". **Nothing to remove.**
- **September availability notice: STILL PRESENT and now stale [CODE].** `strings.ts` `sessions.notice` (`heading: "LIMITED SEPTEMBER AVAILABILITY"`, `body: "Away Sep 2–6 & Sep 15–21"`, `bodyLate`) rendered by `SessionsShort.astro` (`#sept-availability-notice`) inside a date‑gated Europe/Berlin window; its inline script `.remove()`s the node outside the window (and if the time can't be read). As of October it should self‑hide, but the strings + block remain in code. No timer animation beyond reveal; it is tracked only if clicked (no dedicated event). **Not removed** per instructions — flagged for a future cleanup (the code comment itself says to delete the block, script, and `notice` strings when done).

---

## 8. Known issues / TODOs & file map

**Supported by code/history:**
- **No JSON‑LD / no `llms.txt`** — SEO & AI‑recommendation gap (§5). **[CODE]**
- **Stale September availability notice** still shippable in off‑window edge cases (§7). **[CODE]**
- **NAP inconsistency:** home shows "Munich — address shared upon booking" (`Contact.astro`) while `impressum.astro` has full address *Sulzbacher Str. 4, 80803 München*; two different geo coordinates appear (`ReviewsShort.astro` vs `strings.ts` FAQ map link). **[CODE]**
- **Tracking sink opaque:** Apps Script source, Sheet schema, bot filtering, and whether PII‑free guarantees hold at the sink are **[UNKNOWN]** (not in repo).
- Commit messages are terse (`"new track"`, `"new екфсл"`) — limited historical rationale. **[HISTORY]**

**File map for future edits:**
| Need | File(s) |
|---|---|
| Home copy / prices / reviews / FAQ / availability | `src/i18n/strings.ts` |
| Hotel copy / price / Cal link | `src/pages/hotel.astro` |
| Tracking logic, IDs, endpoint, payload | `src/scripts/analytics.ts` |
| Cal stub / events / `booking_completed` | `src/layouts/BaseLayout.astro`, `src/layouts/HotelLayout.astro` |
| Booking‑recovery sheet | `src/components/CalExitFeedback.astro` |
| SEO head / canonical / hreflang | `src/layouts/BaseLayout.astro`, `src/pages/hotel.astro` |
| Privacy text | `src/pages/datenschutz.astro` |
| Legal/NAP | `src/pages/impressum.astro` |
| Global styling / tokens | `tailwind.config.mjs`, `src/styles/global.css` |
| Routing / sitemap excludes | `src/pages/*`, `astro.config.mjs` |

---

## Edit guardrails
- Keep each change **scoped to the explicitly requested task**; do not refactor adjacent code.
- **Preserve** unrelated design, copy, routes, booking flow, and tracking (event names + payload field order are a contract with the external Google Sheet — do **not** rename/reorder/add columns).
- Before editing, **identify dependencies**: tracking event names ↔ Sheet columns; Cal namespaces/links ↔ `calEmbedInit`; `strings.ts` keys ↔ components (removing a key breaks `t()` consumers); layout head ↔ SEO/canonical.
- **Run existing checks:** `npm run build` must pass (and `npm run preview` for runtime spot‑checks). There is no test suite or linter configured.
- After editing, **report changed files + build result**; never commit, push, or deploy unless asked.

## Up to five missing inputs
1. **Google Apps Script source + Sheet schema/ID** (true destination columns, retention, any bot/internal filtering) — not in repo.
2. **Vercel project settings** (which commit/branch is live, env vars, redirects) — no `vercel.json`.
3. **Confirmation that `origin/main @ 59e4b6b` is the deployed production build.**
4. **Real opening hours** (code says only "by appointment, Tue–Sat") and the **canonical address/coordinates** to standardize NAP.
5. **Intended lifetime of the September availability notice** (delete now, or keep the date‑gate for reuse?).
