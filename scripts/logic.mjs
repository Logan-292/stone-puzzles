import { mod, rnd, shuffle, norm, clamp } from "./util.mjs";
import { pairs, levers, mirrors } from "./logic_extra.mjs";
export { traceBeam, MAX_PAIRS } from "./logic_extra.mjs";

export const ALPHA = {
  cyr: "абвгдежзийклмнопрстуфхцчшщъыьэюя",
  lat: "abcdefghijklmnopqrstuvwxyz",
  dig: "0123456789"
};
export const RUNES = Array.from("ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ");
export const runeGlyph = i => RUNES[(i * 2) % RUNES.length];

export const TYPES = {
  rings:   { label: "Радиальные кольца", icon: "fa-bullseye",    short: "Кольца" },
  cipher:  { label: "Шифр",              icon: "fa-scroll",      short: "Шифр" },
  cryptex: { label: "Криптекс",          icon: "fa-lock",        short: "Криптекс" },
  gaps:    { label: "Пропущенное слово", icon: "fa-pen-nib",     short: "Слово" },
  lock:    { label: "Арканый замок",     icon: "fa-hat-wizard",  short: "Замок" },
  pick:    { label: "Взлом замка",       icon: "fa-key",         short: "Взлом" },
  pairs:   { label: "Пары из картинок",  icon: "fa-link",        short: "Пары" },
  levers:  { label: "Ловушка с рычагами", icon: "fa-gears",      short: "Рычаги" },
  mirrors: { label: "Тень и свет",       icon: "fa-lightbulb",   short: "Свет" }
};

export const DEFAULTS = {
  rings:   { image: "", rings: 4, steps: 12, fixedOuter: true },
  cipher:  { text: "Тот, кто читает эти строки, достоин войти.", mode: "substitution", shift: 0, maxAttempts: 0 },
  cryptex: { answer: "руны", alphabet: "auto", custom: "" },
  gaps:    { text: "Врата откроются лишь тому, кто назовёт имя [древнего] стража.", decoys: "", maxAttempts: 0 },
  lock:    { count: 8, sequence: [], maxFails: 0 },
  pick:    { pins: 4, durability: 8, stat: "best", adv: "normal", dc: 12, dcStep: 1 },
  pairs:   { pairs: [
    { a: { img: "", text: "Солнце" }, b: { img: "", text: "День" } },
    { a: { img: "", text: "Луна" }, b: { img: "", text: "Ночь" } },
    { a: { img: "", text: "Огонь" }, b: { img: "", text: "Пепел" } }
  ], maxAttempts: 0 },
  levers:  { levers: 4, lamps: 4, maxAlarm: 12, onTrap: "reset", trapText: "" },
  mirrors: { size: 7, turns: 4, decoys: 3, walls: 3 }
};

/** Характеристики и навыки D&D 5e (2024): ключи как в системе dnd5e. */
export const ABILITIES = {
  str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма"
};
export const SKILLS = {
  acr: "Акробатика (Лов)", ani: "Уход за животными (Мдр)", arc: "Магия (Инт)", ath: "Атлетика (Сил)",
  dec: "Обман (Хар)", his: "История (Инт)", ins: "Проницательность (Мдр)", itm: "Запугивание (Хар)",
  inv: "Расследование (Инт)", med: "Медицина (Мдр)", nat: "Природа (Инт)", prc: "Внимательность (Мдр)",
  prf: "Выступление (Хар)", per: "Убеждение (Хар)", rel: "Религия (Инт)", slt: "Ловкость рук (Лов)",
  ste: "Скрытность (Лов)", sur: "Выживание (Мдр)"
};

/** Название проверки: своё, либо по выбранной характеристике. */
export function rollLabel(r) {
  if (r?.label) return r.label;
  const st = r?.stat ?? "custom";
  if (st.startsWith("abilities.")) return `Проверка: ${ABILITIES[st.slice(10)] ?? st}`;
  if (st.startsWith("skills.")) return `Проверка: ${(SKILLS[st.slice(7)] ?? st).replace(/ \(.+\)$/, "")}`;
  return "Проверка";
}

export const limitOf = p => Math.max(0, Math.trunc(Number(p.config.maxAttempts) || 0));
export const exhausted = p => { const l = limitOf(p); return l > 0 && (p.state.attempts ?? 0) >= l; };

const fold = c => String(c).toLowerCase().replace(/ё/g, "е");
export const alphaOf = c => (ALPHA.cyr.includes(c) ? "cyr" : ALPHA.lat.includes(c) ? "lat" : null);

