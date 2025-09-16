const fs = require('fs');
const path = require('path');
const { edgeKeyBackground } = require('./remove-bg');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dir: '', out: '', recursive: false, copy: true };
  for (const a of args) {
    if (!opts.dir && !a.startsWith('--')) { opts.dir = a; continue; }
    if (a.startsWith('--out=')) opts.out = a.slice(6);
    else if (a === '--recursive') opts.recursive = true;
    else if (a === '--inplace') opts.copy = false; // sobreescribe
    else if (a === '--copy') opts.copy = true; // (por defecto)
  }
  if (!opts.dir) {
    console.error('Uso: node scripts/rm-bg-folder.js <carpeta> [--out=carpeta_salida] [--recursive] [--inplace|--copy]');
    process.exit(1);
  }
  return opts;
}

function listImages(dir, recursive) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (recursive) out.push(...listImages(p, recursive));
      continue;
    }
    const low = it.name.toLowerCase();
    if (low.endsWith('.png') || low.endsWith('.jpg') || low.endsWith('.jpeg')) out.push(p);
  }
  return out;
}

(async () => {
  const opts = parseArgs();
  const root = path.resolve(opts.dir);
  const outDir = opts.out ? path.resolve(opts.out) : root;
  if (opts.out) ensureDir(outDir);

  const files = listImages(root, opts.recursive).filter(f => !/_nobg\.png$/i.test(f));
  if (!files.length) { console.log('No se encontraron imágenes.'); return; }

  let ok = 0;
  for (const src of files) {
    try {
      const img = await edgeKeyBackground(src);
      const base = path.parse(src).name;
      const rel = path.relative(root, path.dirname(src));
      const targetDir = opts.out ? path.join(outDir, rel) : path.dirname(src);
      ensureDir(targetDir);
      const outName = opts.copy ? `${base}_nobg.png` : `${base}.png`;
      const outPath = path.join(targetDir, outName);
      await img.writeAsync(outPath);
      ok++;
      if (ok % 20 === 0) console.log(`✔ procesadas ${ok}/${files.length}`);
    } catch (e) {
      console.warn(`falló ${src}: ${e.message}`);
    }
  }
  console.log(`✔ Completado: ${ok}/${files.length} imágenes procesadas`);
})().catch(e => { console.error(e); process.exit(1); });


