// HTML Layers - side panel.
const $ = (s) => document.querySelector(s);
const ALERT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5 15 14.5H1L8 1.5Zm-.8 4.5v4.2h1.6V6H7.2Zm0 5.4V13h1.6v-1.6H7.2Z"/></svg>';

const ui = {
  status: $('#status'), blocked: $('#blocked'), blockedText: $('#blocked-text'),
  main: $('#main'), rescan: $('#rescan'), allow: $('#allow'),
  summaryText: $('#summary-text'), pageIssues: $('#page-issues'),
  lists: { headings: $('#headings'), landmarks: $('#landmarks'), lists: $('#lists') },
};

const layers = { headings: true, landmarks: true, lists: false, wash: true };
let theme = 'auto';
const themeSelect = $('#theme');
themeSelect.addEventListener('change', () => {
  theme = themeSelect.value;
  if (port) port.postMessage({ type: 'theme', theme });
});
let port = null;
let tabId = null;
let data = null;
let focusedId = null;

// ---------- connection to the page ----------

async function inspect(id) {
  disconnect();
  tabId = id;
  data = null;
  ui.status.textContent = 'Reading the page…';
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content/scan.js', 'content/content.js'] });
  } catch (err) {
    showBlocked(err);
    return;
  }
  port = chrome.tabs.connect(id, { name: 'html-layers' });
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => { port = null; });
  port.postMessage({ type: 'layers', layers });
  port.postMessage({ type: 'theme', theme });
}

function disconnect() {
  if (port) { try { port.disconnect(); } catch (e) { /* ignore */ } }
  port = null;
  focusedId = null;
}

async function inspectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) inspect(tab.id);
}

function showBlocked(err) {
  const msg = String(err && err.message || err);
  ui.main.hidden = true;
  ui.rescan.hidden = true;
  ui.blocked.hidden = false;
  ui.status.textContent = '';
  if (/chrome:\/\/|chrome-extension:|webstore|cannot be scripted|Cannot access a chrome/i.test(msg)) {
    ui.blockedText.textContent = 'Chrome does not allow extensions on this page (browser pages and the Chrome Web Store). Open a regular website to inspect it.';
    ui.allow.hidden = true;
  } else {
    ui.blockedText.textContent = 'Click the HTML Layers icon in the toolbar (or press Alt+Shift+L) to inspect this tab.';
    ui.allow.hidden = false;
  }
}

ui.allow.addEventListener('click', async () => {
  const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (ok) inspectActiveTab();
});
ui.rescan.addEventListener('click', () => { if (port) port.postMessage({ type: 'rescan' }); else inspectActiveTab(); });

// Toolbar icon clicked while the panel is open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'inspect') inspect(msg.tabId);
});

// Follow the user across tabs and reloads (works when access is allowed).
chrome.tabs.onActivated.addListener(({ tabId: id, windowId }) => {
  if (id === tabId && port) return;
  chrome.windows.getCurrent().then((w) => { if (w.id === windowId) inspect(id); });
});
chrome.tabs.onUpdated.addListener((id, info) => {
  if (id === tabId && info.status === 'complete') inspect(id);
});

// ---------- messages from the page ----------

function onMessage(msg) {
  if (msg.type === 'scan') {
    data = msg.data;
    themeSelect.options[0].textContent = 'Auto (' + (msg.autoTheme || 'dark') + ')';
    render();
  }
  else if (msg.type === 'hover') markHover(msg.id);
  else if (msg.type === 'focused') {
    focusedId = msg.id;
    markPressed();
    if (msg.id && !msg.visible) ui.status.textContent = 'This element is not visible on the page, so it cannot be highlighted.';
    else ui.status.textContent = '';
  }
}

// ---------- layers ----------

document.querySelectorAll('[data-layer]').forEach((box) => {
  box.checked = layers[box.dataset.layer];
  box.addEventListener('change', () => {
    layers[box.dataset.layer] = box.checked;
    if (port) port.postMessage({ type: 'layers', layers });
    syncSections();
  });
});

function syncSections() {
  ['headings', 'landmarks', 'lists'].forEach((k) => {
    document.querySelector('[data-section="' + k + '"]').hidden = !layers[k];
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && focusedId && port) port.postMessage({ type: 'focus', id: focusedId });
});

// ---------- rendering ----------

