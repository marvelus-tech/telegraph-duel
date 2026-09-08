import { defineConfig } from 'vite';

export default defineConfig({
  base: '/telegraph-duel/',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        leaderboard: 'leaderboard.html',
      },
    },
  },
});
