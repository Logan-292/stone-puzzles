import { h, mod } from "./util.mjs";
import { Store, Net, canShow, isScreen, nowMs, timerInfo } from "./store.mjs";
import { renderPairs, renderLevers, renderMirrors } from "./views_extra.mjs";
import { TYPES, ALPHA, alphaOf, cipherCells, parseGaps, runeGlyph, limitOf, exhausted, rollLabel } from "./logic.mjs";

const triesRow = p => { const l = limitOf(p); return l ? h("div", { class: "sp-tries" + (exhausted(p) ? " is-out" : "") }, exhausted(p) ? "Попытки исчерпаны — нужна помощь (бросок) или сброс мастера." : `Попытки: ${p.state.attempts ?? 0} / ${l}`) : null; };

const { ApplicationV2 } = foundry.applications.api;
const icon = c => h("i", { class: `fa-solid ${c}` });
const up = s => String(s ?? "").toUpperCase();
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/* ------------------------------------------------------------------ */
/* Картинки для колец                                                  */
/* ------------------------------------------------------------------ */
const ART = new Map();
let DEF_ART = null;

function makeDefaultArt() {
  const S = 600, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), m = S / 2;
  const bg = g.createRadialGradient(m, m, 10, m, m, m);
  bg.addColorStop(0, "#5b8fa8"); bg.addColorStop(0.5, "#27395c"); bg.addColorStop(1, "#0d1124");
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  const glyphs = Array.from("ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ");
  g.textAlign = "center"; g.textBaseline = "middle";
  for (let k = 0; k < 6; k++) {
    const r = (k + 0.5) / 6 * m, cnt = 6 + k * 3;
    g.fillStyle = k % 2 ? "#e2c26b" : "#c9d8e6";
    g.font = `${Math.round(m / 6 * 0.6)}px serif`;
    for (let i = 0; i < cnt; i++) {
      const a = i / cnt * Math.PI * 2;
      g.save(); g.translate(m + Math.cos(a) * r, m + Math.sin(a) * r); g.rotate(a + Math.PI / 2);
      g.fillText(glyphs[(i + k * 3) % glyphs.length], 0, 0); g.restore();
    }
  }
  g.strokeStyle = "rgba(255,230,160,.55)"; g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    g.beginPath(); g.moveTo(m, m); g.lineTo(m + Math.cos(a) * m, m + Math.sin(a) * m); g.stroke();
  }
  g.fillStyle = "#f3dd9a"; g.beginPath(); g.arc(m, m, 22, 0, Math.PI * 2); g.fill();
  return c;
}

/** undefined — грузится, null — ошибка, иначе готовое изображение. */
function getArt(url, cb) {
  if (!url) return (DEF_ART ??= makeDefaultArt());
  let e = ART.get(url);
  if (!e) {
    const img = new Image();
    e = { img, state: "load", cbs: [] };
    img.onload = () => { e.state = "ok"; e.cbs.splice(0).forEach(f => f()); };
    img.onerror = () => { e.state = "err"; e.cbs.splice(0).forEach(f => f()); };
    img.src = url;
    ART.set(url, e);
  }
  if (e.state === "load") { e.cbs.push(cb); return undefined; }
  return e.state === "ok" ? e.img : null;
}

