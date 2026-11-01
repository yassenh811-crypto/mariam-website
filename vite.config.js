import { defineConfig } from 'vite';

export default defineConfig({
  base: '/mariam-website/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});