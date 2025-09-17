// Juego de pelea 2D 2v2 en Canvas
// Arquitectura básica: Game -> Scene -> Systems (input, physics, combat) -> Entities (Fighters, Effects)

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Resolución de render y escalado responsivo
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;
canvas.width = BASE_WIDTH;
canvas.height = BASE_HEIGHT;

// Utilidades
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sign = (v) => (v === 0 ? 0 : v > 0 ? 1 : -1);
const now = () => performance.now();
// Acciones que deben usar solo el primer frame (por personaje)
// Cargadas desde assets/anim-config.json. Si falla, usa valores por defecto.
let SINGLE_FRAME_ACTIONS = { naruto: new Set(['idle','attack1','jump']) };
try {
  const raw = localStorage.getItem('anim-config-json');
  const fromDisk = raw ? JSON.parse(raw) : null;
  const applyConfig = (cfg) => {
    const map = {};
    for (const [charId, arr] of Object.entries(cfg)) map[charId] = new Set(arr);
    SINGLE_FRAME_ACTIONS = map;
  };
  if (fromDisk) {
    applyConfig(fromDisk);
  } else {
    fetch('assets/anim-config.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then(cfg => { applyConfig(cfg); localStorage.setItem('anim-config-json', JSON.stringify(cfg)); })
      .catch(() => {});
  }
} catch {}

// Carga de spritesheets y atlas (.json + .png) generados por scripts
const SHEET_CACHE = { data: {}, loading: {} };

function sheetJsonPath(charId, action) {
  return `sheet_out/${charId}/${action}.json`;
}
function sheetImagePath(charId, action) {
  return `sheet_out/${charId}/${action}.png`;
}

async function loadSheet(charId, action) {
  const key = `${charId}/${action}`;
  if (SHEET_CACHE.data[key]) return SHEET_CACHE.data[key];
  if (SHEET_CACHE.loading[key]) return SHEET_CACHE.loading[key];
  const promise = (async () => {
    try {
      const jsonUrl = sheetJsonPath(charId, action);
      const res = await fetch(jsonUrl, { cache: 'no-cache' });
      if (!res.ok) return null; // no existe hoja
      const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (!ct.includes('application/json')) return null; // evita parsear HTML de fallback
      const atlas = await res.json();
      const imgUrl = sheetImagePath(charId, action);
      const img = new Image();
      const onload = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
      });
      img.src = imgUrl;
      await onload;
      const frames = Array.isArray(atlas.frames) ? atlas.frames : [];
      const data = { image: img, frames };
      SHEET_CACHE.data[key] = data;
      return data;
    } catch (e) {
      console.warn('Fallo cargando sheet', charId, action, e);
      return null;
    } finally {
      delete SHEET_CACHE.loading[key];
    }
  })();
  SHEET_CACHE.loading[key] = promise;
  return promise;
}

function getSheet(charId, action) {
  const key = `${charId}/${action}`;
  return SHEET_CACHE.data[key];
}

class SpriteAnimator {
  constructor(charId) {
    this.charId = charId;
    this.action = 'idle';
    this.frameIndex = 0;
    this.acc = 0;
    this.fps = 10; // velocidad por defecto
    // precargar solo idle; el resto se carga on-demand para evitar warnings en dev
    loadSheet(charId, 'idle');
  }
  setAction(action) {
    if (!action) return;
    if (this.action !== action) {
      this.action = action;
      this.frameIndex = 0;
      this.acc = 0;
      loadSheet(this.charId, action);
    }
  }
  update(dt) {
    const sheet = getSheet(this.charId, this.action);
    if (!sheet || !sheet.frames.length) return;
    if (SINGLE_FRAME_ACTIONS[this.charId] && SINGLE_FRAME_ACTIONS[this.charId].has(this.action)) {
      this.frameIndex = 0; // siempre el primer frame del estado
      return;
    }
    this.acc += dt;
    const spf = 1 / this.fps;
    while (this.acc >= spf) {
      this.acc -= spf;
      this.frameIndex = (this.frameIndex + 1) % sheet.frames.length;
    }
  }
  draw(ctx, dx, dy, dw, dh, dir) {
    const actionName = this.action;
    let sheet = getSheet(this.charId, actionName);
    let usedFallback = false;
    let forcedFacing = null; // +1 (derecha), -1 (izquierda) cuando caemos a idle
    if ((!sheet || !sheet.frames?.length) && (actionName === 'idle_right' || actionName === 'idle_left')) {
      sheet = getSheet(this.charId, 'idle');
      usedFallback = true;
      forcedFacing = actionName === 'idle_left' ? -1 : 1;
    }
    // Fallback global: si cualquier otra acción no está lista, usa idle orientado
    if ((!sheet || !sheet.frames?.length) && !(actionName === 'idle_right' || actionName === 'idle_left')) {
      const prefer = dir < 0 ? 'idle_left' : 'idle_right';
      sheet = getSheet(this.charId, prefer) || getSheet(this.charId, 'idle');
      usedFallback = true;
      forcedFacing = dir;
    }
    if (!sheet || !sheet.frames.length) return false;
    const f = sheet.frames[Math.min(this.frameIndex, sheet.frames.length - 1)];
    const fr = f.frame;
    const effectiveDir = forcedFacing !== null ? forcedFacing : dir;
    const isDedicatedIdle = (actionName === 'idle_right' || actionName === 'idle_left') && !usedFallback;
    if (isDedicatedIdle) {
      // assets dedicados orientados: no aplicar flip
      ctx.drawImage(sheet.image, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh);
    } else {
      // resto de acciones o fallback a idle: aplicar flip según dirección
      const destW = effectiveDir < 0 ? -dw : dw;
      const destX = effectiveDir < 0 ? dx + dw : dx;
      ctx.drawImage(sheet.image, fr.x, fr.y, fr.w, fr.h, destX, dy, destW, dh);
    }
    return true;
  }
}

// Estado global mínimo
const game = {
  timeScale: 1,
  camera: { x: 0, y: 0, shake: 0, shakeT: 0 },
  roundTime: 90,
  isRoundActive: false,
  announcerText: 'Selecciona',
  state: 'select', // 'select' | 'playing' | 'over'
  mode: '2v2', // '1v1' | '2v2'
  difficulty: 'normal', // 'easy' | 'normal' | 'hard'
  dummyEnemy: false,
  world: 'leaf',
  tod: 'day',
};

