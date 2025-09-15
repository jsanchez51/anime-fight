const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const Jimp = require('jimp');
const { PROMPTS, generateImage } = require('../lib/generate');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function downloadImage(url, destPath, retries = 4) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fallo al descargar ${url}: ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.promises.writeFile(destPath, buffer);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(`retry ${attempt + 1}/${retries - 1} en ${Math.round(delay / 1000)}s -> ${path.basename(destPath)}`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

const DEFAULT_ACTIONS = {
  idle: 'idle pose, facing right, neutral stance, centered, sprite',
  idle_right: 'idle pose, facing right, neutral stance, centered, sprite',
  idle_left: 'idle pose, facing left, neutral stance, centered, sprite',
  walk: 'walking cycle frame, right facing, legs mid-step, sprite',
  run: 'running cycle frame, athletic posture, forward lean, consistent limb lengths, clean silhouette, high readability, sprite',
  attack1: 'attack animation frame, melee strike, right facing, sprite',
  attack2: 'attack animation frame, special skill, right facing, sprite',
  jump: 'jump animation frame, mid-air pose, sprite',
  crouch: 'crouching pose, knees bent, low profile, ready stance, sprite',
  slide: 'sliding move frame, low profile dash, forward momentum, sprite',
  hit: 'hit reaction frame, recoiling, sprite',
  death: 'death animation frame, falling, sprite',
  victory: 'victory pose frame, celebratory stance, sprite'
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { frames: 4, outdir: 'sprites', actions: Object.keys(DEFAULT_ACTIONS), force: false, removeBg: false, ensureSingle: true };
  const names = [];
  for (const arg of args) {
    if (arg.startsWith('--frames=')) options.frames = Number(arg.split('=')[1]) || 4;
    else if (arg.startsWith('--outdir=')) options.outdir = arg.split('=')[1] || 'sprites';
    else if (arg.startsWith('--actions=')) options.actions = arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--width=')) options.width = Number(arg.split('=')[1]) || undefined;
    else if (arg.startsWith('--height=')) options.height = Number(arg.split('=')[1]) || undefined;
    else if (arg === '--force') options.force = true;
    else if (arg === '--remove-bg' || arg === '--removeBg') options.removeBg = true;
    else if (arg === '--no-ensure-single') options.ensureSingle = false;
    else names.push(arg);
  }
  options.characters = names.length ? names : Object.keys(PROMPTS);
  return options;
}

async function edgeKeyBackground(filePath, opts = {}) {
  const { edgeSample = 6, threshold = 46, softness = 28 } = opts;
  const img = await Jimp.read(filePath);
  const { width: w, height: h } = img.bitmap;
  let rs = 0, gs = 0, bs = 0, n = 0;
  const sampleStepX = Math.max(1, Math.floor(w / (edgeSample * 4)));
  const sampleStepY = Math.max(1, Math.floor(h / (edgeSample * 4)));
  for (let x = 0; x < w; x += sampleStepX) { const i1 = img.getPixelIndex(x, 0), i2 = img.getPixelIndex(x, h - 1); rs += img.bitmap.data[i1] + img.bitmap.data[i2]; gs += img.bitmap.data[i1+1] + img.bitmap.data[i2+1]; bs += img.bitmap.data[i1+2] + img.bitmap.data[i2+2]; n += 2; }
  for (let y = 0; y < h; y += sampleStepY) { const i1 = img.getPixelIndex(0, y), i2 = img.getPixelIndex(w - 1, y); rs += img.bitmap.data[i1] + img.bitmap.data[i2]; gs += img.bitmap.data[i1+1] + img.bitmap.data[i2+1]; bs += img.bitmap.data[i1+2] + img.bitmap.data[i2+2]; n += 2; }
  const R = rs / n, G = gs / n, B = bs / n;
  const t1 = threshold, t2 = threshold + softness;
  img.scan(0, 0, w, h, function(x, y, idx) {
    const r = this.bitmap.data[idx + 0];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    const a = this.bitmap.data[idx + 3];
    const dr = r - R, dg = g - G, db = b - B;
    const dist = Math.sqrt(dr*dr + dg*dg + db*db);
    if (dist <= t1) {
      this.bitmap.data[idx + 3] = 0;
    } else if (dist <= t2) {
      const k = (dist - t1) / (t2 - t1); // 0..1
      this.bitmap.data[idx + 3] = Math.max(0, Math.min(255, Math.round(a * k)));
    }
  });
  await img.writeAsync(filePath);
}

async function main() {
  const { characters, actions, frames, outdir, width, height, force, removeBg, ensureSingle } = parseArgs();
  console.log(`Generando sprites: chars=${characters.join(', ')} actions=${actions.join(', ')} frames=${frames}`);
  ensureDir(outdir);
  const manifestPath = path.join(outdir, 'seeds.json');
  let seeds = {};
  if (fs.existsSync(manifestPath)) {
    try { seeds = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')); } catch {}
  }
  const getKey = (c, a, i) => `${c}/${a}/${i}`;
  const baseSeedByChar = {};
  for (const characterId of characters) {
    const basePrompt = PROMPTS[characterId];
    if (!basePrompt) {
      console.warn(`Personaje desconocido: ${characterId}, saltando.`);
      continue;
    }
    // semilla base fija por personaje para consistencia entre acciones
    if (!Number.isInteger(baseSeedByChar[characterId])) baseSeedByChar[characterId] = Math.floor(Math.random() * 1000000);
    for (const action of actions) {
      const actionHint = DEFAULT_ACTIONS[action] || `${action} animation frame, sprite`;
      const dir = path.join(outdir, characterId, action);
      ensureDir(dir);
      for (let i = 1; i <= frames; i++) {
        const num = String(i).padStart(3, '0');
        const filename = `${action}_${num}.png`;
        const dest = path.join(dir, filename);
        const prompt = `${basePrompt}, ${actionHint}, solid pure white background (#ffffff), high-key studio, SINGLE SUBJECT, no background elements, centered full body, feet visible, no shadows, no floor shadow, no pedestal, no base, character cutout, high contrast, cel shading, no text, no watermark`;
        try {
          if (fs.existsSync(dest) && !force) {
            console.log(`↷ skip (existe) ${characterId}/${action}/${filename}`);
            if (removeBg) { try { await edgeKeyBackground(dest); } catch {} }
            continue;
          }
          const key = getKey(characterId, action, i);
          let seed = Number.isInteger(seeds[key]) ? seeds[key] : baseSeedByChar[characterId] + i;
          seeds[key] = seed;
          let attempts = 0;
          const maxAttempts = ensureSingle ? 4 : 1;
          while (true) {
            const imageUrl = await generateImage(prompt, { width, height, seed });
            await downloadImage(imageUrl, dest);
            if (!ensureSingle) break;
            try {
              const multi = await hasMultipleSubjects(dest);
              if (!multi) break;
              attempts++;
              if (attempts >= maxAttempts) break;
              seed += 97; // cambia semilla ligeramente
              console.warn(`↺ detectado múltiple sujeto, reintentando con seed=${seed}`);
            } catch {}
          }
          if (removeBg) { try { await edgeKeyBackground(dest); } catch {} }
          console.log(`✔ ${characterId}/${action}/${filename}`);
        } catch (e) {
          console.error(`✖ Error en ${characterId}/${action}/${filename}:`, e.message || e);
        }
      }
    }
  }
  try { await fs.promises.writeFile(manifestPath, JSON.stringify(seeds, null, 2), 'utf8'); } catch {}
}

// Heurística simple: detectar si hay más de un sujeto sobre fondo blanco.
async function hasMultipleSubjects(filePath) {
  const img = await Jimp.read(filePath);
  const { width: w, height: h } = img.bitmap;
  const visited = new Uint8Array(w * h);
  const idxOf = (x, y) => y * w + x;
  const isForeground = (x, y) => {
    const i = img.getPixelIndex(x, y);
    const r = img.bitmap.data[i], g = img.bitmap.data[i+1], b = img.bitmap.data[i+2];
    // distancia a blanco
    const dr = 255 - r, dg = 255 - g, db = 255 - b;
    const dist = Math.sqrt(dr*dr + dg*dg + db*db);
    return dist > 25; // >25 considera no-blanco
  };
  function bfs(sx, sy) {
    const q = [[sx, sy]]; visited[idxOf(sx, sy)] = 1; let area = 0;
    while (q.length) {
      const [x, y] = q.pop(); area++;
      if (x > 0 && !visited[idxOf(x-1, y)] && isForeground(x-1, y)) { visited[idxOf(x-1, y)] = 1; q.push([x-1, y]); }
      if (x < w-1 && !visited[idxOf(x+1, y)] && isForeground(x+1, y)) { visited[idxOf(x+1, y)] = 1; q.push([x+1, y]); }
      if (y > 0 && !visited[idxOf(x, y-1)] && isForeground(x, y-1)) { visited[idxOf(x, y-1)] = 1; q.push([x, y-1]); }
      if (y < h-1 && !visited[idxOf(x, y+1)] && isForeground(x, y+1)) { visited[idxOf(x, y+1)] = 1; q.push([x, y+1]); }
    }
    return area;
  }
  let components = 0; const minArea = Math.floor((w * h) * 0.02); // 2% del área
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const id = idxOf(x, y);
      if (visited[id]) continue;
      if (!isForeground(x, y)) { visited[id] = 1; continue; }
      const area = bfs(x, y);
      if (area >= minArea) components++;
      if (components > 1) return true;
    }
  }
  return false;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});


