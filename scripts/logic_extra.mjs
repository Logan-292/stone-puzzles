import { mod, rnd, shuffle, clamp } from "./util.mjs";

const limitOf = p => Math.max(0, Math.trunc(Number(p.config.maxAttempts) || 0));
const exhaustedP = p => { const l = limitOf(p); return l > 0 && (p.state.attempts ?? 0) >= l; };

/* ------------------------------------------------------------------ */
/* ПАРЫ ИЗ КАРТИНОК                                                    */
/* ------------------------------------------------------------------ */
export const MAX_PAIRS = 8;

export const pairs = {
  create(c) {
    const n = Math.min(MAX_PAIRS, (c.pairs ?? []).length);
    const idx = () => shuffle([...Array(n).keys()]);
    return { n, left: idx(), right: idx(), links: Array(n).fill(-1), locked: Array(n).fill(false), attempts: 0 };
  },
  act(p, op, d) {
    const s = p.state;
    const l = Number(d.l);
    const okIdx = i => Number.isInteger(i) && i >= 0 && i < s.n;
    if (op === "link") {
      const r = Number(d.r);
      if (!okIdx(l) || !okIdx(r) || s.locked[l] || s.locked[r]) return {};
      for (let k = 0; k < s.n; k++) if (s.links[k] === r && !s.locked[k]) s.links[k] = -1;
      s.links[l] = r;
      return {};
    }
    if (op === "unlink") {
      if (okIdx(l) && !s.locked[l]) s.links[l] = -1;
      return {};
    }
    if (op === "check") {
      if (exhaustedP(p)) return { fx: "bad", msg: "Попытки исчерпаны — скрижаль больше не слушает." };
      let any = 0, wrong = 0;
      for (let k = 0; k < s.n; k++) {
        if (s.locked[k] || s.links[k] < 0) continue;
        any++;
        if (s.links[k] === k) s.locked[k] = true;
        else { wrong++; s.links[k] = -1; }
      }
      if (!any) return { msg: "Соедините хотя бы одну пару." };
      if (wrong) s.attempts = (s.attempts ?? 0) + 1;
      const ok = s.locked.filter(Boolean).length;
      return { fx: wrong ? "bad" : "ok", msg: wrong ? `Верно: ${ok} из ${s.n}. Неверные связи разорвались.` : `Верно: ${ok} из ${s.n}.` };
    }
    return {};
  },
  assist(p) {
    const s = p.state;
    const l = s.locked.findIndex(x => !x);
    let refunded = false;
    if (limitOf(p) && (s.attempts ?? 0) > 0) { s.attempts--; refunded = true; }
    if (l < 0) return refunded;
    for (let k = 0; k < s.n; k++) if (k !== l && !s.locked[k] && s.links[k] === l) s.links[k] = -1;
    s.links[l] = l;
    s.locked[l] = true;
    return true;
  },
  check(p) { const s = p.state; return s.n > 0 && s.locked.every(Boolean); }
};