function getDamageMultiplier() {
  // Menos daño por golpe (más fácil): fácil 0.6x, normal 1.0x, difícil 1.2x
  if (game.difficulty === 'easy') return 0.6;
  if (game.difficulty === 'hard') return 1.2;
  return 1.0;
}

// Tuning de slide (puede variarse por dificultad si se desea)
const SLIDE_TUNING = {
  impulse: 1600,       // fuerza de impulso inicial
  duration: 0.32,      // duración del estado de slide
  range: 80,           // ancho del hitbox frontal
  height: 60,          // alto del hitbox
  hitCooldown: 0.15,   // intervalo entre impactos durante slide
  friction: 0.992,     // fricción durante slide
  damageScale: 0.5,    // daño relativo del slide vs golpe normal
  kbScale: 0.8         // retroceso relativo del slide
};

// Entrada
const input = {
  keys: new Set(),
  pressed: new Set(),
};

window.addEventListener('keydown', (e) => {
  input.keys.add(e.key.toLowerCase());
  input.pressed.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'h') toggleHelp();
  if (e.key.toLowerCase() === 'r') resetRound();
  if (game.state === 'over' && e.key.toLowerCase() === 'enter') { game.state = 'select'; showSelect(true); }
});
window.addEventListener('keyup', (e) => {
  input.keys.delete(e.key.toLowerCase());
});

function wasPressed(k) {
  return input.pressed.has(k);
}

function endFrameInput() {
  input.pressed.clear();
}

// Roster de personajes (Naruto, Satoru, Sukuna, Sasuke, Nobara)
const ROSTER = [
  { id: 'naruto',  name: 'Naruto',  aura: '#ffd166', color: '#ffb703' },
  { id: 'satoru',  name: 'Satoru',  aura: '#9bb0ff', color: '#5e7bff' },
  { id: 'sukuna',  name: 'Sukuna',  aura: '#ff6c9b', color: '#ff3b6e' },
  { id: 'sasuke',  name: 'Sasuke',  aura: '#7aa2ff', color: '#3f62ff' },
  { id: 'nobara',  name: 'Nobara',  aura: '#ff8f66', color: '#ff6a33' },
];

const selection = { p1: null, p2: null };
// Debe declararse antes de setupScene() para evitar TDZ
const customSprites = { p1: null, p2: null };

// Sprites SVG simples (sin assets externos) para dar estilo anime
const SPRITE_CACHE = new Map();
function spriteFor(id, primary, aura) {
  const key = id + primary + aura;
  if (SPRITE_CACHE.has(key)) return SPRITE_CACHE.get(key);
  const svg = createCharacterSVG(id, primary, aura);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  SPRITE_CACHE.set(key, img);
  return img;
}

