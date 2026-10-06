// Copies the production build to the repository root, where GitHub Pages serves it
// ("Deploy from a branch": main, / (root)). Also checks the file is really self-contained.
import { copyFileSync, readFileSync } from 'node:fs';

const built = 'dist/index.html';
const html = readFileSync(built, 'utf8');

const problems = [];
if (!html.includes('<div id="root"></div>')) problems.push('missing #root');
if (/<script[^>]+src=/i.test(html)) problems.push('external <script src> found – the build must be a single file');
if (/<link[^>]+rel="stylesheet"/i.test(html)) problems.push('external stylesheet found – the build must be a single file');
if (html.includes('main.tsx') || html.includes('/src/')) problems.push('development paths leaked into the build');
if (problems.length > 0) {
  console.error(`Build check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

copyFileSync(built, 'index.html');
console.log(`index.html updated (${(html.length / 1024).toFixed(0)} KB, single file)`);