function derange(L) {
  const arr = Array.from(L);
  let sh = shuffle(arr);
  for (let t = 0; t < 300 && sh.some((x, i) => x === arr[i]); t++) sh = shuffle(arr);
  const map = {};
  arr.forEach((x, i) => (map[x] = sh[i]));
  return map;
}

/* ------------------------------------------------------------------ */
/* ШИФР                                                                */
/* ------------------------------------------------------------------ */
export function cipherCells(p) {
  const s = p.state;
  const text = String(p.config.text || "").replace(/\r/g, "");
  return Array.from(text).map(raw => {
    const c = fold(raw);
    const a = alphaOf(c);
    if (!a) return { raw, letter: false };
    const L = ALPHA[a];
    const cipher = s.mode === "caesar" ? L[mod(L.indexOf(c) + s.shift, L.length)] : s.key[c];
    return { raw, letter: true, plain: c, cipher, alpha: a };
  });
}

const cipherAlphas = p => {
  const set = new Set(cipherCells(p).filter(x => x.letter).map(x => x.alpha));
  return [...set];
};

const cipher = {
  create(c) {
    const text = String(c.text || "");
    const alphas = new Set(Array.from(text).map(ch => alphaOf(fold(ch))).filter(Boolean));
    if (!alphas.size) alphas.add("lat");
    const st = { mode: c.mode === "caesar" ? "caesar" : "substitution", guess: {}, fixed: {}, reveal: 0, shift: 0, g: 0, plen: 26, key: {}, attempts: 0 };
    if (st.mode === "caesar") {
      const primary = alphas.has("cyr") ? "cyr" : "lat";
      const len = ALPHA[primary].length;
      st.plen = len;
      const want = Math.trunc(Number(c.shift) || 0);
      st.shift = want > 0 && mod(want, len) !== 0 ? mod(want, len) : 1 + rnd(len - 1);
    } else {
      for (const a of alphas) Object.assign(st.key, derange(ALPHA[a]));
    }
    return st;
  },
  act(p, op, d) {
    const s = p.state;
    if ((op === "shift" || (op === "assign" && d.p)) && exhausted(p)) return { fx: "bad", msg: "Попытки исчерпаны — скрижаль больше не слушает." };
    if (op === "shift" && s.mode === "caesar") {
      const g = mod(Math.trunc(Number(d.v) || 0), s.plen);
      if (g !== s.g) { s.g = g; s.attempts = (s.attempts ?? 0) + 1; }
      return {};
    }
    if (op === "assign" && s.mode === "substitution") {
      const c = fold(d.c ?? "");
      const pl = fold(d.p ?? "");
      if (!Object.values(s.key).includes(c) || s.fixed[c]) return {};
      if (!pl) { delete s.guess[c]; return {}; }
      if (alphaOf(pl) !== alphaOf(c)) return { fx: "bad", msg: "Эта буква из другого алфавита." };
      for (const k of Object.keys(s.guess)) {
        if (s.guess[k] === pl && k !== c) {
          if (s.fixed[k]) return { fx: "bad", msg: "Эта буква уже закреплена за другим знаком." };
          delete s.guess[k];
        }
      }
      s.guess[c] = pl;
      s.attempts = (s.attempts ?? 0) + 1;
    }
    return {};
  },
  assist(p) {
    const s = p.state;
    const refund = () => { if (limitOf(p) && (s.attempts ?? 0) > 0) { s.attempts = Math.max(0, s.attempts - 5); return true; } return false; };
    if (s.mode === "caesar") {
      const words = String(p.config.text || "").split(/\s+/).filter(Boolean);
      const r = refund();
      if (s.reveal >= words.length) return r;
      s.reveal = Math.min(words.length, s.reveal + 2);
      return true;
    }
    const wrong = cipherCells(p).filter(x => x.letter && s.guess[x.cipher] !== x.plain);
    const r = refund();
    if (!wrong.length) return r;
    const w = wrong[rnd(wrong.length)];
    for (const k of Object.keys(s.guess)) if (s.guess[k] === w.plain && k !== w.cipher) delete s.guess[k];
    s.guess[w.cipher] = w.plain;
    s.fixed[w.cipher] = true;
    return true;
  },
  check(p) {
    const s = p.state;
    const cells = cipherCells(p).filter(x => x.letter);
    if (!cells.length) return false;
    if (s.mode === "caesar") {
      return cipherAlphas(p).every(a => mod(s.g, ALPHA[a].length) === mod(s.shift, ALPHA[a].length));
    }
    return cells.every(x => s.guess[x.cipher] === x.plain);
  }
};