function createCharacterSVG(id, primary, aura) {
  // 80x120 box
  const outline = '#0b0e1a';
  const hair = {
    naruto: '#ffdf5a',
    satoru: '#eaf2ff',
    sukuna: '#ff7aa8',
    sasuke: '#1b2b6a',
    nobara: '#ff9966',
  }[id] || primary;
  const eye = id === 'satoru' ? 'none' : '#ffffff';
  const extra = id === 'satoru' ? `<rect x="20" y="40" width="40" height="10" rx="5" fill="#9bb0ff"/>` : '';
  const marks = id === 'sukuna' ? `<path d="M28 62c4-4 8-4 12 0" stroke="#4a0d22" stroke-width="2" fill="none"/><path d="M24 52h8" stroke="#4a0d22" stroke-width="2"/><path d="M48 52h8" stroke="#4a0d22" stroke-width="2"/>` : '';
  const hairShape = {
    naruto: '<path d="M12 22l8-10 8 10 8-10 8 10 8-8 6 12H12z" fill="'+hair+'"/>',
    satoru: '<rect x="14" y="18" width="52" height="16" rx="8" fill="'+hair+'"/>',
    sukuna: '<rect x="18" y="18" width="44" height="14" rx="6" fill="'+hair+'"/>',
    sasuke: '<path d="M10 30l12-14h36l12 14H10z" fill="'+hair+'"/>',
    nobara: '<rect x="18" y="22" width="44" height="12" rx="6" fill="'+hair+'"/>',
  }[id] || '';
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120" viewBox="0 0 80 120">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${aura}" flood-opacity="0.9"/>
    </filter>
  </defs>
  <rect x="10" y="30" width="60" height="80" rx="10" fill="${primary}" stroke="${outline}" stroke-width="3" filter="url(#glow)"/>
  <circle cx="40" cy="46" r="14" fill="#ffe9cf" stroke="${outline}" stroke-width="3"/>
  ${hairShape}
  ${extra}
  ${marks}
  ${eye !== 'none' ? '<circle cx="34" cy="46" r="2.5" fill="'+eye+'"/><circle cx="46" cy="46" r="2.5" fill="'+eye+'"/>' : ''}
  <rect x="24" y="74" width="32" height="20" rx="6" fill="${primary}" stroke="${outline}" stroke-width="3"/>
</svg>`;
}

// Entidades
class Entity {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.w = 68; this.h = 120;
    this.dir = 1; // 1 derecha, -1 izquierda
    this.grounded = false;
    this.remove = false;
  }
  update(dt) {}
  draw(ctx) {
    // placeholder: caja
    ctx.fillStyle = '#888';
    ctx.fillRect(this.x - this.w / 2, this.y - this.h, this.w, this.h);
  }
}

// Sistema de efectos sencillos
const effects = [];
function spawnSpark(x, y, color) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 100 + Math.random() * 220;
    effects.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.25 + Math.random() * 0.2, t: 0, color,
    });
  }
}

function updateEffects(dt) {
  for (const e of effects) {
    e.t += dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vx *= 0.96; e.vy *= 0.96;
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    if (effects[i].t >= effects[i].life) effects.splice(i, 1);
  }
}

function drawEffects(ctx) {
  for (const e of effects) {
    const k = 1 - e.t / e.life;
    ctx.globalAlpha = k;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2 + 2 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Luchador
class Fighter extends Entity {
  constructor(opts) {
    super(opts.x, opts.y);
    this.team = opts.team; // 'L' o 'R'
    this.name = opts.name;
    this.color = opts.color;
    this.aura = opts.aura || '#6cf0ff';
    this.charId = opts.charId || 'generic';
    this.sprite = spriteFor(this.charId, this.color, this.aura);
    this.anim = new SpriteAnimator(this.charId);
    this.currentAction = 'idle';
    this.isPlayer = opts.isPlayer;
    this.controls = opts.controls || {};
    this.target = null;
    this.maxHp = 100;
    this.hp = this.maxHp;
    this.atkCooldown = 0;
    this.blocking = false;
    this.invul = 0;
    this.afterimage = [];
    this.spCooldown = 0;
    this.slideTimer = 0;
    this.slideHitCooldown = 0;
    // parámetros IA ajustables por dificultad
    this.ai = { aggression: 1, defense: 1, jumpiness: 1 };
    // base sizes y estado de agachado
    this.baseW = this.w; this.baseH = this.h;
    this.crouching = false; this.wantDown = false;
  }

  get alive() { return this.hp > 0; }

  thinkAI(fighters) {
    if (this.isPlayer || !this.alive) return;
    if (game.dummyEnemy && this.team === 'R') {
      // Enemigo quieto para pruebas: no se mueve ni ataca
      this.vx = 0; this.blocking = false; return;
    }
    // ajustar comportamiento según dificultad global (más lento en ataques)
    if (game.difficulty === 'easy') {
      this.ai = { aggression: 0.25, defense: 0.3, jumpiness: 0.3 };
    } else if (game.difficulty === 'hard') {
      this.ai = { aggression: 0.8, defense: 1.1, jumpiness: 0.9 };
    } else {
      this.ai = { aggression: 0.5, defense: 0.7, jumpiness: 0.6 };
    }
    // Objetivo: enemigo más cercano vivo
    if (!this.target || !this.target.alive) {
      const enemies = fighters.filter(f => f.team !== this.team && f.alive);
      this.target = enemies.sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0] || null;
    }
    if (!this.target) return;
    const dist = this.target.x - this.x;
    this.dir = dist > 0 ? 1 : -1; // mirar hacia el objetivo
    const abs = Math.abs(dist);
    if (abs > 140) {
      this.vx += 900 * this.ai.aggression * Math.sign(dist);
    } else if (this.atkCooldown <= 0 && Math.random() < 0.015 * this.ai.aggression) {
      // Ataque con probabilidad reducida para evitar spam
      this.attack();
    } else {
      this.blocking = Math.random() < 0.015 * this.ai.defense; // bloqueos aleatorios
    }
    if (Math.random() < 0.003 * this.ai.jumpiness && this.grounded) this.jump();
  }

  handleInput() {
    if (!this.isPlayer || !this.alive) return;
    const c = this.controls;
    const left = input.keys.has(c.left);
    const right = input.keys.has(c.right);
    const up = input.keys.has(c.up);
    const down = c.down ? input.keys.has(c.down) : false;
    const atk = input.keys.has(c.attack) || wasPressed(c.attack);
    const sp = input.keys.has(c.special) || wasPressed(c.special);
    const block = input.keys.has(c.block);

    if (left) this.vx -= 1500;
    if (right) this.vx += 1500;
    if (up && this.grounded) this.jump();
    if (atk && this.atkCooldown <= 0) this.attack();
    if (sp && this.spCooldown <= 0) this.special();
    this.blocking = !!block;
    this.wantDown = !!down;
  }

  jump() {
    this.vy = -750;
    this.grounded = false;
  }

  attack() {
    this.atkCooldown = 0.45;
    // hitbox simple frente al luchador
    const range = 90; const height = 80;
    const hx = this.x + this.dir * (this.w / 2 + range / 2);
    const hy = this.y - this.h / 2;
    const hitbox = { x: hx, y: hy, w: range, h: height };
    resolveHit(this, hitbox);
  }

  takeDamage(from, dmg, kb) {
    if (!this.alive) return;
    if (this.blocking && Math.sign(from.x - this.x) === this.dir) {
      // Bloqueo exitoso: reduce daño y retroceso
      dmg *= 0.25; kb *= 0.3;
    }
    if (this.invul > 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.vx += -this.dir * kb;
    this.vy -= 120;
    this.invul = 0.18;
    game.camera.shake = Math.min(18, game.camera.shake + 10);
    spawnSpark(this.x, this.y - this.h + 40, this.team === 'L' ? '#6cf0ff' : '#ff6c9b');
  }

  update(dt) {
    if (!this.alive) {
      this.vx *= 0.95; this.vy += 1500 * dt; this.y += this.vy * dt; return;
    }
    this.atkCooldown -= dt; this.invul -= dt; this.spCooldown -= dt; this.slideTimer -= dt; this.slideHitCooldown -= dt;
    this.handleInput();
    this.vx += -this.vx * 6 * dt; // fricción aérea/suelo básica
    this.vy += 2000 * dt; // gravedad
    this.x += this.vx * dt; this.y += this.vy * dt;
    // suelo
    if (this.y >= 600) { this.y = 600; this.vy = 0; this.grounded = true; } else this.grounded = false;
    // estado de agachado y tamaño de caja
    this.crouching = this.wantDown && this.grounded;
    this.h = this.crouching ? Math.round(this.baseH * 0.7) : this.baseH;
    // límites
    this.x = clamp(this.x, 80, BASE_WIDTH - 80);
    // orientar siempre hacia el enemigo más cercano (jugador y CPU)
    const enemies = fighters.filter(f => f.team !== this.team && f.alive);
    if (enemies.length) {
      let nearest = enemies[0];
      for (let i = 1; i < enemies.length; i++) {
        if (Math.abs(enemies[i].x - this.x) < Math.abs(nearest.x - this.x)) nearest = enemies[i];
      }
      this.dir = (nearest.x - this.x) >= 0 ? 1 : -1;
    }
    // almacenar estelas
    if (Math.abs(this.vx) > 50 || this.atkCooldown > 0.3) {
      this.afterimage.push({ x: this.x, y: this.y, dir: this.dir, t: 0 });
      if (this.afterimage.length > 8) this.afterimage.shift();
    }

    // actualizar acción animación simple
    const speed = Math.abs(this.vx);
    let action = 'idle_right';
    if (!this.grounded) action = 'jump';
    else if (this.atkCooldown > 0.1) action = 'attack1';
    else if (this.crouching && this.grounded && speed > 250) action = 'slide';
    else if (this.crouching && this.grounded) action = 'crouch';
    else if (speed > 160) action = 'run';
    else if (speed > 40) action = 'walk';
    // si está quieto pero mirando izquierda, usar idle_left
    if (action.startsWith('idle')) {
      if (this.dir < 0) action = 'idle_left'; else action = 'idle_right';
    }
    if (this.currentAction !== action) {
      this.currentAction = action;
      this.anim.setAction(action);
      // velocidad por acción
      this.anim.fps = action === 'walk' ? 12 : action === 'run' ? 16 : action === 'attack1' ? 16 : action === 'slide' ? 12 : action === 'crouch' ? 6 : 8;
      if (action === 'slide') {
        this.vx += this.dir * SLIDE_TUNING.impulse;
        this.slideTimer = Math.max(this.slideTimer, SLIDE_TUNING.duration);
        this.slideHitCooldown = 0;
      }
    }
    this.anim.update(dt);
    if (this.slideTimer > 0) {
      const range = SLIDE_TUNING.range; const height = SLIDE_TUNING.height;
      const hx = this.x + this.dir * (this.w / 2 + range / 2);
      const hy = this.y - this.h / 2 + 20;
      if (this.slideHitCooldown <= 0) {
        // Golpe especial con menos daño/knockback utilizando resolveHit levemente modificado localmente
        const hb = { x: hx, y: hy, w: range, h: height };
        for (const f of fighters) {
          if (f === this || f.team === this.team || !f.alive) continue;
          const hurt = { x: f.x, y: f.y, w: f.w, h: f.h };
          if (aabbHit(hb, hurt)) {
            const baseDmg = (12 + Math.random() * 6) * getDamageMultiplier();
            const dmg = baseDmg * SLIDE_TUNING.damageScale;
            const kb = (420 + Math.random() * 120) * SLIDE_TUNING.kbScale;
            f.takeDamage(this, dmg, kb);
            game.announcerText = 'Slide!';
            break;
          }
        }
        this.slideHitCooldown = SLIDE_TUNING.hitCooldown;
      }
      this.vx *= SLIDE_TUNING.friction;
    }
  }

  draw(ctx) {
    const bodyW = this.w, bodyH = this.h;
    const x = this.x - bodyW / 2, y = this.y - bodyH;

    // sombra
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y - 6, 38, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // estela anime leve cuando ataca
    if (this.atkCooldown > 0.3) {
      ctx.save();
      ctx.translate(this.x, this.y - bodyH + 40);
      ctx.scale(this.dir, 1);
      const c = this.aura;
      const gradTrail = ctx.createLinearGradient(0, 0, 110, 0);
      gradTrail.addColorStop(0, 'rgba(255,255,255,0)');
      gradTrail.addColorStop(1, c + '80');
      ctx.fillStyle = gradTrail;
      ctx.fillRect(0, -12, 130, 24);
      ctx.restore();
    }

    // afterimages (suaves, sin rectángulo)
    for (let i = 0; i < this.afterimage.length; i++) {
      const a = this.afterimage[i];
      a.t += 0.02;
      const k = 1 - i / this.afterimage.length;
      ctx.globalAlpha = 0.12 * k;
      const radius = 18 + 14 * k;
      const cx = a.x; const cy = a.y - bodyH + 60;
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, radius);
      g.addColorStop(0, this.aura + '55');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // dibujar sprite SVG con aura
    ctx.save();
    // halo suave (sin fondo cuadrado)
    ctx.save();
    const halo = ctx.createRadialGradient(this.x, this.y - 10, 6, this.x, this.y - 10, 28);
    halo.addColorStop(0, this.aura + '55');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(this.x, this.y - 10, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // intentar dibujar animación; si no hay sheet, fallback al SVG
    const drawn = this.anim.draw(ctx, x, y, bodyW, bodyH, this.dir);
    if (!drawn) {
      // Fallback final: intenta idle orientado; si falla, no dibujar rectángulo
      const prefer = this.dir < 0 ? 'idle_left' : 'idle_right';
      const idleSheet = getSheet(this.charId, prefer) || getSheet(this.charId, 'idle');
      if (idleSheet && idleSheet.frames?.length) {
        const fr = idleSheet.frames[0].frame;
        const flip = this.dir < 0 ? -1 : 1;
        const destW = flip < 0 ? -bodyW : bodyW;
        const destX = flip < 0 ? x + bodyW : x;
        ctx.drawImage(idleSheet.image, fr.x, fr.y, fr.w, fr.h, destX, y, destW, bodyH);
      }
    }
    ctx.restore();

    // (debug removido) marca de posición
  }
}

// Resolución de golpes
function aabbHit(a, b) {
  return Math.abs(a.x - b.x) < (a.w / 2 + b.w / 2) && Math.abs((a.y - a.h / 2) - (b.y - b.h / 2)) < (a.h / 2 + b.h / 2);
}

function resolveHit(attacker, hitbox) {
  const hb = { x: hitbox.x, y: hitbox.y + hitbox.h / 2, w: hitbox.w, h: hitbox.h };
  for (const f of fighters) {
    if (f === attacker || f.team === attacker.team || !f.alive) continue;
    const hurt = { x: f.x, y: f.y, w: f.w, h: f.h };
    if (aabbHit(hb, hurt)) {
      const dmg = (12 + Math.random() * 6) * getDamageMultiplier();
      const kb = 420 + Math.random() * 120;
      f.takeDamage(attacker, dmg, kb);
      if (Math.random() < 0.4) game.announcerText = '¡Golpe!';
    }
  }
}

// Sistema de especiales y proyectiles
const projectiles = [];

class Projectile {
  constructor({ x, y, vx, vy, w = 22, h = 22, team, dmg = 12, kb = 300, color = '#fff', life = 1.8, pierce = false }) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.w = w; this.h = h; this.team = team; this.dmg = dmg; this.kb = kb; this.color = color; this.life = life; this.pierce = pierce; this.remove = false;
  }
  update(dt) {
    this.life -= dt; if (this.life <= 0) this.remove = true;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vy += 400 * dt; // leve gravedad
    // colisión con enemigos
    for (const f of fighters) {
      if (!f.alive || f.team === this.team) continue;
      if (aabbHit({ x: this.x, y: this.y, w: this.w, h: this.h }, { x: f.x, y: f.y, w: f.w, h: f.h })) {
        f.takeDamage({ x: this.x }, this.dmg * getDamageMultiplier(), this.kb);
        spawnSpark(this.x, this.y, this.color);
        if (!this.pierce) { this.remove = true; break; }
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    const g = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, 16);
    g.addColorStop(0, this.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function updateProjectiles(dt) {
  for (const p of projectiles) p.update(dt);
  for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].remove) projectiles.splice(i, 1);
}

function drawProjectiles(ctx) {
  for (const p of projectiles) p.draw(ctx);
}

// Especial por personaje
Fighter.prototype.special = function() {
  const dir = this.dir;
  const base = { x: this.x + dir * (this.w / 2 + 10), y: this.y - this.h + 60 };
  const team = this.team;
  const speed = 700 * dir;
  const name = this.name.toLowerCase();

  if (name.includes('naruto')) {
    // Shuriken múltiple
    for (let i = -1; i <= 1; i++) {
      projectiles.push(new Projectile({ x: base.x, y: base.y + i * 6, vx: speed, vy: -50 + i * 40, dmg: 10, kb: 260, color: '#ffd166', team }));
    }
    this.spCooldown = 3.0;
  } else if (name.includes('satoru')) {
    // Orbe azul (pierce)
    projectiles.push(new Projectile({ x: base.x, y: base.y, vx: speed * 0.8, vy: 0, dmg: 16, kb: 340, color: '#9bb0ff', team, w: 26, h: 26, life: 2.2, pierce: true }));
    this.spCooldown = 3.2;
  } else if (name.includes('sukuna')) {
    // Corte carmesí: hitbox en arco corto delante
    const range = 140; const height = 120;
    const hx = this.x + dir * (this.w / 2 + range / 2);
    const hy = this.y - this.h / 2;
    resolveHit(this, { x: hx, y: hy, w: range, h: height });
    spawnSpark(hx, hy, '#ff6c9b');
    this.spCooldown = 2.6; game.camera.shake = 18;
  } else if (name.includes('sasuke')) {
    // Relámpago (rápido, alto daño)
    projectiles.push(new Projectile({ x: base.x, y: base.y - 20, vx: speed * 1.2, vy: 0, dmg: 20, kb: 420, color: '#7aa2ff', team, life: 1.1 }));
    this.spCooldown = 3.0;
  } else if (name.includes('nobara')) {
    // Clavo explosivo (más lento, estalla en impacto)
    projectiles.push(new Projectile({ x: base.x, y: base.y, vx: speed * 0.7, vy: -60, dmg: 14, kb: 320, color: '#ff8f66', team }));
    this.spCooldown = 2.8;
  } else {
    // genérico
    projectiles.push(new Projectile({ x: base.x, y: base.y, vx: speed, vy: 0, team, color: this.aura }));
    this.spCooldown = 2.5;
  }
};

// Escena
const fighters = [];

function createFighterFromChar(char, base) {
  const fighter = new Fighter({
    x: base.x, y: base.y, team: base.team, name: char.name,
    color: char.color, aura: char.aura, charId: char.id, isPlayer: base.isPlayer, controls: base.controls,
  });
  // aplicar sprite personalizado si existe
  if (base.isPlayer) {
    const side = base.team === 'L' ? 'p1' : 'p2';
    if (customSprites[side]) fighter.sprite = customSprites[side];
  }
  return fighter;
}

function setupScene() {
  fighters.length = 0;
  const baseP1 = { x: 300, y: 600, team: 'L', isPlayer: true,  controls: { left: 'a', right: 'd', up: 'w', down: 's', attack: 'f', special: 't', block: 'g' } };
  const baseA1 = { x: 220, y: 600, team: 'L', isPlayer: false };
  const baseA2 = { x: 980, y: 600, team: 'R', isPlayer: false };
  // P2 control configurable en 1v1
  const p2IsHuman = game.mode === '1v1' && ui.select.p2Control && ui.select.p2Control.value === 'human';
  const baseP2 = { x: 1060, y: 600, team: 'R', isPlayer: p2IsHuman, controls: { left: p2IsHuman ? 'arrowleft' : 'j', right: p2IsHuman ? 'arrowright' : 'l', up: p2IsHuman ? 'arrowup' : 'i', down: p2IsHuman ? 'arrowdown' : 'k', attack: p2IsHuman ? 'k' : 'k', special: p2IsHuman ? 'j' : 'o', block: p2IsHuman ? 'l' : 'p' } };

  const p1Char = selection.p1 || ROSTER[0];
  const p2Char = selection.p2 || ROSTER[2];
  const allyL = ROSTER[1]; // satoru por defecto
  const allyR = ROSTER[4]; // nobara por defecto

  const L1 = createFighterFromChar(p1Char, baseP1);
  L1.dir = 1; // inicio mirando a la derecha
  const R2 = createFighterFromChar(p2Char, baseP2);
  fighters.push(L1, R2);
  if (game.mode === '2v2') {
  const L2 = createFighterFromChar(allyL, baseA1);
  const R1 = createFighterFromChar(allyR, baseA2);
    fighters.splice(1, 0, L2); // L1, L2, R1, R2 orden cercano al original
    fighters.splice(2, 0, R1);
  }
}

setupScene();

// HUD
const ui = {
  hp: {
    p1: document.getElementById('hp-p1'),
    a1: document.getElementById('hp-a1'),
    a2: document.getElementById('hp-a2'),
    p2: document.getElementById('hp-p2'),
  },
  timer: document.getElementById('timer'),
  banner: document.getElementById('round-banner'),
  help: document.getElementById('help'),
  names: {
    p1: document.getElementById('name-p1'),
    a1: document.getElementById('name-a1'),
    a2: document.getElementById('name-a2'),
    p2: document.getElementById('name-p2'),
  },
  select: {
    root: document.getElementById('select'),
    start: document.getElementById('start-btn'),
    singlePreview: null,
    p1Selected: document.getElementById('p1-selected-preview'),
    p2Selected: document.getElementById('p2-selected-preview'),
    p1SelectedName: document.getElementById('p1-selected-name'),
    p2SelectedName: document.getElementById('p2-selected-name'),
    mode: document.getElementById('mode-select'),
    p2ControlWrap: document.getElementById('p2-control-wrap'),
    p2Control: document.getElementById('p2-control-select'),
    difficulty: document.getElementById('difficulty-select'),
    world: document.getElementById('world-select'),
    p1grid: document.getElementById('p1-grid'),
    p2grid: document.getElementById('p2-grid'),
    dummy: document.getElementById('dummy-toggle'),
  },
  post: {
    root: document.getElementById('postgame'),
    replay: document.getElementById('btn-replay'),
    reselect: document.getElementById('btn-reselect'),
  },
  buttons: {
    openSelect: document.getElementById('btn-open-select'),
  },
  touch: { root: document.getElementById('touch-controls') }
};

function toggleHelp() {
  ui.help.style.display = ui.help.style.display === 'none' ? 'block' : 'none';
}

function updateHUD() {
  const left = fighters.filter(f => f.team === 'L');
  const right = fighters.filter(f => f.team === 'R');
  const L1 = left[0];
  const L2 = left[1];
  const R1 = right[0];
  const R2 = right[1];
  const hp01 = (f) => f ? clamp(f.hp / f.maxHp, 0, 1) : 0;
  if (ui.hp?.p1) ui.hp.p1.style.transform = `scaleX(${hp01(L1)})`;
  if (ui.hp?.a1) ui.hp.a1.style.transform = `scaleX(${hp01(L2)})`;
  if (ui.hp?.a2) ui.hp.a2.style.transform = `scaleX(${hp01(R1)})`;
  if (ui.hp?.p2) ui.hp.p2.style.transform = `scaleX(${hp01(R2)})`;
  ui.banner.textContent = game.announcerText;
  ui.timer.textContent = Math.max(0, Math.ceil(game.roundTime)).toString();
  if (L1) ui.names.p1.textContent = L1.name; else ui.names.p1.textContent = '';
  if (L2) ui.names.a1.textContent = L2.name; else ui.names.a1.textContent = '';
  if (R1) ui.names.a2.textContent = R1.name; else ui.names.a2.textContent = '';
  if (R2) ui.names.p2.textContent = R2.name; else ui.names.p2.textContent = '';
}

function resetRound() {
  game.roundTime = 90;
  game.isRoundActive = false;
  game.announcerText = 'Selecciona';
  setupScene();
}

// UI selección
function setSelectedPreview(side) {
  const target = side === 'p1' ? ui.select.p1Selected : ui.select.p2Selected;
  const ch = side === 'p1' ? selection.p1 : selection.p2;
  if (!target || !ch) return;
  target.style.display = 'block';
  // nombre debajo de la imagen
  try {
    const nameEl = side === 'p1' ? ui.select.p1SelectedName : ui.select.p2SelectedName;
    if (nameEl) nameEl.textContent = ch.name || '';
  } catch {}
  // intenta portrait curado primero, luego idle sheet
  const portrait = `assets/portraits/${ch.id}.png`;
  const fallback = `sheet_out/${ch.id}/idle.png`;
  target.onerror = () => { if (target.src.indexOf('assets/portraits') !== -1) target.src = fallback; };
  target.src = portrait;
}

function updateSelectState() {
  setSelectedPreview('p1');
  setSelectedPreview('p2');
}

function showSelect(show) {
  ui.select.root.setAttribute('aria-hidden', show ? 'false' : 'true');
  // asegurar que los botones de postgame no aparezcan en selección
  if (ui.post?.root) ui.post.root.setAttribute('aria-hidden', 'true');
}

function startGameFromSelection() {
  if (!(selection.p1 && selection.p2)) return;
  showSelect(false);
  resetRound();
  game.state = 'playing';
  game.isRoundActive = true;
  game.announcerText = 'Listo';
  // persistir mundo
  try { localStorage.setItem('world', game.world); localStorage.setItem('tod', game.tod); } catch {}
}

// Selección por defecto y manejo de modo
selection.p1 = ROSTER.find(c => c.id === 'naruto') || ROSTER[0];
selection.p2 = ROSTER.find(c => c.id === 'sasuke') || ROSTER[1] || ROSTER[0];
try { const w = localStorage.getItem('world'); if (w) game.world = w; } catch {}
try { const t = localStorage.getItem('tod'); if (t) game.tod = t; } catch {}
ui.select.mode?.addEventListener('change', (e) => {
  game.mode = e.target.value === '1v1' ? '1v1' : '2v2';
  // mostrar selector de control para P2 solo en 1v1
  if (ui.select.p2ControlWrap) ui.select.p2ControlWrap.style.display = game.mode === '1v1' ? 'inline-block' : 'none';
});
ui.select.difficulty?.addEventListener('change', (e) => {
  const val = String(e.target.value || 'normal');
  game.difficulty = ['easy','normal','hard'].includes(val) ? val : 'normal';
});
ui.select.dummy?.addEventListener('change', (e) => {
  game.dummyEnemy = !!e.target.checked;
});
ui.select.world?.addEventListener('change', (e) => {
  const val = String(e.target.value || 'leaf');
  game.world = ['leaf','forest','desert','city'].includes(val) ? val : 'leaf';
});
ui.select.tod?.addEventListener('change', (e) => {
  const val = String(e.target.value || 'day');
  game.tod = val === 'night' ? 'night' : 'day';
});
ui.select.start.addEventListener('click', startGameFromSelection);
window.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGameFromSelection(); });
// Cargar preview del sheet local
// Renderizar grid de P1
(function renderRosterGridP1() {
  const container = ui.select.p1grid;
  if (!container) return;
  container.innerHTML = '';
  for (const ch of ROSTER) {
    const card = document.createElement('button');
    card.className = 'char';
    card.type = 'button';
    card.dataset.id = ch.id;
    // miniatura usando sheet local si existe, si no el cuadrado de color
    const thumb = `sheet_out/${ch.id}/idle.png`;
    card.innerHTML = `<div class=\"portrait\" style=\"box-shadow: inset 0 0 0 2px ${ch.aura}33; background: #0b0e1a;\"><img src=\"${thumb}\" onerror=\"this.style.display='none'\" alt=\"${ch.name}\" style=\"width:100px;height:80px;object-fit:contain;\"/><svg width=\"100\" height=\"80\"><rect x=\"20\" y=\"10\" width=\"60\" height=\"60\" rx=\"10\" fill=\"${ch.color}\" stroke=\"${ch.aura}\" stroke-width=\"6\"/></svg></div><div class=\"name\">${ch.name}</div>`;
    card.addEventListener('click', () => {
      selection.p1 = ch;
      updateSelectState();
      // marcar seleccionado
      for (const b of container.querySelectorAll('.char')) b.classList.remove('selected');
      card.classList.add('selected');
    });
    container.appendChild(card);
  }
})();

