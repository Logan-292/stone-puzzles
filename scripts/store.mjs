import { MOD, esc } from "./util.mjs";
import { Logic, TYPES, DEFAULTS, rollLabel } from "./logic.mjs";

export const canSee = (p, user) =>
  !!user && (user.isGM || (p.visible && (p.assignAll || (p.assigned ?? []).includes(user.id))));

/** Клиент работает как общий экран (Monk's Common Display или ручная галочка в настройках). */
export function isScreen() {
  try { if (game.settings.get(MOD, "screen")) return true; } catch (e) { /* настройка ещё не зарегистрирована */ }
  try { if ((game.settings.get(MOD, "screenUsers")?.ids ?? []).includes(game.user.id)) return true; } catch (e) { /* то же */ }
  try {
    if (game.modules.get("monks-common-display")?.active) {
      const pd = game.settings.get("monks-common-display", "playerdata");
      const me = Array.isArray(pd) ? pd.find(x => x.id === game.user.id) : null;
      if (me?.display) return true;
    }
  } catch (e) { /* настройки Monk's Common Display недоступны */ }
  return false;
}

/** Должна ли скрижаль быть открыта на этом клиенте. Экран показывает всё, что открыто мастером. */
export const canShow = p => (isScreen() ? !!p.visible : canSee(p, game.user));

/** Серверное время (одинаково на всех клиентах), запасной вариант — локальное. */
export const nowMs = () => game.time?.serverTime ?? Date.now();

/** Состояние таймера скрижали: null, если таймер не задан. */
export function timerInfo(p) {
  const t = p.timer;
  if (!t?.sec) return null;
  const running = t.since != null && !p.solved && !t.expired;
  const base = t.left ?? t.sec * 1000;
  return { running, left: Math.max(0, base - (running ? nowMs() - t.since : 0)), total: t.sec * 1000, expired: !!t.expired, action: t.action };
}

/** Показать/скрыть скрижаль; таймер идёт, пока она открыта. */
export function setVisible(p, v) {
  p.visible = !!v;
  const t = p.timer;
  if (!t?.sec) return;
  const n = nowMs();
  if (v) { if (!p.solved && !t.expired && t.since == null) t.since = n; }
  else if (t.since != null) { t.left = Math.max(0, (t.left ?? t.sec * 1000) - (n - t.since)); t.since = null; }
}

function stopTimer(p) {
  const t = p.timer;
  if (t?.since != null) { t.left = Math.max(0, (t.left ?? t.sec * 1000) - (nowMs() - t.since)); t.since = null; }
}

/** Если время вышло — применить последствие. Возвращает "lock" | "reset" | null. */
function applyExpiry(p) {
  const i = timerInfo(p);
  if (!i || !i.running || i.left > 0) return null;
  if (p.timer.action === "reset") { resetPuzzle(p); p.timer.resets = (p.timer.resets ?? 0) + 1; return "reset"; }
  p.timer.left = 0; p.timer.since = null; p.timer.expired = true;
  return "lock";
}

const expiryChat = (name, what) => ChatMessage.create({
  speaker: { alias: "Каменная скрижаль" },
  content: `<div class="sp-chat"><strong>Время вышло:</strong> «${esc(name)}» — ${what === "reset" ? "скрижаль сбросилась" : "скрижаль заперта"}.</div>`
});

/** Вызывается мастером по таймеру: применяет истёкшие таймеры. */
export async function sweepTimers() {
  if (!Store.list().some(p => { const i = timerInfo(p); return i?.running && i.left <= 0; })) return;
  const fired = [];
  await Store.mutate(list => { for (const p of list) { const r = applyExpiry(p); if (r) fired.push([p.name, r]); } });
  fired.forEach(([n, r]) => expiryChat(n, r));
}

/** Хранилище: все головоломки лежат в одной world-настройке. Писать может только мастер. */
export const Store = {
  list() { return foundry.utils.deepClone(game.settings.get(MOD, "data")?.puzzles ?? []); },
  get(id) { return this.list().find(p => p.id === id); },
  mutate(fn) {
    this._q = (this._q ?? Promise.resolve()).then(async () => {
      const list = this.list();
      await fn(list);
      await game.settings.set(MOD, "data", { puzzles: list });
    }).catch(e => console.error(`${MOD} |`, e));
    return this._q;
  }
};

