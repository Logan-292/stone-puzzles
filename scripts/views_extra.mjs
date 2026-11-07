import { h } from "./util.mjs";
import { traceBeam, limitOf, exhausted } from "./logic.mjs";

const icon = c => h("i", { class: `fa-solid ${c}` });
const triesRow = p => {
  const l = limitOf(p);
  return l ? h("div", { class: "sp-tries" + (exhausted(p) ? " is-out" : "") },
    exhausted(p) ? "Попытки исчерпаны — нужна помощь (бросок) или сброс мастера." : `Попытки: ${p.state.attempts ?? 0} / ${l}`) : null;
};

/* ------------------------------------------------------------------ */
/* Пары из картинок                                                    */
/* ------------------------------------------------------------------ */
const PAIR_COLORS = ["#e0675a", "#e0a43f", "#7cc36b", "#4fb6c9", "#7a8fe0", "#b575d6", "#d86fa0", "#9aa05a"];

export function renderPairs(view, p) {
  const s = p.state, items = p.config.pairs ?? [];
  const dis = p.solved || exhausted(p);
  const rightOwner = {}; // правая карточка -> левая, с которой связана
  s.links.forEach((r, l) => { if (r >= 0) rightOwner[r] = l; });

  const card = (it, extra, badge, locked, onclick, sel) => h("button", {
    class: "sp-pitem" + (locked ? " is-ok" : "") + (sel ? " is-sel" : ""), disabled: locked || dis, onclick
  }, it?.img ? h("img", { src: it.img, alt: "", draggable: "false" }) : null,
    it?.text ? h("span", { class: "sp-pcap" }, it.text) : null,
    locked ? h("span", { class: "sp-pbadge sp-pdone" }, icon("fa-check")) : badge !== null ? h("span", { class: "sp-pbadge", style: { background: PAIR_COLORS[badge % PAIR_COLORS.length] } }, badge + 1) : null);

  const left = h("div", { class: "sp-pcol" }, s.left.map(l => card(items[l]?.a, "", s.links[l] >= 0 ? l : null, s.locked[l],
    () => {
      if (s.links[l] >= 0) { view.slot = l; view.send("unlink", { l }); }
      else { view.slot = view.slot === l ? null : l; view.render(); }
    }, view.slot === l)));

  const right = h("div", { class: "sp-pcol" }, s.right.map(r => card(items[r]?.b, "", rightOwner[r] !== undefined ? rightOwner[r] : null, s.locked[r],
    () => {
      if (view.slot != null && !s.locked[view.slot]) { const l = view.slot; view.slot = null; view.send("link", { l, r }); }
      else if (rightOwner[r] !== undefined) view.send("unlink", { l: rightOwner[r] });
    }, false)));

  const root = h("div", { class: "sp-pairs" }, h("div", { class: "sp-pcols" }, left, h("div", { class: "sp-parrow" }, icon("fa-arrows-left-right")), right));
  const tr = triesRow(p);
  if (tr) root.append(tr);
  root.append(h("button", { class: "sp-btn sp-big", disabled: dis, onclick: () => view.send("check") }, icon("fa-check"), " Проверить"),
    h("p", { class: "sp-note" }, "Выберите карточку слева, затем подходящую справа. Одинаковые цветные метки показывают связь."));
  return root;
}

/* ------------------------------------------------------------------ */
/* Ловушка с рычагами                                                  */
/* ------------------------------------------------------------------ */
export function renderLevers(view, p) {
  const s = p.state;
  const dis = p.solved || s.trapped;
  const lamps = h("div", { class: "sp-lamps" }, s.lamps.map((on, j) => h("div", { class: "sp-lamp" + (on ? " is-on" : "") }, h("span", {}, j + 1))));
  const levers = h("div", { class: "sp-levers" }, s.eff.map((e, i) => h("div", { class: "sp-lever-col" },
    h("button", { class: "sp-lever" + (s.pulled[i] % 2 ? " is-down" : ""), disabled: dis, title: "Дёрнуть рычаг", onclick: () => view.send("pull", { i }) },
      h("span", { class: "sp-lever-slot" }, h("span", { class: "sp-lever-knob" }))),
    h("small", { class: "sp-lever-info" }, s.known[i] ? `огни: ${e.map(j => j + 1).join(", ")}` : "?"))));
  const pips = h("div", { class: "sp-durab" }, h("span", {}, "Тревога"),
    Array.from({ length: s.maxAlarm }, (_, i) => h("i", { class: "sp-dot sp-alarm" + (i < s.alarm ? " on" : "") })));
  return h("div", { class: "sp-leverwrap" }, lamps, levers, pips,
    h("p", { class: "sp-note" }, s.trapped ? (p.config.trapText || "Ловушка сработала!") + " Нужна помощь (удачный бросок) или сброс мастера."
      : "Зажгите все огни. Каждый рычаг переключает свои огни, но каждое движение будит ловушку." + (s.springs ? ` Ловушка срабатывала: ${s.springs}.` : "")));
}

