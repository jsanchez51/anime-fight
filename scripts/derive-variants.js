const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { char: '', src: '', actions: ['idle','idle_left','idle_right','walk','run','attack1','attack2','jump','crouch','slide','hit','death','victory'], outdir: 'sprites', frames: 1, force: false, bg: 'white' };
  for (const a of args) {
    if (!opts.char && !a.startsWith('--')) { opts.char = a; continue; }
    if (a.startsWith('--src=')) opts.src = a.slice(6);
    else if (a.startsWith('--actions=')) opts.actions = a.slice(10).split(',').map(s=>s.trim()).filter(Boolean);
    else if (a.startsWith('--outdir=')) opts.outdir = a.slice(9);
    else if (a.startsWith('--frames=')) opts.frames = Math.max(1, parseInt(a.slice(9),10)||1);
    else if (a.startsWith('--bg=')) opts.bg = a.slice(5);
    else if (a === '--force') opts.force = true;
  }
  if (!opts.char) throw new Error('Usage: node scripts/derive-variants.js <charId> [--src=path/to/base.png] [--actions=comma] [--outdir=sprites] [--frames=1] [--bg=white|transparent] [--force]');
  if (!opts.src) opts.src = path.join('sprites', opts.char, 'idle', 'idle_001.png');
  return opts;
}

async function loadBase(src) {
  const img = await Jimp.read(src);
  return img;
}

function createCanvasLike(base, bgMode) {
  const w = base.bitmap.width, h = base.bitmap.height;
  if (bgMode === 'white') return new Jimp(w, h, 0xffffffff);
  return new Jimp(w, h, 0x00000000);
}

async function writeFrame(dst, img) {
  ensureDir(path.dirname(dst));
  await img.writeAsync(dst);
  console.log(`✔ ${dst}`);
}

function cloneWithAlpha(image, alpha) {
  const c = image.clone();
  c.scan(0, 0, c.bitmap.width, c.bitmap.height, function(x, y, idx) {
    this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * alpha);
  });
  return c;
}

async function addTrail(canvas, base, steps, dx, dy, alphaStart, blurPx = 0) {
  for (let s = steps; s >= 1; s--) {
    let ghost = cloneWithAlpha(base, alphaStart * (s / steps));
    if (blurPx > 0) ghost = await ghost.clone().gaussian(blurPx);
    const gx = Math.round((canvas.bitmap.width - ghost.bitmap.width) / 2 - dx * s);
    const gy = Math.round((canvas.bitmap.height - ghost.bitmap.height) + dy * s);
    canvas.composite(ghost, gx, gy, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1 });
  }
}

async function addSpeedLines(canvas, orientation = 'right', count = 8, color = 0xFFFFFFFF) {
  for (let i = 0; i < count; i++) {
    const length = Math.round(canvas.bitmap.width * (0.3 + Math.random() * 0.4));
    const thickness = 2 + Math.round(Math.random() * 3);
    const line = new Jimp(length, thickness, color);
    const y = Math.round(canvas.bitmap.height * 0.2 + Math.random() * canvas.bitmap.height * 0.6);
    let x = Math.round(canvas.bitmap.width * 0.55 + Math.random() * canvas.bitmap.width * 0.35);
    let rot = 0;
    if (orientation === 'right') { rot = 0; }
    if (orientation === 'left') { rot = 180; x = Math.round(canvas.bitmap.width * 0.1); }
    if (orientation === 'up') { rot = -90; x = Math.round(canvas.bitmap.width * 0.3 + Math.random() * canvas.bitmap.width * 0.4); }
    if (orientation === 'down') { rot = 90; x = Math.round(canvas.bitmap.width * 0.3 + Math.random() * canvas.bitmap.width * 0.4); }
    const rl = line.rotate(rot, false).opacity(0.25);
    canvas.composite(rl, x, y);
  }
}

async function addGroundShadow(canvas, widthRatio = 0.45, opacity = 0.25) {
  const w = canvas.bitmap.width;
  const h = canvas.bitmap.height;
  const sw = Math.round(w * widthRatio);
  const sh = Math.max(6, Math.round(h * 0.035));
  let shadow = new Jimp(sw, sh, 0x000000FF).opacity(opacity).gaussian(8);
  const x = Math.round((w - sw) / 2);
  const y = Math.round(h - sh * 2);
  canvas.composite(shadow, x, y);
}

