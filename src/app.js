// App controller: state, undo/redo, files, export, theme, keyboard, Claude suggestions.
window.FP = window.FP || {};

(function () {
  const M = FP.model, G = FP.geom, I = FP.icons;
  const $ = (id) => document.getElementById(id);
  const api = window.api || null;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };

  const state = {
    project: M.newProject('My house'),
    designId: null, placeholder: true, filePath: null, dirty: false,
    sel: null, tool: 'select', mode: 'plan', dims: true,
    theme: store.get('fp.theme') || 'system', resolvedTheme: 'light',
    wheel: store.get('fp.wheel') || 'zoom',
    // snap step in metres for drawing and moving (0 = off); an app preference, not part of a design
    snap: (() => { const v = parseFloat(store.get('fp.snap')); return v >= 0 && v <= 1 ? v : 0.05; })(),
    layers: { house: { visible: true, locked: false }, furniture: { visible: true, locked: false }, landscape: { visible: true, locked: false } },
    opts: {
      wallT: 0.15, wallKind: 'auto', shape: 'rect', roomKind: 'bedroom', roomUse: 'indoor', roomWalls: true,
      material: 'concrete', plant: 'tree', item: 'sofa', itemRot: 0, doorType: 'door',
      openW: { door: 0.9, sliding: 1.8, window: 1.2, opening: 1.5 }
    },
    preview: null, previewShow: 'suggestion', claudeOpts: null
  };
  const undo = [], redo = [];
  let pending = null, raf = 0, panelsDirty = false, saveTimer = 0, toastTimer = 0;

  const shownProject = () => (state.preview && state.previewShow === 'suggestion' ? state.preview.project : state.project);

  /* ---------- rendering ---------- */
  function refresh(opts) {
    if (!(opts && opts.canvasOnly) && !pending) panelsDirty = true;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (state.mode === '3d') FP.view3d.rebuild(); else FP.editor.redraw();
      if (panelsDirty) { panelsDirty = false; FP.panels.update(); }
      updateChrome();
    });
  }

  function updateChrome() {
    const p = state.project;
    const nameEl = $('projectName');
    if (document.activeElement !== nameEl) nameEl.value = p.name;
    const file = state.filePath ? state.filePath.split(/[\\/]/).pop() : null;
    $('saveState').textContent = state.preview ? 'Previewing a suggestion' : state.placeholder ? '' : state.dirty ? 'Saving…' : 'Saved' + (file ? ' · ' + file : '');
    $('btnUndo').disabled = !undo.length || !!state.preview;
    $('btnRedo').disabled = !redo.length || !!state.preview;
    $('viewPlan').classList.toggle('active', state.mode === 'plan');
    $('viewRender').classList.toggle('active', state.mode === 'render');
    $('viewThree').classList.toggle('active', state.mode === '3d');
    $('btnClaude').disabled = !!state.preview;
    const title = p.name + (state.dirty ? ' • ' : '') + ' — Floorplan Studio';
    document.title = title;
    if (api) api.setTitle(title);
  }

  /* ---------- edits & history ---------- */
  function pushUndo(snap) {
    undo.push(snap);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
  }
  function markDirty() {
    state.dirty = true;
    state.placeholder = false;
    if (api) api.setDirty(true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToLibrary, 1200);
  }

  /* ---------- design library: every design autosaves, listed on the home screen ---------- */
  const readLocalLib = () => { try { return JSON.parse(store.get('fp.library') || '{}') || {}; } catch (e) { return {}; } };
  const writeLocalLib = (all) => store.set('fp.library', JSON.stringify(all));
  // Desktop app: files in the app's data folder. Browser fallback: localStorage.
  const lib = {
    list: () => (api ? api.designsList() : Promise.resolve(Object.values(readLocalLib()).map((d) => d.meta).sort((a, b) => b.updatedAt - a.updatedAt))),
    load: (id) => (api ? api.designsLoad(id) : Promise.resolve(readLocalLib()[id] || null)),
    save: (id, payload) => { if (api) return api.designsSave(id, payload); const all = readLocalLib(); all[id] = payload; writeLocalLib(all); return Promise.resolve(true); },
    remove: (id) => { if (api) return api.designsDelete(id); const all = readLocalLib(); delete all[id]; writeLocalLib(all); return Promise.resolve(true); }
  };

  async function thumbnail(p) {
    const svg = FP.draw.documentSvg(p, { mode: 'render', theme: 'light', dims: false, pxPerM: 9 });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  let saving = null;
  async function saveToLibrary() {
    clearTimeout(saveTimer);
    if (!state.designId || state.placeholder) return;
    const id = state.designId;
    const snap = JSON.stringify(state.project), p = JSON.parse(snap);
    const s = M.stats(p);
    const meta = { id, name: p.name, updatedAt: Date.now(), indoor: s.indoor, covered: s.covered, rooms: p.rooms.length, thumb: await thumbnail(p) };
    saving = lib.save(id, { kind: 'floorplan-design', version: 1, meta, project: p });
    try { await saving; } finally { saving = null; }
    if (id === state.designId && JSON.stringify(state.project) === snap) { state.dirty = false; if (api) api.setDirty(false); }
    updateChrome();
  }
  async function flushSave() {
    if (state.dirty && !state.placeholder) await saveToLibrary();
    else if (saving) await saving;
  }

  async function openDesign(id) {
    await flushSave();
    const d = await lib.load(id);
    if (!d || !d.project) { toast('That design could not be opened.'); return false; }
    loadProject(d.project, { designId: id });
    FP.home.hide();
    return true;
  }
  async function deleteDesign(id) {
    const ok = await lib.remove(id);
    if (ok && id === state.designId) { state.placeholder = true; state.designId = null; }
    return ok;
  }
  async function goHome() {
    await flushSave();
    if (state.mode === '3d' && FP.view3d.isWalking()) FP.view3d.exitWalk();
    FP.home.show();
  }

  function mutate(fn) {
    if (state.preview) { toast('Apply or discard the suggestion first.'); return; }
    const snap = JSON.stringify(state.project);
    fn(state.project);
    pushUndo(snap);
    markDirty();
    validateSel();
    refresh();
  }
  function beginChange() { pending = JSON.stringify(state.project); }
  function endChange(changed) {
    if (changed && pending) { pushUndo(pending); markDirty(); }
    pending = null;
    refresh();
  }
  function restore(json) {
    state.project = M.normalize(JSON.parse(json));
    validateSel();
    markDirty();
    refresh();
  }
  function doUndo() {
    if (state.preview) return;
    if (!undo.length) return toast('Nothing to undo');
    redo.push(JSON.stringify(state.project));
    restore(undo.pop());
  }
  function doRedo() {
    if (state.preview || !redo.length) return;
    undo.push(JSON.stringify(state.project));
    restore(redo.pop());
  }
  function validateSel() {
    if (state.sel && !M.find(state.project, state.sel.k, state.sel.id)) state.sel = null;
  }

  function select(sel) {
    state.sel = sel;
    if (sel) FP.panels.showTab('inspector');
    FP.panels.update(true);
    FP.editor.drawOverlay();
    if (state.mode === '3d') FP.view3d.syncSelection();
  }
  const TOOLS_3D = ['select', 'hand', 'item', 'plant'];
  function setTool(t) {
    if (state.preview) return;
    if (state.mode === '3d' && !TOOLS_3D.includes(t)) { setMode('plan'); toast('Switched to Plan to draw.'); }
    state.tool = t;
    FP.editor.resetTool();
    FP.panels.updateTool();
  }
  function setMode(m) {
    if (m === state.mode) return;
    if (m === '3d') {
      state.mode = '3d';
      if (!TOOLS_3D.includes(state.tool)) { state.tool = 'select'; FP.editor.resetTool(); }
      if (!FP.view3d.show()) { state.mode = 'plan'; }
    } else {
      if (state.mode === '3d') FP.view3d.hide();
      state.mode = m;
    }
    FP.panels.updateTool();
    refresh();
  }
  // One click from anywhere: open the 3D view and start walking in first person.
  function walkThrough() {
    if (state.placeholder) return;
    if (state.mode !== '3d') setMode('3d');
    if (state.mode === '3d' && !FP.view3d.isWalking()) FP.view3d.startWalk();
  }
  const zoomBy = (k) => (state.mode === '3d' ? FP.view3d.zoom(k) : FP.editor.zoomAt(k));
  const zoomFit = () => (state.mode === '3d' ? FP.view3d.fit() : FP.editor.fit());
  function setWheel(w) { state.wheel = w; store.set('fp.wheel', w); }
  function setSnap(v) {
    state.snap = Math.max(0, Math.min(1, +v || 0));
    store.set('fp.snap', String(state.snap));
    $('snapSel').value = String(state.snap);
    FP.editor.drawOverlay();
  }

  function deleteSelection() {
    const s = state.sel;
    if (!s) return;
    mutate((p) => M.remove(p, s.k, s.id));
    select(null);
  }

  function duplicate() {
    const s = state.sel;
    if (!s || state.preview) return;
    const src = M.find(state.project, s.k, s.id);
    if (!src) return;
    const c = JSON.parse(JSON.stringify(src));
    c.id = M.uid(s.k[0]);
    const d = 0.5;
    if (c.pts) c.pts = c.pts.map((q) => ({ x: q.x + d, y: q.y + d }));
    if (s.k === 'wall') { c.x1 += d; c.y1 += d; c.x2 += d; c.y2 += d; }
    if (s.k === 'item' || s.k === 'plant') { c.x += d; c.y += d; }
    if (s.k === 'opening') c.pos += c.w + 0.3;
    if (s.k === 'room') c.name = c.name + ' copy';
    mutate((p) => { M.list(p, s.k).push(c); if (s.k === 'opening') M.clampOpening(p, c); });
    select({ k: s.k, id: c.id });
  }

  function rotateSelection(deg) {
    if (state.tool === 'item') return FP.editor.rotateGhost(deg);
    const s = state.sel;
    if (!s || s.k !== 'item') return;
    mutate((p) => { const it = M.find(p, 'item', s.id); it.rot = (((it.rot || 0) + deg) % 360 + 360) % 360; });
  }

  function nudge(dx, dy) {
    const s = state.sel;
    if (!s) return;
    mutate((p) => {
      const e = M.find(p, s.k, s.id);
      if (!e) return;
      if (e.pts) e.pts = e.pts.map((q) => ({ x: G.round(q.x + dx), y: G.round(q.y + dy) }));
      else if (s.k === 'opening') { const v = M.wallVec(M.find(p, 'wall', e.wall)); e.pos += dx * v.ux + dy * v.uy; M.clampOpening(p, e); }
      else if (s.k === 'wall') {
        const vertical = Math.abs(e.x1 - e.x2) < 1e-6, horizontal = Math.abs(e.y1 - e.y2) < 1e-6;
        if (vertical || horizontal) {
          // straight walls move only across themselves, with their whole run; walls meeting them stretch
          const d = vertical ? dx : dy;
          if (d) M.shiftLine(p, vertical, vertical ? e.x1 : e.y1, vertical ? Math.min(e.y1, e.y2) : Math.min(e.x1, e.x2), vertical ? Math.max(e.y1, e.y2) : Math.max(e.x1, e.x2), d);
        } else {
          e.x1 = G.round(e.x1 + dx); e.y1 = G.round(e.y1 + dy); e.x2 = G.round(e.x2 + dx); e.y2 = G.round(e.y2 + dy);
        }
      }
      else { e.x = G.round(e.x + dx); e.y = G.round(e.y + dy); }
    });
  }

  /* ---------- Claude suggestions ---------- */
  function propose(next, summary, title) {
    next.name = state.project.name;
    state.preview = { project: next, summary, title, diff: FP.claude.diff(state.project, next) };
    state.previewShow = 'suggestion';
    state.sel = null;
    FP.editor.resetTool();
    FP.panels.showTab('inspector');
    FP.panels.updateTool();
    refresh();
    if (!state.project.walls.length || state.preview.diff.lot) requestAnimationFrame(() => FP.editor.fit());
  }
  function applyPreview() {
    if (!state.preview) return;
    const snap = JSON.stringify(state.project);
    state.project = M.normalize(state.preview.project);
    state.preview = null;
    pushUndo(snap);
    markDirty();
    FP.panels.updateTool();
    refresh();
    toast('Suggestion applied. ⌘Z undoes it.');
  }
  function discardPreview() {
    if (!state.preview) return;
    state.preview = null;
    FP.panels.updateTool();
    refresh();
    toast('Suggestion discarded.');
  }

  /* ---------- files ---------- */
  // opts: { designId, filePath, persist } — persist saves it to the library straight away.
  function loadProject(p, opts) {
    opts = opts || {};
    state.project = M.normalize(p);
    state.filePath = opts.filePath || null;
    state.designId = opts.designId || M.uid('d');
    state.placeholder = false;
    state.dirty = false;
    state.sel = null;
    state.preview = null;
    undo.length = 0; redo.length = 0;
    if (api) api.setDirty(false);
    FP.editor.resetTool();
    FP.panels.updateTool();
    refresh();
    requestAnimationFrame(() => { FP.editor.fit(); if (state.mode === '3d') FP.view3d.fit(); });
    if (opts.persist) { state.dirty = true; saveToLibrary(); }
    // Designs from before sizes meant "inside the walls": grow their rooms once to keep the same numbers.
    if (state.project.settings.sizes !== 'clear' && state.project.rooms.length) {
      mutate((q) => M.toClearSizes(q));
      toast('Room sizes now measure inside the walls, so rooms grew to keep their sizes. ⌘Z undoes it.', 6500);
    } else {
      state.project.settings.sizes = 'clear';
    }
  }
  // persist false is for Claude drafts: the design is only saved once a suggestion is applied.
  function newBlank(lot, persist) {
    const p = M.newProject('My house');
    if (lot) p.lot = { w: lot.w, h: lot.h };
    loadProject(p, { persist: persist !== false });
    FP.home.hide();
  }
  async function loadSample() {
    await flushSave();
    loadProject(FP.sample(), { persist: true });
    FP.home.hide();
  }

  async function openFile() {
    await flushSave();
    if (api) {
      const r = await api.openFile();
      if (r) parseAndLoad(r.content, r.path);
    } else {
      $('fileInput').click();
    }
  }
  function parseAndLoad(text, path) {
    try {
      const p = JSON.parse(text);
      if (!p || !Array.isArray(p.walls)) throw new Error('not a project');
      loadProject(p, { filePath: path, persist: true });
      FP.home.hide();
      toast('Opened ' + (path ? path.split(/[\\/]/).pop() : p.name) + ' and added it to your designs');
    } catch (e) {
      toast('That file is not a Floorplan Studio project.');
    }
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ⌘S saves to your designs now (and to the linked .fplan file, if there is one). Save As exports a .fplan copy.
  async function save(as) {
    if (state.preview) return toast('Apply or discard the suggestion first.');
    if (state.placeholder) return;
    if (!as) { state.dirty = true; await saveToLibrary(); }
    if (!as && !state.filePath) return toast('Saved to your designs');
    const content = JSON.stringify(state.project, null, 1);
    if (!api) { download(state.project.name + '.fplan', new Blob([content], { type: 'application/json' })); return; }
    const p = as ? await api.saveFileAs(content, state.project.name) : await api.saveFile(state.filePath, content, state.project.name);
    if (!p) return;
    state.filePath = p;
    refresh();
    toast('Saved ' + p.split(/[\\/]/).pop());
  }

  async function exportPng() {
    if (state.mode === '3d') {
      const shot = FP.view3d.screenshot();
      if (api) { const p = await api.exportPng(shot, state.project.name + ' 3D'); if (p) toast('Exported ' + p.split(/[\\/]/).pop()); }
      else download(state.project.name + ' 3D.png', await (await fetch(shot)).blob());
      return;
    }
    const svg = FP.draw.documentSvg(shownProject(), { mode: 'render', theme: 'light', dims: state.dims, pxPerM: 80 });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const dataUrl = c.toDataURL('image/png');
      if (api) {
        const p = await api.exportPng(dataUrl, state.project.name + ' render');
        if (p) toast('Exported ' + p.split(/[\\/]/).pop());
      } else {
        download(state.project.name + ' render.png', await (await fetch(dataUrl)).blob());
      }
    } catch (e) {
      toast('Could not export the render.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function exportSvg() {
    const svg = FP.draw.documentSvg(shownProject(), { mode: 'render', theme: 'light', dims: state.dims });
    if (api) { const p = await api.exportSvg(svg, state.project.name + ' render'); if (p) toast('Exported ' + p.split(/[\\/]/).pop()); }
    else download(state.project.name + ' render.svg', new Blob([svg], { type: 'image/svg+xml' }));
  }

  /* ---------- theme ---------- */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    state.resolvedTheme = state.theme === 'system' ? (mq.matches ? 'dark' : 'light') : state.theme;
    document.documentElement.dataset.theme = state.resolvedTheme;
    const b = $('btnTheme');
    b.innerHTML = state.theme === 'system' ? I.auto : state.theme === 'dark' ? I.moon : I.sun;
    b.title = 'Theme: ' + { system: 'match system', light: 'light', dark: 'dark' }[state.theme];
    if (api) api.setTheme(state.theme);
    refresh({ canvasOnly: true });
  }
  function cycleTheme() {
    state.theme = { system: 'light', light: 'dark', dark: 'system' }[state.theme];
    store.set('fp.theme', state.theme);
    applyTheme();
    toast('Theme: ' + { system: 'match system', light: 'light', dark: 'dark' }[state.theme]);
  }

  /* ---------- toast ---------- */
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  /* ---------- commands & keyboard ---------- */
  const typing = () => {
    const t = document.activeElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };
  function command(cmd) {
    const modalOpen = !$('modal').hidden;
    switch (cmd) {
      case 'new': case 'home': return goHome();
      case 'sample': return loadSample();
      case 'walk': return walkThrough();
      case 'open': return openFile();
      case 'save': return save(false);
      case 'saveAs': return save(true);
      case 'exportPng': return exportPng();
      case 'exportSvg': return exportSvg();
      case 'undo': return typing() ? document.execCommand('undo') : modalOpen ? null : doUndo();
      case 'redo': return typing() ? document.execCommand('redo') : modalOpen ? null : doRedo();
      case 'duplicate': return typing() || modalOpen ? null : duplicate();
      case 'viewPlan': return setMode('plan');
      case 'viewRender': return setMode('render');
      case 'view3d': return setMode('3d');
      case 'zoomFit': return zoomFit();
    }
  }

  const TOOL_KEYS = { v: 'select', h: 'hand', w: 'wall', r: 'room', d: 'door', n: 'window', f: 'item', a: 'area', t: 'plant', m: 'measure' };
  function onKey(e) {
    if (e.key === 'Shift') FP.editor.setModifier('shift', true);
    if (e.key === 'Alt') FP.editor.setModifier('alt', true);
    if (typing()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (!$('modal').hidden) return;
    if (FP.home.isOpen()) { if (e.key === 'Escape' && !state.placeholder) FP.home.hide(); return; }
    if (state.mode === '3d' && FP.view3d.isWalking()) return; // the walker owns the keyboard
    const meta = e.metaKey || e.ctrlKey;
    if (meta) {
      if (api) return; // the native menu owns accelerators
      const k = e.key.toLowerCase();
      const map = { z: e.shiftKey ? 'redo' : 'undo', s: e.shiftKey ? 'saveAs' : 'save', o: 'open', d: 'duplicate', e: 'exportPng', 1: 'viewPlan', 2: 'viewRender', 3: 'view3d', 0: 'zoomFit' };
      if (map[k]) { e.preventDefault(); command(map[k]); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); FP.editor.setModifier('space', true); return; }
    const step = (e.shiftKey ? 10 : 1) * (state.snap || 0.01);
    switch (e.key) {
      case 'Escape': if (!FP.editor.cancel()) select(null); return;
      case 'Enter': FP.editor.enter(); return;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); return;
      case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); return;
      case 'ArrowRight': e.preventDefault(); nudge(step, 0); return;
      case 'ArrowUp': e.preventDefault(); nudge(0, -step); return;
      case 'ArrowDown': e.preventDefault(); nudge(0, step); return;
      case '[': rotateSelection(-90); return;
      case ']': rotateSelection(90); return;
      case '+': case '=': zoomBy(1.25); return;
      case '-': case '_': zoomBy(0.8); return;
      case '0': zoomFit(); return;
    }
    const tool = TOOL_KEYS[e.key.toLowerCase()];
    if (tool) setTool(tool);
  }
  function onKeyUp(e) {
    if (e.key === 'Shift') FP.editor.setModifier('shift', false);
    if (e.key === 'Alt') FP.editor.setModifier('alt', false);
    if (e.key === ' ') FP.editor.setModifier('space', false);
  }

  /* ---------- boot ---------- */
  function init() {
    if (!api) document.body.classList.add('no-electron');
    $('btnUndo').innerHTML = I.undo;
    $('btnRedo').innerHTML = I.redo;
    $('zoomIn').innerHTML = I.plus;
    $('zoomOut').innerHTML = I.minus;
    $('zoomFit').innerHTML = I.fit;
    document.querySelector('#btnExport .i').innerHTML = I.download;
    document.querySelector('#btnClaude .i').innerHTML = I.sparkle;

    $('btnUndo').onclick = doUndo;
    $('btnRedo').onclick = doRedo;
    $('btnTheme').onclick = cycleTheme;
    $('btnExport').onclick = exportPng;
    $('btnClaude').onclick = () => FP.panels.openAsk();
    $('viewPlan').onclick = () => setMode('plan');
    $('viewRender').onclick = () => setMode('render');
    $('viewThree').onclick = () => setMode('3d');
    $('btnHome').innerHTML = I.house;
    $('btnHome').onclick = goHome;
    document.querySelector('#btnWalk .i').innerHTML = I.walk;
    $('btnWalk').onclick = walkThrough;
    $('zoomIn').onclick = () => zoomBy(1.25);
    $('zoomOut').onclick = () => zoomBy(0.8);
    $('zoomFit').onclick = zoomFit;
    const snapSel = $('snapSel');
    for (const [v, l] of [[0.01, '1 cm'], [0.05, '5 cm'], [0.1, '10 cm'], [0.25, '25 cm'], [0.5, '50 cm'], [1, '1 m'], [0, 'Off']]) {
      const o = document.createElement('option'); o.value = String(v); o.textContent = 'Snap ' + l; snapSel.append(o);
    }
    snapSel.value = String(state.snap);
    snapSel.onchange = () => setSnap(snapSel.value);
    $('zoomLabel').onclick = () => FP.editor.zoomTo(FP.editor.BASE_SCALE);
    $('projectName').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v && v !== state.project.name) mutate((p) => { p.name = v; }); });
    $('projectName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('fileInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) f.text().then((t) => parseAndLoad(t, null));
      e.target.value = '';
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { for (const m of ['shift', 'alt', 'space']) FP.editor.setModifier(m, false); });
    mq.addEventListener('change', () => { if (state.theme === 'system') applyTheme(); });
    if (api) api.onMenu(command);

    FP.editor.init();
    FP.panels.buildRail();
    FP.panels.bindTabs();
    applyTheme();

    // Dropping a file anywhere would otherwise navigate the window away; drop zones handle their own.
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    refresh();
    migrateOldAutosave().then(() => FP.home.show());
  }

  // Earlier builds kept one autosaved project in localStorage; move it into the library once.
  async function migrateOldAutosave() {
    let old = null;
    try { old = JSON.parse(store.get('fp.autosave') || 'null'); } catch (e) { old = null; }
    if (!old || !old.project || !Array.isArray(old.project.walls) || !old.project.walls.length) return;
    loadProject(old.project, { filePath: old.filePath, persist: true });
    await flushSave();
    store.set('fp.autosave', '');
  }

  FP.app = {
    state, shownProject, refresh, mutate, beginChange, endChange, select, setTool, setMode, setWheel, setSnap,
    duplicate, rotateSelection, toast, propose, applyPreview, discardPreview, openFile, loadSample, newBlank,
    listDesigns: () => lib.list(), openDesign, deleteDesign, goHome, walkThrough, flushSave,
    hasOpenDesign: () => !state.placeholder
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
