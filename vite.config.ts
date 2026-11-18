import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * `vite build --mode crazygames` (npm run build:crazygames) makes the build that is uploaded to CrazyGames:
 *  - every file is referenced by a relative path, as their site requires (it serves the game from a subfolder);
 *  - their SDK script is added to the page;
 *  - __CRAZYGAMES__ is true, which turns off what their rules forbid (the game's own fullscreen).
 * It is written to dist-crazygames. The server address for multiplayer comes from .env.crazygames.
 */
export default defineConfig(({ mode }) => {
  const crazygames = mode === 'crazygames';
  return {
    base: crazygames ? './' : '/',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'crazygames-sdk',
        transformIndexHtml: (html: string) =>
          crazygames ? html.replace('</head>', '    <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n  </head>') : html,
      },
    ],
    define: {
      __SAMPLE_OVERRIDES__: JSON.stringify(true),
      __LOCAL_MODELS__: JSON.stringify(true),
      __CRAZYGAMES__: JSON.stringify(crazygames),
    },
    build: {
      outDir: crazygames ? 'dist-crazygames' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        output: {
          // Babylon is left to the bundler: it lands in chunks only the lazily loaded game page needs,
          // so the menus never download it. (A manual 'babylon' chunk also swallowed Vite's
          // dynamic-import helper, which made the menus preload all of Babylon.)
          manualChunks(id: string) {
            if (id.includes('node_modules') && !id.includes('@babylonjs')) return 'vendor';
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  } as any;
});