/* ------------------------------------------------------------------ */
/* КРИПТЕКС                                                            */
/* ------------------------------------------------------------------ */
export const cryptAnswer = c => Array.from(fold(String(c.answer || "")).replace(/\s+/g, "")).slice(0, 10);

function cryptAlphabet(c, answer) {
  const a = answer.join("");
  let set = "";
  const k = c.alphabet || "auto";
  if (k === "custom" && String(c.custom || "").trim()) set = Array.from(new Set(Array.from(fold(c.custom).replace(/\s+/g, "")))).join("");
  else if (k === "cyr" || k === "lat" || k === "dig") set = ALPHA[k];
  else {
    const hasDig = /[0-9]/.test(a);
    if (/[а-я]/.test(a)) set = ALPHA.cyr + (hasDig ? ALPHA.dig : "");
    else if (/[a-z]/.test(a)) set = ALPHA.lat + (hasDig ? ALPHA.dig : "");
    else set = ALPHA.dig;
  }
  for (const ch of answer) if (!set.includes(ch)) set += ch;
  return set;
}

const cryptex = {
  create(c) {
    let answer = cryptAnswer(c);
    if (!answer.length) answer = Array.from("камень");
    const alpha = cryptAlphabet(c, answer);
    const L = Array.from(alpha);
    const pos = answer.map(() => L[rnd(L.length)]);
    if (L.length > 1) pos.forEach((ch, i) => { if (ch === answer[i]) pos[i] = L[mod(L.indexOf(ch) + 1 + rnd(L.length - 1), L.length)]; });
    return { alpha, pos, locked: answer.map(() => false), opened: false, tries: 0, autoLocked: 0 };
  },
  act(p, op, d) {
    const s = p.state;
    const L = Array.from(s.alpha);
    if (op === "spin") {
      const i = Number(d.i);
      if (!Number.isInteger(i) || i < 0 || i >= s.pos.length || s.locked[i]) return {};
      s.pos[i] = L[mod(L.indexOf(s.pos[i]) + (d.dir < 0 ? -1 : 1), L.length)];
      // первые две верно поставленные буквы фиксируются
      if ((s.autoLocked ?? 0) < 2 && s.pos[i] === cryptAnswer(p.config)[i]) {
        s.locked[i] = true;
        s.autoLocked = (s.autoLocked ?? 0) + 1;
        return { fx: "ok", msg: "Колесо встало на место и замерло." };
      }
      return {};
    }
    if (op === "open") {
      s.tries++;
      const ans = cryptAnswer(p.config);
      if (s.pos.join("") === ans.join("")) { s.opened = true; return { fx: "ok", msg: "Щёлк! Замок открыт." }; }
      return { fx: "bad", msg: "Замок не поддаётся." };
    }
    return {};
  },
  assist(p) {
    const s = p.state;
    const ans = cryptAnswer(p.config);
    const idx = ans.map((ch, i) => i).filter(i => !s.locked[i] && s.pos[i] !== ans[i]);
    const pick = idx.length ? idx : ans.map((ch, i) => i).filter(i => !s.locked[i]);
    if (!pick.length) return false;
    const i = pick[rnd(pick.length)];
    s.pos[i] = ans[i];
    s.locked[i] = true;
    return true;
  },
  check(p) { return !!p.state.opened; }
};

/* ------------------------------------------------------------------ */
/* ПРОПУЩЕННОЕ СЛОВО                                                   */
/* ------------------------------------------------------------------ */
export function parseGaps(sentence) {
  const s = String(sentence || "");
  const parts = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ t: s.slice(last, m.index) });
    parts.push({ gap: i++, answers: m[1].split("|").map(x => x.trim()).filter(Boolean) });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ t: s.slice(last) });
  return parts;
}
const gapList = p => parseGaps(p.config.text).filter(x => x.gap !== undefined);
const gapMatch = (g, w) => g.answers.some(a => norm(a) === norm(w));

