import { defineConfig } from 'vite';
import { DEFAULT_DEV_APP_PORT, serverPortFromEnv } from '../server/src/http/ports.ts';
import { sharedViteConfig } from './vite.config.ts';
import { pluginAssetDevProxyPlugin, productDevProxy } from './vite-product-proxy.ts';

const serverPort = serverPortFromEnv();
const appPort = Number(process.env.ZCC_DEV_APP_PORT ?? DEFAULT_DEV_APP_PORT);
const serverOrigin = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  ...sharedViteConfig,
  plugins: [pluginAssetDevProxyPlugin(serverOrigin), ...(sharedViteConfig.plugins ?? [])],
  define: {
    __ZCC_DEV_WS_PORT__: JSON.stringify(serverPort)
  },
  server: {
    host: '127.0.0.1',
    port: appPort,
    fs: { allow: ['../..'] },
    proxy: productDevProxy(serverOrigin)
  }
});
