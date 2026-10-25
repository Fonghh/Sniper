// Builds a single self-contained page for publishing as a claude.ai Artifact:
// the host supplies <html>/<head>/<body>, so this emits the title, inlined CSS,
// the app markup and the inlined JS bundle.
// Usage: npm run artifact        →  dist/artifact.html (hunting game)
//        npm run artifact:arena  →  dist/arena/artifact.html (arena prototype)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arena = process.argv[2] === 'arena';
const dist = new URL(arena ? '../dist/arena/' : '../dist/', import.meta.url).pathname;
const page = arena ? 'arena.html' : 'index.html';
const assets = readdirSync(join(dist, 'assets'));
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (!js || !css) throw new Error('Run `npm run build` first.');

const html = readFileSync(join(dist, page), 'utf8');
const title = html.match(/<title>(.*?)<\/title>/)[1];
const app = html.slice(html.indexOf('<div id="app">'), html.lastIndexOf('</div>') + '</div>'.length);
// Keep a literal "</script>" inside the bundle from closing the inline script early.
const code = readFileSync(join(dist, 'assets', js), 'utf8').replaceAll('</script', '<\\/script');
const style = readFileSync(join(dist, 'assets', css), 'utf8');

const out = `<title>${title}</title>
<style>
${style}
</style>
${app}
<script type="module">
${code}
</script>
`;
writeFileSync(join(dist, 'artifact.html'), out);
console.log(`${join(dist, 'artifact.html')} ${(out.length / 1024).toFixed(0)} KB`);
