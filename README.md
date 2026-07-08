# Grounded Touch

Editorial static site for a bodywork studio in Munich. Built with Astro + Tailwind. No JS framework, no runtime dependencies beyond fonts.

## Run

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # ./dist
npm run preview
```

## Structure

```
src/
  layouts/BaseLayout.astro       # Instrument Serif + Inter, nav, footer, reveal
  components/
    Nav.astro                    # thin nav with scroll-triggered hairline
    Footer.astro
    EditorialImage.astro         # image slot with graceful SVG fallback
    sections/
      Hero.astro                 # N° 01 · Studio     — display headline + image
      Approach.astro             # N° 02 · Approach   — 4 numbered principles
      Legs.astro                 # N° 03 · The focus  — legs & feet, spread layout
      Sessions.astro             # N° 04 · Rates      — 2-row rate table
      Booking.astro               # N° 05 · Booking    — Calendly-ready placeholder
      FAQ.astro                  # N° 06 · Questions  — 6-item accordion
      Trust.astro                # N° 07 · Ground rules
      BigCTA.astro               # dark cocoa block with image slot
      Contact.astro              # N° 08 · Contact
  pages/
    index.astro                  # composition
    impressum.astro              # § 5 TMG template
    datenschutz.astro            # DSGVO template
  styles/global.css              # tokens, .h-display, .h-section, .lede, buttons
public/
  favicon.svg
  images/
    README.txt                   # what to put where
    hero.jpg    (add)            # 1600×2000 · main hero
    legs.jpg    (add)            # 1400×1750 · focus section
    cta.jpg     (add)            # 1400×1000 · dark CTA
```

## Design system

Colors (`tailwind.config.mjs`):

| Token | Hex | Use |
|---|---|---|
| `ivory` | `#F4EFE6` | page background |
| `paper` | `#EDE6D7` | secondary panel |
| `ink`   | `#1C1611` | primary text (near-black warm brown) |
| `stone` | `#6B6157` | secondary text |
| `line`  | `#D8CDB8` | hairlines |
| `terra` | `#A54A28` | muted terracotta accent |
| `cocoa` | `#241B14` | dark blocks (CTA) |

Fonts (Google Fonts):

- **Instrument Serif** — display + section headings. Editorial and calm; no romantic swashes.
- **Inter** — body, UI, labels. 300 / 400 / 500 only.

## Photography

Warm natural daylight, no faces, no spa clichés. Preferred subjects:
hands on linen, feet on wood, a calf under a sheet, the corner of a table with light on it. Muted natural palette, straight lines, patience.

Drop `hero.jpg`, `legs.jpg`, `cta.jpg` into `public/images/`. Until you do, an SVG placeholder in warm tones renders in the same slot at the same aspect ratio.

## Enabling Calendly

`src/components/sections/Booking.astro`:

1. `showCalendly = true`
2. Replace `CALENDLY_URL` with your link.

The placeholder swaps for the embed inside the same border.

## Legal

`impressum.astro` and `datenschutz.astro` are German-law templates with `[bracketed]` placeholders. Fill in real data and have them reviewed before publishing.

## Notes on tone

- Non-medical: no "therapy", "healing", or "fixing" language anywhere.
- Non-erotic: `Trust.astro` states this explicitly.
- No fabricated reviews. When real feedback arrives, replace Trust with actual quotes (or add a new Reviews section between FAQ and Trust).
