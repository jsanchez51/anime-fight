const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const WORLDS = {
  leaf: {
    day: 'anime background of Hidden Leaf Village (Konoha), wide landscape, daylight, detailed rooftops, trees, empty scene, no characters, clean composition, high resolution',
    night: 'anime background of Hidden Leaf Village (Konoha) at night, moonlit sky, lanterns, empty scene, no characters, high resolution'
  },
  forest: {
    day: 'anime forest background, tall trees, light rays, empty scene, no characters, high resolution',
    night: 'anime forest background at night, moonlight through trees, fireflies, empty scene, no characters, high resolution'
  },
  desert: {
    day: 'anime desert dunes background, warm colors, oasis far away, empty scene, no characters, high resolution',
    night: 'anime desert background at night, starry sky, dunes silhouettes, empty scene, no characters, high resolution'
  },
  city: {
    day: 'anime city skyline background, blue sky, distant buildings, empty street foreground, no characters, high resolution',
    night: 'anime city skyline background at night, neon lights, night sky, empty street, no characters, high resolution'
  }
};

async function ensureDir(p) { await fs.promises.mkdir(p, { recursive: true }); }

async function downloadImage(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.buffer();
  await fs.promises.writeFile(dest, buf);
}

async function main() {
  const outdir = path.join(process.cwd(), 'assets', 'worlds');
  await ensureDir(outdir);
  for (const [key, prompts] of Object.entries(WORLDS)) {
    for (const tod of ['day', 'night']) {
      const prompt = prompts[tod];
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1600&height=900&model=flux&n=1&seed=${Math.floor(Math.random()*1000000)}`;
      const dest = path.join(outdir, `${key}${tod === 'night' ? '_night' : ''}.png`);
      console.log(`Descargando ${key} ${tod}...`);
      try {
        await downloadImage(url, dest);
        console.log(`✔ ${dest}`);
      } catch (e) {
        console.error(`✖ ${key} ${tod}:`, e.message);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });


