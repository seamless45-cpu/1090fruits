import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'dev.html')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  plugins: [
    {
      name: 'dev-html-rewrite',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            req.url = '/dev.html';
          }
          next();
        });
      },
      closeBundle() {
        // Ensure dist/index.html exists from dev.html
        const devHtmlPath = resolve(import.meta.dirname, 'dist/dev.html');
        const indexHtmlPath = resolve(import.meta.dirname, 'dist/index.html');
        if (fs.existsSync(devHtmlPath)) {
          fs.copyFileSync(devHtmlPath, indexHtmlPath);
        }
      }
    }
  ]
});
