import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation headers, required so `crossOriginIsolated` is true
// and SharedArrayBuffer is available for WebContainers (see spec §6/§11 and
// docs/sandbox-execution.md). COEP: 'require-corp' is the mode that was
// verified against Clerk for this app — see the note in
// docs/sandbox-execution.md before changing this to 'credentialless'.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: crossOriginIsolationHeaders,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
});
