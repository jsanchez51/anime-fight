const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function loadImagesFromDir(dir, preferNobg = true) {
  const all = (await fs.promises.readdir(dir)).filter(f => f.toLowerCase().endsWith('.png')).sort();
  const nobg = all.filter(f => f.toLowerCase().includes('nobg'));
  const files = preferNobg ? (nobg.length ? nobg : all) : all.filter(f => !f.toLowerCase().includes('nobg'));
  const images = [];
  for (const file of files) {
    const p = path.join(dir, file);
    const img = await Jimp.read(p);
    images.push({ name: file, image: img });
  }
  return images;
}

async function buildSheetForAction(inputDir, outPng, outJson, options = {}) {
  const margin = options.margin || 2;
  const images = await loadImagesFromDir(inputDir, options.preferNobg !== false);
  if (!images.length) return false;

  // Usa el tamaño del primer frame como referencia
  const frameWidth = images[0].image.bitmap.width;
  const frameHeight = images[0].image.bitmap.height;
  const cols = options.cols || images.length; // una fila por defecto
  const rows = Math.ceil(images.length / cols);

  const sheetWidth = cols * frameWidth + (cols + 1) * margin;
  const sheetHeight = rows * frameHeight + (rows + 1) * margin;
  const sheet = new Jimp(sheetWidth, sheetHeight, 0x00000000);

  const frames = [];
  for (let i = 0; i < images.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (frameWidth + margin);
    const y = margin + row * (frameHeight + margin);
    sheet.composite(images[i].image, x, y);
    frames.push({
      filename: images[i].name,
      frame: { x, y, w: frameWidth, h: frameHeight },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
      sourceSize: { w: frameWidth, h: frameHeight }
    });
  }

  ensureDir(path.dirname(outPng));
  if (!options.force && fs.existsSync(outPng) && fs.existsSync(outJson)) return true; // cache
  await sheet.writeAsync(outPng);
  const atlas = {
    frames,
    meta: {
      app: 'spritebuilder',
      version: '1.0',
      image: path.basename(outPng),
      size: { w: sheetWidth, h: sheetHeight },
      scale: '1'
    }
  };
  await fs.promises.writeFile(outJson, JSON.stringify(atlas, null, 2), 'utf8');
  return true;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { root: 'sprites', outdir: 'sheets', cols: 8, margin: 2, force: false, preferNobg: true };
  const names = [];
  for (const arg of args) {
    if (arg.startsWith('--root=')) options.root = arg.split('=')[1];
    else if (arg.startsWith('--outdir=')) options.outdir = arg.split('=')[1];
    else if (arg.startsWith('--cols=')) options.cols = Number(arg.split('=')[1]) || 8;
    else if (arg.startsWith('--margin=')) options.margin = Number(arg.split('=')[1]) || 2;
    else if (arg === '--force') options.force = true;
    else if (arg === '--prefer-nobg=false') options.preferNobg = false;
    else names.push(arg);
  }
  options.characters = names.length ? names : fs.existsSync(options.root) ? fs.readdirSync(options.root) : [];
  return options;
}

async function main() {
  const { root, outdir, cols, margin, characters, force, preferNobg } = parseArgs();
  if (!characters.length) {
    console.error('No se encontraron personajes. Ejecuta primero el batch de sprites.');
    process.exit(1);
  }
  for (const characterId of characters) {
    const charDir = path.join(root, characterId);
    if (!fs.existsSync(charDir)) continue;
    const actions = fs.readdirSync(charDir).filter(d => fs.statSync(path.join(charDir, d)).isDirectory());
    for (const action of actions) {
      const inputDir = path.join(charDir, action);
      const outPng = path.join(outdir, characterId, `${action}.png`);
      const outJson = path.join(outdir, characterId, `${action}.json`);
      const ok = await buildSheetForAction(inputDir, outPng, outJson, { cols, margin, force, preferNobg });
      if (ok) {
        console.log(`✔ spritesheet ${characterId}/${action}`);
      } else {
        console.log(`(sin frames) ${characterId}/${action}`);
      }
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});


