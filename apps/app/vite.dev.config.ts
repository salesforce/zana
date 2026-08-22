import { defineConfig } from 'vite';
import { DEFAULT_DEV_APP_PORT, serverPortFromEnv } from '../server/src/http/ports.ts';
import { sharedViteConfig } from './vite.config.ts';

const serverPort = serverPortFromEnv();
const appPort = Number(process.env.ZCC_DEV_APP_PORT ?? DEFAULT_DEV_APP_PORT);
const serverOrigin = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  ...sharedViteConfig,
  define: {
    __ZCC_DEV_WS_PORT__: JSON.stringify(serverPort)
  },
  server: {
    host: '127.0.0.1',
    port: appPort,
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: serverOrigin,
        changeOrigin: true
      },
      '/ws': {
        target: serverOrigin,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
