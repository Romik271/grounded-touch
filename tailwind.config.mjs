/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Ground
        ivory: '#F4EFE6',
        paper: '#EDE6D7',   // secondary panel (very subtle shift)
        // Text
        ink: '#1C1611',     // near-black warm brown — high contrast on ivory
        stone: '#6B6157',   // muted secondary text
        // Structure
        line: '#D8CDB8',    // hairline / border
        // Accents
        terra: '#A54A28',   // muted terracotta
        cocoa: '#241B14',   // deep chocolate — dark blocks
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        widelabel: '0.16em',
      },
      maxWidth: {
        prose2: '58ch',
      },
      transitionTimingFunction: {
        gentle: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
