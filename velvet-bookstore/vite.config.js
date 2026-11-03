import { defineConfig } from 'vite';

export default defineConfig({
  // اجعل روابط الملفات نسبية لتعمل داخل رابط GitHub Pages الخاص بالمستودع.
  base: './',
  publicDir: 'public',
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
