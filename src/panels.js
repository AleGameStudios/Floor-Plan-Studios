// Everything around the canvas: tool rail, tool options, library drawer, inspector,
// area stats, layers, and the Claude dialog.
window.FP = window.FP || {};

(function () {
  const C = FP.catalog, M = FP.model, G = FP.geom, I = FP.icons;
  const A = () => FP.app;
  const S = () => FP.app.state;
  const P = () => FP.app.state.project;
  const $ = (id) => document.getElementById(id);
  const fm = (v) => v.toFixed(2);
  const m2 = (v) => v.toFixed(1) + ' m²';
  let sideTab = 'inspector';

  // name is the short label shown in the rail; label is the longer tooltip. A string entry is a section heading.
  const TOOLS = [
    'View',
    { id: 'select', icon: 'select', key: 'V', name: 'Select', label: 'Select and move' },
    { id: 'hand', icon: 'hand', key: 'H', name: 'Pan', label: 'Pan (or hold Space)' },
    'House',
    { id: 'wall', icon: 'wall', key: 'W', name: 'Walls', label: 'Draw walls' },
    { id: 'room', icon: 'room', key: 'R', name: 'Rooms', label: 'Draw rooms' },
    { id: 'door', icon: 'door', key: 'D', name: 'Doors', label: 'Doors and openings' },
    { id: 'window', icon: 'window', key: 'N', name: 'Windows', label: 'Windows' },
    'Furnish & plot',
    { id: 'item', icon: 'item', key: 'F', name: 'Furniture', label: 'Furniture and objects' },
    { id: 'site', icon: 'pool', key: 'P', name: 'Backyard', label: 'Pools, quinchos and sports fields' },
    { id: 'area', icon: 'area', key: 'A', name: 'Ground', label: 'Ground surfaces (paths, driveway, beds, pool)' },
    { id: 'plant', icon: 'plant', key: 'T', name: 'Plants', label: 'Trees and plants' },
    { id: 'fence', icon: 'fence', key: 'G', name: 'Fences', label: 'Fences (large and white picket)' },
    { id: 'gate', icon: 'gate', key: 'J', name: 'Gates', label: 'Gates: click on a fence to place one' },
    'Measure',
    { id: 'measure', icon: 'measure', key: 'M', name: 'Distance', label: 'Measure the distance between two points' },
    { id: 'laser', icon: 'laser', key: 'L', name: 'Laser gap', label: 'Laser measure: how wide is this space?' },
    { id: 'zone', icon: 'zone', key: 'Z', name: 'Area', label: 'Measure an area (drag a rectangle)' }
  ];
  const KIND_LABEL = { wall: 'Wall', opening: 'Opening', room: 'Room', area: 'Ground surface', plant: 'Plant', fence: 'Fence', gate: 'Gate', item: 'Object' };
  const KIND_ICON = { wall: 'wall', opening: 'door', room: 'room', area: 'area', plant: 'plant', fence: 'fence', gate: 'gate', item: 'item' };

  /* ---------- small DOM helpers ---------- */
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  }
  const opt = (pairs, value) => pairs.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value) }, l));
  const pairs = (obj) => Object.entries(obj).map(([k, d]) => [k, d.label]);

  function field(label, control) { return el('label', { class: 'field' }, el('span', {}, label), control); }
  function numInput(value, onSet, o) {
    o = o || {};
    return el('input', {
      type: 'number', step: o.step || 0.05, min: o.min, max: o.max, value: +(+value).toFixed(o.dec == null ? 2 : o.dec),
      onchange: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) onSet(v); }
    });
  }
  function textInput(value, onSet) { return el('input', { type: 'text', value, onchange: (e) => onSet(e.target.value) }); }
  // Colour swatches plus a picker for any colour. defLabel adds a "use the default" swatch (sets null).
  function swatchInput(value, palette, onSet, defLabel) {
    const box = el('div', { class: 'swatches' }), cur = (value || '').toLowerCase();
    if (defLabel) box.append(el('button', { class: 'sw default' + (!value ? ' on' : ''), title: defLabel, 'aria-label': defLabel, onclick: () => onSet(null) }));
    for (const [c, name] of palette) box.append(el('button', { class: 'sw' + (cur === c ? ' on' : ''), title: name, 'aria-label': name, style: 'background:' + c, onclick: () => onSet(c) }));
    const pick = el('input', { type: 'color', class: 'sw-pick', value: value || palette[0][0], title: 'Any colour', 'aria-label': 'Any colour' });
    pick.addEventListener('change', () => onSet(pick.value));
    box.append(pick);
    return box;
  }
  // Like field(), but stacked and not a <label> (a label would forward clicks to its first swatch).
  function block(label, control) { return el('div', { class: 'field stack' }, el('span', {}, label), control); }
  function selectInput(value, options, onSet) { return el('select', { onchange: (e) => onSet(e.target.value) }, opt(options, value)); }
  function checkInput(label, value, onSet) {
    return el('div', { class: 'field check' }, el('label', {}, el('input', { type: 'checkbox', checked: !!value, onchange: (e) => onSet(e.target.checked) }), label));
  }
  function btn(label, onClick, cls, icon) {
    return el('button', { class: 'btn small ' + (cls || ''), onclick: onClick }, icon ? el('span', { class: 'i', html: I[icon] }) : null, label);
  }
  const edit = (fn) => A().mutate(fn);

  /* ---------- rail ---------- */
  function buildRail() {
    const rail = $('rail');
    rail.innerHTML = '';
    for (const t of TOOLS) {
      if (typeof t === 'string') { rail.append(el('div', { class: 'rail-head' }, t)); continue; }
      rail.append(el('button', {
        class: 'tool', 'data-tool': t.id, title: t.label + ' (' + t.key + ')', 'aria-label': t.label,
        html: I[t.icon] + '<span class="name">' + t.name + '</span><span class="key">' + t.key + '</span>', onclick: () => A().setTool(t.id)
      }));
    }
  }

  /* ---------- options bar & drawer ---------- */
  const THICK = [[0.1, '0.10 m'], [0.12, '0.12 m'], [0.15, '0.15 m'], [0.2, '0.20 m'], [0.25, '0.25 m'], [0.3, '0.30 m']];
  function lbl(text, control) { return el('label', {}, text, control); }
  function seg(value, options, onSet) {
    return el('div', { class: 'seg' }, options.map(([v, l]) => el('button', { class: 'seg-btn' + (v === value ? ' active' : ''), onclick: () => onSet(v) }, l)));
  }

  function updateTool() {
    const st = S(), o = st.opts, bar = $('optbar');
    document.querySelectorAll('.tool').forEach((b) => { b.classList.toggle('active', b.dataset.tool === (st.tool === 'item' && st.site ? 'site' : st.tool)); b.disabled = !!st.preview; });
    $('stage').className = 'stage tool-' + (st.preview ? 'hand' : st.tool) + (st.mode === '3d' ? ' mode-3d' : '');
    bar.innerHTML = '';
    if (st.preview) { suggestionBar(); $('drawer').hidden = true; return; }
    if (st.mode === '3d' && (st.tool === 'select' || st.tool === 'hand')) { bar3d(); buildDrawer(); return; }
    const set = (k) => (v) => { o[k] = v; updateTool(); };
    const hint = (t) => el('span', { class: 'hint' }, t);
    switch (st.tool) {
      case 'wall':
        bar.append(el('span', { class: 'title' }, 'Walls'),
          lbl('Thickness', selectInput(o.wallT, THICK, (v) => set('wallT')(+v))),
          lbl('Type', selectInput(o.wallKind, [['auto', 'Auto'], ['exterior', 'Exterior'], ['interior', 'Interior']], set('wallKind'))),
          hint('Click to start · click each corner · double-click or Enter to finish · Shift any angle · Alt no snap'));
        break;
      case 'room':
        bar.append(el('span', { class: 'title' }, 'Rooms'),
          seg(o.shape, [['rect', 'Rectangle'], ['poly', 'Polygon']], set('shape')),
          selectInput(o.roomKind, pairs(C.roomKinds), (v) => {
            o.roomKind = v;
            if (v === 'gallery' || v === 'porch' || v === 'garage') o.roomUse = 'covered';
            updateTool();
          }),
          selectInput(o.roomUse, pairs(C.uses), set('roomUse')),
          lbl(el('input', { type: 'checkbox', checked: o.roomWalls, onchange: (e) => set('roomWalls')(e.target.checked) }), 'Add walls'),
          o.roomWalls ? selectInput(o.wallT, THICK, (v) => set('wallT')(+v)) : null,
          hint(o.shape === 'rect' ? 'Drag a rectangle' : 'Click corners · click the first one or press Enter to close'));
        break;
      case 'door':
        bar.append(el('span', { class: 'title' }, 'Doors'),
          seg(o.doorType, [['door', 'Swing'], ['sliding', 'Sliding'], ['opening', 'Open passage']], set('doorType')),
          lbl('Width', numInput(o.openW[o.doorType], (v) => { o.openW[o.doorType] = v; }, { step: 0.05, min: 0.4 })),
          hint('Click on a wall · a swing door opens toward the side you click'));
        break;
      case 'window':
        bar.append(el('span', { class: 'title' }, 'Windows'),
          lbl('Width', numInput(o.openW.window, (v) => { o.openW.window = v; }, { step: 0.05, min: 0.3 })),
          hint('Click on a wall to place a window'));
        break;
      case 'item': {
        const idef = C.items[o.item], sz = o.itemSize[o.item] || [idef.w, idef.h];
        bar.append(el('span', { class: 'title' }, idef.label),
          ...(st.site ? [
            lbl('Width', numInput(sz[0], (v) => { o.itemSize[o.item] = [Math.max(0.5, v), sz[1]]; updateTool(); }, { step: 0.5, min: 0.5 })),
            lbl('Depth', numInput(sz[1], (v) => { o.itemSize[o.item] = [sz[0], Math.max(0.5, v)]; updateTool(); }, { step: 0.5, min: 0.5 }))] : []),
          el('button', { class: 'icon-btn', title: 'Rotate left ([)', html: I.rotate, style: 'transform:scaleX(-1)', onclick: () => FP.editor.rotateGhost(-90) }),
          el('button', { class: 'icon-btn', title: 'Rotate right (])', html: I.rotate, onclick: () => FP.editor.rotateGhost(90) }),
          hint((st.mode === '3d' ? 'Click the floor to place' : 'Click to place') + ' · [ and ] rotate · pick another piece in the library' + (st.site ? ' · resize it any time by selecting it' : '')));
        break;
      }
      case 'area':
        bar.append(el('span', { class: 'title' }, C.materials[o.material].label),
          seg(o.shape, [['rect', 'Rectangle'], ['poly', 'Polygon']], set('shape')),
          hint(o.shape === 'rect' ? 'Drag to draw · pick a material in the library' : 'Click corners · Enter to close'));
        break;
      case 'plant':
        bar.append(el('span', { class: 'title' }, C.plants[o.plant].label), hint('Click to plant · drag the handle on a selected plant to resize its canopy'));
        break;
      case 'fence':
        bar.append(el('span', { class: 'title' }, 'Fences'),
          seg(o.fenceKind, Object.entries(C.fences).map(([k, v]) => [k, v.label]), set('fenceKind')),
          lbl('Height', numInput(o.fenceH[o.fenceKind], (v) => { o.fenceH[o.fenceKind] = Math.max(0.3, Math.min(3.6, v)); updateTool(); }, { step: 0.1, min: 0.3, max: 3.6 })),
          hint('Click each corner · double-click or Enter to finish · Shift any angle'));
        break;
      case 'gate': {
        const gd = C.gates[o.gateKind];
        bar.append(el('span', { class: 'title' }, gd.label),
          lbl('Width', numInput(o.gateW[o.gateKind], (v) => { o.gateW[o.gateKind] = Math.max(0.4, Math.min(8, v)); updateTool(); }, { step: 0.1, min: 0.4, max: 8 })),
          lbl('Height', numInput(o.gateH[o.gateKind], (v) => { o.gateH[o.gateKind] = Math.max(0.4, Math.min(3.6, v)); updateTool(); }, { step: 0.1, min: 0.4, max: 3.6 })),
          hint('Click on a fence to place the gate · the side of the fence your mouse is on is the side it opens to · pick a style in the library'));
        break;
      }
      case 'laser':
        bar.append(el('span', { class: 'title' }, 'Laser measure'),
          lbl(el('input', { type: 'checkbox', checked: o.laserAll, onchange: (e) => set('laserAll')(e.target.checked) }), 'Stop at trees and furniture too'),
          btn('Clear marks', () => FP.editor.clearMarks(), ''),
          hint('Hover open ground to read the gap · click to pin it · Alt hides the laser'));
        break;
      case 'zone':
        bar.append(el('span', { class: 'title' }, 'Measure area'),
          btn('Clear marks', () => FP.editor.clearMarks(), ''),
          hint('Drag a rectangle to see its size and m²'));
        break;
      case 'measure':
        bar.append(el('span', { class: 'title' }, 'Measure'), hint('Drag between two points · Shift for any angle'));
        break;
      case 'select':
        bar.append(el('span', { class: 'title' }, 'Select'), hint('Click a thing · drag a box to select many (left to right: fully inside, right to left: touching) · Shift-click adds · Ctrl+G groups · Space or H to pan'));
        break;
      case 'hand':
        bar.append(el('span', { class: 'title' }, 'Pan'), hint('Drag to move around · scroll to zoom'));
        break;
    }
    buildDrawer();
  }

  // Tool bar for the 3D view: orbit or walk, roof toggle, quick access to heights.
  // Detail slider: Low (fast), Medium, High (textures with relief, skirting, sky, softer light).
  function detailControl() {
    const V = FP.view3d, names = ['Low', 'Medium', 'High'];
    const out = el('b', { class: 'detail-val' }, names[V.quality()]);
    const range = el('input', { type: 'range', min: 0, max: 2, step: 1, value: V.quality(), class: 'detail', 'aria-label': 'Detail level' });
    range.addEventListener('input', () => { out.textContent = names[+range.value]; });
    range.addEventListener('change', () => {
      out.textContent = names[+range.value] + '…';
      setTimeout(() => { V.setQuality(+range.value); out.textContent = names[V.quality()]; range.blur(); }, 30);
    });
    return el('label', { title: 'Texture and lighting detail. High looks best; Low is fastest on older machines.' }, 'Detail', range, out);
  }

  // A live slider for the 3D bars: label, range, value readout.
  function slider(label, title, value, min, max, step, show, onSet) {
    const out = el('b', { class: 'detail-val' }, show(value));
    const range = el('input', { type: 'range', min, max, step, value, class: 'detail', 'aria-label': label });
    range.addEventListener('input', () => { onSet(+range.value); out.textContent = show(+range.value); });
    range.addEventListener('change', () => range.blur());
    return el('label', { title }, label, range, out);
  }
  // Field of view while walking: wider shows more of the room, as your eyes do.
  function fovControl() {
    const V = FP.view3d, wide = V.lens() === 'wide';
    return slider('View', wide ? 'How much of the room you see. The wide lens keeps edges natural up to about 150°.' : 'Horizontal field of view of a normal camera lens. Above about 100° the edges stretch.',
      V.fov(), wide ? 90 : 60, wide ? 160 : 120, 5, (v) => Math.round(v) + '°', (v) => V.setFov(v));
  }
  const clock = (h) => { const m = Math.round((h % 1) * 60); return Math.floor(h) + ':' + String(m).padStart(2, '0'); };
  function timeControl() {
    const V = FP.view3d;
    return slider('Sun', 'Time of day: moves the sun and its shadows (plan up is north).', V.time(), 6, 19, 0.25, clock, (v) => V.setTime(v));
  }

  function bar3d() {
    const bar = $('optbar'), V = FP.view3d;
    const hint = (t) => el('span', { class: 'hint' }, t);
    if (V.isWalking()) {
      bar.append(el('span', { class: 'title' }, 'Walking'),
        hint(V.isLocked() ? 'WASD · mouse · Shift run · F full screen · Esc' : 'Click to look · Esc to stop'),
        el('select', { 'aria-label': 'Lens', title: 'Wide shows more of the room without stretched edges', onchange: (e) => { V.setLens(e.target.value); updateTool(); e.target.blur(); } },
          opt([['wide', 'Wide lens'], ['normal', 'Normal lens']], V.lens())),
        fovControl(),
        slider('Size feel', 'Screens make rooms read about 20% small. 1.0× is true eye level; 1.2× matches how rooms feel in person. Measurements never change.',
          V.feel(), 1, 1.5, 0.05, (v) => (+v).toFixed(2) + '×', (v) => V.setFeel(v)),
        timeControl(),
        detailControl(),
        el('button', { class: 'btn', title: 'Full screen (F)', onclick: (e) => { V.toggleFullscreen(); e.currentTarget.blur(); } }, 'Full screen'),
        el('button', { class: 'accent-btn', onclick: () => V.exitWalk() }, 'Stop walking'));
      return;
    }
    bar.append(el('span', { class: 'title' }, '3D'),
      el('button', { class: 'accent-btn', onclick: () => V.startWalk() }, 'Walk around'),
      timeControl(),
      detailControl(),
      lbl(el('input', { type: 'checkbox', checked: V.roofShown(), onchange: (e) => V.setRoof(e.target.checked) }), 'Roof'),
      el('button', { class: 'btn', onclick: () => { A().select(null); showTab('inspector'); update(true); requestAnimationFrame(() => { const s = document.getElementById('styleSection'); if (s) s.scrollIntoView({ block: 'start' }); }); } }, 'Style & roof'),
      hint('Drag to orbit · right-drag to pan · scroll to zoom · drag furniture, doors and windows'));
  }

  function buildDrawer() {
    const st = S(), d = $('drawer');
    const show = st.tool === 'item' || st.tool === 'plant' || st.tool === 'area' || st.tool === 'fence' || st.tool === 'gate';
    d.hidden = !show;
    if (!show) return;
    d.innerHTML = '';
    if (st.tool === 'item') {
      const groups = {};
      for (const [k, v] of Object.entries(C.items)) if ((v.group === 'Pools, quinchos & sports') === !!st.site) (groups[v.group] = groups[v.group] || []).push([k, v]);
      for (const [g, list] of Object.entries(groups)) {
        d.append(el('h3', {}, g));
        d.append(el('div', { class: 'lib' }, list.map(([k, v]) => {
          const pad = 0.12, s = Math.max(v.w, v.h) + pad * 2;
          const svg = '<svg viewBox="' + (-s / 2) + ' ' + (-s / 2) + ' ' + s + ' ' + s + '">' + FP.draw.itemSvg({ id: 'lib', kind: k, x: 0, y: 0, w: v.w, h: v.h, rot: 0 }) + '</svg>';
          return el('button', { class: 'lib-item' + (st.opts.item === k ? ' active' : ''), title: v.label + ' · ' + v.w + ' × ' + v.h + ' m', html: svg + '<span>' + v.label + '</span>', onclick: () => { st.opts.item = k; st.opts.itemRot = 0; updateTool(); } });
        })));
      }
    } else if (st.tool === 'fence') {
      d.append(el('h3', {}, 'Fences'));
      d.append(el('div', { class: 'lib' }, Object.entries(C.fences).map(([k, v]) => {
        const svg = '<svg viewBox="-0.2 -0.5 4.4 1" preserveAspectRatio="xMidYMid meet"><rect x="-0.2" y="-0.5" width="4.4" height="1" fill="#b9d3a0"/>' + FP.draw.fenceSvg({ id: 'lib' + k, kind: k, x1: 0, y1: 0, x2: 4, y2: 0, h: v.h }, true) + '</svg>';
        return el('button', { class: 'lib-item' + (st.opts.fenceKind === k ? ' active' : ''), title: v.hint, html: svg + '<span>' + v.label + '<br>' + st.opts.fenceH[k].toFixed(1) + ' m high</span>', onclick: () => { st.opts.fenceKind = k; updateTool(); } });
      })));
      d.append(el('p', { class: 'note', style: 'margin:14px 4px 0' }, 'Large fences are solid boundary or privacy fences; the picket fence is a low white garden fence. Change any fence\'s height or colour by selecting it.'));
    } else if (st.tool === 'gate') {
      d.append(el('h3', {}, 'Gates'));
      d.append(el('div', { class: 'lib' }, Object.entries(C.gates).map(([k, v]) => {
        const e = FP.draw.gateElev(k);
        const svg = '<svg viewBox="' + e.vb + '" preserveAspectRatio="xMidYMid meet" style="background:#dfeacf;border-radius:6px">' + e.svg + '</svg>';
        return el('button', { class: 'lib-item' + (st.opts.gateKind === k ? ' active' : ''), title: v.hint, html: svg + '<span>' + v.label + '<br>' + st.opts.gateW[k].toFixed(1) + ' m wide</span>', onclick: () => { st.opts.gateKind = k; updateTool(); } });
      })));
      d.append(el('p', { class: 'note', style: 'margin:14px 4px 0' }, 'Click on any fence to cut it open and fit a gate. Select a gate to change its style, width, height, colour or the side it opens to; drag it to slide it along the fence.'));
    } else if (st.tool === 'plant') {
      d.append(el('h3', {}, 'Trees and plants'));
      d.append(el('div', { class: 'lib' }, Object.entries(C.plants).map(([k, v]) => {
        const s = v.r * 2.3;
        const svg = '<svg viewBox="' + (-s / 2) + ' ' + (-s / 2) + ' ' + s + ' ' + s + '">' + FP.draw.plantSvg({ id: 'lib' + k, kind: k, x: 0, y: 0, r: v.r }, true) + '</svg>';
        return el('button', { class: 'lib-item' + (st.opts.plant === k ? ' active' : ''), html: svg + '<span>' + v.label + '<br>⌀ ' + (v.r * 2).toFixed(1) + ' m</span>', onclick: () => { st.opts.plant = k; updateTool(); } });
      })));
    } else {
      const groups = {};
      for (const [k, v] of Object.entries(C.materials)) (groups[v.group || 'Ground'] = groups[v.group || 'Ground'] || []).push([k, v]);
      for (const [g, list] of Object.entries(groups)) {
        d.append(el('h3', {}, g));
        d.append(el('div', { class: 'lib' }, list.map(([k, v]) => {
          const svg = '<svg class="swatch" viewBox="0 0 3 1.2" preserveAspectRatio="xMidYMid slice"><rect width="3" height="1.2" fill="url(#' + FP.draw.groundFillId(k) + ')"/></svg>';
          return el('button', { class: 'lib-item' + (st.opts.material === k ? ' active' : ''), html: svg + '<span>' + v.label + '</span>', onclick: () => { st.opts.material = k; updateTool(); } });
        })));
      }
      d.append(el('p', { class: 'note', style: 'margin:14px 4px 0' }, 'Undrawn ground counts as lawn. Surfaces drawn later sit on top, so draw a pool after its deck.'));
    }
  }

  /* ---------- sidebar ---------- */
  function bindTabs() {
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      sideTab = t.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      update(true);
    }));
  }
  function showTab(name) {
    sideTab = name;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  }

  function update(force) {
    const body = $('sideBody');
    if (!force && sideTab === 'inspector' && body.contains(document.activeElement) && document.activeElement !== body) return;
    body.innerHTML = '';
    if (sideTab === 'inspector') body.append(inspector());
    else if (sideTab === 'stats') body.append(statsView());
    else body.append(layersView());
  }

  function head(kind, title, sub) {
    return el('div', { class: 'ins-head' }, el('div', { class: 'badge', html: I[KIND_ICON[kind] || 'house'] }), el('div', {}, el('div', { class: 't' }, title), el('div', { class: 's' }, sub)));
  }

  function inspector() {
    const st = S(), p = P();
    const wrap = el('div');
    if (st.preview) return suggestionView();
    if (st.multi.length > 1) return multiInspector();
    const sel = st.sel;
    const e = sel && M.find(p, sel.k, sel.id);
    if (!e) return projectInspector();

    const del = btn('Delete', () => { edit((q) => M.remove(q, sel.k, sel.id)); A().select(null); }, 'danger', 'trash');
    const dup = btn('Duplicate', () => A().duplicate(), '', 'copy');

    if (sel.k === 'room') {
      // Width, depth and area are clear sizes inside the walls.
      const size = M.clearSize(P(), e), area = M.clearArea(P(), e);
      wrap.append(head('room', e.name, (C.uses[e.use] || {}).label + ' · ' + m2(area) + ' inside'));
      wrap.append(
        field('Name', textInput(e.name, (v) => edit(() => { e.name = v || 'Room'; }))),
        field('Room type', selectInput(e.kind, pairs(C.roomKinds), (v) => edit(() => {
          if (e.floor === (C.roomKinds[e.kind] || {}).floor) e.floor = C.roomKinds[v].floor;
          e.kind = v;
        }))),
        field('Roof', selectInput(e.use, pairs(C.uses), (v) => edit(() => { e.use = v; }))),
        field('Floor', selectInput(e.floor, pairs(C.floors), (v) => edit(() => { if ((C.floors[v] || {}).wood !== (C.floors[e.floor] || {}).wood) e.floorColor = null; e.floor = v; }))),
        block('Floor colour', swatchInput(e.floorColor, (C.floors[e.floor] || {}).wood ? C.palettes.wood : C.palettes.floor, (c) => edit(() => { e.floorColor = c; }), 'Standard for this floor'))
      );
      if (e.use === 'indoor') wrap.append(block('Wall paint', swatchInput(e.wallColor, C.palettes.wall, (c) => edit(() => { e.wallColor = c; }), 'House paint (Style)')));
      if (size && size.rect) {
        wrap.append(el('div', { class: 'row2' },
          field('Width inside', numInput(size.w, (v) => edit((q) => { M.resizeClear(q, e, Math.max(0.3, v), null); }))),
          field('Depth inside', numInput(size.h, (v) => edit((q) => { M.resizeClear(q, e, null, Math.max(0.3, v)); })))));
      } else if (size) {
        // L-shapes and other outlines: overall extents; reshape by dragging walls or corners
        wrap.append(field('Size inside', el('span', { class: 'ro' }, fm(size.w) + ' × ' + fm(size.h) + ' m overall')));
      }
      wrap.append(field('Area inside', el('span', { class: 'ro' }, m2(area))));
      if (size) {
        const b = G.bbox(e.pts);
        wrap.append(field('To wall centres', el('span', { class: 'ro', style: 'color:var(--muted)' }, fm(b.w) + ' × ' + fm(b.h) + ' m')));
      }
      wrap.append(el('div', { class: 'actions' },
        btn('Add walls around', () => edit((q) => { const made = M.addPolyWalls(q, e.pts, S().opts.wallT, 'interior'); for (const m of made) m.kind = M.classifyWall(q, m); }), '', 'wall'),
        e.use === 'indoor' ? btn('Select whole house', () => { const r = M.houseRefs(P(), e.id); if (r) A().selectMany(r); }, '', 'group') : null,
        dup, del));
      wrap.append(el('p', { class: 'note', style: 'margin-top:14px' }, 'Sizes are measured inside the walls. Changing width or depth moves the right or bottom wall, like dragging it; the room on the other side gets smaller.'));
    } else if (sel.k === 'wall') {
      const v = M.wallVec(e);
      wrap.append(head('wall', (e.kind === 'exterior' ? 'Exterior' : 'Interior') + ' wall', fm(v.L) + ' m long · ' + fm(e.t) + ' m thick'));
      wrap.append(
        field('Length', numInput(v.L, (L) => edit((q) => {
          e.x2 = G.round(e.x1 + v.ux * Math.max(0.1, L)); e.y2 = G.round(e.y1 + v.uy * Math.max(0.1, L));
          for (const o of q.openings) if (o.wall === e.id) M.clampOpening(q, o);
        }))),
        field('Thickness', selectInput(e.t, THICK.some(([t]) => t === e.t) ? THICK : THICK.concat([[e.t, fm(e.t) + ' m']]), (t) => edit(() => { e.t = +t; }))),
        field('Type', selectInput(e.kind, [['exterior', 'Exterior'], ['interior', 'Interior']], (k) => edit(() => { e.kind = k; })))
      );
      const vertical = Math.abs(e.x1 - e.x2) < 1e-6, horizontal = Math.abs(e.y1 - e.y2) < 1e-6;
      if (vertical || horizontal) {
        const at = vertical ? e.x1 : e.y1, lo = vertical ? Math.min(e.y1, e.y2) : Math.min(e.x1, e.x2), hi = vertical ? Math.max(e.y1, e.y2) : Math.max(e.x1, e.x2);
        wrap.append(field(vertical ? 'Position x' : 'Position y', numInput(at, (v) => edit((q) => { M.shiftLine(q, vertical, at, lo, hi, v - at); }), { step: 0.01 })));
      }
      wrap.append(el('div', { class: 'actions' }, dup, del));
      wrap.append(el('p', { class: 'note', style: 'margin-top:14px' }, 'Drag a wall to move it straight across (hold Shift to move it freely); connected walls and room corners follow. Arrow keys nudge it by the snap step, Shift + arrow by 10 steps. Drag a square handle to move one end.'));
    } else if (sel.k === 'opening') {
      const t = C.openings[e.type];
      const wallH = P().settings.wallH;
      wrap.append(head('opening', t.label, fm(e.w) + ' × ' + fm(e.h) + ' m' + (e.sill > 0 ? ' · sill ' + fm(e.sill) + ' m' : '')));
      wrap.append(
        field('Type', selectInput(e.type, pairs(C.openings), (v) => edit((q) => {
          e.type = v; e.h = C.openings[v].h; e.sill = C.openings[v].sill; M.clampOpening(q, e);
        }))),
        el('div', { class: 'row2' },
          field('Width', numInput(e.w, (v) => edit((q) => { e.w = Math.max(0.3, v); M.clampOpening(q, e); }))),
          field('Height', numInput(e.h, (v) => edit(() => { e.h = Math.max(0.2, Math.min(wallH - e.sill, v)); })))),
        el('div', { class: 'row2' },
          field(e.type === 'window' ? 'Sill height' : 'From floor', numInput(e.sill, (v) => edit(() => { e.sill = Math.max(0, Math.min(wallH - e.h, v)); }))),
          field('From wall start', numInput(e.pos - e.w / 2, (v) => edit((q) => { e.pos = v + e.w / 2; M.clampOpening(q, e); })))),
        el('p', { class: 'note', style: 'margin:0 0 4px' }, 'Walls are ' + fm(wallH) + ' m high. In the 3D view you can drag this ' + (e.type === 'window' ? 'window' : 'opening') + ' along the wall and up or down.')
      );
      const acts = el('div', { class: 'actions' });
      if (e.type === 'door') acts.append(btn('Flip swing', () => edit(() => { e.side = -(e.side || 1); }), '', 'flip'), btn('Swap hinge', () => edit(() => { e.hinge = e.hinge === 'end' ? 'start' : 'end'; }), '', 'rotate'));
      acts.append(dup, del);
      wrap.append(acts);
    } else if (sel.k === 'area') {
      const size = G.isAxisRect(e.pts) ? G.bbox(e.pts) : null;
      wrap.append(head('area', e.name, C.materials[e.material].label + ' · ' + m2(G.area(e.pts))));
      wrap.append(
        field('Name', textInput(e.name, (v) => edit(() => { e.name = v; }))),
        field('Material', selectInput(e.material, pairs(C.materials), (v) => edit(() => { e.material = v; })))
      );
      if (size) wrap.append(el('div', { class: 'row2' },
        field('Width', numInput(size.w, (v) => edit(() => { e.pts = G.rectPts(size.x, size.y, Math.max(0.2, v), size.h); }))),
        field('Depth', numInput(size.h, (v) => edit(() => { e.pts = G.rectPts(size.x, size.y, size.w, Math.max(0.2, v)); })))));
      wrap.append(field('Area', el('span', { class: 'ro' }, m2(G.area(e.pts)))));
      wrap.append(el('div', { class: 'actions' },
        btn('Send to back', () => edit((q) => { q.areas = [e].concat(q.areas.filter((a) => a !== e)); }), ''),
        btn('Bring to front', () => edit((q) => { q.areas = q.areas.filter((a) => a !== e).concat([e]); }), ''),
        dup, del));
    } else if (sel.k === 'plant') {
      wrap.append(head('plant', C.plants[e.kind].label, 'Canopy ⌀ ' + fm(e.r * 2) + ' m'));
      wrap.append(
        field('Kind', selectInput(e.kind, pairs(C.plants), (v) => edit(() => { e.kind = v; }))),
        field('Canopy ⌀', numInput(e.r * 2, (v) => edit(() => { e.r = Math.max(0.15, v / 2); }), { step: 0.1 })),
        el('div', { class: 'row2' }, field('X', numInput(e.x, (v) => edit(() => { e.x = v; }))), field('Y', numInput(e.y, (v) => edit(() => { e.y = v; }))))
      );
      wrap.append(el('div', { class: 'actions' }, dup, del));
    } else if (sel.k === 'fence') {
      const d = C.fences[e.kind] || C.fences.large, L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1), ux = (e.x2 - e.x1) / (L || 1), uy = (e.y2 - e.y1) / (L || 1);
      const woods = [['#8a6a4a', 'Oak'], ['#6b4f36', 'Walnut'], ['#b08d62', 'Cedar'], ['#4b4f55', 'Charcoal'], ['#2f3d55', 'Navy'], ['#4b5d4f', 'Forest'], ['#d9d2c6', 'Greige']];
      const whites = [['#ffffff', 'White'], ['#f3eee4', 'Cream'], ['#e8dfcf', 'Ivory'], ['#c9d9e3', 'Sky'], ['#c4cdb8', 'Sage']];
      wrap.append(head('fence', d.label, fm(L) + ' m long · ' + fm(e.h) + ' m high'));
      wrap.append(
        field('Style', selectInput(e.kind, pairs(C.fences), (v) => edit(() => { e.kind = v; e.h = C.fences[v].h; e.color = null; delete e.color; }))),
        field('Height', numInput(e.h, (v) => edit(() => { e.h = Math.max(0.3, Math.min(3.6, v)); }), { step: 0.1, min: 0.3, max: 3.6 })),
        field('Length', numInput(L, (v) => edit(() => { const l = Math.max(0.2, v); e.x2 = G.round(e.x1 + ux * l); e.y2 = G.round(e.y1 + uy * l); }))),
        block('Colour', swatchInput(e.color, e.kind === 'picket' ? whites : woods, (c) => edit(() => { if (c) e.color = c; else delete e.color; }), 'Default (' + d.label + ')'))
      );
      wrap.append(el('div', { class: 'actions' }, btn('Add a gate here', () => edit((q) => {
        const o = S().opts, kind = o.gateKind, w = Math.min(o.gateW[kind], Math.max(0.4, L - 0.4));
        const gt = { id: M.uid('g'), fence: e.id, pos: L / 2, w, h: o.gateH[kind], kind, swing: 1, hinge: 'start' };
        q.gates.push(gt); M.clampGate(q, gt);
      }), ''), dup, del));
      wrap.append(el('p', { class: 'note', style: 'margin-top:14px' }, 'Drag a fence to move it, or a square handle to move one end; fence runs that meet at a corner stay joined.'));
    } else if (sel.k === 'gate') {
      const d = C.gates[e.kind] || C.gates.garden, fe = M.find(P(), 'fence', e.fence), L = fe ? Math.hypot(fe.x2 - fe.x1, fe.y2 - fe.y1) : 0;
      const cols = [['#8a6a4a', 'Oak'], ['#6b4f36', 'Walnut'], ['#ffffff', 'White'], ['#5f7d68', 'Sage'], ['#2f3d55', 'Navy'], ['#26282b', 'Black'], ['#3d4146', 'Charcoal'], ['#a8adb2', 'Galvanised']];
      wrap.append(head('gate', d.label, fm(e.w) + ' m wide · ' + fm(e.h) + ' m high'));
      wrap.append(
        field('Style', selectInput(e.kind, pairs(C.gates), (v) => edit((q) => { e.kind = v; e.w = C.gates[v].w; e.h = C.gates[v].h; delete e.color; M.clampGate(q, e); }))),
        el('div', { class: 'row2' },
          field('Width', numInput(e.w, (v) => edit((q) => { e.w = Math.max(0.4, v); M.clampGate(q, e); }), { step: 0.1, min: 0.4 })),
          field('Height', numInput(e.h, (v) => edit(() => { e.h = Math.max(0.4, Math.min(3.6, v)); }), { step: 0.1, min: 0.4, max: 3.6 }))),
        field('Position', numInput(e.pos, (v) => edit((q) => { e.pos = v; M.clampGate(q, e); }), { step: 0.1 })),
        el('div', { class: 'row2' },
          field('Opens to', selectInput(String(e.swing === -1 ? -1 : 1), [['1', 'Side A'], ['-1', 'Side B']], (v) => edit(() => { e.swing = +v; }))),
          d.leaves === 2 ? el('span') : field(d.slide ? 'Slides' : 'Hinge', selectInput(e.hinge === 'end' ? 'end' : 'start', d.slide ? [['start', 'Towards start'], ['end', 'Towards end']] : [['start', 'At start'], ['end', 'At end']], (v) => edit(() => { e.hinge = v; })))),
        block('Colour', swatchInput(e.color, cols, (c) => edit(() => { if (c) e.color = c; else delete e.color; }), 'Default (' + d.label + ')'))
      );
      wrap.append(el('div', { class: 'actions' }, dup, del));
      wrap.append(el('p', { class: 'note', style: 'margin-top:14px' }, 'Drag the gate along its fence, or use the Position field. Gates are walked through in the first-person view.' + (fe ? ' It sits on a ' + fm(L) + ' m run of fence.' : '')));
    } else if (sel.k === 'item') {
      const d = C.items[e.kind] || { label: e.kind };
      wrap.append(head('item', d.label, fm(e.w) + ' × ' + fm(e.h) + ' m'));
      wrap.append(
        el('div', { class: 'row2' },
          field('Width', numInput(e.w, (v) => edit(() => { e.w = Math.max(0.1, v); }))),
          field('Depth', numInput(e.h, (v) => edit(() => { e.h = Math.max(0.1, v); })))),
        field('Rotation', selectInput(e.rot || 0, [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']].concat([0, 90, 180, 270].includes(e.rot || 0) ? [] : [[e.rot, e.rot + '°']]), (v) => edit(() => { e.rot = +v; }))),
        el('div', { class: 'row2' }, field('X', numInput(e.x, (v) => edit(() => { e.x = v; }))), field('Y', numInput(e.y, (v) => edit(() => { e.y = v; }))))
      );
      wrap.append(el('div', { class: 'actions' }, btn('Rotate', () => A().rotateSelection(90), '', 'rotate'), dup, del));
    }
    const grp = M.groupOf(p, sel);
    if (grp) wrap.append(el('div', { class: 'actions', style: 'margin-top:10px' }, btn('Select ' + grp.name + ' (' + grp.members.length + ' parts)', () => A().selectMany(grp.members), '', 'group')));
    return wrap;
  }

  // Several things selected: move, turn, copy, delete or group them as one.
  const SING = { wall: 'wall', opening: 'door or window', room: 'room', area: 'surface', plant: 'plant', fence: 'fence', gate: 'gate', item: 'furniture piece' };
  const PLUR = { wall: 'walls', opening: 'doors and windows', room: 'rooms', area: 'surfaces', plant: 'plants', fence: 'fences', gate: 'gates', item: 'furniture pieces' };
  function multiInspector() {
    const st = S(), p = P(), refs = st.multi, wrap = el('div');
    const g = A().isGroupSel();
    const counts = {};
    for (const r of refs) counts[r.k] = (counts[r.k] || 0) + 1;
    wrap.append(head('house', g ? g.name : refs.length + ' things selected', Object.entries(counts).map(([k, n]) => n + ' ' + (n === 1 ? SING[k] : PLUR[k])).join(' · ')));
    if (g) wrap.append(field('Group name', textInput(g.name, (v) => edit(() => { g.name = v || 'Group'; }))));
    const mov = refs.filter((r) => M.MOVABLE.includes(r.k));
    const b = M.selBox(p, mov.length ? mov : refs), c = M.selBox(p, mov.some((r) => r.k === 'wall') ? mov.filter((r) => r.k === 'wall') : mov.length ? mov : refs, true);
    if (b && c) {
      wrap.append(
        el('div', { class: 'row2' },
          field('Left x', numInput(G.round(c.x0), (v) => edit((q) => M.translateRefs(q, refs, v - c.x0, 0)), { step: 0.05 })),
          field('Top y', numInput(G.round(c.y0), (v) => edit((q) => M.translateRefs(q, refs, 0, v - c.y0)), { step: 0.05 }))),
        field('Overall size', el('span', { class: 'ro' }, fm(b.x1 - b.x0) + ' × ' + fm(b.y1 - b.y0) + ' m')));
    }
    wrap.append(el('div', { class: 'actions' },
      g ? btn('Ungroup', () => A().ungroupSelection(), '', 'group') : btn('Group', () => A().groupSelection(), '', 'group'),
      btn('Rotate 90°', () => A().rotateSelection(90), '', 'rotate'),
      btn('Duplicate', () => A().duplicate(), '', 'copy'),
      btn('Delete', () => A().deleteSelection(), 'danger', 'trash')));
    wrap.append(el('p', { class: 'note', style: 'margin-top:14px' }, g
      ? 'Drag any part to move the whole group, or type a position. Arrow keys nudge it, [ and ] turn it. Ungroup to work on single parts again, or Shift-click a part to add or remove it.'
      : 'Drag any highlighted part to move everything together, or type a position. Arrow keys nudge, [ and ] turn. Group (Ctrl+G) keeps these together so one click selects them all. Shift-click adds or removes a thing.'));
    return wrap;
  }

  // House style: one click sets exterior, roof, doors, windows, paint and floors; every part can then be changed.
  let keepFloors = false;
  function styleSection() {
    const p = P(), st = p.settings.style;
    const box = el('div', { style: 'margin-top:18px', id: 'styleSection' }, el('div', { class: 'sec-title' }, 'House style'));
    const cards = el('div', { class: 'styles' });
    for (const [key, s] of Object.entries(C.styles)) {
      const chip = (c) => el('i', { style: 'background:' + c });
      cards.append(el('button', { class: 'style-card' + (st.preset === key ? ' on' : ''), title: s.blurb, onclick: () => { edit((q) => M.applyStyle(q, key, keepFloors)); A().toast(s.label + ' style applied. ⌘Z undoes it.'); } },
        el('b', {}, s.label), el('span', { class: 'chips' }, chip(s.extColor), chip(s.roof.color), chip(s.trim), chip(s.floor[1]), chip(s.wall)), el('small', {}, s.blurb)));
    }
    const set = (k) => (v) => edit((q) => { q.settings.style[k] = v; });
    box.append(cards,
      checkInput('Keep my floors when changing style', keepFloors, (v) => { keepFloors = v; }),
      el('div', { class: 'sec-title', style: 'margin-top:12px' }, 'Outside'),
      field('Walls', selectInput(st.finish, pairs(C.wallFinishes), set('finish'))),
      block('Wall colour', swatchInput(st.extColor, C.palettes.exterior, set('extColor'))),
      block('Window frames & trim', swatchInput(st.trim, C.palettes.trim, set('trim'))),
      field('Windows', selectInput(st.window, pairs(C.windowGrids), set('window'))),
      field('Front doors', selectInput(st.door, pairs(C.doorStyles), set('door'))),
      block('Front door colour', swatchInput(st.doorColor, C.palettes.trim.concat(C.palettes.wall.slice(10)), set('doorColor'))),
      field('Porch columns', selectInput(st.columns, pairs(C.columns), set('columns'))),
      el('div', { class: 'sec-title', style: 'margin-top:12px' }, 'Inside'),
      block('Wall paint', swatchInput(st.wall, C.palettes.wall, set('wall'))),
      block('Ceiling', swatchInput(st.ceiling, C.palettes.wall.slice(0, 6), set('ceiling'))),
      field('Inside doors', selectInput(st.intDoor, pairs(C.doorStyles), set('intDoor'))),
      block('Inside door colour', swatchInput(st.intDoorColor, C.palettes.trim.concat(C.palettes.wood.slice(1, 5)), set('intDoorColor'))),
      checkInput('Crown moulding at the ceiling', st.cornice, set('cornice')),
      el('p', { class: 'note', style: 'margin:0' }, 'Each room can have its own floor and paint: select the room. Changes show in the 3D view and the walkthrough.'));
    return box;
  }

  // Wall height and roof height are linked through the roof shape (see M.roofHeight).
  function buildingSection() {
    const p = P(), R = p.settings.roof;
    const box = el('div', { style: 'margin-top:18px' }, el('div', { class: 'sec-title' }, 'Roof & heights'));
    const flatRoof = R.type === 'flat' || R.type === 'parapet';
    box.append(
      field('Roof type', selectInput(R.type, pairs(C.roofs), (v) => edit(() => { R.type = v; }))),
      field('Roofing', selectInput(R.material, pairs(C.roofMaterials), (v) => edit(() => { R.material = v; }))),
      block('Roof colour', swatchInput(R.color, C.palettes.roof, (c) => edit(() => { R.color = c; }))),
      el('div', { class: 'row2' },
        field('Wall height', numInput(p.settings.wallH, (v) => edit(() => { p.settings.wallH = Math.max(2.2, Math.min(8, v)); }))),
        field('Roof height', numInput(M.roofHeight(p), (v) => edit((q) => { M.setRoofHeight(q, v); })))),
      flatRoof
        ? field('Roof slab', numInput(R.slab, (v) => edit(() => { R.slab = Math.max(0.1, Math.min(1, v)); })))
        : el('div', { class: 'row2' },
          field('Pitch (°)', numInput(R.pitch, (v) => edit(() => { R.pitch = Math.max(5, Math.min(60, v)); }), { step: 1, dec: 0 })),
          field('Overhang', numInput(R.overhang, (v) => edit(() => { R.overhang = Math.max(0, Math.min(2, v)); }), { step: 0.1 }))),
      el('p', { class: 'note', style: 'margin:0' }, flatRoof
        ? 'Roof height is the wall height plus the slab' + (R.type === 'parapet' ? ' and a ' + fm(M.PARAPET) + ' m parapet' : '') + '. Change either one and the other follows.'
        : 'Roof height is the ridge. It follows the wall height, the pitch and the house width; type a roof height and the walls adjust to match.'));
    return box;
  }

  // How the first-person walk feels: eye level, pace, lens and the screen size compensation.
  function walkSection() {
    const V = FP.view3d;
    return el('div', { style: 'margin-top:18px' },
      el('div', { class: 'sec-title' }, 'Walkthrough'),
      el('div', { class: 'row2' },
        field('Your height', numInput(V.person(), (v) => V.setPerson(v), { step: 0.01 })),
        field('View (°)', numInput(V.fov(), (v) => { V.setFov(v); update(true); }, { step: 5, dec: 0 }))),
      field('Lens', selectInput(V.lens(), [['wide', 'Wide, natural edges'], ['normal', 'Normal camera']], (v) => { V.setLens(v); update(true); })),
      field('Size feel', selectInput(String(V.feel()), [['1', 'Exact (1.0×)'], ['1.1', '1.1×'], ['1.2', '1.2× (recommended)'], ['1.3', '1.3×'], ['1.4', '1.4×'], ['1.5', '1.5×']].concat(['1', '1.1', '1.2', '1.3', '1.4', '1.5'].includes(String(V.feel())) ? [] : [[String(V.feel()), V.feel() + '×']]), (v) => V.setFeel(+v))),
      field('Pace', selectInput(String(V.pace()), [['0.9', 'Slow, 0.9 m/s'], ['1.2', 'Stroll, 1.2 m/s'], ['1.5', 'Brisk, 1.5 m/s']].concat(['0.9', '1.2', '1.5'].includes(String(V.pace())) ? [] : [[String(V.pace()), V.pace() + ' m/s']]), (v) => V.setPace(+v))),
      field('Mouse look speed', selectInput(String(V.look()), [['0.5', 'Slow'], ['0.75', 'Gentle'], ['1', 'Normal'], ['1.5', 'Fast'], ['2', 'Very fast']].concat([['0.5', 'Slow'], ['0.75', 'Gentle'], ['1', 'Normal'], ['1.5', 'Fast'], ['2', 'Very fast']].some((o) => o[0] === String(V.look())) ? [] : [[String(V.look()), V.look() + '×']]), (v) => V.setLook(+v))),
      checkInput('Keep walls upright when looking up or down', V.straight(), (v) => V.setStraight(v)),
      el('p', { class: 'note', style: 'margin:0' }, 'Rooms on a flat screen read about 20% smaller than in person. Size feel makes up for that the way game studios do: the camera is the same as the house built ' +
        'that much larger, while every measurement stays exact. Use 1.0× to see true eye level. The wide lens shows more of the room without stretching the edges. F goes full screen.'));
  }

  function projectInspector() {
    const p = P(), st = S();
    const wrap = el('div');
    wrap.append(head('house', p.name, 'Lot ' + fm(p.lot.w) + ' × ' + fm(p.lot.h) + ' m · ' + m2(p.lot.w * p.lot.h)));
    wrap.append(
      el('div', { class: 'sec-title' }, 'Project'),
      field('Name', textInput(p.name, (v) => edit(() => { p.name = v || 'Untitled project'; }))),
      el('div', { class: 'row2' },
        field('Lot width', numInput(p.lot.w, (v) => edit(() => { p.lot.w = Math.max(5, v); }), { step: 0.5 })),
        field('Lot depth', numInput(p.lot.h, (v) => edit(() => { p.lot.h = Math.max(5, v); }), { step: 0.5 }))),
      field('Snap step', selectInput(String(st.snap), [['0.01', '1 cm'], ['0.05', '5 cm'], ['0.1', '10 cm'], ['0.25', '25 cm'], ['0.5', '50 cm'], ['1', '1 m'], ['0', 'Off']], (v) => A().setSnap(v))),
      field('Scroll wheel', selectInput(st.wheel, [['zoom', 'Zooms'], ['pan', 'Pans (pinch zooms)']], (v) => A().setWheel(v)))
    );
    wrap.append(styleSection(), buildingSection(), walkSection());
    const keys = [['V', 'Select'], ['W', 'Walls'], ['R', 'Rooms'], ['D', 'Doors'], ['N', 'Windows'], ['F', 'Furniture'], ['A', 'Surfaces'], ['T', 'Plants'], ['Space', 'Pan'], ['Scroll', 'Zoom'], ['⌫', 'Delete'], ['⌘D', 'Duplicate'], ['Drag box', 'Select many'], ['⌘G', 'Group'], ['⌘A', 'Select all'], ['[ ]', 'Rotate'], ['Alt', 'No snap']];
    wrap.append(el('div', { class: 'sec-title', style: 'margin-top:18px' }, 'Shortcuts'),
      el('div', { class: 'note', style: 'display:grid;grid-template-columns:auto 1fr;gap:4px 12px' }, keys.flatMap(([k, l]) => [el('b', {}, k), el('span', {}, l)])));
    wrap.append(el('p', { class: 'note', style: 'margin-top:16px' }, 'Select anything on the plan to edit it here. Double-click a room to rename it.'));
    return wrap;
  }

  function statsView() {
    const p = A().shownProject(), s = M.stats(p);
    const wrap = el('div');
    if (S().preview) wrap.append(el('p', { class: 'note', style: 'margin:0 0 12px' }, 'Showing the ' + (S().previewShow === 'suggestion' ? 'suggested' : 'current') + ' design.'));
    const kpi = (k, v, sub, wide) => el('div', { class: 'kpi' + (wide ? ' wide' : '') }, el('div', { class: 'k' }, k), el('div', { class: 'v', html: v + (sub ? ' <small>' + sub + '</small>' : '') }));
    const cover = el('div', { class: 'kpi wide' }, el('div', { class: 'k' }, 'Lot use · ' + m2(s.lot)),
      el('div', { class: 'v', html: (s.coverage * 100).toFixed(1) + '% <small>built over</small>' }),
      el('div', { class: 'bar' },
        el('i', { style: 'width:' + (s.indoor / s.lot * 100) + '%;background:var(--accent)', title: 'Indoor' }),
        el('i', { style: 'width:' + (s.covered / s.lot * 100) + '%;background:color-mix(in srgb, var(--accent) 45%, var(--panel))', title: 'Covered' }),
        el('i', { style: 'width:' + (s.groundTotal / s.lot * 100) + '%;background:#c9a77f', title: 'Surfaces' })));
    wrap.append(el('div', { class: 'kpis' },
      kpi('House, usable', s.indoor.toFixed(1), 'm²'),
      kpi('House, built', s.indoorBuilt.toFixed(1), 'm²'),
      kpi('Covered only', s.covered.toFixed(1), 'm²'),
      kpi('Lawn & open', s.openGround.toFixed(0), 'm²'),
      cover));

    const group = (use, title) => {
      const rows = s.rooms.filter((r) => r.use === use);
      if (!rows.length) return null;
      const sum = rows.reduce((a, r) => a + r.area, 0);
      return el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, title),
        el('div', { class: 'list' }, rows.map((r) => el('button', {
          class: 'li' + (S().sel && S().sel.id === r.id ? ' sel' : ''), onclick: () => { A().select({ k: 'room', id: r.id }); },
          html: '<span class="dot" style="background:' + (C.roomKinds[r.kind] || C.roomKinds.other).tint + ';border:1px solid var(--border-strong)"></span><span class="n"></span><span class="a">' + (r.size ? fm(r.size.w) + '×' + fm(r.size.h) + ' · ' : '') + m2(r.area) + '</span>'
        }, ))),
        el('div', { class: 'sum-row' }, el('span', {}, 'Total'), el('span', {}, m2(sum))));
    };
    const gI = group('indoor', 'Indoor rooms'), gC = group('covered', 'Covered (roof only)'), gO = group('outdoor', 'Outdoor rooms');
    [gI, gC, gO].forEach((g) => g && wrap.append(g));
    // names via textContent so user text is never parsed as HTML
    const names = s.rooms.filter((r) => r.use === 'indoor').concat(s.rooms.filter((r) => r.use === 'covered'), s.rooms.filter((r) => r.use === 'outdoor'));
    wrap.querySelectorAll('.li .n').forEach((n, i) => { n.textContent = names[i] ? names[i].name : ''; });

    const ground = Object.entries(s.ground).sort((a, b) => b[1] - a[1]);
    wrap.append(el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, 'Plot surfaces'),
      el('div', { class: 'list' },
        ground.map(([k, v]) => el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'dot', style: 'background:' + C.materials[k].flat }), el('span', { class: 'n' }, C.materials[k].label), el('span', { class: 'a' }, m2(v)))),
        el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'dot', style: 'background:' + C.materials.lawn.flat }), el('span', { class: 'n' }, 'Lawn & open ground'), el('span', { class: 'a' }, '≈ ' + m2(s.openGround))))));

    const plants = Object.entries(s.plants);
    if (plants.length) wrap.append(el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, 'Planting · ' + s.plantCount),
      el('div', { class: 'list' }, plants.map(([k, n]) => el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, C.plants[k].label), el('span', { class: 'a' }, String(n)))))));

    const fenceRows = Object.entries(s.fences || {});
    if (fenceRows.length) wrap.append(el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, 'Fencing'),
      el('div', { class: 'list' }, fenceRows.map(([k, len]) => el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, C.fences[k].label), el('span', { class: 'a' }, fm(len) + ' m'))))));

    const gateRows = Object.entries(s.gates || {});
    if (gateRows.length) wrap.append(el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, 'Gates'),
      el('div', { class: 'list' }, gateRows.map(([k, n]) => el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, C.gates[k].label), el('span', { class: 'a' }, String(n)))))));

    const ops = s.openings;
    wrap.append(el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, 'Construction'),
      el('div', { class: 'list' },
        el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, 'Exterior walls'), el('span', { class: 'a' }, fm(s.wallLen.exterior) + ' m')),
        el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, 'Interior walls'), el('span', { class: 'a' }, fm(s.wallLen.interior) + ' m')),
        el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, 'Doors'), el('span', { class: 'a' }, String((ops.door || 0) + (ops.sliding || 0)))),
        el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, 'Windows'), el('span', { class: 'a' }, String(ops.window || 0))))));
    wrap.append(el('p', { class: 'note' }, 'Room sizes and usable area are measured inside the walls. Built area includes the walls, to the outer face of the exterior walls. Lawn is the lot minus the house and drawn surfaces, so overlaps make it approximate.'));
    return wrap;
  }

  function layersView() {
    const st = S();
    const wrap = el('div');
    const rows = [['house', 'House', 'Walls, doors, windows, rooms'], ['furniture', 'Furniture', 'Furniture, fixtures, cars'], ['landscape', 'Landscape', 'Surfaces, trees, plants, fences']];
    wrap.append(el('div', { class: 'sec-title' }, 'Layers'));
    for (const [k, name, sub] of rows) {
      const L = st.layers[k];
      wrap.append(el('div', { class: 'layer' },
        el('div', { class: 'n' }, el('div', {}, name), el('div', {}, sub)),
        el('button', { class: 'icon-btn', title: L.visible ? 'Hide' : 'Show', html: L.visible ? I.eye : I.eyeOff, onclick: () => { L.visible = !L.visible; A().refresh(); update(true); } }),
        el('button', { class: 'icon-btn', title: L.locked ? 'Unlock' : 'Lock (stop selecting)', html: L.locked ? I.lock : I.unlock, style: L.locked ? 'color:var(--accent)' : '', onclick: () => { L.locked = !L.locked; if (L.locked) A().select(null); update(true); } })));
    }
    wrap.append(el('div', { class: 'sec-title', style: 'margin-top:18px' }, 'Display'));
    wrap.append(checkInput('Show dimensions', st.dims, (v) => { st.dims = v; A().refresh(); }));
    wrap.append(el('p', { class: 'note' }, 'Lock the house while you landscape so clicks only pick plants and surfaces.'));
    return wrap;
  }

  function focusFirstField() {
    showTab('inspector');
    update(true);
    const i = $('sideBody').querySelector('input[type=text]');
    if (i) { i.focus(); i.select(); }
  }

  /* ---------- Claude: shared pieces ---------- */
  // Runs one Claude request while the dialog shows a busy state. Resolves to the response, or null on failure.
  async function runJob(req, ui) {
    ui.err.hidden = true;
    ui.go.disabled = true;
    const goHtml = ui.go.innerHTML;
    ui.go.innerHTML = '';
    ui.go.append(el('span', { class: 'spinner' }), ui.busyLabel || 'Working…');
    ui.running = true;
    if (ui.cancel) ui.cancel.textContent = 'Cancel';
    const base = ui.foot.textContent;
    const t0 = Date.now();
    const tick = setInterval(() => { ui.foot.textContent = 'Claude is working · ' + Math.round((Date.now() - t0) / 1000) + ' s. A whole house can take a few minutes.'; }, 500);
    const res = await window.api.claudeRun(req);
    clearInterval(tick);
    ui.running = false;
    ui.go.disabled = false;
    ui.go.innerHTML = goHtml;
    if (ui.cancel) ui.cancel.textContent = 'Close';
    ui.foot.textContent = base;
    if (!res.ok) {
      ui.err.hidden = false;
      ui.err.textContent = res.error + (res.raw ? '\n\n' + res.raw.slice(0, 600) : '');
      return null;
    }
    return res;
  }

  function statusPill(pill, go, err) {
    if (!window.api) { pill.textContent = 'Desktop app only'; pill.className = 'pill err'; go.disabled = true; return; }
    window.api.claudeStatus().then((r) => {
      if (r.found && r.subscription) {
        pill.textContent = r.plan + ' plan · no extra charge';
        pill.className = 'pill ok';
        pill.title = 'Signed in as ' + (r.email || 'your Claude account') + ' · Claude Code ' + r.version.replace(' (Claude Code)', '') + ' · ' + r.path;
      } else {
        pill.textContent = r.found ? 'Not on a subscription' : 'Not found';
        pill.className = 'pill err';
        err.hidden = false; err.textContent = r.error; go.disabled = true;
      }
    });
  }

  function modelPicker() {
    const sel = el('select', {}, opt([['', 'Claude Code default'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']], ''));
    if (window.api) {
      window.api.getSettings().then((s) => { sel.value = s.claudeModel || ''; });
      sel.onchange = () => window.api.setSettings({ claudeModel: sel.value });
    }
    return el('div', { class: 'field', style: 'margin-top:12px' }, el('span', {}, 'Model'), sel);
  }

  function openModal(node, busy) {
    const back = $('modal');
    back.innerHTML = '';
    back.append(node);
    back.hidden = false;
    back.onclick = (e) => { if (e.target === back && !(busy && busy())) closeModal(); };
  }
  function closeModal() { const back = $('modal'); back.hidden = true; back.innerHTML = ''; }

  const choice = (o, key, title, sub) => el('label', { class: 'choice' },
    el('input', { type: 'checkbox', checked: !!o[key], onchange: (e) => { o[key] = e.target.checked; } }),
    el('div', {}, el('div', {}, title), sub ? el('div', { class: 's' }, sub) : null));

  /* ---------- new design: from scratch, described, or from a floor-plan image ---------- */
  // Shrinks big images and re-encodes as JPEG so the request stays small.
  async function prepImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
      const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(im, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.9);
      return { mediaType: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl, name: file.name, w: c.width, h: c.height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function openStart(closable, startMode) {
    const lot = { w: 30, h: 40 };
    const d = { text: '', notes: '', furnish: true, landscape: true, image: null };
    let mode = startMode || 'describe';
    const err = el('div', { class: 'err-box', hidden: true });
    const pill = el('span', { class: 'pill' }, 'Checking Claude Code…');
    const go = el('button', { class: 'accent-btn' }, el('span', { class: 'i', html: I.sparkle }), 'Design it');
    const scratch = el('button', { class: 'accent-btn' }, 'Start drawing');
    const foot = el('span', { class: 'grow' });
    const ui = { go, err, foot, running: false, busyLabel: 'Designing…' };
    const fileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    const text = el('textarea', {
      rows: 7, oninput: (e) => { d.text = e.target.value; },
      placeholder: 'For example: single-storey house under 180 m² on a 30 × 40 m lot. Kitchen in the upper right corner with an L counter and island, then dining, then living, all open plan. A roofed gallery along the left side. Four bedrooms: three 3 × 3 m and a 5 × 5 m master with walk-in closet and ensuite. Carport for one car, front door facing south.'
    });
    const notes = el('textarea', { rows: 3, oninput: (e) => { d.notes = e.target.value; }, placeholder: 'Optional changes, for example: mirror it, put the gallery on the left, make the ensuite smaller.' });
    const lotFields = () => el('div', { class: 'row2', style: 'margin-top:10px' },
      field('Lot width', numInput(lot.w, (v) => { lot.w = Math.max(5, v); }, { step: 0.5 })),
      field('Lot depth', numInput(lot.h, (v) => { lot.h = Math.max(5, v); }, { step: 0.5 })));
    const body = el('div', { class: 'body' });

    async function takeFile(f) {
      if (!f) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { err.hidden = false; err.textContent = 'That file is not a supported image. Use PNG, JPG, WebP or GIF; for a PDF, take a screenshot of the page.'; return; }
      try { d.image = await prepImage(f); err.hidden = true; draw(); } catch (e) { err.hidden = false; err.textContent = 'That image could not be read. Try another file.'; }
    }
    fileIn.addEventListener('change', () => { takeFile(fileIn.files[0]); fileIn.value = ''; });

    function dropzone() {
      const z = el('div', { class: 'dropzone' + (d.image ? ' has-image' : ''), tabindex: 0, role: 'button', 'aria-label': 'Choose a floor-plan image' });
      if (d.image) {
        z.append(el('img', { src: d.image.url, alt: 'Floor plan to rebuild' }),
          el('div', { class: 'actions', style: 'margin:8px 0 0;justify-content:center' },
            el('span', { class: 'note' }, d.image.name + ' · ' + d.image.w + ' × ' + d.image.h + ' px'),
            btn('Replace', () => fileIn.click()), btn('Remove', () => { d.image = null; draw(); })));
      } else {
        z.append(el('span', { class: 'i', html: I.image }), el('div', {}, 'Drop a floor-plan image here'), el('div', { class: 'note' }, 'or click to choose a file · you can also paste a screenshot'));
        z.addEventListener('click', () => fileIn.click());
        z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
      }
      z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
      return z;
    }

    const draw = () => {
      body.innerHTML = '';
      const tab = (m, label) => el('button', { class: 'seg-btn' + (mode === m ? ' active' : ''), onclick: () => { mode = m; err.hidden = true; draw(); } }, label);
      body.append(el('div', { class: 'seg', style: 'margin-bottom:14px' }, tab('describe', 'Describe it'), tab('image', 'From an image'), tab('scratch', 'Start from scratch')));
      if (mode === 'describe') {
        body.append(
          el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Describe the house and the plot in your own words. Claude drafts the walls, rooms, doors and windows. You preview the draft, apply it, then keep editing by hand.'),
          text, lotFields(),
          choice(d, 'furnish', 'Furnish the rooms'),
          choice(d, 'landscape', 'Landscape the plot', 'Paths, driveway, garden beds, trees'),
          modelPicker(), err);
      } else if (mode === 'image') {
        body.append(
          el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Use a drawing, photo or screenshot of an existing plan. Claude reads the written dimensions and rebuilds it to scale; you preview the result before applying it.'),
          dropzone(),
          el('div', { class: 'sec-title', style: 'margin-top:14px' }, 'Changes to make (optional)'), notes,
          lotFields(),
          choice(d, 'furnish', 'Furnish the rooms'),
          choice(d, 'landscape', 'Landscape the plot', 'Keeps garden features shown in the image'),
          modelPicker(), err);
        notes.value = d.notes;
      } else {
        body.append(el('p', { class: 'note', style: 'margin:0 0 10px' }, 'An empty lot. Draw walls, rooms and the garden yourself. You can still ask Claude for changes at any time.'), lotFields());
      }
      go.hidden = mode === 'scratch';
      scratch.hidden = mode !== 'scratch';
      go.lastChild.textContent = mode === 'image' ? 'Rebuild it' : 'Design it';
      foot.textContent = mode === 'scratch' ? '' : 'Uses your Claude Code login on this Mac.';
      if (mode === 'describe') setTimeout(() => text.focus(), 0);
    };

    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-label': 'New design' },
      el('header', {}, el('span', { class: 'i', html: I.house, style: 'color:var(--accent)' }), el('h2', {}, 'New design'), pill,
        closable ? el('button', { class: 'icon-btn', title: 'Close', html: I.close, onclick: () => { if (!ui.running) closeModal(); } }) : null),
      body, fileIn,
      el('footer', {}, foot, scratch, go));
    modal.addEventListener('paste', (e) => {
      const f = [...(e.clipboardData ? e.clipboardData.files : [])].find((x) => /^image\//.test(x.type));
      if (f) { e.preventDefault(); mode = 'image'; takeFile(f); }
    });
    draw();
    openModal(modal, () => ui.running || !closable);
    statusPill(pill, go, err);

    scratch.onclick = () => { closeModal(); A().newBlank(lot); };
    go.onclick = async () => {
      const blank = M.newProject('My house');
      blank.lot = { w: lot.w, h: lot.h };
      let req, title;
      if (mode === 'image') {
        if (!d.image) { err.hidden = false; err.textContent = 'Add a floor-plan image first.'; return; }
        req = FP.claude.buildImageRequest(blank, { notes: d.notes.trim(), furnish: d.furnish, landscape: d.landscape });
        req.images = [{ mediaType: d.image.mediaType, data: d.image.data }];
        title = 'Rebuilt from your image';
      } else {
        if (d.text.trim().length < 10) { err.hidden = false; err.textContent = 'Write a sentence or two about the house first.'; return; }
        req = FP.claude.buildDesignRequest(blank, { fresh: true, instruction: d.text.trim(), furnish: d.furnish, landscape: d.landscape });
        title = 'Draft from your description';
      }
      const res = await runJob(req, ui);
      if (!res) return;
      const next = FP.claude.proposal(blank, res.data);
      closeModal();
      A().newBlank(next.lot, false);
      A().propose(next, res.data.summary || 'A first draft.', title);
    };
  }

  /* ---------- Ask Claude while editing ---------- */
  function openAsk() {
    const st = S();
    if (st.preview) { A().toast('Apply or discard the current suggestion first.'); return; }
    const selRoom = st.sel && st.sel.k === 'room' ? M.find(P(), 'room', st.sel.id) : null;
    const o = st.claudeOpts = Object.assign({ mode: 'change', instruction: '', furnish: true, replaceItems: true, landscape: true, replaceLandscape: false, onlySelected: false, wishes: '' }, st.claudeOpts || {});
    const err = el('div', { class: 'err-box', hidden: true });
    const pill = el('span', { class: 'pill' }, 'Checking Claude Code…');
    const go = el('button', { class: 'accent-btn' }, el('span', { class: 'i', html: I.sparkle }), 'Suggest');
    const cancel = el('button', { class: 'btn' }, 'Close');
    const foot = el('span', { class: 'grow' }, 'Nothing changes until you apply the suggestion.');
    const ui = { go, err, foot, cancel, running: false, busyLabel: 'Thinking…' };
    const body = el('div', { class: 'body' });

    const draw = () => {
      body.innerHTML = '';
      body.append(el('div', { class: 'seg', style: 'margin-bottom:14px' },
        el('button', { class: 'seg-btn' + (o.mode === 'change' ? ' active' : ''), onclick: () => { o.mode = 'change'; draw(); } }, 'Change the design'),
        el('button', { class: 'seg-btn' + (o.mode === 'furnish' ? ' active' : ''), onclick: () => { o.mode = 'furnish'; draw(); } }, 'Furnish & landscape')));
      if (o.mode === 'change') {
        const ta = el('textarea', {
          rows: 5, oninput: (e) => { o.instruction = e.target.value; },
          placeholder: selRoom ? 'For example: make ' + selRoom.name + ' 1 m wider and add a window on its outside wall.' : 'For example: move the laundry next to the kitchen, widen the hallway to 1.5 m, and add a pergola over the patio.'
        });
        ta.value = o.instruction;
        body.append(el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Say what to change. Claude returns a suggestion that you preview on the plan before applying.'), ta);
        if (selRoom) body.append(el('p', { class: 'note', style: 'margin:8px 0 0' }, 'Selected room: ' + selRoom.name + '. Claude knows which one you mean.'));
        setTimeout(() => ta.focus(), 0);
      } else {
        const wishes = el('textarea', { rows: 3, oninput: (e) => { o.wishes = e.target.value; }, placeholder: 'Optional style and wishes. For example: modern tropical, light oak floors, palms along the gallery, a vegetable garden at the back.' });
        wishes.value = o.wishes;
        body.append(
          el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Claude places furniture, floors, plants and paths into your exact plan. The app draws the render from your real dimensions.'),
          choice(o, 'furnish', 'Furnish rooms', 'Beds, sofas, kitchen, bathrooms, outdoor furniture, cars'),
          selRoom ? choice(o, 'onlySelected', 'Only the selected room', selRoom.name) : null,
          choice(o, 'replaceItems', 'Replace current furniture', 'Off keeps what is there and works around it'),
          choice(o, 'landscape', 'Landscape the plot', 'Trees, shrubs, flowers, walkways, driveway, garden beds'),
          choice(o, 'replaceLandscape', 'Replace current planting and surfaces', 'Off adds to what you have drawn'),
          el('div', { class: 'sec-title', style: 'margin-top:14px' }, 'Style and wishes'), wishes);
      }
      body.append(modelPicker(), err);
    };

    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-label': 'Ask Claude' },
      el('header', {}, el('span', { class: 'i', html: I.sparkle, style: 'color:var(--accent)' }), el('h2', {}, 'Ask Claude'), pill),
      body, el('footer', {}, foot, cancel, go));
    draw();
    openModal(modal, () => ui.running);
    statusPill(pill, go, err);
    cancel.onclick = () => { if (ui.running) window.api.claudeCancel(); else closeModal(); };

    go.onclick = async () => {
      const roomIds = o.onlySelected && selRoom ? [selRoom.id] : null;
      let req;
      if (o.mode === 'change') {
        if (o.instruction.trim().length < 3) { err.hidden = false; err.textContent = 'Say what you want changed first.'; return; }
        const hint = selRoom ? '\n(The owner currently has the room "' + selRoom.name + '" selected, id ' + selRoom.id + '.)' : '';
        req = FP.claude.buildDesignRequest(P(), { fresh: false, instruction: o.instruction.trim() + hint });
      } else {
        if (!o.furnish && !o.landscape) { err.hidden = false; err.textContent = 'Pick at least one: furnish rooms or landscape the plot.'; return; }
        req = FP.claude.buildRequest(P(), Object.assign({}, o, { roomIds }));
      }
      const res = await runJob(req, ui);
      if (!res) return;
      closeModal();
      if (o.mode === 'change') {
        A().propose(FP.claude.proposal(P(), res.data), res.data.summary || 'Suggested change.', 'Suggested change');
      } else {
        const r = FP.claude.furnishProposal(P(), res.data, Object.assign({}, o, { roomIds }));
        const sum = 'Adds ' + r.counts.items + ' pieces of furniture, ' + r.counts.plants + ' plants and ' + r.counts.areas + ' surfaces.' + (res.data.notes ? ' ' + res.data.notes : '');
        A().propose(r.project, sum, 'Furnishing & landscape');
        A().setMode('render');
      }
    };
  }

  /* ---------- import a house from another design ---------- */
  function openImport() {
    const st = S();
    if (st.preview) { A().toast('Apply or discard the current suggestion first.'); return; }
    const lot = P().lot;
    const d = { id: null, rot: 0, x: 0, y: 0, furniture: true, look: true, text: '', note: '' };
    let metas = null, src = null, fp = null, doors = [];
    const err = el('div', { class: 'err-box', hidden: true });
    const pill = el('span', { class: 'pill' }, 'Checking Claude Code…');
    const ask = el('button', { class: 'btn' }, el('span', { class: 'i', html: I.sparkle }), 'Ask Claude where');
    const go = el('button', { class: 'accent-btn' }, 'Preview on plot');
    const cancel = el('button', { class: 'btn' }, 'Close');
    const foot = el('span', { class: 'grow' }, 'Nothing is added until you apply the preview.');
    const ui = { go: ask, err, foot, cancel, running: false, busyLabel: 'Placing…' };
    const body = el('div', { class: 'body' });
    const diagram = el('div', { style: 'margin:8px 0 10px' });
    const size = () => M.turnedSize(fp, d.rot);
    const fit = () => { const s = size(); d.x = G.round(Math.max(0, Math.min(Math.max(0, lot.w - s.w), d.x)), 2); d.y = G.round(Math.max(0, Math.min(Math.max(0, lot.h - s.h), d.y)), 2); };
    const fits = () => { const s = size(); return s.w <= lot.w + 1e-6 && s.h <= lot.h + 1e-6; };
    const centre = () => { const s = size(); d.x = G.round(Math.round((lot.w - s.w) / 2 / 0.05) * 0.05, 2); d.y = G.round(Math.round((lot.h - s.h) / 2 / 0.05) * 0.05, 2); fit(); };

    function drawDiagram() {
      const p = P();
      let g = '<rect x="0" y="0" width="' + lot.w + '" height="' + lot.h + '" fill="var(--panel)" stroke="var(--border)" stroke-width=".2"/>';
      for (const a of p.areas) g += '<polygon points="' + a.pts.map((q) => q.x + ',' + q.y).join(' ') + '" fill="#d8c9a6" opacity=".75"/>';
      for (const pl of p.plants) g += '<circle cx="' + pl.x + '" cy="' + pl.y + '" r="' + pl.r + '" fill="#9cc47f" opacity=".65"/>';
      for (const fe of p.fences) g += '<line x1="' + fe.x1 + '" y1="' + fe.y1 + '" x2="' + fe.x2 + '" y2="' + fe.y2 + '" stroke="#8a6a4a" stroke-width=".3"/>';
      const eh = M.houseFootprint(p);
      if (eh) g += '<rect x="' + eh.x + '" y="' + eh.y + '" width="' + eh.w + '" height="' + eh.h + '" fill="#8d9096" opacity=".7"/>';
      if (fp) {
        const s = size(), t = Math.max(0.6, Math.min(lot.w, lot.h) * 0.025);
        g += '<rect x="' + d.x + '" y="' + d.y + '" width="' + s.w + '" height="' + s.h + '" fill="var(--accent)" fill-opacity=".28" stroke="var(--accent)" stroke-width=".35"/>';
        if (doors[0]) {
          const side = M.turnSide(doors[0], d.rot), L = Math.min(2.4, (side === 'north' || side === 'south' ? s.w : s.h) / 3);
          const cx = d.x + s.w / 2, cy = d.y + s.h / 2;
          const r = side === 'north' ? [cx - L / 2, d.y - t / 2, L, t] : side === 'south' ? [cx - L / 2, d.y + s.h - t / 2, L, t] : side === 'west' ? [d.x - t / 2, cy - L / 2, t, L] : [d.x + s.w - t / 2, cy - L / 2, t, L];
          g += '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" fill="#d9480f"/>';
        }
      }
      diagram.innerHTML = '<svg viewBox="-1 -1 ' + (lot.w + 2) + ' ' + (lot.h + 2) + '" style="width:100%;max-height:280px;display:block;border-radius:8px;background:var(--hover)" aria-label="Plot with the house outline">' + g + '</svg>';
    }

    async function pick(m) {
      err.hidden = true;
      const p = await A().loadDesignProject(m.id);
      if (!p) { err.hidden = false; err.textContent = 'That design could not be opened.'; return; }
      const f = M.houseFootprint(p);
      if (!f) { err.hidden = false; err.textContent = 'That design has no walls or rooms to import.'; return; }
      src = p; fp = f; d.id = m.id; d.rot = 0; d.note = ''; doors = M.doorSides(p, f);
      centre();
      draw();
    }

    const draw = () => {
      body.innerHTML = '';
      body.append(el('p', { class: 'note', style: 'margin:0 0 10px' }, 'Bring a house you designed in another design into this plot. Tell Claude where it goes and which way it faces, or set the spot yourself, then preview it on the plan.'));
      body.append(el('div', { class: 'sec-title' }, '1 · Choose the house'));
      if (metas === null) body.append(el('p', { class: 'note' }, 'Loading your designs…'));
      else if (!metas.length) body.append(el('p', { class: 'note' }, 'You have no other saved designs yet. Designs save automatically: open the house design once, then come back here.'));
      else body.append(el('div', { class: 'list', style: 'max-height:168px;overflow:auto' }, metas.map((m) => el('button', {
        class: 'li' + (d.id === m.id ? ' sel' : ''), style: 'width:100%;border:0;background:none;text-align:left;font:inherit;color:inherit', onclick: () => pick(m)
      }, el('span', { class: 'n' }, m.name || 'Untitled'), el('span', { class: 'a' }, (m.rooms || 0) + ' rooms' + (m.indoor ? ' · ' + (+m.indoor).toFixed(0) + ' m² indoor' : ''))))));
      if (src) {
        body.append(el('p', { class: 'note', style: 'margin:8px 0 0' }, 'Footprint ' + fm(fp.w) + ' × ' + fm(fp.h) + ' m, outer wall to outer wall · ' + src.walls.length + ' walls, ' + src.rooms.length + ' rooms' + (doors.length ? ' · entrance on the ' + doors[0] + ' side as drawn' : '')),
          choice(d, 'furniture', 'Bring its furniture', 'Pieces standing inside or beside the house'),
          choice(d, 'look', 'Use its house style and roof', 'Applies to the whole design'),
          el('div', { class: 'sec-title', style: 'margin-top:14px' }, '2 · Place it'),
          el('textarea', {
            rows: 3, oninput: (e) => { d.text = e.target.value; },
            placeholder: 'Tell Claude where, for example: at the back of the plot, centred left to right, 6 m from the back fence, entrance facing the street (south side) so the driveway reaches the front door.'
          }),
          el('div', { class: 'actions', style: 'margin:8px 0 0' }, ask, el('span', { class: 'note' }, 'or set the position yourself:')));
        body.lastChild.previousSibling.value = d.text;
        if (d.note) body.append(el('p', { class: 'note', style: 'margin:8px 0 0;color:var(--accent)' }, d.note));
        const onPos = () => { drawDiagram(); };
        body.append(el('div', { class: 'row2', style: 'margin-top:10px' },
          field('From west edge', numInput(d.x, (v) => { d.x = v; fit(); onPos(); }, { step: 0.1, min: 0 })),
          field('From north edge', numInput(d.y, (v) => { d.y = v; fit(); onPos(); }, { step: 0.1, min: 0 }))));
        body.append(field('Turn', selectInput(d.rot, [[0, 'As drawn'], [90, '90° clockwise'], [180, '180°'], [270, '270° clockwise']], (v) => { d.rot = +v; fit(); draw(); })));
        body.append(diagram, el('p', { class: 'note', style: 'margin:0' }, 'Blue outline = the house · grey = what is already built · red bar = its entrance. Plants where the house lands are removed.'));
        if (!fits()) body.append(el('p', { class: 'err-box' }, 'At this rotation the house (' + fm(size().w) + ' × ' + fm(size().h) + ' m) is bigger than the plot (' + fm(lot.w) + ' × ' + fm(lot.h) + ' m). Try another turn.'));
        drawDiagram();
      }
      body.append(modelPicker(), err);
      go.disabled = !src || !fits();
    };

    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-label': 'Import a house' },
      el('header', {}, el('span', { class: 'i', html: I.house, style: 'color:var(--accent)' }), el('h2', {}, 'Import a house'), pill),
      body, el('footer', {}, foot, cancel, go));
    draw();
    openModal(modal, () => ui.running);
    statusPill(pill, ask, err);
    A().listDesigns().then((list) => { metas = (list || []).filter((m) => m.id !== st.designId); draw(); });
    cancel.onclick = () => { if (ui.running) window.api.claudeCancel(); else closeModal(); };

    ask.onclick = async () => {
      if (!src) { err.hidden = false; err.textContent = 'Choose a house first.'; return; }
      if (d.text.trim().length < 3) { err.hidden = false; err.textContent = 'Say where it should go first, for example: "at the back of the plot, centred".'; return; }
      const res = await runJob(FP.claude.buildPlaceRequest(P(), src, { instruction: d.text.trim() }), ui);
      if (!res) return;
      const r = FP.claude.placement(P(), src, res.data);
      d.x = r.x; d.y = r.y; d.rot = r.rot; d.note = r.note;
      draw();
    };
    go.onclick = () => {
      if (!src || !fits()) return;
      fit();
      const next = JSON.parse(JSON.stringify(P()));
      const r = M.importHouse(next, src, { x: d.x, y: d.y, rot: d.rot, furniture: d.furniture, look: d.look });
      closeModal();
      const sum = 'Adds ' + (src.name || 'the house') + ': ' + r.walls + ' walls, ' + r.rooms + ' rooms' + (r.items ? ', ' + r.items + ' pieces of furniture' : '') + ' at ' + fm(d.x) + ' m from the west and ' + fm(d.y) + ' m from the north edge' + (d.rot ? ', turned ' + d.rot + '° clockwise' : '') + '.' + (r.plantsRemoved ? ' Removes ' + r.plantsRemoved + ' plant' + (r.plantsRemoved === 1 ? '' : 's') + ' where it stands.' : '') + (d.note ? ' ' + d.note : '');
      A().propose(M.normalize(next), sum, 'Imported house');
      A().setMode('plan');
    };
  }

  /* ---------- suggestion preview ---------- */
  const DIFF_LABEL = { gates: 'Gates', rooms: 'Rooms', walls: 'Walls', openings: 'Doors & windows', items: 'Furniture', areas: 'Surfaces', plants: 'Plants', fences: 'Fences' };

  function suggestionBar() {
    const st = S(), pv = st.preview, bar = $('optbar');
    bar.innerHTML = '';
    bar.append(
      el('span', { class: 'i', html: I.sparkle, style: 'color:var(--accent)' }),
      el('span', { class: 'title' }, pv.title),
      el('span', { class: 'hint' }, pv.diff.total + ' change' + (pv.diff.total === 1 ? '' : 's')),
      seg(st.previewShow, [['current', 'Current'], ['suggestion', 'Suggestion']], (v) => { st.previewShow = v; A().refresh(); suggestionBar(); }),
      el('button', { class: 'btn', onclick: () => A().discardPreview() }, 'Discard'),
      el('button', { class: 'accent-btn', onclick: () => A().applyPreview() }, 'Apply'));
  }

  function suggestionView() {
    const pv = S().preview, d = pv.diff;
    const wrap = el('div');
    wrap.append(el('div', { class: 'ins-head' }, el('div', { class: 'badge', html: I.sparkle }), el('div', {}, el('div', { class: 't' }, pv.title), el('div', { class: 's' }, d.total + ' change' + (d.total === 1 ? '' : 's') + ' · not applied yet'))));
    wrap.append(el('p', { style: 'margin:0 0 16px;line-height:1.5' }, pv.summary));
    const rows = Object.entries(DIFF_LABEL).map(([k, label]) => {
      const x = d.lists[k];
      if (!x || !(x.added + x.changed + x.removed)) return null;
      const parts = [];
      if (x.added) parts.push('+' + x.added + ' new');
      if (x.changed) parts.push(x.changed + ' changed');
      if (x.removed) parts.push('−' + x.removed + ' removed');
      return el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, label), el('span', { class: 'a' }, parts.join(' · ')));
    }).filter(Boolean);
    if (d.lot) rows.push(el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, 'Lot size'), el('span', { class: 'a' }, fm(pv.project.lot.w) + ' × ' + fm(pv.project.lot.h) + ' m')));
    wrap.append(el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, 'What changes'), el('div', { class: 'list' }, rows.length ? rows : [el('p', { class: 'note' }, 'Claude made no changes.')])));
    const delta = (a, b) => m2(a) + ' → ' + m2(b);
    wrap.append(el('div', { class: 'sec' }, el('div', { class: 'sec-title' }, 'Areas'), el('div', { class: 'list' },
      el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, 'House, indoor'), el('span', { class: 'a' }, delta(d.indoor[0], d.indoor[1]))),
      el('div', { class: 'li', style: 'cursor:default' }, el('span', { class: 'n' }, 'Covered only'), el('span', { class: 'a' }, delta(d.covered[0], d.covered[1]))))));
    wrap.append(el('div', { class: 'actions' },
      el('button', { class: 'accent-btn', onclick: () => A().applyPreview() }, 'Apply suggestion'),
      el('button', { class: 'btn', onclick: () => A().discardPreview() }, 'Discard')));
    wrap.append(el('p', { class: 'note', style: 'margin-top:14px' }, 'New and changed pieces are outlined on the plan. Switch between Current and Suggestion at the top to compare. Applying can be undone with ⌘Z.'));
    return wrap;
  }

  FP.panels = { buildRail, bindTabs, updateTool, update, showTab, focusFirstField, openStart, openAsk, openImport, closeModal, buildDrawer };
})();
