/**
 * Shared by every kit's builder: turns a kit's plain-ESM `src/core` modules
 * into the single block of JavaScript that goes into its Code nodes.
 *
 * The bundler strips the module syntax and concatenates, which is sound because
 * the core has no cycles and no name collisions (asserted here).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KITS_ROOT = join(ROOT, 'kits', 'uk-accountancy');

/**
 * @param {object} opts
 * @param {string} opts.kitDir   absolute path of the kit
 * @param {string[]} opts.modules core module file names, in dependency order
 * @param {(name:string, src:string)=>string} [opts.pre]  runs before import/export stripping
 * @param {(name:string, src:string)=>string} [opts.post] runs after stripping
 */
export function bundleCore({ kitDir, modules, pre, post }) {
  const core = join(kitDir, 'src', 'core');
  const declared = new Set();
  const parts = [];

  for (const name of modules) {
    let src = readFileSync(join(core, name), 'utf8');
    if (pre) src = pre(name, src);
    src = src.replace(/^\s*import[^;]*;\s*$/gm, '');
    src = src.replace(/^export\s+/gm, '');
    if (post) src = post(name, src);
    for (const m of src.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (declared.has(m[1])) {
        throw new Error(`duplicate top-level name "${m[1]}" in ${name}; the bundle would shadow it`);
      }
      declared.add(m[1]);
    }
    parts.push(`// ---- ${name} ----\n${src.trim()}`);
  }
  return parts.join('\n\n');
}
