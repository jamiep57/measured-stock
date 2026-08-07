import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const ADMIN_ROUTE_RE =
  /^\/(?:library|kit-library|suppliers|warehouses|volume-pools|users|case-sizes|bugs|dev(?:\/.*)?|settings(?:\/.*)?|events(?:\/.*)?)?$/;

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
        if (url === '/__dev-lan') {
          sendLanOrigins(req, res);
          return;
        }
        if (url === '/login' || url === '/login.html') {
          const filePath = path.join(repoRoot, 'login.html');
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        if (url === '/setup' || url === '/setup.html') {
          const filePath = path.join(repoRoot, 'setup.html');
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        if (url === '/onboard' || url === '/onboard.html') {
          const filePath = path.join(repoRoot, 'onboard.html');
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        if (url === '/' || (ADMIN_ROUTE_RE.test(url) && !path.extname(url))) {
          req.url = '/admin.html';
        }
        if ((url === '/app' || url === '/app/') && !path.extname(url)) {
          req.url = '/app.html';
        }
        if ((url === '/scan' || url === '/scan/') && !path.extname(url)) {
          req.url = '/scan.html';
        }
        next();
      });
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        if (!url.startsWith('/assets/')) return next();
        const filePath = path.join(repoRoot, url.slice(1));
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
  base: '/',
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'static',
    rollupOptions: {
      input: {
        admin: path.resolve(__dirname, 'admin.html'),
        app: path.resolve(__dirname, 'app.html'),
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
