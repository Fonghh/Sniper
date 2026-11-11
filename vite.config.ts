import { defineConfig } from 'vite';

// Pages: the hunting game (index.html), the arena prototype (arena.html), the ski run
// (ski.html) and the archer wave shooter (archer.html). ENTRY=main / arena / ski / archer
// builds one page alone (one JS chunk) for the single-file artifacts.
const entry = process.env.ENTRY;

export default defineConfig({
  base: './',
  server: { host: true },
  build:
    entry === 'arena' || entry === 'ski' || entry === 'archer'
      ? { outDir: `dist/${entry}`, rollupOptions: { input: `${entry}.html` } }
      : entry === 'main'
        ? { rollupOptions: { input: 'index.html' } }
        : { rollupOptions: { input: { main: 'index.html', arena: 'arena.html', ski: 'ski.html', archer: 'archer.html' } } },
});