/* ------------------------------------------------------------------ */
/* Рендереры головоломок                                               */
/* ------------------------------------------------------------------ */
function renderRings(view, p) {
  const s = p.state, n = s.n, S = 420, R = S / 2;
  let hover = -1, lastWheel = 0;
  const canvas = h("canvas", { width: S, height: S, class: "sp-ring-canvas" });
  const ctx = canvas.getContext("2d");

  function draw() {
    ctx.clearRect(0, 0, S, S);
    const art = getArt(p.config.image, draw);
    if (!art) {
      ctx.fillStyle = "#222"; ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = "#bbb"; ctx.font = "16px serif"; ctx.textAlign = "center";
      ctx.fillText(art === undefined ? "Скрижаль проявляется…" : "Не удалось загрузить изображение", R, R);
      return;
    }
    const iw = art.naturalWidth ?? art.width, ih = art.naturalHeight ?? art.height;
    const sw = Math.min(iw, ih), sx = (iw - sw) / 2, sy = (ih - sw) / 2;
    for (let i = 0; i < n; i++) {
      const ri = R * i / n, ro = R * (i + 1) / n;
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, ro - 1, 0, Math.PI * 2); ctx.closePath();
      if (ri > 0) { ctx.moveTo(R + ri + 1, R); ctx.arc(R, R, ri + 1, 0, Math.PI * 2); ctx.closePath(); }
      ctx.clip("evenodd");
      ctx.translate(R, R);
      ctx.rotate(s.rot[i] * Math.PI * 2 / s.steps);
      ctx.drawImage(art, sx, sy, sw, sw, -R, -R, S, S);
      ctx.restore();
      if (i === hover) {
        ctx.save(); ctx.beginPath();
        ctx.arc(R, R, ro - 1, 0, Math.PI * 2); ctx.closePath();
        if (ri > 0) { ctx.moveTo(R + ri + 1, R); ctx.arc(R, R, ri + 1, 0, Math.PI * 2); ctx.closePath(); }
        ctx.fillStyle = "rgba(255,230,150,.22)"; ctx.fill("evenodd"); ctx.restore();
      }
    }
    for (let i = 0; i < n; i++) {
      const ro = R * (i + 1) / n;
      ctx.lineWidth = 4; ctx.strokeStyle = s.locked[i] ? "rgba(226,194,107,.9)" : "rgba(20,16,12,.85)";
      ctx.beginPath(); ctx.arc(R, R, ro - 2, 0, Math.PI * 2); ctx.stroke();
    }
  }

  const ringAt = ev => {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * S - R, y = (ev.clientY - r.top) / r.height * S - R;
    const d = Math.hypot(x, y);
    return d > R ? -1 : Math.min(n - 1, Math.floor(d / R * n));
  };
  const rot = (i, dir) => { if (i >= 0 && !s.locked[i] && !p.solved) view.send("rot", { ring: i, dir }); };

  canvas.addEventListener("click", ev => rot(ringAt(ev), ev.shiftKey ? -1 : 1));
  canvas.addEventListener("contextmenu", ev => { ev.preventDefault(); rot(ringAt(ev), -1); });
  canvas.addEventListener("wheel", ev => {
    ev.preventDefault();
    const now = Date.now(); if (now - lastWheel < 120) return; lastWheel = now;
    rot(ringAt(ev), ev.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  canvas.addEventListener("pointermove", ev => { const i = ringAt(ev); if (i !== hover) { hover = i; draw(); } });
  canvas.addEventListener("pointerleave", () => { hover = -1; draw(); });
  draw();

  const ctrls = h("div", { class: "sp-ring-ctrls" });
  for (let i = 0; i < n; i++) {
    const fixed = s.locked[i];
    const name = i === 0 ? "Ядро" : `Кольцо ${i}`;
    ctrls.append(h("div", { class: "sp-ring-row" + (fixed ? " is-locked" : "") },
      h("span", { class: "sp-ring-name" }, fixed ? icon("fa-lock") : null, " ", name),
      h("button", { class: "sp-btn sp-mini", title: "Против часовой", disabled: fixed || p.solved, onclick: () => rot(i, -1) }, icon("fa-rotate-left")),
      h("button", { class: "sp-btn sp-mini", title: "По часовой", disabled: fixed || p.solved, onclick: () => rot(i, 1) }, icon("fa-rotate-right"))));
  }
  return h("div", { class: "sp-rings" }, canvas,
    h("div", { class: "sp-side" },
      h("p", { class: "sp-note" }, "Клик по кольцу — вращение по часовой, правый клик или Shift — против, колесо мыши тоже работает. Соберите изображение."),
      ctrls));
}

function renderCipher(view, p, root) {
  const s = p.state;
  if (s.mode === "caesar") return renderCaesar(view, p);
  const cells = cipherCells(p);
  const text = h("div", { class: "sp-text" });
  let word = null;
  const flush = () => { if (word) { text.append(word); word = null; } };
  for (const c of cells) {
    if (c.raw === "\n") { flush(); text.append(h("div", { class: "sp-break" })); continue; }
    if (/\s/.test(c.raw)) { flush(); text.append(h("span", { class: "sp-space" })); continue; }
    word ??= h("span", { class: "sp-word" });
    if (!c.letter) { word.append(h("span", { class: "sp-punct" }, c.raw)); continue; }
    const g = s.guess[c.cipher];
    word.append(h("button", {
      class: "sp-cell" + (view.sel === c.cipher ? " is-sel" : "") + (s.fixed[c.cipher] ? " is-fixed" : ""),
      onclick: () => { view.sel = view.sel === c.cipher ? null : c.cipher; view.render(); }
    }, h("span", { class: "sp-c-top" }, up(c.cipher)), h("span", { class: "sp-c-bot" }, g ? up(g) : "·")));
  }
  flush();

  const freq = {};
  cells.filter(c => c.letter).forEach(c => (freq[c.cipher] = (freq[c.cipher] ?? 0) + 1));
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${up(k)}×${v}`).join("  ");

  const kb = h("div", { class: "sp-kb" });
  if (exhausted(p) && !p.solved) {
    // клавиатура недоступна
  } else if (view.sel && !p.solved && !s.fixed[view.sel]) {
    const L = ALPHA[alphaOf(view.sel)] ?? "";
    for (const ch of L) kb.append(h("button", { class: "sp-key", onclick: () => view.send("assign", { c: view.sel, p: ch }) }, up(ch)));
    kb.append(h("button", { class: "sp-key sp-key-del", title: "Стереть", onclick: () => view.send("assign", { c: view.sel, p: "" }) }, icon("fa-delete-left")));
  } else if (!p.solved) {
    kb.append(h("p", { class: "sp-note" }, s.fixed[view.sel] ? "Этот знак уже открыт." : "Выберите знак на скрижали, затем назовите его букву (можно с клавиатуры)."));
  }

  root.addEventListener("keydown", e => {
    if (!view.sel || p.solved || exhausted(p) || e.target.matches("input,textarea")) return;
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); view.send("assign", { c: view.sel, p: "" }); }
    else if (e.key.length === 1 && /\p{L}/u.test(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); view.send("assign", { c: view.sel, p: e.key }); }
  });

  return h("div", { class: "sp-cipher" }, text,
    h("div", { class: "sp-freq" }, h("strong", {}, "Частота знаков: "), top || "—"),
    revealRow(p), triesRow(p), kb);
}

function revealRow(p) {
  const n = p.state.reveal ?? 0;
  if (!n) return null;
  const words = String(p.config.text || "").split(/\s+/).filter(Boolean).slice(0, n).join(" ");
  return h("div", { class: "sp-reveal" }, h("strong", {}, "Проявившийся фрагмент: "), up(words), " …");
}

function renderCaesar(view, p) {
  const s = p.state, cells = cipherCells(p);
  const primary = cells.some(c => c.alpha === "cyr") ? "cyr" : "lat";
  const L = Array.from(ALPHA[primary]);
  const shiftBy = d => !p.solved && view.send("shift", { v: s.g + d });

  const row = (letters, cls) => h("div", { class: `sp-disc-row ${cls}` }, letters.map(l => h("span", {}, up(l))));
  const disc = h("div", { class: "sp-disc" },
    h("div", { class: "sp-disc-label" }, "Знак на скрижали"), row(L, "outer"),
    row(L.map((_, i) => L[mod(i - s.g, L.length)]), "inner"),
    h("div", { class: "sp-disc-label" }, "Читается как"));

  const dec = h("div", { class: "sp-decoded" });
  let word = null;
  const flush = () => { if (word) { dec.append(word); word = null; } };
  for (const c of cells) {
    if (c.raw === "\n") { flush(); dec.append(h("div", { class: "sp-break" })); continue; }
    if (/\s/.test(c.raw)) { flush(); dec.append(h("span", { class: "sp-space" })); continue; }
    word ??= h("span", { class: "sp-word" });
    if (!c.letter) { word.append(h("span", { class: "sp-punct" }, c.raw)); continue; }
    const A = ALPHA[c.alpha];
    word.append(h("span", { class: "sp-dch" }, up(A[mod(A.indexOf(c.cipher) - s.g, A.length)])));
  }
  flush();

  return h("div", { class: "sp-cipher sp-caesar" }, dec,
    h("div", { class: "sp-shift" },
      h("button", { class: "sp-btn", disabled: p.solved || exhausted(p), onclick: () => shiftBy(-1) }, icon("fa-chevron-left")),
      h("div", { class: "sp-shift-val" }, h("small", {}, "Сдвиг"), h("b", {}, s.g)),
      h("button", { class: "sp-btn", disabled: p.solved || exhausted(p), onclick: () => shiftBy(1) }, icon("fa-chevron-right"))),
    disc, revealRow(p), triesRow(p),
    h("p", { class: "sp-note" }, "Поворачивайте внутренний круг, пока текст не станет читаемым."));
}

function renderCryptex(view, p) {
  const s = p.state, L = Array.from(s.alpha);
  const wheels = h("div", { class: "sp-wheels" });
  const spin = (i, dir) => !p.solved && !s.locked[i] && view.send("spin", { i, dir });
  s.pos.forEach((ch, i) => {
    const idx = L.indexOf(ch);
    const dis = p.solved || s.locked[i];
    const col = h("div", { class: "sp-wheel" + (s.locked[i] ? " is-locked" : "") },
      h("button", { class: "sp-btn sp-mini", disabled: dis, onclick: () => spin(i, -1) }, icon("fa-chevron-up")),
      h("div", { class: "sp-w-side" }, up(L[mod(idx - 1, L.length)])),
      h("div", { class: "sp-w-cur" }, up(ch)),
      h("div", { class: "sp-w-side" }, up(L[mod(idx + 1, L.length)])),
      h("button", { class: "sp-btn sp-mini", disabled: dis, onclick: () => spin(i, 1) }, icon("fa-chevron-down")),
      s.locked[i] ? h("span", { class: "sp-w-lock" }, icon("fa-lock")) : null);
    let last = 0;
    col.addEventListener("wheel", ev => {
      ev.preventDefault();
      const now = Date.now(); if (now - last < 90) return; last = now;
      spin(i, ev.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    wheels.append(col);
  });
  return h("div", { class: "sp-cryptex" }, wheels,
    h("button", { class: "sp-btn sp-big", disabled: p.solved, onclick: () => view.send("open") }, icon("fa-unlock"), " Открыть"),
    h("p", { class: "sp-note" }, "Крутите колёса кнопками или колесом мыши и составьте слово."),
    s.tries ? h("p", { class: "sp-note" }, `Попыток открыть: ${s.tries}`) : null);
}

function renderGaps(view, p) {
  const s = p.state, parts = parseGaps(p.config.text);
  const total = s.filled.length;
  const freeMode = !s.bank;
  const inputs = [];
  const sentence = h("div", { class: "sp-sentence" });
  for (const part of parts) {
    if (part.gap === undefined) { sentence.append(part.t); continue; }
    const i = part.gap, locked = s.locked[i], word = s.filled[i];
    if (freeMode) {
      const inp = h("input", { type: "text", class: "sp-input" + (locked ? " is-ok" : ""), value: word, disabled: locked || p.solved, maxlength: 40, placeholder: "…",
        onchange: e => view.send("place", { i, word: e.target.value }) });
      inputs[i] = inp;
      sentence.append(inp);
    } else {
      sentence.append(h("button", {
        class: "sp-slot" + (locked ? " is-ok" : "") + (view.slot === i ? " is-sel" : "") + (word ? " is-filled" : ""),
        onclick: () => {
          if (locked || p.solved) return;
          if (word) { view.slot = i; view.send("place", { i, word: "" }); }
          else { view.slot = view.slot === i ? null : i; view.render(); }
        }
      }, word || "  "));
    }
  }
  const root = h("div", { class: "sp-gaps" }, sentence);
  if (!freeMode) {
    const left = [...s.bank];
    for (const w of s.filled) { const k = left.indexOf(w); if (k >= 0) left.splice(k, 1); }
    root.append(h("div", { class: "sp-bank" }, left.map(w => h("button", {
      class: "sp-chip", disabled: p.solved,
      onclick: () => {
        let i = view.slot;
        if (i == null || s.locked[i] || s.filled[i]) i = s.filled.findIndex((f, k) => !f && !s.locked[k]);
        if (i < 0) return;
        view.slot = null;
        view.send("place", { i, word: w });
      }
    }, w))));
  }
  const tr = triesRow(p);
  if (tr) root.append(tr);
  root.append(h("button", { class: "sp-btn sp-big", disabled: p.solved || exhausted(p), onclick: () =>
    view.send("check", { values: freeMode ? inputs.map((x, i) => (s.locked[i] ? s.filled[i] : x.value)) : s.filled }) }, icon("fa-check"), " Проверить"),
    h("p", { class: "sp-note" }, freeMode ? `Впишите недостающие слова (${total}).` : `Выберите пропуск и слово из списка (${total}).`));
  return root;
}

function renderLock(view, p) {
  const s = p.state, n = s.n, R = 135;
  const order = {};
  s.seq.slice(0, s.progress).forEach((idx, k) => (order[idx] = [...(order[idx] ?? []), ROMAN[k] ?? k + 1]));
  const box = h("div", { class: "sp-lock" + (s.jammed ? " is-jammed" : "") });
  for (let i = 0; i < n; i++) {
    const a = (-90 + i * 360 / n) * Math.PI / 180;
    box.append(h("button", {
      class: "sp-rune" + (order[i] ? " is-lit" : ""),
      style: { "--x": `${Math.cos(a) * R}px`, "--y": `${Math.sin(a) * R}px` },
      disabled: p.solved || s.jammed,
      onclick: () => view.send("rune", { i })
    }, h("span", { class: "sp-glyph" }, runeGlyph(i)), order[i] ? h("span", { class: "sp-order" }, order[i].join(",")) : null));
  }
  const dots = h("div", { class: "sp-dots" }, s.seq.map((_, k) => h("i", { class: "sp-dot" + (k < s.progress ? " on" : "") + (k < s.given ? " given" : "") })));
  box.append(h("div", { class: "sp-lock-core" }, dots,
    s.jammed ? h("b", { class: "sp-jam" }, "ЗАКЛИНИЛО") : h("small", {}, s.maxFails ? `Ошибки ${s.fails}/${s.maxFails}` : (s.fails ? `Ошибок: ${s.fails}` : "печати"))));
  return h("div", { class: "sp-lockwrap" }, box,
    h("p", { class: "sp-note" }, `Активируйте руны в верной последовательности (${s.seq.length}). Ошибка гасит цепочку.`));
}

function renderPick(view, p) {
  const s = p.state;
  const dis = p.solved || s.jammed;
  const pins = h("div", { class: "sp-pins" }, Array.from({ length: s.pins }, (_, i) =>
    h("div", { class: "sp-pin" + (i < s.cur ? " is-set" : "") + (i === s.cur && !p.solved ? " is-cur" : "") },
      h("div", { class: "sp-pin-top" }), h("div", { class: "sp-pin-body" }), h("span", { class: "sp-pin-n" }, i + 1))));
  const tried = new Map((s.hist ?? []).map(x => [x.pos, x.text]));
  const strip = h("div", { class: "sp-notches" }, Array.from({ length: s.K }, (_, k) => {
    const pos = k + 1;
    return h("button", { class: "sp-notch" + (tried.has(pos) ? " is-tried" : ""), disabled: dis || tried.has(pos),
      title: tried.get(pos) ?? "Нажать отмычкой здесь", onclick: () => view.send("set", { pos }) }, h("b", {}, pos), tried.has(pos) ? h("small", {}, tried.get(pos)) : null);
  }));
  const pips = h("div", { class: "sp-durab" }, h("span", {}, "Прочность отмычек"),
    Array.from({ length: s.maxDur }, (_, i) => h("i", { class: "sp-dot" + (i < s.durability ? " on" : "") })));
  const feelBtn = h("button", { class: "sp-btn sp-roll", disabled: dis || s.feelRolled || s.cur >= s.pins, onclick: () => view.send("feel") },
    icon("fa-dice-d20"), ` Прощупать штифт ${Math.min(s.cur + 1, s.pins)} (проверка персонажа)`);
  const feelText = s.cur >= s.pins ? "" : s.feel ? "Чутьё обострено: отмычка подсказывает направление и расстояние."
    : s.feelRolled ? "Прощупать не вышло — только «холодно / тепло / горячо»." : "Бросок Ловкости рук или воровских инструментов даст точные подсказки для этого штифта.";
  return h("div", { class: "sp-pick" }, pins,
    h("p", { class: "sp-note" }, s.jammed ? "Отмычки сломаны! Нужна помощь (удачный бросок) или сброс мастера." : "Выберите позицию, в которую нажать отмычкой. Штифты встают по порядку."),
    strip, pips,
    h("div", { class: "sp-pick-roll" }, feelBtn, h("small", {}, feelText)));
}

const RENDER = { rings: renderRings, cipher: renderCipher, cryptex: renderCryptex, gaps: renderGaps, lock: renderLock, pick: renderPick, pairs: renderPairs, levers: renderLevers, mirrors: renderMirrors };

/* ------------------------------------------------------------------ */
/* Окно головоломки                                                    */
/* ------------------------------------------------------------------ */
/* ---- Таймер ---- */
const fmtTime = ms => {
  const t = Math.ceil(ms / 1000), hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  return (hh ? `${hh}:${String(mm).padStart(2, "0")}` : String(mm)) + `:${String(ss).padStart(2, "0")}`;
};
function timerBadge(p) {
  const i = timerInfo(p);
  if (!i) return null;
  if (i.expired) return h("span", { class: "sp-badge sp-timer is-out" }, icon("fa-hourglass-end"), " Время вышло");
  const el = h("span", { class: "sp-badge sp-timer" + (i.left < 30000 && i.running ? " is-low" : "") }, icon("fa-hourglass-half"), " ", fmtTime(i.left));
  if (i.running) el.dataset.end = String(nowMs() + i.left);
  else el.title = "Таймер на паузе";
  return el;
}
// один общий «тикер» обновляет все видимые таймеры (окна и экранный оверлей)
setInterval(() => {
  document.querySelectorAll(".sp-timer[data-end]").forEach(el => {
    const left = Number(el.dataset.end) - nowMs();
    const txt = el.lastChild;
    if (txt && txt.nodeType === 3) txt.textContent = fmtTime(Math.max(0, left));
    el.classList.toggle("is-low", left < 30000);
  });
}, 500);

/** Собирает плиту головоломки; общий код для окна и для экранного оверлея. */
async function buildTablet(view) {
  const p = Store.get(view.puzzleId);
  if (!p) return h("div", { class: "sp-tablet" }, "Скрижаль рассыпалась в прах.");
  const root = h("div", { class: `sp-tablet sp-t-${p.type}` + (p.solved ? " is-solved" : ""), tabindex: "0" });
  const info = TYPES[p.type];
  root.append(h("div", { class: "sp-head" }, icon(info.icon), h("h2", {}, p.name),
    timerBadge(p),
    p.solved ? h("span", { class: "sp-badge" }, icon("fa-check"), " Решено") : null,
    game.user.isGM && !p.visible ? h("span", { class: "sp-badge sp-hidden" }, icon("fa-eye-slash"), " Скрыто") : null));
  if (p.intro) root.append(h("div", { class: "sp-intro" }, p.intro));
  root.append(h("div", { class: "sp-body" }, RENDER[p.type](view, p, root)));

  const foot = h("div", { class: "sp-foot" });
  const hints = (p.hints ?? []).filter(Boolean).slice(0, p.hintsShown ?? 0);
  if (hints.length) foot.append(h("div", { class: "sp-hints" }, hints.map((t, i) => h("div", { class: "sp-hintline" }, icon("fa-lightbulb"), h("b", {}, ` ${ROMAN[i] ?? i + 1}. `), t))));
  if (p.solved) {
    foot.append(h("div", { class: "sp-win" }, h("b", {}, "Скрижаль повинуется."), p.successText ? h("div", { class: "sp-win-text" }, p.successText) : null));
  } else if (p.roll?.enabled) {
    const left = p.roll.max > 0 ? p.roll.max - (p.rollsUsed ?? 0) : null;
    const btn = h("button", { class: "sp-btn sp-roll", disabled: left !== null && left <= 0, onclick: ev => {
      ev.currentTarget.disabled = true;
      setTimeout(() => view.render(), 1500);
      view.send("roll");
    } }, icon("fa-dice-d20"), ` ${rollLabel(p.roll)}`, left !== null ? ` (осталось ${Math.max(0, left)})` : "");
    foot.append(h("div", { class: "sp-rollbox" }, btn,
      h("small", {}, p.roll.reward === "segment" ? "При успехе часть головоломки разгадается." : "При успехе скрижаль откроет подсказку.")));
  }
  root.append(foot);
  return root;
}

const VIEWS = new Map();
const SCREENS = new Map();

export class PuzzleView extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["stone-puzzles", "sp-view"],
    tag: "div",
    window: { icon: "fa-solid fa-dungeon", resizable: true },
    position: { width: 620, height: "auto" }
  };

  static open(id) {
    let v = VIEWS.get(id);
    if (!v) { v = new PuzzleView({ id: `sp-view-${id}`, puzzleId: id }); VIEWS.set(id, v); }
    v.render({ force: true });
    return v;
  }
  static get(id) { return VIEWS.get(id); }
  static refreshAll() {
    for (const [id, v] of [...VIEWS]) {
      const p = Store.get(id);
      if (!p || !canShow(p)) v.close();
      else if (v.rendered) v.render();
    }
    for (const [id, v] of [...SCREENS]) {
      const p = Store.get(id);
      if (!p || !canShow(p) || !isScreen()) v.close();
      else v.render();
    }
  }

  constructor(options) {
    super(options);
    this.puzzleId = options.puzzleId;
    this.sel = null;
    this.slot = null;
    this._fx = null;
  }

  get title() { return Store.get(this.puzzleId)?.name ?? "Скрижаль"; }

  send(op, data) { return Net.request(this.puzzleId, op, data); }

  flash(result) {
    if (result?.msg) (result.fx === "bad" ? ui.notifications.warn : ui.notifications.info).call(ui.notifications, result.msg);
    if (!result?.fx) return;
    this._fx = result.fx;
    this.#applyFx();
    setTimeout(() => { this._fx = null; this.element?.querySelector(".sp-tablet")?.classList.remove("fx-ok", "fx-bad"); }, 800);
  }
  #applyFx() {
    const t = this.element?.querySelector(".sp-tablet");
    if (!t) return;
    t.classList.remove("fx-ok", "fx-bad");
    if (this._fx) { void t.offsetWidth; t.classList.add(`fx-${this._fx}`); }
  }

  async _renderHTML() { return buildTablet(this); }

  _replaceHTML(result, content) {
    const top = content.scrollTop;
    content.replaceChildren(result);
    content.scrollTop = top;
  }

  _onRender() {
    this.#applyFx();
    const p = Store.get(this.puzzleId);
    if (p?.type === "cipher") this.element.querySelector(".sp-tablet")?.focus({ preventScroll: true });
  }

  async _onClose() { VIEWS.delete(this.puzzleId); }
}

/**
 * Экранный оверлей: не окно Foundry, а собственный слой поверх страницы.
 * Его не скрывают стили «чистых» режимов вроде Monk's Common Display.
 */
/** Инлайн-стили с !important перебивают любые таблицы стилей, в том числе «Скрыть UI» у Monk's Common Display. */
const FORCE_ROOT = { position: "fixed", inset: "0", display: "flex", visibility: "visible", opacity: "1", "z-index": "2147483000", "pointer-events": "none", transform: "none", filter: "none" };
const FORCE_INNER = { display: "block", visibility: "visible", opacity: "1", "pointer-events": "auto" };
function force(el, rules) {
  for (const [k, val] of Object.entries(rules)) {
    if (el.style.getPropertyValue(k) !== val || el.style.getPropertyPriority(k) !== "important") el.style.setProperty(k, val, "important");
  }
}
let guardTimer = null;
function startGuard() {
  if (guardTimer) return;
  guardTimer = setInterval(() => { if (!SCREENS.size) { clearInterval(guardTimer); guardTimer = null; } else SCREENS.forEach(v => v.ensure()); }, 700);
}

/**
 * Экранный оверлей: не окно Foundry, а собственный слой поверх страницы.
 * Он сам возвращает себя на место, если «чистый» режим (Скрыть UI) его прячет или убирает.
 */
class ScreenView {
  constructor(puzzleId, n) {
    this.puzzleId = puzzleId;
    this.sel = null; this.slot = null; this._fx = null;
    this.root = h("div", { class: "sp-screen", style: { "--n": n } });
    this.inner = h("div", { class: "stone-puzzles sp-screen-inner" });
    this.root.append(h("div", { class: "sp-screen-frame" }, this.inner,
      h("button", { class: "sp-screen-x", title: "Убрать с экрана", onclick: () => this.close() }, icon("fa-xmark"))));
    this.ensure();
    this.mo = new MutationObserver(() => this.ensure());
    this.mo.observe(this.root, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
    this.mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    startGuard();
  }
  get element() { return this.inner; }
  ensure() {
    if (this._closed) return;
    if (!this.root.isConnected) (document.body ?? document.documentElement).append(this.root);
    this.root.removeAttribute("hidden");
    force(this.root, FORCE_ROOT);
    force(this.inner, FORCE_INNER);
    const cs = getComputedStyle(this.root);
    if ((cs.display === "none" || cs.visibility === "hidden") && this.root.parentElement !== document.documentElement) document.documentElement.append(this.root);
  }
  send(op, data) { return Net.request(this.puzzleId, op, data); }
  async render() {
    const el = await buildTablet(this);
    this.inner.replaceChildren(el);
    this.ensure();
    this.#fx();
  }
  flash(result) {
    if (!result?.fx) return;
    this._fx = result.fx; this.#fx();
    setTimeout(() => { this._fx = null; this.inner.querySelector(".sp-tablet")?.classList.remove("fx-ok", "fx-bad"); }, 800);
  }
  #fx() {
    const t = this.inner.querySelector(".sp-tablet");
    if (!t || !this._fx) return;
    t.classList.remove("fx-ok", "fx-bad"); void t.offsetWidth; t.classList.add(`fx-${this._fx}`);
  }
  close() { this._closed = true; this.mo.disconnect(); this.root.remove(); SCREENS.delete(this.puzzleId); }
}

/** Открыть головоломку так, как подходит этому клиенту: оверлей на экране, окно у остальных. */
export function openPuzzle(id) {
  if (!isScreen()) return PuzzleView.open(id);
  let v = SCREENS.get(id);
  if (!v) { v = new ScreenView(id, SCREENS.size); SCREENS.set(id, v); }
  v.render();
  return v;
}
export function closeScreens() { for (const v of [...SCREENS.values()]) v.close(); }

Net.feedback = (puzzleId, result) => {
  const v = PuzzleView.get(puzzleId) ?? SCREENS.get(puzzleId);
  if (v) v.flash(result);
  else if (result?.msg) ui.notifications.info(result.msg);
};
