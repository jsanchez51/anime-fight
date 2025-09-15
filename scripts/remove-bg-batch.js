const fs = require('fs');
const path = require('path');
const { edgeKeyBackground } = require('./remove-bg');

// usa edgeKeyBackground del módulo principal

function listPngsRec(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listPngsRec(p));
    else if (/\.png$/i.test(entry.name)) results.push(p);
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] || 'sprites');
  const writeMode = args.includes('--copy') ? 'copy' : 'inplace';
  const suffix = args.includes('--copy') ? '_nobg' : '';
  const files = listPngsRec(root);
  let ok = 0;
  for (const file of files) {
    try {
      const img = await edgeKeyBackground(file);
      let out = file;
      if (writeMode === 'copy') out = file.replace(/\.png$/i, `${suffix}.png`);
      await img.writeAsync(out);
      ok++;
      if (ok % 20 === 0) console.log(`✔ procesadas ${ok}/${files.length}`);
    } catch (e) {
      console.warn(`falló ${file}: ${e.message}`);
    }
  }
  console.log(`✔ Completado: ${ok}/${files.length} PNGs`);
}

main().catch((e) => { console.error(e); process.exit(1); });


