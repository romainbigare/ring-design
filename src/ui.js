// Control panel: collapsible folders, sliders, selects, toggles, buttons and a toolbar.
// No dependencies.

import { DEFAULTS } from './params.js';

const MOBILE_QUERY = '(max-width: 759.98px)';

function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) el.append(c);
  return el;
}

function decimalsOf(step) {
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function snap(value, item) {
  const { min, max, step } = item;
  let v = Math.min(max, Math.max(min, value));
  v = min + Math.round((v - min) / step) * step;
  v = Math.min(max, Math.max(min, v));
  return Number(v.toFixed(decimalsOf(step) + 2));
}

// ---------------------------------------------------------------- toast

let toastEl = null;
let toastTimer = 0;

export function toast(message, ms = 2200) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = message;
  // restart the transition
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- panel

export function createPanel(panelEl, toolbarEl, schema, toolbar, state, { onChange, onAction } = {}) {
  const change = (key, value) => { if (onChange) onChange(key, value); updateVisibility(); };
  const action = (name) => { if (onAction) onAction(name); };
  const rows = new Map();   // key -> { sync(), row }

  panelEl.classList.add('panel');
  panelEl.textContent = '';

  // ---- header / handle
  const collapseBtn = h('button', { class: 'panel-collapse', type: 'button', 'aria-label': 'Collapse panel' });
  const shareBtn = h('button', { class: 'panel-share', type: 'button', 'aria-label': 'Share this design' });
  shareBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3v12"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>' +
    '<span>Share</span>';
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); action('share'); });
  const head = h('div', { class: 'panel-head' }, [
    h('span', { class: 'panel-grabber', 'aria-hidden': 'true' }),
    h('span', { class: 'panel-title', text: 'Design' }),
    h('span', { class: 'panel-head-actions' }, [shareBtn, collapseBtn]),
  ]);
  const body = h('div', { class: 'panel-body' });
  panelEl.append(head, body);

  const mq = window.matchMedia(MOBILE_QUERY);
  let collapsed = mq.matches;           // bottom sheet starts closed on phones

  function applyCollapsed() {
    panelEl.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('panel-open', !collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    collapseBtn.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
  }
  const toggleCollapsed = () => { collapsed = !collapsed; applyCollapsed(); };
  head.addEventListener('click', toggleCollapsed);   // whole header is the handle
  mq.addEventListener('change', (e) => { collapsed = e.matches; applyCollapsed(); });
  applyCollapsed();

  // ---- controls
  function buildRange(item) {
    const dec = decimalsOf(item.step);
    const fmt = (v) => Number(v).toFixed(dec);
    const slider = h('input', {
      type: 'range', min: item.min, max: item.max, step: item.step,
      'aria-label': item.label,
    });
    const num = h('input', {
      type: 'text', inputmode: 'decimal', class: 'num', autocomplete: 'off',
      spellcheck: 'false', 'aria-label': item.label + ' value',
    });
    num.size = Math.max(4, fmt(item.max).length + 1);
    const label = h('span', { class: 'label', text: item.label, title: 'Double-click to reset' });
    const unit = h('span', { class: 'unit', text: item.unit || '' });
    const row = h('div', { class: 'row range', dataset: { key: item.key } }, [
      h('div', { class: 'row-top' }, [label, h('span', { class: 'readout' }, [num, unit])]),
      slider,
    ]);

    const paint = (v) => {
      const t = (v - item.min) / (item.max - item.min);
      slider.style.setProperty('--fill', (Math.min(1, Math.max(0, t)) * 100).toFixed(2) + '%');
    };
    const sync = () => {
      const v = Number(state[item.key]);
      slider.value = v;
      paint(v);
      if (document.activeElement !== num) num.value = fmt(v);
    };
    const commit = (v) => {
      state[item.key] = v;
      slider.value = v;
      paint(v);
      num.value = fmt(v);
      change(item.key, v);
    };

    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      state[item.key] = v;
      paint(v);
      num.value = fmt(v);
      change(item.key, v);
    });

    const applyTyped = () => {
      const parsed = parseFloat(num.value.replace(',', '.'));
      if (Number.isFinite(parsed)) {
        const v = snap(parsed, item);
        if (v !== state[item.key]) commit(v);
        else num.value = fmt(v);
      } else num.value = fmt(state[item.key]);
    };
    num.addEventListener('focus', () => num.select());
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { applyTyped(); num.select(); }
      else if (e.key === 'Escape') { num.value = fmt(state[item.key]); num.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? 1 : -1;
        const cur = parseFloat(num.value.replace(',', '.'));
        commit(snap((Number.isFinite(cur) ? cur : state[item.key]) + dir * item.step, item));
        num.select();
      }
    });
    num.addEventListener('blur', applyTyped);

    // Double click / double tap on the label resets to the default value.
    let lastTap = 0;
    label.addEventListener('click', () => {
      const now = performance.now();
      if (now - lastTap < 350) {
        lastTap = 0;
        if (!(item.key in DEFAULTS) || row.classList.contains('disabled')) return;
        commit(snap(DEFAULTS[item.key], item));
      } else lastTap = now;
    });

    return { row, sync, controls: [slider, num] };
  }

  function buildSelect(item) {
    const select = h('select', { 'aria-label': item.label },
      item.options.map((o) => h('option', { value: o.value, text: o.label })));
    const row = h('div', { class: 'row select', dataset: { key: item.key } }, [
      h('span', { class: 'label', text: item.label }),
      h('span', { class: 'select-wrap' }, select),
    ]);
    select.addEventListener('input', () => {
      state[item.key] = select.value;
      change(item.key, select.value);
    });
    return { row, sync: () => { select.value = String(state[item.key]); }, controls: [select] };
  }

  function buildToggle(item) {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch-input' });
    const row = h('label', { class: 'row toggle', dataset: { key: item.key } }, [
      h('span', { class: 'label', text: item.label }),
      input,
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
    ]);
    input.addEventListener('input', () => {
      state[item.key] = input.checked;
      change(item.key, input.checked);
    });
    return { row, sync: () => { input.checked = !!state[item.key]; }, controls: [input] };
  }

  function buildButtons(item) {
    return {
      row: h('div', { class: 'row buttons' }, item.items.map((b) =>
        h('button', { type: 'button', class: 'btn', text: b.label, dataset: { action: b.action } }))),
    };
  }

  for (const folder of schema) {
    const content = h('div', { class: 'folder-content' });
    const details = h('details', { class: 'folder', open: folder.open }, [
      h('summary', {}, [h('span', { text: folder.folder }), h('span', { class: 'chev', 'aria-hidden': 'true' })]),
      content,
    ]);
    for (const item of folder.items) {
      let built;
      if (item.type === 'range') built = buildRange(item);
      else if (item.type === 'select') built = buildSelect(item);
      else if (item.type === 'toggle') built = buildToggle(item);
      else if (item.type === 'buttons') built = buildButtons(item);
      else continue;
      content.append(built.row);
      built.when = item.when;
      if (item.key) rows.set(item.key, built);
      if (item.type === 'buttons') {
        item.items.forEach((b, i) => {
          built.row.children[i].addEventListener('click', () => action(b.action));
        });
      }
    }
    body.append(details);
  }

  // Rows with a `when(state)` rule are only shown when they matter
  // (e.g. the point length only for the pointy collar).
  function updateVisibility() {
    for (const r of rows.values()) if (r.when) r.row.hidden = !r.when(state);
  }

  function refresh() {
    for (const r of rows.values()) if (r.sync) r.sync();
    updateVisibility();
  }
  refresh();

  // ---- toolbar
  toolbarEl.textContent = '';
  for (const t of toolbar) {
    const b = h('button', { type: 'button', class: t.view ? 'pill view' : 'pill', text: t.label, dataset: { action: t.action } });
    b.addEventListener('click', () => action(t.action));
    toolbarEl.append(b);
  }

  return { refresh, body };
}