// Renderizar grid de P2 (enemigo)
(function renderRosterGridP2() {
  const container = ui.select.p2grid;
  if (!container) return;
  container.innerHTML = '';
  for (const ch of ROSTER) {
    const card = document.createElement('button');
    card.className = 'char';
    card.type = 'button';
    card.dataset.id = ch.id;
    const thumb = `sheet_out/${ch.id}/idle.png`;
    card.innerHTML = `<div class=\"portrait\" style=\"box-shadow: inset 0 0 0 2px ${ch.aura}33; background: #0b0e1a;\"><img src=\"${thumb}\" onerror=\"this.style.display='none'\" alt=\"${ch.name}\" style=\"width:100px;height:80px;object-fit:contain;\"/><svg width=\"100\" height=\"80\"><rect x=\"20\" y=\"10\" width=\"60\" height=\"60\" rx=\"10\" fill=\"${ch.color}\" stroke=\"${ch.aura}\" stroke-width=\"6\"/></svg></div><div class=\"name\">${ch.name}</div>`;
    card.addEventListener('click', () => {
      selection.p2 = ch;
      updateSelectState();
      for (const b of container.querySelectorAll('.char')) b.classList.remove('selected');
      card.classList.add('selected');
    });
    container.appendChild(card);
  }
})();

