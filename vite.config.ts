import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/stream': { target: 'ws://127.0.0.1:4174', ws: true },
      '/api': { target: 'http://127.0.0.1:4174' },
    },
  },
});
