import { defineConfig } from 'vite';

// Two pages: the hunting game (index.html) and the arena prototype (arena.html).
// ENTRY=main / ENTRY=arena build one page alone (one JS chunk) for the single-file artifacts.
const entry = process.env.ENTRY;

export default defineConfig({
  base: './',
  server: { host: true },
  build:
    entry === 'arena'
      ? { outDir: 'dist/arena', rollupOptions: { input: 'arena.html' } }
      : entry === 'main'
        ? { rollupOptions: { input: 'index.html' } }
        : { rollupOptions: { input: { main: 'index.html', arena: 'arena.html' } } },
});