updateSelectState();

// Carga de imágenes personalizadas
function handleUpload(input, side) {
  const file = input.files && input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    customSprites[side] = img;
    (side === 'p1' ? ui.select.p1Preview : ui.select.p2Preview).style.display = 'block';
    (side === 'p1' ? ui.select.p1Preview : ui.select.p2Preview).src = url;
    updateSelectState();
  };
  img.src = url;
}
// inputs/botones de la versión anterior no existen en el modal simplificado

async function localSheetPreviewFor(charObj) {
  if (!charObj) return null;
  const candidateActions = ['idle', 'walk', 'attack1'];
  for (const act of candidateActions) {
    const jsonUrl = `sheet_out/${charObj.id}/${act}.json`;
    const pngUrl = `sheet_out/${charObj.id}/${act}.png`;
    try {
      const res = await fetch(jsonUrl, { cache: 'no-cache' });
      if (res.ok) return { jsonUrl, pngUrl };
    } catch {}
  }
  return null;
}

async function useLocalSprites(side) {
  // si no hay selección, tomar una por defecto
  if (!selection.p1 && side === 'p1') selection.p1 = ROSTER.find(c => c.id === 'naruto') || ROSTER[0];
  if (!selection.p2 && side === 'p2') selection.p2 = ROSTER.find(c => c.id === 'sasuke') || ROSTER[1] || ROSTER[0];
  updateSelectState();

  const charObj = side === 'p1' ? selection.p1 : selection.p2;
        const prev = side === 'p1' ? ui.select.p1Preview : ui.select.p2Preview;
  const info = await localSheetPreviewFor(charObj);
  if (!info) {
    alert('No hay sprites locales para este personaje. Genera primero con los scripts.');
    return;
  }
  // Mostrar el PNG del sheet como preview
        prev.style.display = 'block';
  prev.src = info.pngUrl;
  customSprites[side] = null;
        updateSelectState();
}

