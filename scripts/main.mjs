import { MOD } from "./util.mjs";
import { Store, Net, canShow, isScreen, sweepTimers } from "./store.mjs";
import { PuzzleView, openPuzzle, closeScreens } from "./views.mjs";
import { PuzzleManager } from "./editor.mjs";

let seen = new Set();

/** Открывать ли скрижали автоматически: игрокам и клиенту-экрану (в т.ч. под учёткой мастера). */
const autoOpen = () => !game.user.isGM || isScreen();
const shownIds = () => new Set(Store.list().filter(p => p.visible && canShow(p)).map(p => p.id));

function onData() {
  if (!game.ready) return;
  if (autoOpen()) {
    const now = shownIds();
    for (const id of now) {
      if (seen.has(id)) continue;
      if (!isScreen()) ui.notifications.info(`Перед вами появилась скрижаль: «${Store.get(id)?.name}»`);
      openPuzzle(id);
    }
    seen = now;
  }
  if (!isScreen()) closeScreens();
  PuzzleView.refreshAll();
  PuzzleManager.refresh();
}

Hooks.once("init", () => {
  game.settings.register(MOD, "data", {
    scope: "world",
    config: false,
    type: Object,
    default: { puzzles: [] },
    onChange: onData
  });
  game.settings.register(MOD, "screenUsers", {
    scope: "world",
    config: false,
    type: Object,
    default: { ids: [] },
    onChange: () => { seen = new Set(); onData(); }
  });
  game.settings.register(MOD, "screen", {
    name: "Этот клиент — общий экран",
    hint: "Включите на компьютере, подключённом к телевизору или проектору (Monk's Common Display и т.п.): открытые мастером скрижали будут сами появляться на этом экране, даже если вход выполнен под учётной записью мастера.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => { seen = new Set(); onData(); }
  });
});

Hooks.once("ready", () => {
  Net.init();
  // таймеры скрижалей проверяет активный мастер
  setInterval(() => { if (game.users.activeGM?.isSelf) sweepTimers(); }, 2000);
  const mod = game.modules.get(MOD);
  if (mod) mod.api = { openManager: () => PuzzleManager.open(), openPuzzle: id => PuzzleView.open(id), Store };
  seen = autoOpen() ? shownIds() : new Set();
  // уже открытые мастером скрижали появляются сразу при входе
  for (const id of seen) openPuzzle(id);
  if (isScreen()) ui.notifications.info("Каменные скрижали: этот клиент работает как общий экран.");
});

Hooks.on("getSceneControlButtons", controls => {
  let last = 0;
  const run = () => { const n = Date.now(); if (n - last > 300) { last = n; PuzzleManager.open(); } };
  const tool = {
    name: "stone-puzzles",
    title: game.user?.isGM ? "Каменные скрижали" : "Мои скрижали",
    icon: "fa-solid fa-dungeon",
    button: true,
    visible: true,
    order: 99,
    onChange: run,
    onClick: run
  };
  const group = Array.isArray(controls)
    ? controls.find(c => c.name === "token" || c.name === "tokens")
    : (controls.tokens ?? controls.token);
  if (!group) return;
  if (Array.isArray(group.tools)) group.tools.push(tool);
  else group.tools[tool.name] = tool;
});
