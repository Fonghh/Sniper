// Builds a single self-contained page for publishing as a claude.ai Artifact:
// the host supplies <html>/<head>/<body>, so this emits the title, inlined CSS,
// the app markup and the inlined JS bundle.
// Usage: npm run build && node scripts/artifact.mjs  →  dist/artifact.html
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const assets = readdirSync(join(dist, 'assets'));
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (!js || !css) throw new Error('Run `npm run build` first.');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const app = html.slice(html.indexOf('<div id="app">'), html.lastIndexOf('</div>') + '</div>'.length);
// Keep a literal "</script>" inside the bundle from closing the inline script early.
const code = readFileSync(join(dist, 'assets', js), 'utf8').replaceAll('</script', '<\\/script');
const style = readFileSync(join(dist, 'assets', css), 'utf8');

const page = `<title>Sniper 狩獵</title>
<style>
${style}
</style>
${app}
<script type="module">
${code}
</script>
`;
writeFileSync(join(dist, 'artifact.html'), page);
console.log(`dist/artifact.html ${(page.length / 1024).toFixed(0)} KB`);