// botones de usar sprites locales eliminados


// Cámara
function updateCamera(dt) {
  const alive = fighters.filter(f => f.alive);
  const minX = Math.min(...alive.map(f => f.x));
  const maxX = Math.max(...alive.map(f => f.x));
  const center = (minX + maxX) / 2;
  game.camera.x = lerp(game.camera.x, center - BASE_WIDTH / 2, 4 * dt);
  game.camera.x = clamp(game.camera.x, -100, 100);
  if (game.camera.shake > 0) {
    game.camera.shakeT += dt * 50;
    game.camera.shake *= 0.9;
  }
}

function applyCamera(ctx) {
  const s = game.camera.shake;
  const ox = s > 0 ? (Math.sin(game.camera.shakeT) * s) : 0;
  const oy = s > 0 ? (Math.cos(game.camera.shakeT * 1.3) * s * 0.5) : 0;
  ctx.translate(-game.camera.x + ox, oy);
}

// Render del escenario
function drawStage(ctx) {
  const y = 600;
  // imagen de fondo del mundo si existe
  const suffix = game.tod === 'night' ? '_night' : '';
  const cacheKey = `${game.world}${suffix}`;
  const customPaths = [
    `assets/worlds/${game.world}_custom${suffix}.png`,
    `assets/worlds/${game.world}_custom.png`,
  ];
  const defaultPath = `assets/worlds/${game.world}${suffix}.png`;
  // cache simple en window
  if (!window.__worldCache) window.__worldCache = {};
  const cache = window.__worldCache;
  function drawBackground() {
    try { ctx.drawImage(cache[cacheKey], -400, -200, BASE_WIDTH + 800, BASE_HEIGHT + 400); } catch {}
  }
  if (cache[cacheKey]) {
    drawBackground();
  } else {
    const img = new Image();
    let tried = 0;
    const sources = [...customPaths, defaultPath];
    img.onload = () => { cache[cacheKey] = img; drawBackground(); };
    img.onerror = () => { tried++; if (tried < sources.length) { img.src = sources[tried]; } };
    img.src = sources[0];
  }

  // suelo común
  const grad = ctx.createLinearGradient(0, y - 20, 0, BASE_HEIGHT);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = grad;
  ctx.fillRect(-400, y - 20, BASE_WIDTH + 800, BASE_HEIGHT - (y - 20));

  // rótulo de escenario
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(20, BASE_HEIGHT - 80, 260, 56);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(20, BASE_HEIGHT - 80, 260, 56);
  ctx.fillStyle = '#eaf2ff';
  ctx.font = 'bold 18px Montserrat, Arial';
  const worldName = game.world === 'leaf' ? 'Aldea de la Hoja' : game.world === 'forest' ? 'Bosque' : game.world === 'desert' ? 'Desierto' : 'Ciudad';
  const todName = game.tod === 'night' ? 'Noche' : 'Día';
  ctx.fillText(`${worldName} · ${todName}`, 34, BASE_HEIGHT - 46);
  ctx.restore();
}

