import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/gridstack/dist/gridstack.min.css');
const dest = join(root, 'static/css/vendor-gridstack.css');

if (!existsSync(src)) {
  console.error('gridstack is not installed. Run: npm install');
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`Copied ${src} -> ${dest}`);
