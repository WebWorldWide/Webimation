import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri serves the dev build from a fixed port and loads `dist` in production.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: host || false, hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 on Windows is Chromium; macOS and Linux use WebKit.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  },
  test: { environment: 'jsdom' }
});
