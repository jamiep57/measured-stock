import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** Serve /assets from repo root during `vite dev`. */
function serveRootAssets() {
  return {
    name: 'serve-root-assets',
    configureServer(server) {
      const sendLanOrigins = (_req, res) => {
        const network = server.resolvedUrls?.network || [];
        const origins = [];
        for (const u of network) {
          try {
            origins.push(new URL(u).origin);
          } catch { /* ignore */ }
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ origins }));
      };
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        if (url === '/__dev-lan' || url === '/v5/__dev-lan') {
          sendLanOrigins(req, res);
          return;
        }
        if (url.startsWith('/v5/admin/') && !path.extname(url)) {
          req.url = '/v5/admin.html';
        }
        if ((url === '/v5/scan' || url === '/v5/scan/') && !path.extname(url)) {
          req.url = '/v5/scan.html';
        }
        next();
      });
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        const assetPath = url.startsWith('/v5/assets/')
          ? url.slice('/v5'.length)
          : url.startsWith('/assets/')
            ? url
            : null;
        if (!assetPath) return next();
        const filePath = path.join(repoRoot, assetPath.slice(1));
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();
        const ext = path.extname(filePath).toLowerCase();
        const types = {
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.ttf': 'font/ttf',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.json': 'application/json',
          '.webmanifest': 'application/manifest+json',
        };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: '/v5/',
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        mobile: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
        scan: path.resolve(__dirname, 'scan.html'),
      },
    },
  },
  server: {
    host: true,
    https: true,
    fs: { allow: [repoRoot] },
  },
  plugins: [basicSsl(), serveRootAssets()],
  test: {
    environment: 'node',
  },
});