// Loop
let last = now();
function frame() {
  const t = now();
  let dt = (t - last) / 1000;
  last = t;
  dt = Math.min(1 / 30, dt) * game.timeScale;

  // lógica
  if (game.state === 'playing' && game.isRoundActive) {
    game.roundTime -= dt;
    if (game.roundTime <= 0) {
      game.isRoundActive = false;
      // ganador por vida restante
      const leftHp = fighters.filter(f => f.team === 'L').reduce((s, f) => s + Math.max(0, f.hp), 0);
      const rightHp = fighters.filter(f => f.team === 'R').reduce((s, f) => s + Math.max(0, f.hp), 0);
      const winnersTeam = leftHp >= rightHp ? 'L' : 'R';
      game.announcerText = winnersTeam === 'L' ? '¡Equipo Izq. Gana!' : '¡Equipo Der. Gana!';
      game.state = 'over';
      for (const f of fighters) {
        if (f.team === winnersTeam) { f.currentAction = 'victory'; f.anim.setAction('victory'); }
        else { f.currentAction = 'death'; f.anim.setAction('death'); }
      }
    }
  }

  if (game.state === 'playing') {
    for (const f of fighters) {
      f.thinkAI(fighters);
      f.update(dt);
    }
    updateEffects(dt);
    updateProjectiles(dt);
    updateCamera(dt);
  }

  // condiciones de victoria
  if (game.state === 'playing') {
    const leftAlive = fighters.filter(f => f.team === 'L' && f.alive).length;
    const rightAlive = fighters.filter(f => f.team === 'R' && f.alive).length;
    if (game.isRoundActive && (leftAlive === 0 || rightAlive === 0)) {
      game.isRoundActive = false;
      game.announcerText = leftAlive > 0 ? '¡Equipo Izq. Gana!' : '¡Equipo Der. Gana!';
      game.state = 'over';
      // activar pose de victoria/derrota
      const winnersTeam = leftAlive > 0 ? 'L' : 'R';
      for (const f of fighters) {
        if (f.team === winnersTeam) {
          f.currentAction = 'victory';
          f.anim.setAction('victory');
        } else {
          f.currentAction = 'death';
          f.anim.setAction('death');
        }
      }
    }
  }

  // render
  ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  ctx.save();
  // detectar móvil para UI táctil (solo mostrar en juego activo)
  const isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(max-width: 850px)').matches);
  const showTouchControls = isTouch && game.state === 'playing';
  if (ui.touch?.root) ui.touch.root.setAttribute('aria-hidden', showTouchControls ? 'false' : 'true');
  if (game.state === 'playing') {
    applyCamera(ctx);
    drawStage(ctx);
    for (const f of fighters) f.draw(ctx);
    drawProjectiles(ctx);
    drawEffects(ctx);
  } else if (game.state === 'over') {
    // mostrar escena pero sin estelas ni golpes: congelar sprites finales
    drawStage(ctx);
    for (const f of fighters) {
      const bodyW = f.w, bodyH = f.h;
      const x = f.x - bodyW / 2, y = f.y - bodyH;
      const drawn = f.anim.draw(ctx, x, y, bodyW, bodyH, f.dir);
      if (!drawn) {
        const prefer = f.dir < 0 ? 'idle_left' : 'idle_right';
        const idleSheet = getSheet(f.charId, prefer) || getSheet(f.charId, 'idle');
        if (idleSheet && idleSheet.frames?.length) {
          const fr = idleSheet.frames[0].frame;
          const flip = f.dir < 0 ? -1 : 1;
          const destW = flip < 0 ? -bodyW : bodyW;
          const destX = flip < 0 ? x + bodyW : x;
          ctx.drawImage(idleSheet.image, fr.x, fr.y, fr.w, fr.h, destX, y, destW, bodyH);
        }
      }
    }
    // overlay de texto
    const text = game.announcerText.includes('Izq') ? '¡GANASTE!' : game.announcerText.includes('Der') ? '¡PERDISTE!' : game.announcerText;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(BASE_WIDTH/2 - 380, BASE_HEIGHT/2 - 140, 760, 280);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(BASE_WIDTH/2 - 380, BASE_HEIGHT/2 - 140, 760, 280);
    ctx.font = 'bold 48px Montserrat, Arial';
    ctx.fillStyle = '#eaf2ff';
    ctx.textAlign = 'center';
    ctx.fillText(text, BASE_WIDTH/2, BASE_HEIGHT/2);
    ctx.font = '20px Montserrat, Arial';
    ctx.fillStyle = '#9bb0ff';
    ctx.fillText('Pulsa Enter para volver a jugar', BASE_WIDTH/2, BASE_HEIGHT/2 + 46);
  }
  ctx.restore();

  updateHUD();
  const isOver = game.state === 'over';
  if (ui.post.root) {
    ui.post.root.setAttribute('aria-hidden', isOver ? 'false' : 'true');
    ui.post.root.style.display = isOver ? 'flex' : 'none';
  }
  endFrameInput();
  requestAnimationFrame(frame);
}