/* ------------------------------------------------------------------ */
/* ЛОВУШКА С РЫЧАГАМИ                                                  */
/* ------------------------------------------------------------------ */
export const levers = {
  create(c) {
    const L = clamp(Math.trunc(Number(c.levers) || 4), 3, 6);
    const M = clamp(Math.trunc(Number(c.lamps) || 4), 3, 6);
    const eff = Array.from({ length: L }, () => {
      const cnt = 1 + rnd(Math.min(3, M));
      return shuffle([...Array(M).keys()]).slice(0, cnt).sort((a, b) => a - b);
    });
    // стартуем из решённого состояния и случайно «дёргаем» рычаги — решение гарантированно существует
    let lamps;
    for (let t = 0; t < 50; t++) {
      lamps = Array(M).fill(true);
      eff.forEach(e => { if (rnd(2)) e.forEach(j => (lamps[j] = !lamps[j])); });
      if (!lamps.every(Boolean)) break;
    }
    if (lamps.every(Boolean)) lamps[0] = false;
    return {
      lamps, init: [...lamps], eff, pulled: Array(L).fill(0), known: Array(L).fill(false),
      alarm: 0, maxAlarm: clamp(Math.trunc(Number(c.maxAlarm) || 12), 4, 60), trapped: false, springs: 0
    };
  },
  act(p, op, d) {
    const s = p.state;
    if (op !== "pull" || s.trapped) return {};
    const i = Number(d.i);
    if (!Number.isInteger(i) || i < 0 || i >= s.eff.length) return {};
    s.pulled[i]++;
    s.eff[i].forEach(j => (s.lamps[j] = !s.lamps[j]));
    s.alarm++;
    if (s.lamps.every(Boolean)) return { fx: "ok", msg: "Механизм щёлкнул — все огни горят!" };
    if (s.alarm >= s.maxAlarm) {
      const text = String(p.config.trapText || "").trim() || "Ловушка сработала!";
      if (p.config.onTrap === "lock") { s.trapped = true; return { fx: "bad", msg: text }; }
      s.lamps = [...s.init]; s.alarm = 0; s.pulled = s.pulled.map(() => 0); s.springs = (s.springs ?? 0) + 1;
      return { fx: "bad", msg: `${text} Рычаги вернулись в исходное положение.` };
    }
    return {};
  },
  assist(p) {
    const s = p.state;
    if (s.trapped) { s.trapped = false; s.alarm = Math.floor(s.maxAlarm / 2); return true; }
    const i = s.known.findIndex(x => !x);
    if (i >= 0) { s.known[i] = true; return true; }
    if (s.alarm > 0) { s.alarm = Math.max(0, s.alarm - 3); return true; }
    return false;
  },
  check(p) { return p.state.lamps.every(Boolean); }
};

/* ------------------------------------------------------------------ */
/* ТЕНЬ И СВЕТ                                                         */
/* ------------------------------------------------------------------ */
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N
const reflect = (d, t) => (t === 1 ? [-d[1], -d[0]] : [d[1], d[0]]); // 1: «/», 2: «\»
const typeFor = (d, nd) => [1, 2].find(t => { const r = reflect(d, t); return r[0] === nd[0] && r[1] === nd[1]; });

/** Луч от левого края: возвращает точки (в координатах клеток) и попадание в цель. */
export function traceBeam(s) {
  let x = 0, y = s.y0, d = [1, 0], lx = 0, ly = s.y0, hit = false;
  const pts = [[-0.5, y + 0.5]];
  for (let step = 0; step < 500; step++) {
    if (x < 0 || y < 0 || x >= s.size || y >= s.size) { pts.push([lx + 0.5 + d[0] * 0.5, ly + 0.5 + d[1] * 0.5]); break; }
    lx = x; ly = y;
    pts.push([x + 0.5, y + 0.5]);
    if (x === s.target[0] && y === s.target[1]) { hit = true; break; }
    const c = s.grid[y][x];
    if (c === 9) break;
    if (c === 1 || c === 2) d = reflect(d, c);
    x += d[0]; y += d[1];
  }
  return { pts, hit };
}