const gaps = {
  create(c) {
    const g = gapList({ config: c });
    const answers = g.map(x => x.answers[0] ?? "");
    const decoys = String(c.decoys || "").split(",").map(x => x.trim()).filter(Boolean)
      .filter(x => !answers.some(a => norm(a) === norm(x)));
    const bank = decoys.length ? shuffle([...answers, ...decoys]) : null;
    return { bank, filled: g.map(() => ""), locked: g.map(() => false), attempts: 0 };
  },
  act(p, op, d) {
    const s = p.state;
    const g = gapList(p);
    if (op === "place") {
      const i = Number(d.i);
      if (!Number.isInteger(i) || i < 0 || i >= g.length || s.locked[i]) return {};
      s.filled[i] = String(d.word ?? "").trim().slice(0, 60);
      return {};
    }
    if (op === "check") {
      if (exhausted(p)) return { fx: "bad", msg: "Попытки исчерпаны — скрижаль больше не слушает." };
      if (Array.isArray(d.values)) g.forEach((x, i) => { if (!s.locked[i] && d.values[i] !== undefined) s.filled[i] = String(d.values[i]).trim().slice(0, 60); });
      let wrong = 0, any = 0;
      g.forEach((x, i) => {
        if (s.locked[i] || !s.filled[i]) return;
        any++;
        if (gapMatch(x, s.filled[i])) s.locked[i] = true;
        else { wrong++; s.filled[i] = ""; }
      });
      if (!any) return { msg: "Заполните пропуски." };
      if (wrong) s.attempts = (s.attempts ?? 0) + 1;
      const ok = s.locked.filter(Boolean).length;
      return { fx: wrong ? "bad" : "ok", msg: wrong ? `Верно: ${ok} из ${g.length}. Неверные слова стёрлись.` : `Верно: ${ok} из ${g.length}.` };
    }
    return {};
  },
  assist(p) {
    const s = p.state;
    const g = gapList(p);
    const i = g.findIndex((x, k) => !s.locked[k]);
    let refunded = false;
    if (limitOf(p) && (s.attempts ?? 0) > 0) { s.attempts--; refunded = true; }
    if (i < 0) return refunded;
    s.filled[i] = g[i].answers[0] ?? "";
    s.locked[i] = true;
    return true;
  },
  check(p) { const s = p.state; return s.locked.length > 0 && s.locked.every(Boolean); }
};

/* ------------------------------------------------------------------ */
/* АРКАНЫЙ ЗАМОК                                                       */
/* ------------------------------------------------------------------ */
const lock = {
  create(c) {
    const n = clamp(Math.trunc(Number(c.count)), 5, 12);
    let seq = (c.sequence ?? []).filter(i => Number.isInteger(i) && i >= 0 && i < n);
    if (seq.length < 2) seq = shuffle([...Array(n).keys()]).slice(0, 4);
    return { n, seq, progress: 0, given: 0, fails: 0, jammed: false, maxFails: Math.max(0, Math.trunc(Number(c.maxFails) || 0)) };
  },
  act(p, op, d) {
    const s = p.state;
    if (op !== "rune" || s.jammed) return {};
    const i = Number(d.i);
    if (!Number.isInteger(i) || i < 0 || i >= s.n) return {};
    if (i === s.seq[s.progress]) {
      s.progress++;
      return s.progress >= s.seq.length ? { fx: "ok", msg: "Печати сняты." } : {};
    }
    s.fails++;
    s.progress = s.given;
    if (s.maxFails && s.fails >= s.maxFails) {
      s.jammed = true;
      return { fx: "bad", msg: "Замок заклинило! Нужна помощь." };
    }
    return { fx: "bad", msg: "Руны гаснут — порядок неверен." };
  },
  assist(p) {
    const s = p.state;
    let did = false;
    if (s.jammed) { s.jammed = false; s.fails = 0; did = true; }
    if (s.given < s.seq.length - 1) { s.given++; did = true; }
    s.progress = Math.max(s.progress, s.given);
    return did;
  },
  check(p) { return p.state.progress >= p.state.seq.length; }
};

