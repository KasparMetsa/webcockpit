import { defineConfig } from 'vite';

// Cross-origin isolation (spec §1.5) stays possible from day one.
// COEP does not apply to WebSocket connections, so the direct
// wss://mume.org/ws-play/ socket (ADR 0002) is unaffected.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: { target: 'es2022' },
});