export function newPuzzle(type) {
  const p = {
    id: foundry.utils.randomID(),
    type,
    name: TYPES[type].label,
    intro: "",
    successText: "",
    hints: [],
    roll: { enabled: type !== "pick", stat: "abilities.int", adv: "normal", label: "", formula: "1d20", dc: 15, reward: "hint", max: 0 },
    config: foundry.utils.deepClone(DEFAULTS[type]),
    visible: false,
    assignAll: true,
    assigned: [],
    solved: false,
    hintsShown: 0,
    rollsUsed: 0,
    timer: { sec: 0, action: "lock", left: 0, since: null, expired: false },
    unlocks: []
  };
  if (type === "levers") Object.assign(p.roll, { stat: "skills.inv", reward: "segment" });
  p.state = Logic[type].create(p.config);
  return p;
}

export function resetPuzzle(p) {
  p.state = Logic[p.type].create(p.config);
  p.solved = false;
  p.hintsShown = 0;
  p.rollsUsed = 0;
  if (p.timer?.sec) {
    p.timer.left = p.timer.sec * 1000;
    p.timer.since = p.visible ? nowMs() : null;
    p.timer.expired = false;
  }
}

/** Бонус персонажа dnd5e к проверке; null — данных нет. */
function resolveBonus(actor, stat) {
  const g = path => { const v = Number(foundry.utils.getProperty(actor ?? {}, path)); return Number.isFinite(v) ? v : null; };
  const dex = g("system.abilities.dex.mod");
  if (stat === "best") {
    const v = [g("system.skills.slt.total"), g("system.tools.thief.total") ?? dex].filter(x => x !== null);
    return v.length ? Math.max(...v) : null;
  }
  if (stat === "tools.thief") return g("system.tools.thief.total") ?? dex;
  if (stat.startsWith("skills.")) return g(`system.${stat}.total`);
  if (stat.startsWith("abilities.")) return g(`system.${stat}.mod`);
  return null;
}
const dieOf = adv => (adv === "adv" ? "2d20kh" : adv === "dis" ? "2d20kl" : "1d20");
const withBonus = (die, b) => (b ? `${die} ${b > 0 ? "+" : "-"} ${Math.abs(b)}` : die);

/** Взлом замка: бросок персонажа (Ловкость рук / воровские инструменты) на текущем штифте. */
async function doFeel(p, user) {
  const s = p.state, c = p.config;
  if (s.jammed) return { fx: "bad", msg: "Отмычки сломаны." };
  if (s.cur >= s.pins) return {};
  if (s.feelRolled) return { fx: "bad", msg: "Этот штифт вы уже прощупывали." };
  const actor = user.character;
  const bonus = resolveBonus(actor, c.stat || "best");
  let roll;
  try {
    roll = new Roll(withBonus(dieOf(c.adv), bonus ?? 0));
    await roll.evaluate();
  } catch (e) { return { fx: "bad", msg: "Не удалось бросить кубики." }; }
  const dc = Number(c.dc || 0) + Number(c.dcStep || 0) * s.cur;
  const first = roll.dice[0]?.results?.find(r => r.active)?.result;
  const outcome = first === 1 ? "nat1" : (first === 20 || roll.total >= dc) ? "success" : "fail";
  const word = { success: "успех", fail: "неудача", nat1: "критическая неудача" }[outcome];
  const note = bonus === null ? " (у игрока нет подходящего персонажа — бросок без бонуса)" : "";
  try {
    await roll.toMessage({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: user.name },
      flavor: `Взлом замка — штифт ${s.cur + 1} из ${s.pins}: ${word}${esc(note)}`,
      author: user.id
    });
  } catch (e) { console.warn(`${MOD} |`, e); }
  return Logic.pick.applyFeel(p, outcome);
}