/* ------------------------------------------------------------------ */
/* РАДИАЛЬНЫЕ КОЛЬЦА                                                   */
/* ------------------------------------------------------------------ */
const rings = {
  create(c) {
    const n = clamp(Math.trunc(Number(c.rings)), 2, 6);
    const steps = clamp(Math.trunc(Number(c.steps)), 4, 24);
    const locked = Array.from({ length: n }, (_, i) => !!c.fixedOuter && i === n - 1);
    const rot = locked.map(l => (l ? 0 : 1 + rnd(steps - 1)));
    const movable = rot.map((r, i) => i).filter(i => !locked[i]);
    return { n, steps, rot, locked, firstDone: false };
  },
  act(p, op, d) {
    const s = p.state;
    if (op !== "rot") return {};
    const i = Number(d.ring);
    if (!Number.isInteger(i) || i < 0 || i >= s.n || s.locked[i]) return {};
    s.rot[i] = mod(s.rot[i] + (d.dir < 0 ? -1 : 1), s.steps);
    // первое верно поставленное кольцо фиксируется
    if (!s.firstDone && s.rot[i] === 0) {
      s.firstDone = true;
      s.locked[i] = true;
      return { fx: "ok", msg: "Кольцо встало на место и замерло." };
    }
    return {};
  },
  assist(p) {
    const s = p.state;
    const idx = s.rot.map((r, i) => i).filter(i => !s.locked[i] && s.rot[i] !== 0);
    const pick = idx.length ? idx : [];
    if (!pick.length) {
      const free = s.rot.map((r, i) => i).filter(i => !s.locked[i]);
      if (!free.length) return false;
      s.locked[free[0]] = true;
      return true;
    }
    const i = pick[rnd(pick.length)];
    s.rot[i] = 0;
    s.locked[i] = true;
    return true;
  },
  check(p) { return p.state.rot.every(r => r === 0); }
};

/* ------------------------------------------------------------------ */
/* ВЗЛОМ ЗАМКА: бросок персонажа + выбор позиции игроком               */
/* ------------------------------------------------------------------ */
const PICK_K = 8;
const pickAdvance = s => { s.cur++; s.feel = false; s.feelRolled = false; s.hist = []; };

const pick = {
  create(c) {
    const pins = clamp(Math.trunc(Number(c.pins) || 4), 3, 6);
    const dur = clamp(Math.trunc(Number(c.durability) || 8), 3, 30);
    return {
      pins, K: PICK_K, targets: Array.from({ length: pins }, () => 1 + rnd(PICK_K)),
      cur: 0, feel: false, feelRolled: false, durability: dur, maxDur: dur, hist: [], jammed: false
    };
  },
  act(p, op, d) {
    const s = p.state;
    if (op !== "set" || s.jammed || s.cur >= s.pins) return {};
    const pos = Number(d.pos);
    if (!Number.isInteger(pos) || pos < 1 || pos > s.K) return {};
    if (s.hist.some(x => x.pos === pos)) return { msg: "Сюда вы уже нажимали." };
    const t = s.targets[s.cur];
    if (pos === t) {
      pickAdvance(s);
      return { fx: "ok", msg: s.cur >= s.pins ? "Последний штифт встал — замок поддался!" : "Щёлк! Штифт встал на место." };
    }
    const dist = Math.abs(pos - t);
    const text = s.feel ? `${pos < t ? "правее" : "левее"}, на ${dist}` : (dist === 1 ? "горячо" : dist <= 3 ? "тепло" : "холодно");
    s.hist.push({ pos, text });
    s.durability--;
    if (s.durability <= 0) {
      s.durability = 0; s.jammed = true;
      return { fx: "bad", msg: "Отмычки сломаны — замок не поддаётся!" };
    }
    return { fx: "bad", msg: `Мимо: ${text}.` };
  },
  /** Итог броска персонажа на текущем штифте: success | fail | nat1 */
  applyFeel(p, outcome) {
    const s = p.state;
    s.feelRolled = true;
    if (outcome === "success") { s.feel = true; return { fx: "ok", msg: "Вы чувствуете штифт: теперь отмычка подсказывает направление и расстояние." }; }
    if (outcome === "nat1") {
      s.durability = Math.max(0, s.durability - 2);
      if (s.durability <= 0) { s.jammed = true; return { fx: "bad", msg: "Отмычка сломалась — больше нечем работать!" }; }
      return { fx: "bad", msg: "Отмычка погнулась (−2 прочности). Штифт не поддаётся чувству." };
    }
    return { fx: "bad", msg: "Не удалось почувствовать штифт — придётся действовать наугад." };
  },
  assist(p) {
    const s = p.state;
    if (s.jammed) { s.jammed = false; s.durability = Math.max(1, Math.ceil(s.maxDur / 2)); return true; }
    if (s.cur >= s.pins) return false;
    pickAdvance(s);
    return true;
  },
  check(p) { return p.state.cur >= p.state.pins; }
};

export const Logic = { rings, cipher, cryptex, gaps, lock, pick, pairs, levers, mirrors };
