const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

// Algoritmo mejorado: clave solo el blanco conectado al borde.
// Evita borrar blancos internos (ojos, brillos en piel/ropa).
async function edgeKeyBackground(filePath, opts = {}) {
  const { softness = 3, whiteDist = 28, satMax = 22, minBright = 210, removeIslands = true } = opts;
  const img = await Jimp.read(filePath);
  const { width: w, height: h } = img.bitmap;

  const idx = (x, y) => img.getPixelIndex(x, y);
  const visited = new Uint8Array(w * h);
  const mark = new Uint8Array(w * h);
  const idOf = (x, y) => y * w + x;

  const isWhiteish = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max - min; // 0..255
    const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);
    return (dist < whiteDist || (max > minBright && sat < satMax));
  };

  // BFS desde bordes para marcar fondo conectado
  const q = [];
  function tryPush(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const id = idOf(x, y); if (visited[id]) return; visited[id] = 1;
    const p = idx(x, y);
    const r = img.bitmap.data[p], g = img.bitmap.data[p + 1], b = img.bitmap.data[p + 2];
    if (isWhiteish(r, g, b)) { mark[id] = 1; q.push([x, y]); }
  }
  for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1); }
  for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y); }
  while (q.length) {
    const [x, y] = q.shift();
    const neigh = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of neigh) tryPush(nx, ny);
  }

  // Aplicar transparencia al área marcada y suavizar borde
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = idOf(x, y);
      const p = idx(x, y);
      if (mark[id]) {
        img.bitmap.data[p + 3] = 0;
      } else if (softness > 0) {
        // calcular distancia mínima a zona marcada en vecindario pequeño
        let near = false;
        for (let dy = -softness; !near && dy <= softness; dy++) {
          for (let dx = -softness; dx <= softness; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            if (mark[idOf(xx, yy)]) { near = true; break; }
          }
        }
        if (near) {
          // desvanecer ligero en el borde
          img.bitmap.data[p + 3] = Math.min(255, Math.round(img.bitmap.data[p + 3] * 0.85));
        }
      }
    }
  }

  // 2) Opcional: eliminar islas internas muy blancas (p. ej., ovals o bases blancas dentro del contorno)
  if (removeIslands) {
    const visited2 = new Uint8Array(w * h);
    const isStrictWhite = (r, g, b) => {
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max - min;
      const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);
      return dist < 12 && max > 240 && sat < 10; // casi blanco puro
    };
    function floodComponent(sx, sy) {
      const stack = [[sx, sy]]; visited2[idOf(sx, sy)] = 1; const pixels = [];
      let touchesEdge = false;
      while (stack.length) {
        const [x, y] = stack.pop(); pixels.push([x, y]);
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
        const neigh = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const id = idOf(nx, ny); if (visited2[id]) continue;
          const q = idx(nx, ny);
          const a = img.bitmap.data[q + 3]; if (a === 0) { visited2[id] = 1; continue; }
          const r = img.bitmap.data[q], g = img.bitmap.data[q + 1], b = img.bitmap.data[q + 2];
          if (isStrictWhite(r, g, b)) { visited2[id] = 1; stack.push([nx, ny]); }
        }
      }
      return { pixels, touchesEdge };
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = idOf(x, y);
        if (visited2[id]) continue;
        const p = idx(x, y);
        const a = img.bitmap.data[p + 3];
        if (a === 0) { visited2[id] = 1; continue; }
        const r = img.bitmap.data[p], g = img.bitmap.data[p + 1], b = img.bitmap.data[p + 2];
        if (!isStrictWhite(r, g, b)) { visited2[id] = 1; continue; }
        const comp = floodComponent(x, y);
        if (!comp.touchesEdge && comp.pixels.length >= 80) {
          for (const [cx, cy] of comp.pixels) {
            const q = idx(cx, cy);
            img.bitmap.data[q + 3] = 0;
          }
        }
      }
    }
  }
  return img;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error('Uso: node scripts/remove-bg.js <input.png> [output.png]');
    process.exit(1);
  }
  const src = path.resolve(args[0]);
  const out = path.resolve(args[1] || src.replace(/\.png$/i, '_nobg.png'));
  const img = await edgeKeyBackground(src);
  await img.writeAsync(out);
  console.log(`✔ Fondo eliminado -> ${out}`);
}

module.exports = { edgeKeyBackground };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}


