const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { actions: [], targetW: 512, targetH: 768, bodyH: 700, bottomPad: 20 };
  const names = [];
  for (const a of args) {
    if (a.startsWith('--actions=')) opts.actions = a.split('=')[1].split(',');
    else if (a.startsWith('--targetW=')) opts.targetW = Number(a.split('=')[1]) || 512;
    else if (a.startsWith('--targetH=')) opts.targetH = Number(a.split('=')[1]) || 768;
    else if (a.startsWith('--bodyH=')) opts.bodyH = Number(a.split('=')[1]) || 700;
    else if (a.startsWith('--bottomPad=')) opts.bottomPad = Number(a.split('=')[1]) || 20;
    else names.push(a);
  }
  opts.characters = names.length ? names : [];
  return opts;
}

async function normalizeImage(filePath, { targetW, targetH, bodyH, bottomPad }) {
  const img = await Jimp.read(filePath);
  const { width: w, height: h, data } = img.bitmap;
  // bounding box of non-transparent pixels
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) * 4 + 3; // alpha
      if (data[idx] > 10) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return; // blank
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const crop = img.clone().crop(minX, minY, bw, bh);
  // scale to target body height
  const scale = bodyH / bh;
  crop.scale(scale);
  // compose on canvas
  const canvas = await new Jimp(targetW, targetH, 0x00000000);
  const dx = Math.round((targetW - crop.bitmap.width) / 2);
  const dy = targetH - bottomPad - crop.bitmap.height;
  canvas.composite(crop, dx, dy);
  await canvas.writeAsync(filePath);
}

async function main() {
  const { characters, actions, targetW, targetH, bodyH, bottomPad } = parseArgs();
  if (!characters.length) { console.error('Uso: node scripts/normalize-sprites.js <char ...> --actions=run,walk'); process.exit(1); }
  for (const ch of characters) {
    for (const action of actions) {
      const dir = path.join('sprites', ch, action);
      if (!fs.existsSync(dir)) continue;
      const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.png')).sort();
      for (const f of files) {
        const p = path.join(dir, f);
        try {
          await normalizeImage(p, { targetW, targetH, bodyH, bottomPad });
          console.log('✔', p);
        } catch (e) {
          console.error('✖', p, e.message);
        }
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });


