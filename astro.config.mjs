import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.groundedtouch.de',
  integrations: [tailwind(), sitemap()],
  vite: {
    build: {
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return '_astro/styles.[hash][extname]';
            }
            return '_astro/[name].[hash][extname]';
          },
        },
      },
    },
  },
});