/* ------------------------------------------------------------------ */
/* Тень и свет                                                         */
/* ------------------------------------------------------------------ */
export function renderMirrors(view, p) {
  const s = p.state, n = s.size;
  const C = Math.min(64, Math.floor(470 / n)), ox = Math.round(C * 0.65), S = C * n, W = S + ox * 2;
  const canvas = h("canvas", { width: W, height: S, class: "sp-mirror-canvas" });
  const ctx = canvas.getContext("2d");
  let hover = null;

  function draw() {
    const { pts, hit } = traceBeam(s);
    const g = ctx.createLinearGradient(0, 0, W, S);
    g.addColorStop(0, "#3a352f"); g.addColorStop(1, "#262220");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, S);
    ctx.fillStyle = "#17130f"; ctx.fillRect(ox, 0, S, S);
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * C, 0); ctx.lineTo(ox + i * C, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, i * C); ctx.lineTo(ox + S, i * C); ctx.stroke();
    }
    // стены
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (s.grid[y][x] === 9) {
      ctx.fillStyle = "#5b554b"; ctx.fillRect(ox + x * C + 3, y * C + 3, C - 6, C - 6);
      ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(ox + x * C + 3, y * C + 3, C - 6, 4);
      ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(ox + x * C + 3, y * C + C - 9, C - 6, 6);
    }
    // луч
    ctx.save();
    ctx.strokeStyle = hit ? "#9df0a8" : "#ffe49a"; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowColor = hit ? "#9df0a8" : "#ffd36a"; ctx.shadowBlur = 14;
    ctx.beginPath();
    pts.forEach(([px, py], i) => { const X = ox + px * C, Y = py * C; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.stroke(); ctx.restore();
    // зеркала
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = s.grid[y][x];
      if (c !== 1 && c !== 2) continue;
      const X = ox + x * C, Y = y * C, pad = C * 0.16;
      const locked = s.locked[`${x},${y}`];
      if (hover && hover[0] === x && hover[1] === y && !locked) { ctx.fillStyle = "rgba(255,228,154,.14)"; ctx.fillRect(X + 2, Y + 2, C - 4, C - 4); }
      ctx.save();
      ctx.lineCap = "round"; ctx.lineWidth = Math.max(6, C * 0.13);
      ctx.strokeStyle = locked ? "#d9b867" : "#cfd8df";
      ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 5;
      ctx.beginPath();
      if (c === 1) { ctx.moveTo(X + pad, Y + C - pad); ctx.lineTo(X + C - pad, Y + pad); }
      else { ctx.moveTo(X + pad, Y + pad); ctx.lineTo(X + C - pad, Y + C - pad); }
      ctx.stroke(); ctx.restore();
    }
    // цель
    const tx = ox + s.target[0] * C + C / 2, ty = s.target[1] * C + C / 2;
    ctx.save(); ctx.shadowColor = hit ? "#9df0a8" : "#6b655b"; ctx.shadowBlur = hit ? 18 : 4;
    ctx.fillStyle = hit ? "#2f5a38" : "#2b2722"; ctx.strokeStyle = hit ? "#9df0a8" : "#d9b867"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(tx, ty, C * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = hit ? "#e9ffe9" : "#d9b867"; ctx.font = `${Math.round(C * 0.4)}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ᛟ", tx, ty + 1);
    // источник света
    const sy = s.y0 * C + C / 2;
    ctx.save(); ctx.shadowColor = "#ffd36a"; ctx.shadowBlur = 18;
    ctx.fillStyle = "#ffe49a"; ctx.beginPath(); ctx.arc(ox * 0.42, sy, C * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  const cellAt = ev => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - r.left) / r.width * W - ox) / C), y = Math.floor((ev.clientY - r.top) / r.height * S / C);
    return x >= 0 && y >= 0 && x < n && y < n ? [x, y] : null;
  };
  canvas.addEventListener("click", ev => {
    const c = cellAt(ev);
    if (!c || p.solved) return;
    const v = s.grid[c[1]][c[0]];
    if (v === 1 || v === 2) view.send("flip", { x: c[0], y: c[1] });
  });
  canvas.addEventListener("pointermove", ev => { const c = cellAt(ev); if (String(c) !== String(hover)) { hover = c; draw(); } });
  canvas.addEventListener("pointerleave", () => { hover = null; draw(); });
  draw();

  return h("div", { class: "sp-mirrors" }, canvas,
    h("p", { class: "sp-note" }, "Щёлкайте по зеркалам, поворачивая их, чтобы луч дошёл до руны. Каменные блоки луч не пропускают."));
}