async function addSlash(canvas, diagonal = 'forward') {
  const w = canvas.bitmap.width, h = canvas.bitmap.height;
  const slash = new Jimp(Math.round(w * 0.9), 6, 0xFFFFFFFF).opacity(0.8).gaussian(2);
  const rot = diagonal === 'forward' ? -25 : 25;
  const rs = slash.rotate(rot, false);
  const x = Math.round(w * 0.1);
  const y = Math.round(h * 0.35);
  canvas.composite(rs, x, y);
}

function transform(base, action, frameIdx, frames, bgMode) {
  const w = base.bitmap.width, h = base.bitmap.height;
  const canvas = createCanvasLike(base, bgMode);
  let clone = base.clone();
  let dx = 0, dy = 0;

  switch (action) {
    case 'idle': {
      // sin cambios
      break;
    }
    case 'idle_right': {
      // copia directa
      break;
    }
    case 'idle_left': {
      clone = clone.flip(true, false);
      break;
    }
    case 'crouch': {
      const scale = 0.78;
      clone = clone.scale(scale, Jimp.RESIZE_BEZIER);
      dy = Math.round(h - clone.bitmap.height);
      break;
    }
    case 'jump': {
      dy = -Math.round(h * 0.12);
      clone = clone.rotate(-3 + (frameIdx%2?2:0), false);
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
      const tilt = 6;
      const shift = Math.round(((frameIdx % 2) ? 1 : -1) * w * 0.03);
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
      clone = clone.brightness(-0.15).contrast(0.25).rotate(10, false);
      dx = -Math.round(w * 0.04);
      break;
    }
    case 'attack1': {
      clone = clone.rotate(-10 + (frameIdx*3), false).contrast(0.15);
      dx = Math.round(w * 0.02 * frameIdx);
      break;
    }
    case 'attack2': {
      clone = clone.rotate(8 - (frameIdx*2), false).brightness(0.05);
      dx = -Math.round(w * 0.02 * frameIdx);
      break;
    }
    case 'victory': {
      clone = clone.brightness(0.12).contrast(0.12);
      break;
    }
    case 'death': {
      clone = clone.rotate(90, false).brightness(-0.1);
      dy = Math.round(h * 0.1);
      break;
    }
    default: {
      break;
    }
  }

  const x = Math.round((w - clone.bitmap.width) / 2 + dx);
  const y = Math.round((h - clone.bitmap.height) + dy);
  canvas.composite(clone, x, y, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1 });

  // Post-efectos por acción
  switch (action) {
    case 'walk':
      // trail sutil
      return addTrail(canvas, clone, 2, -w * 0.02, 0, 0.35, 2).then(() => canvas);
    case 'run':
      return addTrail(canvas, clone, 3, -w * 0.05, 0, 0.30, 3).then(() => addSpeedLines(canvas, 'right', 10).then(() => canvas));
    case 'jump':
      return addTrail(canvas, clone, 2, 0, h * 0.06, 0.28, 2).then(() => addGroundShadow(canvas, 0.35, 0.20).then(() => canvas));
    case 'slide':
      return addTrail(canvas, clone, 3, -w * 0.06, 0, 0.25, 2).then(() => addSpeedLines(canvas, 'right', 6).then(() => canvas));
    case 'attack1':
      return addSlash(canvas, 'forward').then(() => canvas);
    case 'attack2':
      return addSlash(canvas, 'back').then(() => addSpeedLines(canvas, 'right', 6, 0x66FFFFFF).then(() => canvas));
    case 'hit':
      return addTrail(canvas, clone, 2, w * 0.04, 0, 0.25, 2).then(() => canvas);
    case 'victory':
      return canvas;
    case 'death':
      return addGroundShadow(canvas, 0.5, 0.18).then(() => canvas);
    default:
      return canvas;
  }
}

(async () => {
  const opts = parseArgs();
  const base = await loadBase(opts.src);
  for (const action of opts.actions) {
    for (let i = 1; i <= opts.frames; i++) {
      const frame = await transform(base, action, i - 1, opts.frames, opts.bg);
      const fname = `${action}_${String(i).padStart(3,'0')}.png`;
      const outDir = path.join(opts.outdir, opts.char, action);
      const outPath = path.join(outDir, fname);
      if (!opts.force && fs.existsSync(outPath)) { console.log(`skip ${outPath}`); continue; }
      await writeFrame(outPath, frame);
    }
  }
})().catch(err => { console.error(err); process.exit(1); });


