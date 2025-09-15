const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const PORTRAIT_PROMPTS = {
  naruto: 'Naruto Uzumaki, anime character portrait full body, plain white background, clean cutout, cel shading, consistent with Shippuden outfit, no background elements, high resolution',
  satoru: 'Satoru Gojo, anime character portrait full body, plain white background, clean cutout, cel shading, blindfold, high resolution',
  sukuna: 'Ryomen Sukuna, anime character portrait full body, plain white background, clean cutout, cel shading, high resolution',
  sasuke: 'Sasuke Uchiha, anime character portrait full body, plain white background, clean cutout, cel shading, high resolution',
  nobara: 'Nobara Kugisaki, anime character portrait full body, plain white background, clean cutout, cel shading, hammer and nails, high resolution'
};

async function ensureDir(p) { await fs.promises.mkdir(p, { recursive: true }); }

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP '+res.status);
  const buf = await res.buffer();
  await fs.promises.writeFile(dest, buf);
}

async function main() {
  const outdir = path.join(process.cwd(), 'assets', 'portraits');
  await ensureDir(outdir);
  for (const [id, prompt] of Object.entries(PORTRAIT_PROMPTS)) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=768&model=flux&n=1&seed=${Math.floor(Math.random()*1000000)}`;
    const dest = path.join(outdir, `${id}.png`);
    console.log('Descargando', id);
    try { await download(url, dest); console.log('✔', dest); } catch (e) { console.error('✖', id, e.message); }
  }
}

main().catch(e => { console.error(e); process.exit(1); });


