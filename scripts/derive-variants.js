const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { char: '', src: '', actions: ['crouch','jump'], outdir: 'sprites', frames: 1, force: false };
  for (const a of args) {
    if (!opts.char && !a.startsWith('--')) { opts.char = a; continue; }
    if (a.startsWith('--src=')) opts.src = a.slice(6);
    else if (a.startsWith('--actions=')) opts.actions = a.slice(10).split(',').map(s=>s.trim()).filter(Boolean);
    else if (a.startsWith('--outdir=')) opts.outdir = a.slice(9);
    else if (a.startsWith('--frames=')) opts.frames = Math.max(1, parseInt(a.slice(9),10)||1);
    else if (a === '--force') opts.force = true;
  }
  if (!opts.char) throw new Error('Usage: node scripts/derive-variants.js <charId> [--src=path/to/base.png] [--actions=crouch,jump] [--outdir=sprites] [--frames=1] [--force]');
  if (!opts.src) opts.src = path.join('sprites', opts.char, 'idle', 'idle_001.png');
  return opts;
}

async function loadBase(src) {
  const img = await Jimp.read(src);
  return img;
}

function createCanvasLike(base) {
  return new Jimp(base.bitmap.width, base.bitmap.height, 0x00000000);
}

async function writeFrame(dst, img) {
  ensureDir(path.dirname(dst));
  await img.writeAsync(dst);
  console.log(`✔ ${dst}`);
}

function transform(base, action, frameIdx, frames) {
  const w = base.bitmap.width, h = base.bitmap.height;
  const canvas = createCanvasLike(base);
  let clone = base.clone();
  let dx = 0, dy = 0;

  switch (action) {
    case 'crouch': {
      const scale = 0.78;
      clone = clone.scale(scale, Jimp.RESIZE_BEZIER);
      dy = Math.round(h - clone.bitmap.height);
      break;
    }
    case 'jump': {
      dy = -Math.round(h * 0.12);
      clone = clone.rotate(-3, false);
      break;
    }
    case 'run': {
      const tilt = 8;
      const shift = Math.round(((frameIdx % 2) ? 1 : -1) * w * 0.02);
      clone = clone.rotate(-tilt, false);
      dx = shift;
      break;
    }
    case 'walk': {
      const tilt = 4;
      const shift = Math.round(((frameIdx % 2) ? 1 : -1) * w * 0.015);
      clone = clone.rotate(-tilt, false);
      dx = shift;
      break;
    }
    case 'slide': {
      const scaleY = 0.6;
      clone = clone.scale(1, scaleY);
      dy = Math.round(h - clone.bitmap.height);
      dx = Math.round(w * 0.04);
      break;
    }
    case 'hit': {
      clone = clone.brightness(-0.1).contrast(0.2).rotate(6, false);
      break;
    }
    case 'victory': {
      clone = clone.brightness(0.05).contrast(0.1);
      break;
    }
    default: {
      break;
    }
  }

  const x = Math.round((w - clone.bitmap.width) / 2 + dx);
  const y = Math.round((h - clone.bitmap.height) + dy);
  canvas.composite(clone, x, y, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1 });
  return canvas;
}

(async () => {
  const opts = parseArgs();
  if (opts.char.toLowerCase() !== 'nobara') {
    console.log('Seguridad: este script de prueba sólo actúa sobre nobara.');
    return;
  }
  const base = await loadBase(opts.src);
  for (const action of opts.actions) {
    for (let i = 1; i <= opts.frames; i++) {
      const frame = transform(base, action, i - 1, opts.frames);
      const fname = `${action}_${String(i).padStart(3,'0')}.png`;
      const outDir = path.join(opts.outdir, opts.char, action);
      const outPath = path.join(outDir, fname);
      if (!opts.force && fs.existsSync(outPath)) { console.log(`skip ${outPath}`); continue; }
      await writeFrame(outPath, frame);
    }
  }
})().catch(err => { console.error(err); process.exit(1); });


