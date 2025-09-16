const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function makeIdleVariantsFor(characterId) {
  const baseNobg = path.join('sprites', characterId, 'idle', 'idle_001_nobg.png');
  const basePlain = path.join('sprites', characterId, 'idle', 'idle_001.png');
  const base = fs.existsSync(baseNobg) ? baseNobg : fs.existsSync(basePlain) ? basePlain : '';
  if (!base) { console.warn(`[${characterId}] no se encontró idle_001(_nobg).png`); return false; }
  const rightDir = path.join('sprites', characterId, 'idle_right');
  const leftDir = path.join('sprites', characterId, 'idle_left');
  ensureDir(rightDir); ensureDir(leftDir);
  const dstRight = path.join(rightDir, 'idle_right_001.png');
  const dstLeft = path.join(leftDir, 'idle_left_001.png');
  // Copia directa para right
  fs.copyFileSync(base, dstRight);
  // Flip horizontal para left
  const img = await Jimp.read(base);
  img.flip(true, false);
  await img.writeAsync(dstLeft);
  console.log(`✔ ${characterId}: idle_right/idle_left sincronizados desde ${path.basename(base)}`);
  return true;
}

(async () => {
  const chars = process.argv.slice(2);
  const list = chars.length ? chars : ['sasuke', 'satoru', 'sukuna'];
  for (const c of list) {
    try { await makeIdleVariantsFor(c); } catch (e) { console.warn(`✖ ${c}:`, e.message); }
  }
})().catch(e => { console.error(e); process.exit(1); });


