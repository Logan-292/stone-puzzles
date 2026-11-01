export const MOD = "stone-puzzles";

/** Мини-хелпер создания DOM-элементов. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === "value") value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") el[k] = true;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  if (value !== undefined) el.value = value;
  return el;
}

export const rnd = n => Math.floor(Math.random() * n);
export const mod = (n, m) => ((n % m) + m) % m;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
export const norm = s => String(s ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function field(label, control, hint) {
  return h("div", { class: "sp-field" },
    h("span", { class: "sp-flabel" }, label),
    control,
    hint ? h("small", { class: "sp-hint-text" }, hint) : null);
}

export function pickImage(current, cb) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  new FP({ type: "image", current, callback: cb }).render({ force: true });
}
