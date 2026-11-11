// Build the Rust engine for the browser (wasm32) and copy it, with the bundled fonts, into
// public/engine/. Run automatically before `npm run dev` and `npm run build`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'src-tauri', 'crates', 'wcore');
const out = join(root, 'public', 'engine');
const wasm = join(root, 'src-tauri', 'target', 'wasm32-unknown-unknown', 'release', 'wcore.wasm');

// GUI-launched shells and CI may not have cargo on PATH; add the usual rustup locations.
const env = { ...process.env };
const tc = join(homedir(), '.rustup', 'toolchains');
const extra = [join(homedir(), '.cargo', 'bin'), ...(existsSync(tc) ? readdirSync(tc).filter(d => d.startsWith('stable')).map(d => join(tc, d, 'bin')) : [])];
env.PATH = [...extra, env.PATH].join(process.platform === 'win32' ? ';' : ':');

execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '--no-default-features', '-p', 'wcore'], { cwd: crate, stdio: 'inherit', env });
mkdirSync(join(out, 'fonts'), { recursive: true });
copyFileSync(wasm, join(out, 'wcore.wasm'));
let n = 0;
for (const f of readdirSync(join(crate, 'fonts'))) {
  if (!f.endsWith('.ttf')) continue;
  const dst = join(out, 'fonts', f);
  if (!existsSync(dst) || statSync(dst).size !== statSync(join(crate, 'fonts', f)).size) copyFileSync(join(crate, 'fonts', f), dst);
  n++;
}
console.log(`engine: ${(statSync(wasm).size / 1024).toFixed(0)} KB wasm, ${n} fonts → public/engine`);
