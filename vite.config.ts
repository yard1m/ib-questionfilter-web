import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site is served from https://<user>.github.io/<repo>/
// so the base path must match the repository name exactly.
const repoName = 'ib-questionfilter-web';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? `/${repoName}/` : '/',
  resolve: {
    alias: {
      // jsPDF pulls these in only for doc.html(), which this app never calls.
      html2canvas: '/src/lib/empty-module.ts',
      dompurify: '/src/lib/empty-module.ts',
      canvg: '/src/lib/empty-module.ts',
    },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
