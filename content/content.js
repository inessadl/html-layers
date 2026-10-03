// HTML Layers - overlay layer drawn on top of the page, and the link with the side panel.
(() => {
  if (globalThis.HTMLLayers) return;

  const Scan = globalThis.HTMLLayersScan;
  const state = {
    active: false,
    port: null,
    result: null,
    byId: new Map(),
    layers: { headings: true, landmarks: true, lists: false, wash: true },
    theme: 'auto',          // auto | light | dark (overlay veil, not the panel)
    focusId: null,
    hoverId: null,
    byEl: new Map(),
    host: null,
    root: null,
    marks: null,
    wash: null,
    spot: null,
    raf: 0,
    observer: null,
    rescanTimer: 0,
  };

  // ---------- overlay ----------

  // One line per mark, in a tonal variant of the category color (no second outline).
  // The chip keeps the base color.
  // Tweakable in DevTools: select <html-layers-overlay> (last child of <html>) and add any
  // of these to its element.style, e.g. --hl-line: 3px. The overlay redraws on change.
  const TWEAKS = {
    '--hl-line': '2px',            // line width
    '--hl-line-active': '3px',     // line width on hover / selection
    '--hl-radius': '4px',          // box corners (headings, lists)
    '--hl-landmark-radius': '6px', // box corners (landmarks)
    '--hl-fill': '28%',            // fill on hover (headings, lists)
    '--hl-landmark-fill': '10%',   // fill on hover (landmarks)
    '--hl-chip-height': '22px',
    '--hl-chip-font': '12px',
    '--hl-chip-pad': '8px',        // chip side padding
    '--hl-chip-zoom': '1.05',       // chip scale on hover / selection
    '--hl-veil': '0.45',           // veil opacity (0 to 1)
    // Geometry, read by the script on every redraw:
    '--hl-pad-x': '6px',           // space around headings and lists, sides
    '--hl-pad-y': '4px',           // space around headings and lists, top and bottom
    '--hl-landmark-inset': '3px',  // landmarks drawn this much inside the element
    '--hl-grow': '4px',            // room landmarks leave around the marks inside them
    '--hl-lift': '2px',            // how much a box grows on hover / selection
    '--hl-chip-gap': '1px',        // space between chip and box
    '--hl-freeze': '0',            // 1 = stop redrawing, to edit the marks by hand
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wash { position: fixed; inset: 0; background: var(--page-wash); }
    .spot { position: fixed; border-radius: var(--hl-landmark-radius); box-shadow: 0 0 0 200vmax var(--page-wash); display: none; }
    .spot.on { display: block; }
    .box { position: fixed; border: var(--hl-line) solid var(--line); border-radius: var(--hl-radius); }
    .box.ghost { border-style: dashed; }
    .box.heading { --line: var(--heading-line); --c: var(--heading); }
    .box.landmark { --line: var(--landmark-line); --c: var(--landmark); border-radius: var(--hl-landmark-radius); --fill: var(--hl-landmark-fill); }
    .box.list { --line: var(--list-line); --c: var(--list); }
    .box.issue { --line: var(--issue-line); --c: var(--issue); }
    .box.hover {
      border-width: var(--hl-line-active); z-index: 1;
      background: color-mix(in srgb, var(--c) var(--fill, var(--hl-fill)), transparent);
    }
    .chip {
      position: fixed; display: inline-flex; align-items: center; gap: 4px;
      height: var(--hl-chip-height); padding: 0 var(--hl-chip-pad); border-radius: 999px;
      font: 700 var(--hl-chip-font)/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: .01em;
      white-space: nowrap; z-index: 3;
      background: var(--bg); color: var(--fg);
    }
    .chip.heading { --bg: var(--heading); --fg: var(--heading-text); --line: var(--heading-line); min-width: var(--hl-chip-height); justify-content: center; padding: 0 calc(var(--hl-chip-pad) - 2px); }
    .chip.landmark { --bg: var(--landmark); --fg: var(--landmark-text); --line: var(--landmark-line); }
    .chip.list { --bg: var(--list); --fg: var(--list-text); --line: var(--list-line); }
    .chip.issue { --bg: var(--issue); --fg: var(--issue-text); --line: var(--issue-line); }
    .chip.ghost { opacity: .85; outline: 1.5px dashed var(--fg); outline-offset: -4px; }
    .chip svg { width: 12px; height: 12px; flex: none; }
    .chip.hover { z-index: 4; transform: scale(var(--hl-chip-zoom)); transform-origin: left bottom; }
    .measure { visibility: hidden; left: 0; top: 0; }
  `;
  const TOKENS = {
    '--heading': '#0675B8', '--heading-text': '#FFFFFF',
    '--landmark': '#7B5BD6', '--landmark-text': '#FFFFFF',
    '--list': '#F5C84C', '--list-text': '#14283A',
    '--issue': '#D23838', '--issue-text': '#FFFFFF',
  };
  // Veil themes. Light pages: light veil, darker line. Dark pages: dark veil, lighter line.
  // Same hue as the base color (OKLCH), at least 7:1 against white (light) or black (dark).
  const THEMES = {
    light: {
      '--page-wash': 'rgb(255 255 255 / var(--hl-veil))',
      '--heading-line': '#045D94', '--landmark-line': '#6440B9', '--list-line': '#6D5504', '--issue-line': '#B20D1C',
    },
    dark: {
      '--page-wash': 'rgb(0 0 0 / var(--hl-veil))',
      '--heading-line': '#409CE1', '--landmark-line': '#9E81FE', '--list-line': '#FFF1C8', '--issue-line': '#FD625C',
    },
  };
  // Geometry comes from the --hl-* variables (see TWEAKS), read once per redraw.
  // Landmarks are drawn slightly inside, so stacked landmarks (header, main) don't overlap.
  let PAD = {}, GROW = 4, LIFT = 3, GAP = 4;
  function readGeometry() {
    const cs = getComputedStyle(state.host);
    const n = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
    const px = n('--hl-pad-x'), py = n('--hl-pad-y'), inset = n('--hl-landmark-inset');
    PAD = { heading: { x: px, y: py }, list: { x: px, y: py }, landmark: { x: -inset, y: -inset } };
    GROW = n('--hl-grow'); LIFT = n('--hl-lift'); GAP = n('--hl-chip-gap');
    return n('--hl-freeze') === 1;
  }
  const ALERT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5 15 14.5H1L8 1.5Zm-.8 4.5v4.2h1.6V6H7.2Zm0 5.4V13h1.6v-1.6H7.2Z"/></svg>';

  function mount() {
    if (state.host && state.host.isConnected) return;
    const host = document.createElement('html-layers-overlay');
    // Short inline style on purpose: easy to read and edit in DevTools (no "all: initial").
    host.setAttribute('style', 'position: fixed !important; inset: 0 !important; margin: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important; contain: strict !important;');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    const vars = (o) => Object.entries(o).map(([k, v]) => k + ':' + v).join(';');
    style.textContent = ':host{' + vars(TWEAKS) + ';' + vars(TOKENS) + ';' + vars(THEMES.dark) + '}' +
      ':host([data-theme="light"]){' + vars(THEMES.light) + '}' + CSS;
    const wash = document.createElement('div'); wash.className = 'wash';
    const spot = document.createElement('div'); spot.className = 'spot';
    const marks = document.createElement('div');
    root.append(style, wash, spot, marks);
    document.documentElement.appendChild(host);
    Object.assign(state, { host, root, wash, spot, marks });
    // Tweaks edited in DevTools (element.style of the host) redraw right away.
    new MutationObserver(() => schedule()).observe(host, { attributes: true, attributeFilter: ['style'] });
  }

  function unmount() {
    if (state.host) state.host.remove();
    Object.assign(state, { host: null, root: null, wash: null, spot: null, marks: null });
  }

  function schedule() {
    if (!state.active || state.raf) return;
    state.raf = requestAnimationFrame(() => { state.raf = 0; render(); });
  }

  function chipEl(item) {
    const c = document.createElement('div');
    const hasIssue = item.issues.length > 0;
    c.className = 'chip ' + item.kind + (hasIssue ? ' issue' : '') + (item.vis.ghost || item.vis.ax ? ' ghost' : '') + (isActive(item) ? ' hover' : '');
    let text = item.label;
    if (item.kind === 'landmark' && item.name) text += ' · ' + truncate(item.name, 24);
    c.innerHTML = (hasIssue ? ALERT : '') + '<span></span>';
    c.lastChild.textContent = text;
    return c;
  }

  // Hovered (page or panel) or selected in the panel.
  function isActive(item) { return item.id === state.hoverId || item.id === state.focusId; }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function render() {
    if (!state.active || !state.result) return;
    mount();
    state.host.setAttribute('data-theme', state.theme === 'auto' ? state.autoTheme || 'dark' : state.theme);
    if (readGeometry()) return; // --hl-freeze: 1
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const L = state.layers;

    // Spotlight on the item picked in the panel.
    const focus = state.focusId && state.byId.get(state.focusId);
    let focusRect = null;
    if (focus && focus.el.isConnected) {
      const r = focus.el.getBoundingClientRect();
      if (r.width || r.height) focusRect = r;
    }
    if (focusRect) {
      const pad = Math.max(PAD[focus.kind].x, 0) + 6;
      Object.assign(state.spot.style, {
        left: focusRect.left - pad + 'px', top: focusRect.top - pad + 'px',
        width: focusRect.width + pad * 2 + 'px', height: focusRect.height + pad * 2 + 'px',
      });
      state.spot.classList.add('on');
      state.wash.style.display = 'none';
    } else {
      state.spot.classList.remove('on');
      state.wash.style.display = L.wash ? 'block' : 'none';
    }

    // 1. Geometry of every visible item, with breathing room (not clamped yet).
    const visible = (item) => {
      // display: none and visibility: hidden are listed in the panel, not drawn.
      if (item.removed || item.vis.gone || !item.el.isConnected) return null;
      const r = item.el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return null;
      const pad = PAD[item.kind];
      return {
        item, tiny: r.width <= 2 && r.height <= 2, // visually hidden: chip only, no box
        x1: r.left - pad.x, y1: r.top - pad.y, x2: r.right + pad.x, y2: r.bottom + pad.y,
      };
    };
    const pick = (on, items) => (on ? items.map(visible).filter(Boolean) : []);
    const heads = pick(L.headings, state.result.headings);
    const lists = pick(L.lists, state.result.lists);
    const lands = pick(L.landmarks, state.result.landmarks);

    // 2. Landmarks grow to wrap the marks drawn inside them (deepest first, so parents wrap children).
    lands.sort((a, b) => b.item.depth - a.item.depth);
    const inner = heads.concat(lists);
    lands.forEach((g) => {
      inner.concat(lands).forEach((o) => {
        if (o === g || o.tiny || !g.item.el.contains(o.item.el)) return;
        g.x1 = Math.min(g.x1, o.x1 - GROW); g.y1 = Math.min(g.y1, o.y1 - GROW);
        g.x2 = Math.max(g.x2, o.x2 + GROW); g.y2 = Math.max(g.y2, o.y2 + GROW);
      });
    });

    // 3. Draw boxes, kept inside the viewport. Chip order: headings get the best spots.
    const boxes = document.createDocumentFragment();
    const chips = [];
    heads.concat(lands.slice().sort((a, b) => a.item.depth - b.item.depth), lists).forEach((g) => {
      const { item } = g;
      // Hovered or selected: the box grows a little, in step with the chip zoom.
      const lift = isActive(item) ? LIFT : 0;
      const x1 = Math.max(g.x1 - lift, 2), y1 = Math.max(g.y1 - lift, 2);
      const x2 = Math.min(g.x2 + lift, vw - 2), y2 = Math.min(g.y2 + lift, vh - 2);
      const b = document.createElement('div');
      b.className = 'box ' + item.kind + (item.issues.length ? ' issue' : '') + (item.vis.ghost || item.vis.ax ? ' ghost' : '') + (isActive(item) ? ' hover' : '');
      Object.assign(b.style, { left: x1 + 'px', top: y1 + 'px', width: Math.max(x2 - x1, 4) + 'px', height: Math.max(y2 - y1, 4) + 'px' });
      if (!g.tiny) boxes.appendChild(b);
      chips.push({ item, rect: { left: x1, top: y1, right: x2, bottom: y2 } });
    });

    state.marks.replaceChildren(boxes);

    // Measure chips, then place them outside the element without overlapping each other.
    const els = chips.map((c) => { const e = chipEl(c.item); e.classList.add('measure'); state.marks.appendChild(e); return e; });
    const sizes = els.map((e) => ({ w: e.offsetWidth, h: e.offsetHeight }));
    const placed = [];
    chips.forEach((c, i) => {
      const { w, h } = sizes[i];
      const r = c.rect;
      const gap = GAP;
      const candidates = [
        { x: r.left, y: r.top - h - gap },           // above, aligned left
        { x: r.left - w - gap, y: r.top },           // outside, left
        { x: r.left + gap, y: r.top + gap },         // inside, top left
      ];
      let spot = null;
      candidates.forEach((cand, ci) => {
        for (let shift = 0; shift < 6 && !spot; shift++) {
          const want = { x: cand.x + shift * (w + gap), y: cand.y };
          const p = {
            x: Math.min(Math.max(want.x, 2), vw - w - 2),
            y: Math.min(Math.max(want.y, 2), vh - h - 2), w, h,
          };
          // Outside positions that would be pushed back over the element are skipped.
          const pushed = Math.abs(p.x - want.x) > 8 || Math.abs(p.y - want.y) > 8;
          if (ci < 2 && pushed) continue;
          if (!placed.some((q) => overlaps(p, q))) spot = p;
        }
      });
      if (!spot) spot = { x: Math.min(Math.max(r.left, 2), vw - w - 2), y: Math.min(Math.max(r.top - h - gap, 2), vh - h - 2), w, h };
      placed.push(spot);
      const e = els[i];
      e.classList.remove('measure');
      e.style.left = spot.x + 'px';
      e.style.top = spot.y + 'px';
    });
  }

  // ---------- scanning ----------

  // Sample the page background on a grid and pick the veil that disturbs it least.
  function detectTheme() {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bgOf = (el) => {
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
        if (m && (m.length < 4 || parseFloat(m[3]) > 0.5)) return m.slice(0, 3).map(Number);
      }
      return [255, 255, 255]; // browser default canvas
    };
    let total = 0, n = 0;
    for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
      const el = document.elementFromPoint((vw * i) / 6, (vh * j) / 6);
      if (!el || el === state.host) continue;
      total += lum(bgOf(el)); n++;
    }
    state.autoTheme = n && total / n < 0.4 ? 'dark' : 'light';
  }

  function rescan() {
    if (state.host) state.host.style.setProperty('display', 'none', 'important');
    detectTheme();
    if (state.host) state.host.style.setProperty('display', 'block', 'important');
    state.result = Scan.scan();
    state.byId = new Map();
    state.byEl = new Map();
    ['headings', 'landmarks', 'lists'].forEach((k) => state.result[k].forEach((i) => {
      state.byId.set(i.id, i);
      state.byEl.set(i.el, i);
    }));
    send({ type: 'scan', data: Scan.serialize(state.result), autoTheme: state.autoTheme });
    schedule();
  }

  function onMutations(records) {
    if (records.every((r) => r.target === state.host || (state.host && state.host.contains(r.target)))) return;
    clearTimeout(state.rescanTimer);
    state.rescanTimer = setTimeout(rescan, 500);
  }

  const onScroll = () => schedule();

  // Hover: the innermost drawn item under the pointer gets highlighted, here and in the panel.
  function drawn(item) {
    if (!item || item.removed || item.vis.gone) return false;
    return !!state.layers[item.kind === 'heading' ? 'headings' : item.kind === 'landmark' ? 'landmarks' : 'lists'];
  }
  function setHover(id, fromPage) {
    if (id === state.hoverId) return;
    state.hoverId = id;
    if (fromPage) send({ type: 'hover', id });
    schedule();
  }
  let moveRaf = 0, lastTarget = null;
  const onMove = (e) => {
    lastTarget = e.target;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      let found = null;
      for (let n = lastTarget; n && n.nodeType === 1; n = n.parentElement) {
        const item = state.byEl.get(n);
        if (drawn(item)) { found = item; break; }
      }
      setHover(found ? found.id : null, true);
    });
  };
  const onLeave = (e) => { if (!e.relatedTarget) setHover(null, true); };
  const onKey = (e) => { if (e.key === 'Escape' && state.focusId) { focusItem(null); } };

  function activate() {
    if (state.active) { rescan(); return; }
    state.active = true;
    mount();
    rescan();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousemove', onMove, { capture: true, passive: true });
    document.addEventListener('mouseout', onLeave, true);
    state.observer = new MutationObserver(onMutations);
    state.observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['role', 'aria-level', 'aria-label', 'aria-labelledby', 'aria-hidden', 'hidden', 'inert', 'open', 'class', 'style', 'lang'],
    });
  }

  function deactivate() {
    state.active = false;
    state.focusId = null;
    cancelAnimationFrame(state.raf); state.raf = 0;
    clearTimeout(state.rescanTimer);
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', onScroll);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousemove', onMove, { capture: true });
    document.removeEventListener('mouseout', onLeave, true);
    state.hoverId = null;
    if (state.observer) state.observer.disconnect();
    state.observer = null;
    unmount();
  }

  function focusItem(id) {
    state.focusId = id;
    const item = id && state.byId.get(id);
    if (item) {
      const r = item.el.getBoundingClientRect();
      if (r.width || r.height) {
        item.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        send({ type: 'focused', id, visible: true });
      } else {
        send({ type: 'focused', id, visible: false });
      }
    } else {
      send({ type: 'focused', id: null });
    }
    schedule();
  }

  // ---------- messaging with the side panel ----------

  function send(msg) {
    if (state.port) { try { state.port.postMessage(msg); } catch (e) { /* panel closed */ } }
  }

  function handle(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'layers') { Object.assign(state.layers, msg.layers); schedule(); }
    else if (msg.type === 'focus') focusItem(msg.id === state.focusId ? null : msg.id);
    else if (msg.type === 'rescan') rescan();
    else if (msg.type === 'hover') setHover(msg.id || null, false);
    else if (msg.type === 'theme') { state.theme = msg.theme; schedule(); }
  }

  if (globalThis.chrome && chrome.runtime && chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'html-layers') return;
      if (state.port) { try { state.port.disconnect(); } catch (e) { /* ignore */ } }
      state.port = port;
      port.onMessage.addListener(handle);
      port.onDisconnect.addListener(() => {
        if (state.port === port) { state.port = null; deactivate(); }
      });
      activate();
    });
  }

  // Exposed for tests.
  globalThis.HTMLLayers = { activate, deactivate, handle, render, state };
})();