function genMirrors(size, turns, decoys, walls) {
  const key = (x, y) => `${x},${y}`;
  for (let att = 0; att < 500; att++) {
    const used = new Set();
    const sol = {};
    const y0 = rnd(size);
    let x = 0, y = y0, d = DIRS[0];
    used.add(key(x, y));
    const ahead = () => {
      const cells = [];
      for (let k = 1; ; k++) {
        const cx = x + d[0] * k, cy = y + d[1] * k;
        if (cx < 0 || cy < 0 || cx >= size || cy >= size || used.has(key(cx, cy))) break;
        cells.push([cx, cy]);
      }
      return cells;
    };
    let ok = true;
    for (let t = 0; t < turns && ok; t++) {
      const cells = ahead();
      if (cells.length < 1) { ok = false; break; }
      const k = 1 + rnd(cells.length);
      cells.slice(0, k).forEach(([cx, cy]) => used.add(key(cx, cy)));
      const [mx, my] = cells[k - 1];
      const opts = DIRS.filter(nd => (nd[0] !== d[0] || nd[1] !== d[1]) && (nd[0] !== -d[0] || nd[1] !== -d[1]))
        .filter(nd => {
          const nx = mx + nd[0], ny = my + nd[1];
          return nx >= 0 && ny >= 0 && nx < size && ny < size && !used.has(key(nx, ny));
        });
      if (!opts.length) { ok = false; break; }
      const nd = opts[rnd(opts.length)];
      sol[key(mx, my)] = typeFor(d, nd);
      x = mx; y = my; d = nd;
    }
    if (!ok) continue;
    const last = ahead();
    if (!last.length) continue;
    const target = last[rnd(last.length)];
    const k = last.findIndex(c => c === target);
    last.slice(0, k + 1).forEach(([cx, cy]) => used.add(key(cx, cy)));

    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    for (const [k2, t] of Object.entries(sol)) { const [mx, my] = k2.split(",").map(Number); grid[my][mx] = t; }
    const free = [];
    for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) if (!used.has(key(xx, yy))) free.push([xx, yy]);
    const pool = shuffle(free);
    for (let i = 0; i < walls && pool.length; i++) { const [wx, wy] = pool.pop(); grid[wy][wx] = 9; }
    for (let i = 0; i < decoys && pool.length; i++) { const [dx, dy] = pool.pop(); grid[dy][dx] = 1 + rnd(2); }
    return { size, y0, grid, target, sol };
  }
  // запасной вариант: простая комната с одним зеркалом
  const grid = Array.from({ length: size }, () => Array(size).fill(0));
  const y0 = Math.floor(size / 2);
  grid[y0][size - 1] = 1;
  return { size, y0, grid, target: [size - 1, 0], sol: { [`${size - 1},${y0}`]: 1 } };
}

export const mirrors = {
  create(c) {
    const size = clamp(Math.trunc(Number(c.size) || 7), 5, 9);
    const turns = clamp(Math.trunc(Number(c.turns) || 4), 1, 7);
    const g = genMirrors(size, turns, clamp(Math.trunc(Number(c.decoys) || 0), 0, 12), clamp(Math.trunc(Number(c.walls) || 0), 0, 12));
    const s = { ...g, locked: {}, flips: 0 };
    // испортим решение: часть зеркал на пути повернём неверно, чтобы луч не дошёл
    const keys = Object.keys(g.sol);
    for (let t = 0; t < 40; t++) {
      keys.forEach(k => { const [x, y] = k.split(",").map(Number); s.grid[y][x] = rnd(10) < 6 ? 3 - g.sol[k] : g.sol[k]; });
      if (!traceBeam(s).hit) break;
    }
    if (traceBeam(s).hit && keys.length) { const [x, y] = keys[0].split(",").map(Number); s.grid[y][x] = 3 - g.sol[keys[0]]; }
    return s;
  },
  act(p, op, d) {
    const s = p.state;
    if (op !== "flip") return {};
    const x = Number(d.x), y = Number(d.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= s.size || y >= s.size) return {};
    const c = s.grid[y][x];
    if ((c !== 1 && c !== 2) || s.locked[`${x},${y}`]) return {};
    s.grid[y][x] = 3 - c;
    s.flips = (s.flips ?? 0) + 1;
    return traceBeam(s).hit ? { fx: "ok", msg: "Луч коснулся руны!" } : {};
  },
  assist(p) {
    const s = p.state;
    const wrong = Object.keys(s.sol).filter(k => { const [x, y] = k.split(",").map(Number); return s.grid[y][x] !== s.sol[k]; });
    const pool = wrong.length ? wrong : [];
    if (!pool.length) return false;
    const k = pool[rnd(pool.length)];
    const [x, y] = k.split(",").map(Number);
    s.grid[y][x] = s.sol[k];
    s.locked[k] = true;
    return true;
  },
  check(p) { return traceBeam(p.state).hit; }
};
