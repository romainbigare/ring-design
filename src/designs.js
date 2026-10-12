// "My designs": save, load and remove ring designs in the browser
// (localStorage). The four reference rings are added once as starters and
// can be removed like any other design.
import { DEFAULTS, PRESETS } from './params.js';

const KEY = 'ringStudio.designs.v1';
const SEEDED_KEY = 'ringStudio.seeded.v1';

// Studio settings are viewing preferences, not part of a design.
export const STUDIO_KEYS = new Set(['scene', 'exposure', 'bloom', 'dispersion', 'bounces', 'autoRotate', 'showHand', 'skinTone']);
export const DESIGN_KEYS = Object.keys(DEFAULTS).filter((k) => !STUDIO_KEYS.has(k));

const STARTERS = [
  ['Ring A', PRESETS.A],
  ['Ring B', PRESETS.B],
  ['Ring C', PRESETS.C],
  ['Ring D', PRESETS.D],
];

export function pickDesign(state) {
  const out = {};
  for (const k of DESIGN_KEYS) out[k] = state[k];
  return out;
}

function readList() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!localStorage.getItem(SEEDED_KEY)) {
      localStorage.setItem(SEEDED_KEY, '1');
      if (!list.length) {
        for (const [name, p] of STARTERS) list.push({ name, params: pickDesign({ ...DEFAULTS, ...p }), savedAt: Date.now() });
        writeList(list);
      }
    }
    return Array.isArray(list) ? list.filter((d) => d && d.name && d.params) : [];
  } catch {
    // Storage blocked (private mode…): still offer the starters for this visit.
    return STARTERS.map(([name, p]) => ({ name, params: pickDesign({ ...DEFAULTS, ...p }) }));
  }
}

function writeList(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

function sameDesign(params, state) {
  for (const k of DESIGN_KEYS) {
    if (!(k in params)) continue;
    if (k === 'haloStoneSize' && state.haloAutoSize) continue; // computed value
    const a = params[k], b = state[k];
    if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 1e-6) return false; }
    else if (a !== b) return false;
  }
  return true;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// container: element to render into. onLoad(params) applies a saved design.
export function createDesignsUI(container, state, { onLoad, toast }) {
  let list = readList();
  let undo = null;      // { item, index, timer }
  let editing = false;

  const root = el('section', 'designs');
  container.prepend(root);

  function render() {
    root.textContent = '';
    const head = el('div', 'designs-head');
    head.append(el('span', 'designs-title', 'My designs'));
    if (!editing) {
      const saveBtn = el('button', 'designs-save', '+ Save');
      saveBtn.type = 'button';
      saveBtn.title = 'Save the current ring';
      saveBtn.addEventListener('click', () => { editing = true; render(); });
      head.append(saveBtn);
    }
    root.append(head);

    if (editing) {
      const form = el('form', 'designs-form');
      const input = el('input', 'designs-input');
      input.type = 'text';
      input.maxLength = 40;
      input.placeholder = 'Name of this design';
      const active = list.find((d) => sameDesign(d.params, state));
      input.value = active ? active.name : `Design ${list.length + 1}`;
      const ok = el('button', 'designs-ok', 'Save');
      ok.type = 'submit';
      const cancel = el('button', 'designs-cancel', '×');
      cancel.type = 'button';
      cancel.setAttribute('aria-label', 'Cancel');
      form.append(input, ok, cancel);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        const item = { name, params: pickDesign(state), savedAt: Date.now() };
        const i = list.findIndex((d) => d.name.toLowerCase() === name.toLowerCase());
        if (i >= 0) list[i] = item; else list.push(item);
        const stored = writeList(list);
        editing = false;
        render();
        toast(!stored ? 'Saved for this visit only (storage is blocked)' : i >= 0 ? `“${name}” updated` : `“${name}” saved`);
      });
      cancel.addEventListener('click', () => { editing = false; render(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { editing = false; render(); } });
      root.append(form);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    const chips = el('div', 'designs-list');
    if (!list.length) chips.append(el('p', 'designs-empty', 'No saved designs yet. Use “+ Save” to keep the current ring.'));
    list.forEach((d, index) => {
      const chip = el('div', 'design-chip');
      if (sameDesign(d.params, state)) chip.classList.add('active');
      const load = el('button', 'design-load', d.name);
      load.type = 'button';
      load.title = `Open “${d.name}”`;
      load.addEventListener('click', () => onLoad(d.params, d.name));
      const del = el('button', 'design-del', '×');
      del.type = 'button';
      del.setAttribute('aria-label', `Remove “${d.name}”`);
      del.addEventListener('click', () => {
        list.splice(index, 1);
        writeList(list);
        if (undo) clearTimeout(undo.timer);
        undo = { item: d, index, timer: setTimeout(() => { undo = null; render(); }, 6000) };
        render();
      });
      chip.append(load, del);
      chips.append(chip);
    });
    root.append(chips);

    if (undo) {
      const bar = el('div', 'designs-undo');
      bar.append(el('span', '', `“${undo.item.name}” removed`));
      const u = el('button', 'designs-undo-btn', 'Undo');
      u.type = 'button';
      u.addEventListener('click', () => {
        list.splice(Math.min(undo.index, list.length), 0, undo.item);
        writeList(list);
        clearTimeout(undo.timer);
        undo = null;
        render();
      });
      bar.append(u);
      root.append(bar);
    }
  }

  render();
  // Re-mark the active design after changes (cheap; called from the app).
  return {
    update() {
      if (editing) return;
      root.querySelectorAll('.design-chip').forEach((chip, i) => {
        chip.classList.toggle('active', !!list[i] && sameDesign(list[i].params, state));
      });
    },
  };
}
