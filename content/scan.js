// HTML Layers - detection and validation.
// Reads the DOM and returns headings, landmarks and lists with their issues.
// Adapted from Ine's original semantics inspector (AJC).
(() => {
  if (globalThis.HTMLLayersScan) return;

  const IGNORE = 'html-layers-overlay';

  // ---------- helpers ----------

  function idref(el, attr) {
    const ids = el.getAttribute(attr);
    if (!ids) return '';
    return ids.split(/\s+/).map((id) => {
      const t = document.getElementById(id);
      return t ? textOf(t) : '';
    }).join(' ').trim();
  }

  // Approximate accessible text: text nodes + img alt, skipping aria-hidden subtrees.
  function textOf(root) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.getAttribute('aria-hidden') === 'true') return;
      const tag = n.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT') return;
      if (tag === 'IMG' || (n.getAttribute('role') === 'img')) {
        out += ' ' + (n.getAttribute('alt') || n.getAttribute('aria-label') || '') + ' ';
        return;
      }
      if (n.hasAttribute('aria-label') && n !== root) { out += ' ' + n.getAttribute('aria-label') + ' '; return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(root);
    return out.replace(/\s+/g, ' ').trim();
  }

  function accName(el) {
    const by = idref(el, 'aria-labelledby');
    if (by) return by;
    const label = el.getAttribute('aria-label');
    return label ? label.trim() : '';
  }

  // How an element is hidden.
  // ax:   removed from the accessibility tree (screen readers skip it)
  // ghost: still read by screen readers, but not visible on screen
  function visibility(el) {
    if (el.closest('[inert]')) return { state: 'inert', ax: true };
    if (el.closest('[aria-hidden="true"]')) return { state: 'aria-hidden', ax: true };
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') return { state: 'display: none', ax: true, gone: true };
    }
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') return { state: 'visibility: hidden', ax: true, gone: true };
    const r = el.getBoundingClientRect();
    const clipped = (cs.clipPath && cs.clipPath.indexOf('inset(50%') === 0) ||
      (cs.clip && cs.clip !== 'auto' && /rect\(0(px)?,? 0(px)?/.test(cs.clip));
    if (clipped || (r.width <= 1 && r.height <= 1)) return { state: 'visually hidden', ghost: true };
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (getComputedStyle(n).opacity === '0') return { state: 'opacity: 0', ghost: true };
    }
    const docW = document.documentElement.scrollWidth;
    if (r.right <= 0 || r.left >= docW) return { state: 'off-screen', ghost: true };
    return { state: '' };
  }

  function inOverlay(el) { return !!el.closest(IGNORE); }

  // ---------- headings ----------

  const HSEL = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

  function scanHeadings(page) {
    const out = [];
    document.querySelectorAll(HSEL).forEach((el) => {
      if (inOverlay(el)) return;
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
      const native = /^h[1-6]$/.test(tag);
      const notes = [];
      if (native && (role === 'presentation' || role === 'none')) {
        // Semantics removed: not a heading for assistive tech. Listed, not counted.
        out.push(base(el, { kind: 'heading', level: null, removed: true, tag, label: tag + ' role=' + role,
          notes: ['role="' + role + '" removes the heading semantics'] }));
        return;
      }
      if (native && role && role !== 'heading') {
        out.push(base(el, { kind: 'heading', level: null, removed: true, tag, label: tag + ' role=' + role,
          notes: ['role="' + role + '" replaces the heading semantics'] }));
        return;
      }
      const ariaLevel = parseInt(el.getAttribute('aria-level'), 10);
      let level;
      if (native) {
        level = parseInt(tag.charAt(1), 10);
        if (ariaLevel >= 1 && ariaLevel !== level) {
          notes.push('aria-level="' + ariaLevel + '" overrides the ' + tag + ' level');
          level = ariaLevel;
        }
      } else {
        if (ariaLevel >= 1) level = ariaLevel;
        else { level = 2; notes.push('role="heading" without aria-level (defaults to level 2)'); }
        notes.push('<' + tag + ' role="heading"> instead of a native h' + level);
      }
      out.push(base(el, { kind: 'heading', level, tag, label: 'h' + level, notes }));
    });

    // Validation: only headings exposed to assistive tech take part in the outline.
    const exposed = out.filter((h) => !h.removed && !h.vis.ax);
    let prev = 0;
    exposed.forEach((h) => {
      if (!h.text) h.issues.push('Empty heading');
      if (prev && h.level > prev + 1) h.issues.push('Skipped level: h' + prev + ' to h' + h.level);
      prev = h.level;
    });
    const h1s = exposed.filter((h) => h.level === 1);
    if (h1s.length > 1) h1s.forEach((h) => h.issues.push('More than one h1 on the page (' + h1s.length + ')'));
    if (!exposed.length) page.issues.push('No headings on the page');
    else if (!h1s.length) page.issues.push('No h1 on the page');
    if (exposed.length && exposed[0].level !== 1 && h1s.length) {
      exposed[0].notes.push('First heading of the page is not the h1');
    }
    return out;
  }

  // ---------- landmarks ----------

  const ROLE_LANDMARK = { banner: 1, contentinfo: 1, main: 1, navigation: 1, complementary: 1, search: 1, form: 1, region: 1 };
  const IMPLICIT = { HEADER: 'banner', FOOTER: 'contentinfo', MAIN: 'main', NAV: 'navigation', ASIDE: 'complementary', SEARCH: 'search', FORM: 'form', SECTION: 'region' };
  const SECTIONING = 'article, aside, main, nav, section, [role="article"], [role="complementary"], [role="main"], [role="navigation"], [role="region"]';

  function landmarkRole(el) {
    const role = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (role) return ROLE_LANDMARK[role] ? role : null;
    const implicit = IMPLICIT[el.tagName];
    if (!implicit) return null;
    if ((implicit === 'banner' || implicit === 'contentinfo') && el.parentElement && el.parentElement.closest(SECTIONING)) return null;
    if ((implicit === 'region' || implicit === 'form') && !accName(el)) return null;
    return implicit;
  }

  function scanLandmarks(page) {
    const out = [];
    document.querySelectorAll('header, footer, main, nav, aside, search, section, form, [role]').forEach((el) => {
      if (inOverlay(el)) return;
      const role = landmarkRole(el);
      if (!role) return;
      const tag = el.tagName.toLowerCase();
      const explicit = el.getAttribute('role');
      const notes = [];
      if (explicit) notes.push('<' + tag + ' role="' + explicit + '">');
      else notes.push('<' + tag + '>');
      const name = accName(el);
      out.push(base(el, { kind: 'landmark', role, tag, name, label: role, notes }));
    });

    // Nesting depth, for the panel tree.
    const els = new Set(out.map((l) => l.el));
    out.forEach((l) => {
      let d = 0;
      for (let p = l.el.parentElement; p; p = p.parentElement) if (els.has(p)) d++;
      l.depth = d;
    });

    const exposed = out.filter((l) => !l.vis.ax);
    const byRole = {};
    exposed.forEach((l) => { (byRole[l.role] = byRole[l.role] || []).push(l); });

    ['main', 'banner', 'contentinfo'].forEach((r) => {
      if ((byRole[r] || []).length > 1) byRole[r].forEach((l) => l.issues.push('More than one ' + r + ' landmark (' + byRole[r].length + ')'));
    });
    Object.keys(byRole).forEach((r) => {
      const list = byRole[r];
      if (list.length > 1 && r !== 'region') {
        list.forEach((l) => { if (!l.name) l.issues.push(list.length + ' ' + r + ' landmarks, this one has no name'); });
      }
    });
    if (!byRole.main) page.issues.push('No main landmark');
    return out;
  }

  // ---------- lists ----------

  function scanLists() {
    const out = [];
    document.querySelectorAll('ul, ol, dl, [role="list"]').forEach((el) => {
      if (inOverlay(el)) return;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role');
      const native = tag === 'ul' || tag === 'ol' || tag === 'dl';
      const notes = [];
      const issues = [];
      let count = 0;
      if (role === 'none' || role === 'presentation') {
        notes.push('role="' + role + '" removes the list semantics');
      } else if (native && role && role !== 'list') {
        notes.push('role="' + role + '" replaces the list semantics');
      } else {
        if (tag === 'dl') {
          count = el.querySelectorAll(':scope > dt, :scope > div > dt').length;
        } else {
          count = el.querySelectorAll(native ? ':scope > li' : ':scope > [role="listitem"]').length;
          const invalid = Array.prototype.some.call(el.children, (c) =>
            native ? !/^(LI|SCRIPT|TEMPLATE)$/.test(c.tagName) : c.getAttribute('role') !== 'listitem');
          if (invalid) issues.push('Direct children that are not list items');
        }
        if (!count) issues.push('Empty list');
      }
      if (!native) notes.push('<' + tag + ' role="list">');
      const label = (native ? tag : 'list') + (role === 'none' || role === 'presentation' ? '' : ' · ' + count);
      out.push(base(el, { kind: 'list', tag, count, label, notes, issues }));
    });
    return out;
  }

  // ---------- shared ----------

  let nextId = 1;
  const ids = new WeakMap();
  function idOf(el) {
    if (!ids.has(el)) ids.set(el, 'hl' + nextId++);
    return ids.get(el);
  }

  function base(el, extra) {
    const vis = visibility(el);
    return Object.assign({
      id: idOf(el),
      el,
      text: textOf(el).slice(0, 160),
      vis,
      issues: [],
      notes: [],
      depth: 0,
    }, extra, { issues: extra.issues || [], notes: extra.notes || [] });
  }

  function scan() {
    const page = { issues: [] };
    const headings = scanHeadings(page);
    const landmarks = scanLandmarks(page);
    const lists = scanLists();
    if (!document.documentElement.getAttribute('lang')) {
      // Not part of the MVP rules, kept as a page note only.
      page.notes = ['<html> has no lang attribute'];
    }
    return { page, headings, landmarks, lists };
  }

  // Serializable copy for the panel (no DOM references).
  function serialize(result) {
    const strip = (i) => ({
      id: i.id, kind: i.kind, label: i.label, level: i.level ?? null, role: i.role || null,
      tag: i.tag, name: i.name || '', text: i.text, depth: i.depth || 0, count: i.count ?? null,
      removed: !!i.removed, hidden: i.vis.state, ax: !!i.vis.ax, ghost: !!i.vis.ghost,
      issues: i.issues, notes: i.notes,
    });
    return {
      page: Object.assign({ title: document.title, url: location.href }, result.page),
      headings: result.headings.map(strip),
      landmarks: result.landmarks.map(strip),
      lists: result.lists.map(strip),
    };
  }

  globalThis.HTMLLayersScan = { scan, serialize, textOf };
})();