async function doRoll(p, user) {
  const r = p.roll ?? {};
  if (!r.enabled) return { fx: "bad", msg: "Бросок здесь недоступен." };
  if (r.max > 0 && (p.rollsUsed ?? 0) >= r.max) return { fx: "bad", msg: "Попытки исчерпаны." };
  const actor = user.character;
  let roll, note = "";
  try {
    const stat = r.stat ?? "custom";
    if (stat === "custom") {
      roll = new Roll(r.formula || "1d20", actor?.getRollData?.() ?? {});
    } else {
      let bonus = 0;
      if (stat !== "none") {
        const val = resolveBonus(actor, stat);
        if (val !== null) bonus = val;
        else note = " (у игрока нет подходящего персонажа — бросок без бонуса)";
      }
      roll = new Roll(withBonus(dieOf(r.adv), bonus));
    }
    await roll.evaluate();
  } catch (e) {
    return { fx: "bad", msg: "Не удалось бросить кубики (проверьте формулу)." };
  }
  p.rollsUsed = (p.rollsUsed ?? 0) + 1;
  const ok = roll.total >= Number(r.dc || 0);
  try {
    await roll.toMessage({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: user.name },
      flavor: `${esc(rollLabel(r))} — «${esc(p.name)}»: ${ok ? "успех" : "неудача"}${esc(note)}`,
      author: user.id
    });
  } catch (e) { console.warn(`${MOD} |`, e); }
  if (!ok) return { fx: "bad", msg: "Бросок не удался." };
  const hints = (p.hints ?? []).filter(Boolean);
  if (r.reward !== "segment" && (p.hintsShown ?? 0) < hints.length) {
    p.hintsShown = (p.hintsShown ?? 0) + 1;
    return { fx: "ok", msg: "Скрижаль открыла подсказку!" };
  }
  if (Logic[p.type].assist(p)) return { fx: "ok", msg: "Часть головоломки разгадана!" };
  return { fx: "ok", msg: "Скрижаль молчит — помочь больше нечем." };
}

async function handleAct(userId, puzzleId, op, data) {
  const user = game.users.get(userId);
  if (!user) return;
  let result = {};
  let solved = null;
  const opened = [];
  let expired = null;
  await Store.mutate(async list => {
    const p = list.find(x => x.id === puzzleId);
    if (!p || !canSee(p, user) || p.solved) return;
    const L = Logic[p.type];
    if (p.timer?.expired) { result = { fx: "bad", msg: "Время вышло — скрижаль заперта. Нужна помощь мастера." }; return; }
    const ex = applyExpiry(p);
    if (ex) { expired = [p.name, ex]; result = { fx: "bad", msg: ex === "reset" ? "Время вышло — скрижаль сбросилась!" : "Время вышло — скрижаль заперта!" }; return; }
    result = op === "roll" ? await doRoll(p, user)
      : (op === "feel" && p.type === "pick") ? await doFeel(p, user)
      : (L.act(p, op, data ?? {}) ?? {});
    if (!p.solved && L.check(p)) {
      p.solved = true;
      stopTimer(p);
      result = { ...result, fx: "ok", solved: true };
      solved = p;
      // цепочка: решённая скрижаль открывает следующие
      for (const id of p.unlocks ?? []) {
        const t = list.find(x => x.id === id);
        if (t && !t.visible && !t.solved) { setVisible(t, true); opened.push(t.name); }
      }
    }
  });
  if (expired) expiryChat(...expired);
  if (opened.length) ChatMessage.create({
    speaker: { alias: "Каменная скрижаль" },
    content: `<div class="sp-chat"><strong>Открылась новая скрижаль:</strong> ${opened.map(n => `«${esc(n)}»`).join(", ")}</div>`
  });
  if (solved) {
    const body = solved.successText ? `<p style="white-space:pre-wrap">${esc(solved.successText)}</p>` : "";
    ChatMessage.create({
      speaker: { alias: "Каменная скрижаль" },
      content: `<div class="sp-chat"><strong>Головоломка решена:</strong> «${esc(solved.name)}»${body}</div>`
    });
  }
  if (userId === game.user.id) Net.feedback?.(puzzleId, result);
  else game.socket.emit(Net.ch, { type: "result", userId, puzzleId, result });
}

export const Net = {
  ch: `module.${MOD}`,
  feedback: null,
  init() {
    game.socket.on(this.ch, msg => {
      if (msg?.type === "act" && game.users.activeGM?.isSelf) handleAct(msg.userId, msg.puzzleId, msg.op, msg.data);
      else if (msg?.type === "result" && msg.userId === game.user.id) this.feedback?.(msg.puzzleId, msg.result);
    });
  },
  request(puzzleId, op, data = {}) {
    if (game.user.isGM) return handleAct(game.user.id, puzzleId, op, data);
    if (!game.users.activeGM) return ui.notifications.warn("Мастер не в сети — скрижаль не отвечает.");
    game.socket.emit(this.ch, { type: "act", userId: game.user.id, puzzleId, op, data });
  }
};