frame();
// Postgame buttons
ui.post.replay?.addEventListener('click', () => {
  showSelect(false);
  resetRound();
  game.state = 'playing';
  game.isRoundActive = true;
  if (ui.post?.root) ui.post.root.setAttribute('aria-hidden', 'true');
});
ui.post.reselect?.addEventListener('click', () => {
  game.state = 'select';
  showSelect(true);
  if (ui.post?.root) ui.post.root.setAttribute('aria-hidden', 'true');
});

// Botón HUD para volver a selección en cualquier momento
ui.buttons.openSelect?.addEventListener('click', () => {
  game.state = 'select';
  showSelect(true);
});

// Habilitar controles táctiles para P1 y forzar P2 como CPU en móviles
(function initTouchControls(){
  const isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(max-width: 850px)').matches);
  if (!isTouch) return;
  // fuerza 1v1 y CPU para P2
  game.mode = '1v1';
  try { if (ui.select.mode) ui.select.mode.value = '1v1'; } catch {}
  // Mapear botones touch -> teclas de P1
  const map = { left:'a', right:'d', up:'w', down:'s', attack:'f', special:'t', block:'g' };
  function bind(el){
    const act = el.dataset.act; const key = map[act]; if (!key) return;
    const press = () => { input.keys.add(key); input.pressed.add(key); };
    const release = () => { input.keys.delete(key); };
    el.addEventListener('touchstart', (e)=>{ e.preventDefault(); press(); }, { passive:false });
    el.addEventListener('touchend', (e)=>{ e.preventDefault(); release(); }, { passive:false });
    el.addEventListener('touchcancel', (e)=>{ e.preventDefault(); release(); }, { passive:false });
  }
  try { document.querySelectorAll('#touch-controls [data-act]')?.forEach(bind); } catch {}
})();


