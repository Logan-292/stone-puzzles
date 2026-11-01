import { h, field, pickImage, MOD } from "./util.mjs";
import { Store, newPuzzle, resetPuzzle } from "./store.mjs";
import { Logic, TYPES, runeGlyph, ABILITIES, SKILLS } from "./logic.mjs";
import { PuzzleView, openPuzzle } from "./views.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const icon = c => h("i", { class: `fa-solid ${c}` });

/* ------------------------------------------------------------------ */
/* Менеджер                                                            */
/* ------------------------------------------------------------------ */
export class PuzzleManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sp-manager",
    classes: ["stone-puzzles", "sp-manager"],
    tag: "div",
    window: { title: "Каменные скрижали", icon: "fa-solid fa-dungeon", resizable: true },
    position: { width: 680, height: 520 }
  };
  static inst = null;
  static open() { (this.inst ??= new PuzzleManager()).render({ force: true }); }
  static refresh() { if (this.inst?.rendered) this.inst.render(); }

  async _renderHTML() {
    const gm = game.user.isGM;
    const list = Store.list().filter(p => gm || (p.visible && (p.assignAll || (p.assigned ?? []).includes(game.user.id))));
    const root = h("div", { class: "sp-tablet sp-mgr" });

    if (gm) {
      root.append(h("div", { class: "sp-toolbar" },
        h("button", { class: "sp-btn", onclick: () => this.#create() }, icon("fa-plus"), " Новая головоломка"),
        h("button", { class: "sp-btn", onclick: () => Store.mutate(l => l.forEach(p => (p.visible = false))) }, icon("fa-eye-slash"), " Скрыть все"),
        h("button", { class: "sp-btn", title: "Кто из пользователей показывает скрижали на общем экране", onclick: () => this.#screens() }, icon("fa-tv"), " Общий экран")));
      root.append(h("p", { class: "sp-note" }, "Для ответов скрижалей мастер должен быть в сети."));
    }
    if (!list.length) root.append(h("p", { class: "sp-empty" }, gm ? "Пока нет ни одной скрижали." : "Мастер ещё не открыл вам ни одной скрижали."));

    for (const p of list) {
      const info = TYPES[p.type];
      const row = h("div", { class: "sp-row" + (p.solved ? " is-solved" : "") + (gm && !p.visible ? " is-off" : "") },
        h("div", { class: "sp-row-ico" }, icon(info.icon)),
        h("div", { class: "sp-row-main" },
          h("b", {}, p.name),
          h("small", {}, info.label, p.solved ? " · решено" : "", gm ? ` · ${this.#assignText(p)}` : "")));
      const acts = h("div", { class: "sp-row-acts" });
      const add = (ico, title, fn, extra = "") => acts.append(h("button", { class: "sp-btn sp-mini " + extra, title, onclick: fn }, icon(ico)));
      add("fa-book-open", "Открыть", () => PuzzleView.open(p.id));
      if (gm) {
        add(p.visible ? "fa-eye" : "fa-eye-slash", p.visible ? "Скрыть от игроков" : "Показать игрокам",
          async () => {
            const show = !p.visible;
            await Store.mutate(l => { const x = l.find(q => q.id === p.id); if (x) x.visible = show; });
            if (show) openPuzzle(p.id); // мастер тоже видит показанную головоломку
          }, p.visible ? "is-on" : "");
        add("fa-users", "Кому назначена", () => this.#assign(p.id));
        add("fa-pen", "Редактировать", () => PuzzleEditor.open(p.id));
        add("fa-rotate-left", "Сбросить прогресс", () => this.#reset(p.id));
        add("fa-trash", "Удалить", () => this.#remove(p.id));
      }
      row.append(acts);
      root.append(row);
    }
    return root;
  }
  _replaceHTML(result, content) { const t = content.scrollTop; content.replaceChildren(result); content.scrollTop = t; }

  #assignText(p) {
    if (p.assignAll) return "всем игрокам";
    const names = (p.assigned ?? []).map(id => game.users.get(id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : "никому";
  }

  async #create() {
    const type = await DialogV2.wait({
      window: { title: "Тип головоломки" },
      content: "<p>Что высечем на камне?</p>",
      buttons: Object.entries(TYPES).map(([k, t]) => ({ action: k, label: t.label, icon: `fa-solid ${t.icon}` })),
      rejectClose: false
    });
    if (type && TYPES[type]) PuzzleEditor.open(null, type);
  }

  /** Выбор пользователей-«экранов»: у них скрижали появляются как оверлей на всю страницу. */
  async #screens() {
    const ids = game.settings.get(MOD, "screenUsers")?.ids ?? [];
    const content = `<div class="sp-assign"><p>Отметьте учётные записи, под которыми открыт общий экран (телевизор, проектор, Monk's Common Display). Там все показанные скрижали будут появляться сами, поверх всей страницы.</p>
      ${game.users.map(u => `<label><input type="checkbox" name="s" value="${u.id}" ${ids.includes(u.id) ? "checked" : ""}> ${foundry.utils.escapeHTML(u.name)}${u.isGM ? " <small>(мастер)</small>" : ""}${u.active ? " <small>● в сети</small>" : ""}</label>`).join("")}</div>`;
    const res = await DialogV2.prompt({
      window: { title: "Общий экран" },
      content,
      ok: { label: "Сохранить", callback: (ev, button) => [...button.form.querySelectorAll("input[name=s]:checked")].map(i => i.value) },
      rejectClose: false
    });
    if (res) await game.settings.set(MOD, "screenUsers", { ids: res });
  }

  async #assign(id) {
    const p = Store.get(id);
    if (!p) return;
    const users = game.users.filter(u => !u.isGM);
    const content = `<div class="sp-assign">
      <label><input type="checkbox" name="all" ${p.assignAll ? "checked" : ""}> <b>Всем игрокам</b></label><hr>
      ${users.map(u => `<label><input type="checkbox" name="u" value="${u.id}" ${(p.assigned ?? []).includes(u.id) ? "checked" : ""}> ${foundry.utils.escapeHTML(u.name)}${u.active ? "" : " <small>(не в сети)</small>"}</label>`).join("") || "<p>Нет игроков.</p>"}
      <p class="notes"><small>Если отмечено «Всем», выбор ниже не учитывается.</small></p></div>`;
    const res = await DialogV2.prompt({
      window: { title: `Назначить: ${p.name}` },
      content,
      ok: {
        label: "Сохранить",
        callback: (ev, button) => ({
          all: button.form.elements.all.checked,
          ids: [...button.form.querySelectorAll("input[name=u]:checked")].map(i => i.value)
        })
      },
      rejectClose: false
    });
    if (!res) return;
    await Store.mutate(l => { const x = l.find(q => q.id === id); if (x) { x.assignAll = res.all; x.assigned = res.ids; } });
  }

  async #reset(id) {
    const ok = await DialogV2.confirm({ window: { title: "Сброс" }, content: "<p>Сбросить прогресс, подсказки и попытки этой скрижали?</p>", rejectClose: false });
    if (ok) await Store.mutate(l => { const x = l.find(q => q.id === id); if (x) resetPuzzle(x); });
  }

  async #remove(id) {
    const ok = await DialogV2.confirm({ window: { title: "Удаление" }, content: "<p>Разбить эту скрижаль навсегда?</p>", rejectClose: false });
    if (ok) await Store.mutate(l => { const i = l.findIndex(q => q.id === id); if (i >= 0) l.splice(i, 1); });
  }
}

/* ------------------------------------------------------------------ */
/* Редактор                                                            */
/* ------------------------------------------------------------------ */
const EDITORS = new Map();

export class PuzzleEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["stone-puzzles", "sp-editor"],
    tag: "div",
    window: { icon: "fa-solid fa-pen-nib", resizable: true },
    position: { width: 600, height: 700 }
  };

  static open(id, type) {
    const key = id ?? `new-${type}`;
    let e = EDITORS.get(key);
    if (!e) { e = new PuzzleEditor({ id: `sp-edit-${key}-${foundry.utils.randomID(4)}`, puzzleId: id, type }); EDITORS.set(key, e); }
    e.render({ force: true });
  }

  constructor(options) {
    super(options);
    this.key = options.puzzleId ?? `new-${options.type}`;
    const existing = options.puzzleId ? Store.get(options.puzzleId) : null;
    this.isNew = !existing;
    this.draft = existing ?? newPuzzle(options.type);
    this.origConfig = JSON.stringify(this.draft.config);
    this.hintsText = (this.draft.hints ?? []).join("\n");
  }

  get title() { return `${this.isNew ? "Новая" : "Правка"}: ${TYPES[this.draft.type].label}`; }

  async _renderHTML() {
    const d = this.draft, c = d.config, r = d.roll;
    const num = (obj, key, min, max) => h("input", { type: "number", value: obj[key], min, max, oninput: e => (obj[key] = Number(e.target.value)) });
    const txt = (obj, key, ph = "") => h("input", { type: "text", value: obj[key] ?? "", placeholder: ph, oninput: e => (obj[key] = e.target.value) });
    const area = (obj, key, rows = 3, ph = "") => h("textarea", { rows, placeholder: ph, oninput: e => (obj[key] = e.target.value) }, obj[key] ?? "");
    const chk = (obj, key) => h("input", { type: "checkbox", checked: !!obj[key], onchange: e => (obj[key] = e.target.checked) });
    const sel = (obj, key, opts) => h("select", { onchange: e => (obj[key] = e.target.value) },
      opts.map(([v, l]) => h("option", { value: v, selected: obj[key] === v }, l)));

    // выбор характеристики для броска (D&D 5e 2024, система dnd5e)
    r.stat ??= "custom";
    r.adv ??= "normal";
    const opt = (v, l) => h("option", { value: v, selected: r.stat === v }, l);
    const advField = field("Преимущество / помеха", sel(r, "adv", [["normal", "Обычный бросок"], ["adv", "Преимущество"], ["dis", "Помеха"]]), "Для режима «своя формула» не применяется.");
    const formulaField = field("Своя формула", txt(r, "formula", "1d20+@abilities.int.mod"), "Данные берутся из персонажа игрока (@abilities...).");
    const syncStat = () => { formulaField.style.display = r.stat === "custom" ? "" : "none"; advField.style.display = r.stat === "custom" ? "none" : ""; };
    const statSel = h("select", { onchange: e => { r.stat = e.target.value; syncStat(); } },
      opt("none", "Без бонуса (чистый d20)"),
      h("optgroup", { label: "Проверки характеристик" }, Object.entries(ABILITIES).map(([k, l]) => opt(`abilities.${k}`, l))),
      h("optgroup", { label: "Навыки" }, Object.entries(SKILLS).map(([k, l]) => opt(`skills.${k}`, l))),
      h("optgroup", { label: "Другое" }, opt("custom", "Своя формула")));
    const statField = field("Характеристика или навык", statSel, "Бонус берётся из персонажа игрока (D&D 5e / dnd5e). Сложность проверки — ниже.");
    syncStat();

    const root = h("div", { class: "sp-tablet sp-form" });
    root.append(h("fieldset", {}, h("legend", {}, "Общее"),
      field("Название", txt(d, "name")),
      field("Описание / загадка для игроков", area(d, "intro", 3), "Показывается над головоломкой."),
      field("Текст награды при решении", area(d, "successText", 3), "Выводится в окне и в чат."),
      field("Подсказки (по одной в строке)", h("textarea", { rows: 4, oninput: e => (this.hintsText = e.target.value) }, this.hintsText), "Открываются по порядку после успешных бросков.")));

    root.append(h("fieldset", {}, h("legend", {}, "Бросок на помощь"),
      h("label", { class: "sp-inline" }, chk(r, "enabled"), " Игроки могут запросить бросок"),
      statField, advField,
      field("Название на кнопке", txt(r, "label", "по умолчанию — по характеристике"), "Можно оставить пустым."),
      formulaField,
      h("div", { class: "sp-two" }, field("Сложность (DC)", num(r, "dc", 0, 99)), field("Макс. бросков (0 — без лимита)", num(r, "max", 0, 99))),
      field("Награда за успех", sel(r, "reward", [["hint", "Подсказка (потом — часть головоломки)"], ["segment", "Решается часть головоломки"]]))));

    const f = h("fieldset", {}, h("legend", {}, TYPES[d.type].label));
    const T = {
      rings: () => {
        const prev = h("img", { class: "sp-prev", src: c.image || "", style: { display: c.image ? "" : "none" } });
        const inp = h("input", { type: "text", value: c.image, placeholder: "путь к изображению", oninput: e => { c.image = e.target.value; prev.src = c.image; prev.style.display = c.image ? "" : "none"; } });
        f.append(field("Изображение", h("div", { class: "sp-row-inline" }, inp,
          h("button", { type: "button", class: "sp-btn", onclick: () => pickImage(c.image, path => { c.image = path; inp.value = path; prev.src = path; prev.style.display = ""; }) }, icon("fa-folder-open"), " Выбрать")),
          "Без картинки будет использована руническая мандала."), prev,
          h("div", { class: "sp-two" }, field("Колец (2–6)", num(c, "rings", 2, 6)), field("Положений на кольцо (4–24)", num(c, "steps", 4, 24))),
          h("label", { class: "sp-inline" }, chk(c, "fixedOuter"), " Внешнее кольцо неподвижно (опора)"));
      },
      cipher: () => f.append(
        field("Текст (его увидят зашифрованным)", area(c, "text", 5)),
        field("Тип шифра", sel(c, "mode", [["substitution", "Замена знаков (игроки подбирают буквы)"], ["caesar", "Круг сдвига (Цезарь, проще)"]])),
        field("Сдвиг для Цезаря (0 — случайный)", num(c, "shift", 0, 31)),
        field("Лимит попыток (0 — без лимита)", num(c, "maxAttempts", 0, 999), "Считается каждая подставленная буква (или шаг круга в режиме Цезаря). Удачный бросок возвращает несколько попыток.")),
      cryptex: () => f.append(
        field("Слово-ответ (до 10 букв)", txt(c, "answer")),
        field("Алфавит колёс", sel(c, "alphabet", [["auto", "Авто"], ["cyr", "Кириллица"], ["lat", "Латиница"], ["dig", "Цифры"], ["custom", "Свой набор"]])),
        field("Свой набор символов", txt(c, "custom"), "Используется, если выбран «Свой набор».")),
      gaps: () => f.append(
        field("Предложение", area(c, "text", 4), "Пропущенное слово — в квадратных скобках: [слово]. Допустимые варианты: [слово|синоним]. Пропусков может быть несколько."),
        field("Лишние слова (через запятую)", txt(c, "decoys"), "Если заполнено — игроки выбирают из списка. Если пусто — вписывают слово сами."),
        field("Лимит попыток (0 — без лимита)", num(c, "maxAttempts", 0, 99), "Попыткой считается нажатие «Проверить» с хотя бы одним неверным словом. Удачный бросок возвращает попытку.")),
      pick: () => f.append(
        h("p", { class: "sp-hint-text" }, "Сочетание броска персонажа и действий игрока: игрок сам выбирает позицию отмычки, а удачный бросок на штифте даёт точные подсказки. Ошибки изнашивают отмычки."),
        h("div", { class: "sp-two" }, field("Штифтов (3–6)", num(c, "pins", 3, 6)), field("Прочность отмычек (3–30)", num(c, "durability", 3, 30), "Каждая ошибка нажатия — −1, провал на 1 при броске — −2.")),
        field("Проверка персонажа", sel(c, "stat", [["best", "Лучшее: Ловкость рук или воровские инструменты"], ["skills.slt", "Ловкость рук"], ["tools.thief", "Воровские инструменты"], ["abilities.dex", "Ловкость (чистая)"]]), "Если у персонажа нет владения инструментами, берётся модификатор Ловкости."),
        h("div", { class: "sp-two" }, field("Сложность первого штифта (DC)", num(c, "dc", 0, 40)), field("Рост DC за каждый следующий штифт", num(c, "dcStep", 0, 10))),
        field("Преимущество / помеха", sel(c, "adv", [["normal", "Обычный бросок"], ["adv", "Преимущество (хорошие инструменты)"], ["dis", "Помеха (нет инструментов)"]]))),
      lock: () => {
        const box = h("div", { class: "sp-seq" });
        const draw = () => {
          c.sequence = (c.sequence ?? []).filter(i => i < c.count);
          box.replaceChildren(
            h("div", { class: "sp-seq-runes" }, Array.from({ length: Math.max(5, Math.min(12, c.count || 8)) }, (_, i) =>
              h("button", { type: "button", class: "sp-btn sp-rune-pick", onclick: () => { c.sequence.push(i); draw(); } }, h("span", {}, runeGlyph(i)), h("small", {}, i + 1)))),
            h("div", { class: "sp-seq-chain" }, c.sequence.length ? c.sequence.map(i => `${runeGlyph(i)}(${i + 1})`).join(" → ") : "Нажимайте руны в нужном порядке. Пусто — будет случайная последовательность из 4 рун."),
            h("div", { class: "sp-row-inline" },
              h("button", { type: "button", class: "sp-btn", onclick: () => { c.sequence.pop(); draw(); } }, icon("fa-delete-left"), " Убрать последнюю"),
              h("button", { type: "button", class: "sp-btn", onclick: () => { c.sequence = []; draw(); } }, icon("fa-eraser"), " Очистить")));
        };
        const count = h("input", { type: "number", value: c.count, min: 5, max: 12, onchange: e => { c.count = Math.min(12, Math.max(5, Number(e.target.value) || 8)); e.target.value = c.count; draw(); } });
        f.append(field("Рун на круге (5–12)", count), field("Последовательность", box),
          field("Ошибок до заклинивания (0 — без лимита)", num(c, "maxFails", 0, 20), "После заклинивания помогает только успешный бросок или сброс мастером."));
        draw();
      }
    };
    T[d.type]();
    root.append(f);

    root.append(h("div", { class: "sp-toolbar" },
      h("button", { type: "button", class: "sp-btn sp-big", onclick: () => this.#save() }, icon("fa-floppy-disk"), " Сохранить"),
      h("button", { type: "button", class: "sp-btn", onclick: () => this.close() }, "Отмена")),
      h("p", { class: "sp-note" }, "Если изменить саму головоломку (не название, подсказки или бросок), её прогресс сбросится."));
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }

  async #save() {
    const d = foundry.utils.deepClone(this.draft);
    d.name = (d.name || "").trim() || TYPES[d.type].label;
    d.hints = this.hintsText.split("\n").map(x => x.trim()).filter(Boolean);
    d.roll.dc = Number(d.roll.dc) || 0;
    d.roll.max = Math.max(0, Math.trunc(Number(d.roll.max) || 0));
    const changed = JSON.stringify(d.config) !== this.origConfig;
    await Store.mutate(list => {
      const i = list.findIndex(p => p.id === d.id);
      if (i < 0) { d.state = Logic[d.type].create(d.config); list.push(d); return; }
      const cur = list[i];
      Object.assign(cur, { name: d.name, intro: d.intro, successText: d.successText, hints: d.hints, roll: d.roll, config: d.config });
      if (changed) resetPuzzle(cur);
    });
    this.close();
    ui.notifications.info(`Скрижаль «${d.name}» сохранена.`);
  }

  async _onClose() { EDITORS.delete(this.key); }
}
