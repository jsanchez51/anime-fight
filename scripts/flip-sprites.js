const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { in: '', out: '', pattern: '*.png', renamePrefix: '', force: false };
  for (const a of args) {
    if (a.startsWith('--in=')) opts.in = a.slice(5);
    else if (a.startsWith('--out=')) opts.out = a.slice(6);
    else if (a.startsWith('--pattern=')) opts.pattern = a.slice(10);
    else if (a.startsWith('--rename-prefix=')) opts.renamePrefix = a.slice(16);
    else if (a === '--force') opts.force = true;
    else if (!opts.in) opts.in = a; // positional input
    else if (!opts.out) opts.out = a; // positional output
  }
  if (!opts.in) throw new Error('Usage: node scripts/flip-sprites.js <input-file-or-dir> [out-dir-or-file] [--rename-prefix=idle_right_]');
  return opts;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function flipFile(src, dst) {
  const img = await Jimp.read(src);
  img.flip(true, false);
  await img.writeAsync(dst);
  console.log(`✔ flipped ${src} -> ${dst}`);
}

function listPngs(dir, pattern) {
  const rx = new RegExp('^' + pattern.replace('*', '.*') + '$');
  return fs.readdirSync(dir).filter(f => rx.test(f) && f.toLowerCase().endsWith('.png'));
}

(async () => {
  const opts = parseArgs();
  const inPath = path.resolve(opts.in);
  const stat = fs.statSync(inPath);
  if (stat.isDirectory()) {
    const outDir = path.resolve(opts.out || inPath + '_flipped');
    ensureDir(outDir);
    const files = listPngs(inPath, opts.pattern);
    for (const f of files) {
      const name = opts.renamePrefix ? opts.renamePrefix + f.replace(/^.*?_/, '') : f;
      const dst = path.join(outDir, name);
      if (!opts.force && fs.existsSync(dst)) { console.log(`skip ${dst}`); continue; }
      await flipFile(path.join(inPath, f), dst);
    }
  } else {
    const outFile = path.resolve(opts.out || inPath.replace(/\.png$/i, '_flipped.png'));
    ensureDir(path.dirname(outFile));
    await flipFile(inPath, outFile);
  }
})().catch(err => { console.error(err); process.exit(1); });


