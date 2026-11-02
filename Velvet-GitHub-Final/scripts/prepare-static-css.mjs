import { copyFile, mkdir } from 'node:fs/promises';

// Keep editing the familiar root-level style.css. Copy it to public so Vite
// publishes it with a stable filename instead of a hashed CSS asset URL.
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await copyFile(
  new URL('../style.css', import.meta.url),
  new URL('../public/style.css', import.meta.url)
);