function render() {
  ui.blocked.hidden = true;
  ui.main.hidden = false;
  ui.rescan.hidden = false;
  ui.status.textContent = '';
  syncSections();

  const headings = data.headings.filter((h) => !h.removed);
  document.querySelector('[data-count="headings"]').textContent = headings.length;
  document.querySelector('[data-count="landmarks"]').textContent = data.landmarks.length;
  document.querySelector('[data-count="lists"]').textContent = data.lists.length;

  // Summary
  const itemIssues = ['headings', 'landmarks'].concat(layers.lists ? ['lists'] : [])
    .reduce((n, k) => n + data[k].filter((i) => i.issues.length).length, 0);
  const total = itemIssues + data.page.issues.length;
  ui.summaryText.textContent = total === 0
    ? 'No issues found in headings and landmarks.'
    : total + (total === 1 ? ' issue' : ' issues') + ' found.';
  ui.pageIssues.replaceChildren(...data.page.issues.map((t) => {
    const li = document.createElement('li');
    li.innerHTML = ALERT + '<span></span>';
    li.lastChild.textContent = t;
    return li;
  }));

  fill(ui.lists.headings, data.headings, 'No headings found.');
  fill(ui.lists.landmarks, data.landmarks, 'No landmarks found.');
  fill(ui.lists.lists, data.lists, 'No lists found.');
  markPressed();
}

function fill(list, items, emptyText) {
  if (!items.length) {
    const p = document.createElement('li');
    p.className = 'empty-list';
    p.textContent = emptyText;
    list.replaceChildren(p);
    return;
  }
  list.replaceChildren(...items.map(rowFor));
}

function rowFor(item) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'row' + (item.hidden ? ' is-hidden' : '');
  btn.dataset.id = item.id;
  btn.setAttribute('aria-pressed', 'false');

  const indent = item.kind === 'heading' ? Math.max((item.level || 1) - 1, 0) : item.depth;
  li.style.paddingLeft = Math.min(indent, 5) * 14 + 'px';

  const chip = document.createElement('span');
  const issue = item.issues.length > 0;
  chip.className = 'chip chip--' + (item.removed ? 'removed' : issue ? 'issue' : item.kind);
  chip.innerHTML = (issue ? ALERT : '') + '<span></span>';
  chip.lastChild.textContent = item.removed ? item.tag : item.label;

  const body = document.createElement('span');
  body.className = 'row__body';
  const text = document.createElement('span');
  text.className = 'row__text';
  let main = '';
  if (item.kind === 'heading') main = item.text;
  else if (item.kind === 'landmark') main = item.name || '(no name)';
  else main = item.text.slice(0, 80);
  if (!main) { text.classList.add('row__text--empty'); main = item.kind === 'heading' ? '(empty)' : '(no text)'; }
  text.textContent = main;
  body.appendChild(text);

  item.issues.forEach((t) => {
    const p = document.createElement('span');
    p.className = 'issue-msg';
    p.innerHTML = ALERT + '<span></span>';
    p.lastChild.textContent = t;
    body.appendChild(p);
  });
  const meta = [].concat(item.notes);
  if (item.hidden) meta.push('Hidden: ' + item.hidden + (item.ax ? ' (skipped by screen readers)' : ' (still read by screen readers)'));
  if (meta.length) {
    const m = document.createElement('span');
    m.className = 'row__meta';
    m.textContent = meta.join(' · ');
    body.appendChild(m);
  }

  btn.append(chip, body);
  btn.addEventListener('click', () => { if (port) port.postMessage({ type: 'focus', id: item.id }); });
  const hoverOn = () => { if (port) port.postMessage({ type: 'hover', id: item.id }); };
  const hoverOff = () => { if (port) port.postMessage({ type: 'hover', id: null }); };
  btn.addEventListener('mouseenter', hoverOn);
  btn.addEventListener('mouseleave', hoverOff);
  btn.addEventListener('focus', hoverOn);
  btn.addEventListener('blur', hoverOff);
  li.appendChild(btn);
  return li;
}

// Pointer over an element on the page: highlight its row and bring it into view.
function markHover(id) {
  document.querySelectorAll('.row.is-hover').forEach((b) => b.classList.remove('is-hover'));
  if (!id) return;
  const row = document.querySelector('.row[data-id="' + id + '"]');
  if (row) { row.classList.add('is-hover'); row.scrollIntoView({ block: 'nearest' }); }
}

function markPressed() {
  document.querySelectorAll('.row').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === focusedId)));
}

inspectActiveTab();
