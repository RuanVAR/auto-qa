import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 3000,
    host: true,
    // Worker container hits /testapp via docker DNS — Vite's default host
    // allow-list rejects "web" with a Blocked request page, breaking runs.
    // Allow it explicitly. Production build serves through nginx so this
    // dev-only addition has no prod surface.
    allowedHosts: ['web', 'localhost', '127.0.0.1'],
    // Inside Docker the source tree is bind-mounted; inotify events from
    // the host filesystem don't propagate reliably through the Docker fs
    // layer on macOS / WSL, so vite never sees changes. Polling (~300 ms)
    // gives universal reliability with negligible CPU cost on modern HW.
    // Only enabled when CHOKIDAR_USEPOLLING is set, so native Linux dev
    // keeps zero-overhead inotify.
    watch: process.env.CHOKIDAR_USEPOLLING ? { usePolling: true, interval: 300 } : undefined,
    // HMR client connects back via the host port (3000) — needed because
    // the container's perspective of `localhost` doesn't match the user's.
    hmr: process.env.CHOKIDAR_USEPOLLING ? { host: 'localhost', port: 3000, protocol: 'ws' } : undefined,
    // Server-side proxy target (vite forwards `/api/*` here). Inside Docker
    // this is `http://api:3001` (docker DNS); on the host it's `localhost:3001`.
    // Falls back to VITE_API_URL when unset for legacy compatibility.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? process.env.VITE_API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      // WebSocket — same logic. Browser opens ws://localhost:3000/socket.io
      // (same origin as web) and vite upgrades the connection to api:3002.
      '/socket.io': {
        target: (process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001').replace(':3001', ':3002'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Third-party vendor bundles — cached long-term between deploys
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('@tanstack')) return 'vendor-query';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('socket.io-client')) return 'vendor-socket';
            if (id.includes('axios')) return 'vendor-http';
            if (id.includes('zustand')) return 'vendor-state';
            if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
            return 'vendor-other';
          }
          // App code splits — route-based. Admin + testing are heavy
          // and rarely loaded together, so splitting them saves first-load bytes.
          if (id.includes('/pages/admin/')) return 'app-admin';
          if (id.includes('/pages/modules/FeaturePage')) return 'app-feature';
          if (id.includes('/pages/testing/')) return 'app-testing';
          if (id.includes('/pages/tests/TestEditor')) return 'app-test-editor';
          if (id.includes('/components/StepEditor') || id.includes('/components/IssueTracker')) {
            return 'app-editor-heavy';
          }
          return undefined;
        },
      },
    },
  },
});
