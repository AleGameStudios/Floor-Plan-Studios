// Canvas interaction: view transform, picking, snapping, tools and the selection overlay.
// World units are metres; V.s is pixels per metre.
window.FP = window.FP || {};

(function () {
  const G = FP.geom, M = FP.model, C = FP.catalog;
  // Pools, quinchos and sports fields are items that sit in the landscape layer.
  const layerOf = (k, id) => (k === 'item' ? ((FP.catalog.items[(FP.model.find(FP.app.shownProject(), 'item', id) || {}).kind] || {}).layer || 'furniture') : LAYER_OF[k]);
  const LAYER_OF = { wall: 'house', opening: 'house', room: 'house', item: 'furniture', area: 'landscape', plant: 'landscape', fence: 'landscape', gate: 'landscape' };
  const BASE_SCALE = 30; // px per metre shown as 100%

  let svg, sceneEl, overlayEl, defsEl, stage, hud;
  const V = { x: -3, y: -3, s: BASE_SCALE };
  let T = {};        // transient tool state (wall chain, rectangle, ghost...)
  let drag = null;   // active pointer gesture
  let marks = [];    // pinned laser readings and measured areas (not saved with the design)
  let hover = null;  // entity under the cursor in select mode
  let cursor = null; // last pointer position in world units
  const mods = { shift: false, alt: false, space: false };

  const A = () => FP.app;
  const S = () => FP.app.state;
  const P = () => FP.app.state.project;
  const f = (v) => Math.round(v * 1000) / 1000;

  /* ---------- view ---------- */
  function size() { const r = svg.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1, l: r.left, t: r.top }; }
  function applyView() {
    const z = size();
    svg.setAttribute('viewBox', f(V.x) + ' ' + f(V.y) + ' ' + f(z.w / V.s) + ' ' + f(z.h / V.s));
    const lbl = document.getElementById('zoomLabel');
    if (lbl) lbl.textContent = Math.round((V.s / BASE_SCALE) * 100) + '%';
    drawOverlay();
  }
  function toWorld(e) { const z = size(); return { x: V.x + (e.clientX - z.l) / V.s, y: V.y + (e.clientY - z.t) / V.s }; }
  function zoomAt(k, cx, cy) {
    const z = size();
    if (cx == null) { cx = z.l + z.w / 2; cy = z.t + z.h / 2; }
    const wx = V.x + (cx - z.l) / V.s, wy = V.y + (cy - z.t) / V.s;
    V.s = Math.max(4, Math.min(400, V.s * k));
    V.x = wx - (cx - z.l) / V.s; V.y = wy - (cy - z.t) / V.s;
    applyView();
  }
  function zoomTo(scale) { zoomAt(scale / V.s); }
  function fit() {
    const p = P(), z = size(), pad = 3.5;
    const bw = p.lot.w + pad * 2, bh = p.lot.h + pad * 2;
    V.s = Math.max(4, Math.min(400, Math.min(z.w / bw, z.h / bh)));
    V.x = -pad - (z.w / V.s - bw) / 2; V.y = -pad - (z.h / V.s - bh) / 2;
    applyView();
  }

  /* ---------- drawing ---------- */
  function redraw() {
    const st = S();
    sceneEl.innerHTML = FP.draw.scene(A().shownProject(), { mode: st.mode, theme: st.resolvedTheme, layers: visibleLayers(), dims: st.dims, noDefs: true });
    drawOverlay();
  }
  function visibleLayers() {
    const L = S().layers;
    return { house: L.house.visible, furniture: L.furniture.visible, landscape: L.landscape.visible };
  }

  const px = (n) => n / V.s;
  const style = (s) => ' style="' + s + '"';
  function label(x, y, text) {
    return '<text x="' + f(x) + '" y="' + f(y) + '" font-size="' + f(px(12)) + '" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-weight="600" paint-order="stroke" stroke-width="' + f(px(4)) + '" stroke-linejoin="round"' + style('fill:var(--text);stroke:var(--panel)') + '>' + text + '</text>';
  }
  const ptsAttr = (pts) => pts.map((q) => f(q.x) + ',' + f(q.y)).join(' ');

  function outline(sel, strong) {
    const p = P();
    const sw = px(strong ? 2 : 1.5);
    const st = style('stroke:var(--accent);fill:' + (strong ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'none') + (strong ? '' : ';opacity:.7'));
    const e = M.find(p, sel.k, sel.id);
    if (!e) return '';
    if (sel.k === 'room' || sel.k === 'area') return '<polygon points="' + ptsAttr(e.pts) + '" stroke-width="' + f(sw) + '"' + st + '/>';
    if (sel.k === 'wall') {
      const v = M.wallVec(e), h = e.t / 2 + px(2);
      const Q = (d, k) => ({ x: v.a.x + v.ux * d + v.nx * k, y: v.a.y + v.uy * d + v.ny * k });
      return '<polygon points="' + ptsAttr([Q(-h, -h), Q(v.L + h, -h), Q(v.L + h, h), Q(-h, h)]) + '" stroke-width="' + f(sw) + '"' + st + '/>';
    }
    if (sel.k === 'opening') {
      const g = M.openingGeo(p, e);
      if (!g) return '';
      const h = g.t / 2 + 0.06;
      const Q = (pt, k) => ({ x: pt.x + g.v.nx * k, y: pt.y + g.v.ny * k });
      return '<polygon points="' + ptsAttr([Q(g.s, -h), Q(g.e, -h), Q(g.e, h), Q(g.s, h)]) + '" stroke-width="' + f(sw) + '"' + st + '/>';
    }
    if (sel.k === 'gate') {
      const g = M.gateGeo(p, e);
      if (!g) return '';
      const Q = (pt, k) => ({ x: pt.x + g.v.nx * k, y: pt.y + g.v.ny * k });
      const k = 0.2 + px(2);
      return '<polygon points="' + ptsAttr([Q(g.s, -k), Q(g.e, -k), Q(g.e, k), Q(g.s, k)]) + '" stroke-width="' + f(sw) + '"' + st + '/>';
    }
    if (sel.k === 'fence') {
      const L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1e-9, ux = (e.x2 - e.x1) / L, uy = (e.y2 - e.y1) / L, h = 0.12 + px(2);
      const Q = (d, k) => ({ x: e.x1 + ux * d - uy * k, y: e.y1 + uy * d + ux * k });
      return '<polygon points="' + ptsAttr([Q(-h, -h), Q(L + h, -h), Q(L + h, h), Q(-h, h)]) + '" stroke-width="' + f(sw) + '"' + st + '/>';
    }
    if (sel.k === 'plant') return '<circle cx="' + f(e.x) + '" cy="' + f(e.y) + '" r="' + f(e.r + px(3)) + '" stroke-width="' + f(sw) + '"' + st + '/>';
    if (sel.k === 'item') {
      return '<rect x="' + f(-e.w / 2) + '" y="' + f(-e.h / 2) + '" width="' + f(e.w) + '" height="' + f(e.h) + '" transform="translate(' + f(e.x) + ' ' + f(e.y) + ') rotate(' + f(e.rot || 0) + ')" stroke-width="' + f(sw) + '"' + st + '/>';
    }
    return '';
  }

  function handles(sel) {
    const e = M.find(P(), sel.k, sel.id);
    if (!e) return '';
    const hs = px(4.5);
    const sq = (x, y, i) => '<rect data-h="' + i + '" x="' + f(x - hs) + '" y="' + f(y - hs) + '" width="' + f(hs * 2) + '" height="' + f(hs * 2) + '" rx="' + f(px(1.5)) + '" stroke-width="' + f(px(1.5)) + '"' + style('fill:var(--panel);stroke:var(--accent);cursor:move') + '/>';
    if (sel.k === 'wall' || sel.k === 'fence') return sq(e.x1, e.y1, 1) + sq(e.x2, e.y2, 2);
    if (sel.k === 'room' || sel.k === 'area') return e.pts.map((q, i) => sq(q.x, q.y, i)).join('');
    if (sel.k === 'plant') return sq(e.x + e.r, e.y, 'r');
    return '';
  }

  // Outline everything a pending Claude suggestion adds or changes.
  function previewOutlines() {
    const st = S(), pv = st.preview;
    if (st.previewShow !== 'suggestion') return '';
    const q = pv.project, ids = pv.diff.changedIds, sw = f(px(2));
    const st2 = style('stroke:var(--accent);fill:color-mix(in srgb, var(--accent) 12%, transparent)');
    let s = '';
    for (const r of q.rooms.concat(q.areas)) if (ids.has(r.id)) s += '<polygon points="' + ptsAttr(r.pts) + '" stroke-width="' + sw + '" stroke-dasharray="' + f(px(6)) + ' ' + f(px(4)) + '"' + st2 + '/>';
    for (const w of q.walls) if (ids.has(w.id)) s += '<line x1="' + f(w.x1) + '" y1="' + f(w.y1) + '" x2="' + f(w.x2) + '" y2="' + f(w.y2) + '" stroke-width="' + f(w.t + px(6)) + '"' + style('stroke:var(--accent);opacity:.35') + '/>';
    for (const it of q.items) if (ids.has(it.id)) s += '<rect x="' + f(-it.w / 2) + '" y="' + f(-it.h / 2) + '" width="' + f(it.w) + '" height="' + f(it.h) + '" transform="translate(' + f(it.x) + ' ' + f(it.y) + ') rotate(' + f(it.rot || 0) + ')" stroke-width="' + sw + '"' + style('stroke:var(--accent);fill:none') + '/>';
    for (const fe of q.fences || []) if (ids.has(fe.id)) s += '<line x1="' + f(fe.x1) + '" y1="' + f(fe.y1) + '" x2="' + f(fe.x2) + '" y2="' + f(fe.y2) + '" stroke-width="' + f(0.2) + '"' + style('stroke:var(--accent);opacity:.35') + '/>';
    for (const pl of q.plants) if (ids.has(pl.id)) s += '<circle cx="' + f(pl.x) + '" cy="' + f(pl.y) + '" r="' + f(pl.r) + '" stroke-width="' + sw + '"' + style('stroke:var(--accent);fill:none') + '/>';
    for (const gt of q.gates || []) {
      if (!ids.has(gt.id)) continue;
      const g = M.gateGeo(q, gt);
      if (g) s += '<circle cx="' + f(g.c.x) + '" cy="' + f(g.c.y) + '" r="' + f(gt.w / 2 + 0.15) + '" stroke-width="' + sw + '"' + style('stroke:var(--accent);fill:none') + '/>';
    }
    for (const o of q.openings) {
      if (!ids.has(o.id)) continue;
      const g = M.openingGeo(q, o);
      if (g) s += '<circle cx="' + f(g.c.x) + '" cy="' + f(g.c.y) + '" r="' + f(o.w / 2 + 0.1) + '" stroke-width="' + sw + '"' + style('stroke:var(--accent);fill:none') + '/>';
    }
    return s;
  }

  function drawOverlay() {
    if (!overlayEl) return;
    const st = S();
    if (st.preview) { overlayEl.innerHTML = previewOutlines(); updateHud(); return; }
    let s = marksSvg();
    if (st.tool === 'select' && hover && !(st.sel && st.sel.id === hover.id) && !st.multi.some((r) => r.id === hover.id)) {
      const hg = M.groupOf(P(), hover);
      for (const r of hg ? hg.members : [hover]) s += outline(r, false);
    }
    if (st.sel) s += outline(st.sel, true) + handles(st.sel);
    if (st.multi.length) s += multiOverlay();
    if (T.box) s += marqueeSvg();
    s += toolPreview();
    overlayEl.innerHTML = s;
    updateHud();
  }

  const escTxt = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Outline of every selected thing, plus a dashed box around them all with a count or the group's name.
  function multiOverlay() {
    const p = P(), refs = S().multi;
    let s = '';
    for (const r of refs) s += outline(r, true);
    const b = M.selBox(p, refs);
    if (!b) return s;
    const pad = px(6), g = A().isGroupSel();
    s += '<rect x="' + f(b.x0 - pad) + '" y="' + f(b.y0 - pad) + '" width="' + f(b.x1 - b.x0 + 2 * pad) + '" height="' + f(b.y1 - b.y0 + 2 * pad) + '" rx="' + f(px(4)) + '" stroke-width="' + f(px(1.5)) + '" stroke-dasharray="' + f(px(6)) + ' ' + f(px(4)) + '"' + style('stroke:var(--accent);fill:none') + '/>';
    s += label((b.x0 + b.x1) / 2, b.y0 - pad - px(8), escTxt(g ? g.name + ' (' + refs.length + ' parts)' : refs.length + ' selected'));
    return s;
  }
  function marqueeSvg() {
    const b = T.box, x = Math.min(b.a.x, b.b.x), y = Math.min(b.a.y, b.b.y), w = Math.abs(b.b.x - b.a.x), h = Math.abs(b.b.y - b.a.y);
    const crossing = b.b.x < b.a.x;
    return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" stroke-width="' + f(px(1.5)) + '"' + (crossing ? ' stroke-dasharray="' + f(px(5)) + ' ' + f(px(3)) + '"' : '') + style('stroke:var(--accent);fill:color-mix(in srgb, var(--accent) 9%, transparent)') + '/>';
  }

  // What a box selects: left to right takes what lies fully inside; right to left takes anything it touches.
  // Anything in a group brings its whole group along.
  function marqueeRefs(box) {
    const p = P(), L = S().layers;
    const x0 = Math.min(box.a.x, box.b.x), x1 = Math.max(box.a.x, box.b.x), y0 = Math.min(box.a.y, box.b.y), y1 = Math.max(box.a.y, box.b.y);
    const crossing = box.b.x < box.a.x;
    const out = new Map();
    for (const k of Object.keys(M.LISTS)) {
      for (const e of M.list(p, k)) {
        const layer = L[layerOf(k, e.id)];
        if (!layer || !layer.visible || layer.locked) continue;
        const b = M.refBox(p, { k, id: e.id });
        if (!b) continue;
        let hit;
        if (!crossing) hit = b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1;
        else {
          hit = b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0;
          // a box drawn inside a big lawn or room should not grab the lawn or room itself
          if (hit && (k === 'room' || k === 'area') && b.x0 <= x0 && b.x1 >= x1 && b.y0 <= y0 && b.y1 >= y1) hit = false;
        }
        if (hit) out.set(k + ':' + e.id, { k, id: e.id });
      }
    }
    for (const r of [...out.values()]) {
      const g = M.groupOf(p, r);
      if (g) for (const m of g.members) out.set(M.keyOf(m), m);
    }
    return [...out.values()];
  }
  function selectAll() {
    if (S().mode === '3d') return A().toast('Switch to Plan to select several things at once.');
    A().selectMany(marqueeRefs({ a: { x: -1e6, y: -1e6 }, b: { x: 1e6, y: 1e6 } }));
  }

  function toolPreview() {
    const st = S(), o = st.opts;
    let s = '';
    const acc = style('stroke:var(--accent);fill:none');
    if (T.snapDot) s += '<circle cx="' + f(T.snapDot.x) + '" cy="' + f(T.snapDot.y) + '" r="' + f(px(4)) + '" stroke-width="' + f(px(1.5)) + '"' + acc + '/>';
    if (st.tool === 'wall' && T.pts && T.pts.length && T.target) {
      const a = T.pts[T.pts.length - 1], b = T.target;
      s += '<polyline points="' + ptsAttr(T.pts) + '" stroke-width="' + f(px(1)) + '"' + acc + ' stroke-dasharray="' + f(px(4)) + ' ' + f(px(3)) + '"/>';
      s += '<line x1="' + f(a.x) + '" y1="' + f(a.y) + '" x2="' + f(b.x) + '" y2="' + f(b.y) + '" stroke-width="' + f(o.wallT) + '"' + style('stroke:var(--accent);opacity:.45') + '/>';
      s += label((a.x + b.x) / 2, (a.y + b.y) / 2 - px(10), FP.draw.fm(G.len(a, b)) + ' m');
    }
    if (st.tool === 'fence' && T.pts && T.pts.length && T.target) {
      const a = T.pts[T.pts.length - 1], b = T.target;
      s += '<polyline points="' + ptsAttr(T.pts) + '" stroke-width="' + f(px(1)) + '"' + acc + ' stroke-dasharray="' + f(px(4)) + ' ' + f(px(3)) + '"/>';
      s += '<line x1="' + f(a.x) + '" y1="' + f(a.y) + '" x2="' + f(b.x) + '" y2="' + f(b.y) + '" stroke-width="0.12"' + style('stroke:var(--accent);opacity:.5') + '/>';
      s += label((a.x + b.x) / 2, (a.y + b.y) / 2 - px(10), FP.draw.fm(G.len(a, b)) + ' m');
    }
    if ((st.tool === 'room' || st.tool === 'area') && T.a && T.b) {
      const x = Math.min(T.a.x, T.b.x), y = Math.min(T.a.y, T.b.y), w = Math.abs(T.b.x - T.a.x), h = Math.abs(T.b.y - T.a.y);
      s += '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" stroke-width="' + f(px(1.5)) + '"' + style('stroke:var(--accent);fill:color-mix(in srgb, var(--accent) 12%, transparent)') + '/>';
      // with new walls on every side, the clear size is one wall thickness smaller each way
      const t = st.tool === 'room' && o.roomWalls && o.roomUse === 'indoor' ? o.wallT : 0;
      const cw = Math.max(0, w - t), ch = Math.max(0, h - t);
      s += label(x + w / 2, y + h / 2, FP.draw.fm(cw) + ' × ' + FP.draw.fm(ch) + ' m' + (t ? ' inside' : '') + ' · ' + (cw * ch).toFixed(1) + ' m²');
    }
    if ((st.tool === 'room' || st.tool === 'area') && T.poly && T.poly.length) {
      const pts = T.target ? T.poly.concat([T.target]) : T.poly;
      s += '<polyline points="' + ptsAttr(pts) + '" stroke-width="' + f(px(1.5)) + '"' + acc + '/>';
      s += '<circle cx="' + f(T.poly[0].x) + '" cy="' + f(T.poly[0].y) + '" r="' + f(px(5)) + '" stroke-width="' + f(px(1.5)) + '"' + acc + '/>';
      if (T.target) { const a = T.poly[T.poly.length - 1]; s += label((a.x + T.target.x) / 2, (a.y + T.target.y) / 2 - px(10), FP.draw.fm(G.len(a, T.target)) + ' m'); }
    }
    if ((st.tool === 'door' || st.tool === 'window') && T.op) {
      const g = T.op;
      const h = g.t / 2 + 0.05;
      const Q = (pt, k) => ({ x: pt.x + g.v.nx * k, y: pt.y + g.v.ny * k });
      s += '<polygon points="' + ptsAttr([Q(g.s, -h), Q(g.e, -h), Q(g.e, h), Q(g.s, h)]) + '" stroke-width="' + f(px(1.5)) + '"' + style('stroke:var(--accent);fill:color-mix(in srgb, var(--accent) 35%, transparent)') + '/>';
    }
    if (st.tool === 'gate' && T.gate) {
      const g = T.gate, Q = (pt, k) => ({ x: pt.x + g.v.nx * k, y: pt.y + g.v.ny * k });
      s += '<polygon points="' + ptsAttr([Q(g.s, -0.25), Q(g.e, -0.25), Q(g.e, 0.25), Q(g.s, 0.25)]) + '" stroke-width="' + f(px(1.5)) + '"' + style('stroke:var(--accent);fill:color-mix(in srgb, var(--accent) 25%, transparent)') + '/>';
      s += '<g opacity=".85">' + FP.draw.gateSvg(P(), g.g, false) + '</g>';
      s += label(g.c.x, g.c.y - 0.55 - px(8), FP.draw.fm(g.g.w) + ' m');
    }
    if (st.tool === 'item' && T.ghost) s += '<g opacity=".7">' + FP.draw.itemSvg(T.ghost) + '</g>';
    if (st.tool === 'plant' && T.ghost) s += '<g opacity=".7">' + FP.draw.plantSvg(T.ghost, st.mode === 'render') + '</g>';
    if (st.tool === 'laser' && T.laser) s += laserSvg(T.laser, true);
    if (st.tool === 'zone' && T.a && T.b) {
      const x = Math.min(T.a.x, T.b.x), y = Math.min(T.a.y, T.b.y);
      s += rectSvg({ x, y, w: Math.abs(T.b.x - T.a.x), h: Math.abs(T.b.y - T.a.y) }, true);
    }
    if (T.dragLabel) s += label(T.dragLabel.x, T.dragLabel.y - px(14), T.dragLabel.text);
    if (st.tool === 'measure' && T.a && T.b) {
      s += '<line x1="' + f(T.a.x) + '" y1="' + f(T.a.y) + '" x2="' + f(T.b.x) + '" y2="' + f(T.b.y) + '" stroke-width="' + f(px(2)) + '"' + acc + '/>';
      for (const q of [T.a, T.b]) s += '<circle cx="' + f(q.x) + '" cy="' + f(q.y) + '" r="' + f(px(3.5)) + '"' + style('fill:var(--accent)') + '/>';
      s += label((T.a.x + T.b.x) / 2, (T.a.y + T.b.y) / 2 - px(10), FP.draw.fm(G.len(T.a, T.b)) + ' m');
    }
    return s;
  }

  function updateHud() {
    if (!hud) return;
    const g = S().snap;
    const c = cursor ? 'x ' + cursor.x.toFixed(2) + '   y ' + cursor.y.toFixed(2) + ' m' : '';
    hud.textContent = c + (c ? '   ·   ' : '') + (g ? 'snap ' + (g < 1 ? Math.round(g * 100) + ' cm' : g + ' m') : 'snap off') + (mods.alt ? '   ·   snapping off' : '');
  }

  /* ---------- laser measure & area marks ---------- */
  // Everything a laser beam stops at: walls and fences always, trees and furniture when asked.
  function beamSegments(all) {
    const p = P(), segs = [];
    const poly = (pts) => pts.forEach((a, i) => segs.push([a, pts[(i + 1) % pts.length]]));
    poly([{ x: 0, y: 0 }, { x: p.lot.w, y: 0 }, { x: p.lot.w, y: p.lot.h }, { x: 0, y: p.lot.h }]);
    for (const w of p.walls) {
      const v = M.wallVec(w), h = w.t / 2, Q = (d, k) => ({ x: v.a.x + v.ux * d + v.nx * k, y: v.a.y + v.uy * d + v.ny * k });
      poly([Q(0, -h), Q(v.L, -h), Q(v.L, h), Q(0, h)]);
    }
    for (const fe of p.fences) {
      const L = Math.hypot(fe.x2 - fe.x1, fe.y2 - fe.y1) || 1e-9, ux = (fe.x2 - fe.x1) / L, uy = (fe.y2 - fe.y1) / L, h = 0.06;
      const Q = (d, k) => ({ x: fe.x1 + ux * d - uy * k, y: fe.y1 + uy * d + ux * k });
      poly([Q(0, -h), Q(L, -h), Q(L, h), Q(0, h)]);
    }
    if (all) {
      for (const pl of p.plants) { const n = 16; poly(Array.from({ length: n }, (_, i) => ({ x: pl.x + Math.cos((i * 2 * Math.PI) / n) * pl.r, y: pl.y + Math.sin((i * 2 * Math.PI) / n) * pl.r }))); }
      for (const it of p.items) {
        const a = ((it.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
        poly([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ x: it.x + (sx * it.w / 2) * ca - (sy * it.h / 2) * sa, y: it.y + (sx * it.w / 2) * sa + (sy * it.h / 2) * ca })));
      }
    }
    return segs;
  }
  // Distance from c along unit (dx, dy) to the first segment it meets; null if none.
  function beam(c, dx, dy, segs) {
    let best = null;
    for (const [a, b] of segs) {
      const ex = b.x - a.x, ey = b.y - a.y, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den, u = ((a.x - c.x) * dy - (a.y - c.y) * dx) / den;
      if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t;
    }
    return best;
  }
  // The gap through point c, sideways and up and down.
  function laserAt(c) {
    const p = P(), segs = beamSegments(S().opts.laserAll);
    if (c.x < 0 || c.y < 0 || c.x > p.lot.w || c.y > p.lot.h) return null;
    const g = (dx, dy) => { const d = beam(c, dx, dy, segs); return d == null ? 0 : d; };
    return { c: { x: c.x, y: c.y }, l: g(-1, 0), r: g(1, 0), u: g(0, -1), d: g(0, 1) };
  }
  function laserSvg(m, live) {
    const col = '#e5484d', c = m.c, w = px(live ? 1.5 : 2);
    const line = (x1, y1, x2, y2) => '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '" stroke-width="' + f(w) + '"' + style('stroke:' + col + (live ? ';opacity:.85' : '')) + '/>';
    const dot = (x, y, r) => '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(px(r)) + '"' + style('fill:' + col) + '/>';
    const tick = (x, y, horiz) => horiz ? line(x, y - px(6), x, y + px(6)) : line(x - px(6), y, x + px(6), y);
    let s = '';
    if (m.l + m.r > 0.01) { s += line(c.x - m.l, c.y, c.x + m.r, c.y) + tick(c.x - m.l, c.y, true) + tick(c.x + m.r, c.y, true) + label(c.x + (m.r - m.l) / 2, c.y - px(10), FP.draw.fm(m.l + m.r) + ' m'); }
    if (m.u + m.d > 0.01) { s += line(c.x, c.y - m.u, c.x, c.y + m.d) + tick(c.x, c.y - m.u, false) + tick(c.x, c.y + m.d, false) + label(c.x + px(34), c.y + (m.d - m.u) / 2 + px(4), FP.draw.fm(m.u + m.d) + ' m'); }
    return s + dot(c.x, c.y, live ? 3.5 : 4.5);
  }
  function rectSvg(r, live) {
    const area = r.w * r.h;
    return '<rect x="' + f(r.x) + '" y="' + f(r.y) + '" width="' + f(r.w) + '" height="' + f(r.h) + '" stroke-width="' + f(px(live ? 1.5 : 2)) + '"' + style('stroke:var(--accent);fill:color-mix(in srgb, var(--accent) ' + (live ? 12 : 18) + '%, transparent)' + (live ? ';stroke-dasharray:' + f(px(6)) + ' ' + f(px(4)) : '')) + '/>'
      + label(r.x + r.w / 2, r.y + r.h / 2 - px(2), FP.draw.fm(r.w) + ' × ' + FP.draw.fm(r.h) + ' m')
      + label(r.x + r.w / 2, r.y + r.h / 2 + px(14), area.toFixed(2) + ' m²');
  }
  function marksSvg() {
    return marks.map((m) => (m.kind === 'laser' ? laserSvg(m, false) : rectSvg(m, false))).join('');
  }
  function clearMarks() { marks = []; T = {}; drawOverlay(); }

  /* ---------- picking & snapping ---------- */
  function pick(e) {
    const L = S().layers;
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (!sceneEl.contains(el)) continue;
      const g = el.closest('[data-k]');
      if (!g) continue;
      const layer = L[layerOf(g.dataset.k, g.dataset.id)];
      if (!layer || !layer.visible || layer.locked) continue;
      return { k: g.dataset.k, id: g.dataset.id };
    }
    return null;
  }

  function vertices(opt) {
    const p = P(), out = [];
    for (const w of p.walls) if (w.id !== opt.excludeWall) out.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    for (const fe of p.fences) if (fe.id !== opt.excludeFence) out.push({ x: fe.x1, y: fe.y1 }, { x: fe.x2, y: fe.y2 });
    for (const r of p.rooms) if (r.id !== opt.excludeShape) out.push(...r.pts);
    for (const a of p.areas) if (a.id !== opt.excludeShape) out.push(...a.pts);
    out.push({ x: 0, y: 0 }, { x: p.lot.w, y: 0 }, { x: p.lot.w, y: p.lot.h }, { x: 0, y: p.lot.h });
    return out;
  }

  // Snap to a nearby corner, else onto a nearby wall, else to the grid. Alt disables.
  function snapPoint(w, opt) {
    opt = opt || {};
    T.snapDot = null;
    if (mods.alt) return { x: w.x, y: w.y };
    const tol = px(10), g = S().snap;
    let best = null, bd = tol;
    for (const v of vertices(opt)) {
      const d = Math.hypot(v.x - w.x, v.y - w.y);
      if (d < bd) { bd = d; best = { x: v.x, y: v.y }; }
    }
    if (best) { T.snapDot = best; return best; }
    for (const wl of P().walls) {
      if (wl.id === opt.excludeWall) continue;
      const pr = G.project(w, { x: wl.x1, y: wl.y1 }, { x: wl.x2, y: wl.y2 });
      if (pr.d < bd) {
        bd = pr.d;
        best = { x: pr.x, y: pr.y };
        if (Math.abs(wl.x1 - wl.x2) < 1e-6) best.y = G.snap(w.y, g);
        if (Math.abs(wl.y1 - wl.y2) < 1e-6) best.x = G.snap(w.x, g);
      }
    }
    if (best) { T.snapDot = best; return best; }
    return { x: G.snap(w.x, g), y: G.snap(w.y, g) };
  }

  // Next point of a straight run from a: locked to horizontal/vertical unless Shift,
  // with the free coordinate aligned to existing corners or the grid.
  function orthoTarget(a, w, opt) {
    if (mods.shift) return snapPoint(w, opt);
    T.snapDot = null;
    const horiz = Math.abs(w.x - a.x) >= Math.abs(w.y - a.y);
    let x = horiz ? w.x : a.x, y = horiz ? a.y : w.y;
    if (mods.alt) return { x, y };
    const tol = px(10);
    let best = null, bd = tol;
    for (const v of vertices(opt || {})) {
      const d = horiz ? Math.abs(v.x - x) : Math.abs(v.y - y);
      if (d < bd) { bd = d; best = v; }
    }
    const g = S().snap;
    if (best) { if (horiz) x = best.x; else y = best.y; T.snapDot = { x, y }; }
    else if (horiz) x = G.snap(x, g); else y = G.snap(y, g);
    return { x, y };
  }

  function nearestWall(w) {
    const tol = Math.max(0.45, px(14));
    let best = null;
    for (const wl of P().walls) {
      const pr = G.project(w, { x: wl.x1, y: wl.y1 }, { x: wl.x2, y: wl.y2 });
      if (pr.d < tol && (!best || pr.d < best.pr.d)) best = { wl, pr };
    }
    return best;
  }

  function openingGhost(w) {
    const st = S();
    const n = nearestWall(w);
    if (!n) return null;
    const type = st.tool === 'window' ? 'window' : st.opts.doorType;
    const width = st.opts.openW[type] || C.openings[type].w;
    const v = M.wallVec(n.wl);
    const pos = Math.max(width / 2, Math.min(v.L - width / 2, G.snap(n.pr.t * v.L, 0.05)));
    if (width > v.L) return null;
    const side = (w.x - n.pr.x) * v.nx + (w.y - n.pr.y) * v.ny >= 0 ? 1 : -1;
    const o = { id: 'ghost', wall: n.wl.id, pos, w: width, h: C.openings[type].h, sill: C.openings[type].sill, type, side, hinge: 'start' };
    return Object.assign(M.openingGeo(P(), o), { o });
  }

  function nearestFence(w) {
    const tol = Math.max(0.6, px(14));
    let best = null;
    for (const fe of P().fences) {
      const pr = G.project(w, { x: fe.x1, y: fe.y1 }, { x: fe.x2, y: fe.y2 });
      if (pr.d < tol && (!best || pr.d < best.pr.d)) best = { fe, pr };
    }
    return best;
  }

  // Where a gate would go: on the fence nearest the cursor, on whichever side of it the cursor is.
  function gateGhost(w) {
    const st = S(), n = nearestFence(w);
    if (!n) return null;
    const kind = st.opts.gateKind, d = C.gates[kind], width = st.opts.gateW[kind] || d.w, v = M.wallVec(n.fe);
    if (width > v.L - 0.1) return null;
    const pos = Math.max(width / 2, Math.min(v.L - width / 2, G.snap(n.pr.t * v.L, mods.alt ? 0 : 0.05)));
    const swing = (w.x - n.pr.x) * v.nx + (w.y - n.pr.y) * v.ny >= 0 ? 1 : -1;
    const g = { id: 'ghost', fence: n.fe.id, pos, w: width, h: st.opts.gateH[kind] || d.h, kind, swing, hinge: 'start' };
    return Object.assign(M.gateGeo(P(), g), { g });
  }

  /* ---------- gestures ---------- */
  function onDown(e) {
    if (e.button === 2) return;
    svg.setPointerCapture(e.pointerId);
    const w = toWorld(e);
    cursor = w;
    const st = S();
    if (e.button === 1 || mods.space || st.tool === 'hand' || st.preview) return startPan(e);

    switch (st.tool) {
      case 'select': return downSelect(e, w);
      case 'wall': return downWall(w);
      case 'fence': return downFence(w);
      case 'room': case 'area': return downShape(w);
      case 'door': case 'window': {
        const g = openingGhost(w);
        if (!g) return A().toast('Click on a wall to place it.');
        const o = Object.assign({}, g.o, { id: M.uid('o') });
        A().mutate((p) => p.openings.push(o));
        A().select({ k: 'opening', id: o.id });
        return;
      }
      case 'gate': {
        const gh = gateGhost(w);
        if (!gh) return A().toast('Click on a fence to place the gate.');
        const gt = Object.assign({}, gh.g, { id: M.uid('g') });
        A().mutate((p) => p.gates.push(gt));
        A().select({ k: 'gate', id: gt.id });
        return;
      }
      case 'plant': {
        const kind = st.opts.plant;
        const pl = { id: M.uid('p'), kind, x: G.round(G.snap(w.x, mods.alt ? 0 : 0.1)), y: G.round(G.snap(w.y, mods.alt ? 0 : 0.1)), r: C.plants[kind].r };
        A().mutate((p) => p.plants.push(pl));
        A().select({ k: 'plant', id: pl.id }, true);
        return;
      }
      case 'item': {
        const g = itemGhost(w);
        const it = Object.assign({}, g, { id: M.uid('i') });
        A().mutate((p) => p.items.push(it));
        A().select({ k: 'item', id: it.id }, true);
        return;
      }
      case 'laser': {
        const m = laserAt(w);
        if (m) { marks.push(Object.assign({ kind: 'laser' }, m)); drawOverlay(); }
        return;
      }
      case 'zone':
        T = { a: snapPoint(w) };
        T.b = T.a;
        drag = { type: 'zone' };
        return;
      case 'measure':
        T = { a: snapPoint(w), b: null };
        T.b = T.a;
        drag = { type: 'measure' };
        return;
    }
  }

  function startPan(e) {
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: V.x, vy: V.y };
    stage.classList.add('dragging');
  }

  function downSelect(e, w) {
    const st = S();
    const h = e.target.closest && e.target.closest('[data-h]');
    if (h && st.sel) {
      const ent = M.find(P(), st.sel.k, st.sel.id);
      drag = { type: 'handle', h: h.dataset.h, sel: st.sel, start: w, orig: JSON.parse(JSON.stringify(ent)), moved: false };
      drag.links = linksFor(st.sel, ent, drag.h);
      A().beginChange();
      return;
    }
    const hit = pick(e);
    const cur = A().curRefs();
    // Shift-click (or Ctrl/Cmd-click) adds a thing to the selection or takes it out
    const onlyThis = cur.length === 1 && cur[0].id === (hit && hit.id);
    if (hit && (e.ctrlKey || e.metaKey || (e.shiftKey && cur.length && !onlyThis))) {
      A().selectMany(cur.some((r) => r.id === hit.id) ? cur.filter((r) => r.id !== hit.id) : cur.concat([hit]));
      return;
    }
    if (!hit) {
      // empty ground: drag a box to select several things; a plain click clears the selection
      drag = { type: 'marquee', a: w, sx: e.clientX, sy: e.clientY, add: e.shiftKey, moved: false };
      delete T.box;
      return;
    }
    if (cur.length > 1 && cur.some((r) => r.id === hit.id)) return startMoveMany(cur, w, e);
    const grp = M.groupOf(P(), hit);
    if (grp) { A().selectMany(grp.members); return startMoveMany(grp.members, w, e); }
    if (!st.sel || st.sel.id !== hit.id) A().select(hit);
    const ent = M.find(P(), hit.k, hit.id);
    drag = { type: 'move', sel: hit, start: w, sx: e.clientX, sy: e.clientY, orig: JSON.parse(JSON.stringify(ent)), moved: false };
    drag.links = linksFor(hit, ent, null);
    A().beginChange();
  }

  // Dragging several things (a box selection or a group) moves them together, keeping their layout.
  function startMoveMany(refs, w, e) {
    const p = P();
    const mov = refs.filter((r) => M.MOVABLE.includes(r.k));
    const bb = M.selBox(p, mov);
    if (!bb) return;
    const orig = new Map();
    for (const r of mov) orig.set(r.id, JSON.parse(JSON.stringify(M.find(p, r.k, r.id))));
    // snap by a real corner of the first wall (else room, else anything) so drawn geometry stays on the grid
    const ar = mov.find((r) => r.k === 'wall') || mov.find((r) => r.k === 'room' || r.k === 'area') || mov[0], ae = orig.get(ar.id);
    const anchor = ae.pts ? ae.pts[0] : ae.x1 !== undefined ? { x: ae.x1, y: ae.y1 } : { x: ae.x, y: ae.y };
    drag = { type: 'moveMany', mov, bb, anchor, orig, start: w, sx: e.clientX, sy: e.clientY, moved: false };
    A().beginChange();
  }
  function moveMany(e, w) {
    const d = drag, p = P();
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    const g = mods.alt ? 0 : S().snap;
    const dx = G.snap(d.anchor.x + (w.x - d.start.x), g) - d.anchor.x, dy = G.snap(d.anchor.y + (w.y - d.start.y), g) - d.anchor.y;
    for (const r of d.mov) {
      const ent = M.find(p, r.k, r.id);
      if (!ent) continue;
      Object.assign(ent, JSON.parse(JSON.stringify(d.orig.get(r.id))));
      M.moveEnt(r.k, ent, dx, dy);
    }
    M.clampGates(p);
    const fmt = FP.draw.fm;
    T.dragLabel = { x: (d.bb.x0 + d.bb.x1) / 2 + dx, y: d.bb.y0 + dy - px(6), text: (dx >= 0 ? '→ ' : '← ') + fmt(Math.abs(dx)) + ' m   ' + (dy >= 0 ? '↓ ' : '↑ ') + fmt(Math.abs(dy)) + ' m' };
    A().refresh();
  }

  // Things that should follow a wall when it (or one of its ends) moves:
  // coincident ends of other walls, and room/area corners lying on the wall.
  function linksFor(sel, ent, handle) {
    if (sel.k === 'fence') {
      // fence runs that meet at an end keep meeting when it moves
      const out = { ends: [] };
      const ends = handle ? [handle === '1' ? { x: ent.x1, y: ent.y1 } : { x: ent.x2, y: ent.y2 }] : [{ x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 }];
      for (const o of P().fences) {
        if (o.id === ent.id) continue;
        for (const q of ends) {
          if (Math.hypot(o.x1 - q.x, o.y1 - q.y) < 0.01) out.ends.push({ id: o.id, end: 1, x: o.x1, y: o.y1 });
          if (Math.hypot(o.x2 - q.x, o.y2 - q.y) < 0.01) out.ends.push({ id: o.id, end: 2, x: o.x2, y: o.y2 });
        }
      }
      return out;
    }
    if (sel.k !== 'wall') return null;
    const p = P(), out = { ends: [], verts: [] };
    // Moving a straight wall moves its whole straight run; anything meeting the run follows.
    const run = !handle && M.lineRun(p, ent);
    if (run) {
      for (const w of p.walls) {
        if (w === ent) continue;
        const all = run.walls.includes(w);
        if (all || run.touches(w.x1, w.y1)) out.ends.push({ id: w.id, end: 1, x: w.x1, y: w.y1 });
        if (all || run.touches(w.x2, w.y2)) out.ends.push({ id: w.id, end: 2, x: w.x2, y: w.y2 });
      }
      for (const list of [p.rooms, p.areas]) {
        for (const r of list) r.pts.forEach((v, i) => { if (run.touches(v.x, v.y)) out.verts.push({ id: r.id, list: list === p.rooms ? 'room' : 'area', i, x: v.x, y: v.y }); });
      }
      return out;
    }
    const ends = handle ? [handle === '1' ? { x: ent.x1, y: ent.y1 } : { x: ent.x2, y: ent.y2 }] : [{ x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 }];
    for (const w of p.walls) {
      if (w.id === ent.id) continue;
      for (const q of ends) {
        if (Math.hypot(w.x1 - q.x, w.y1 - q.y) < 0.01) out.ends.push({ id: w.id, end: 1, x: w.x1, y: w.y1 });
        if (Math.hypot(w.x2 - q.x, w.y2 - q.y) < 0.01) out.ends.push({ id: w.id, end: 2, x: w.x2, y: w.y2 });
      }
    }
    for (const list of [p.rooms, p.areas]) {
      for (const r of list) {
        r.pts.forEach((v, i) => {
          const on = handle ? ends.some((q) => Math.hypot(v.x - q.x, v.y - q.y) < 0.02)
            : G.project(v, { x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 }).d < 0.02;
          if (on) out.verts.push({ id: r.id, list: list === p.rooms ? 'room' : 'area', i, x: v.x, y: v.y });
        });
      }
    }
    return out;
  }
  function applyLinks(links, dx, dy) {
    if (!links) return;
    const p = P();
    for (const l of links.ends) {
      const w = M.find(p, l.fence ? 'fence' : 'wall', l.id) || M.find(p, 'fence', l.id);
      if (!w) continue;
      if (l.end === 1) { w.x1 = G.round(l.x + dx); w.y1 = G.round(l.y + dy); } else { w.x2 = G.round(l.x + dx); w.y2 = G.round(l.y + dy); }
    }
    for (const l of links.verts || []) {
      const r = M.find(p, l.list, l.id);
      if (r) r.pts[l.i] = { x: G.round(l.x + dx), y: G.round(l.y + dy) };
    }
  }

  function moveSelect(e, w) {
    const p = P(), d = drag;
    if (!d.moved && Math.hypot(e.clientX - (d.sx || e.clientX), e.clientY - (d.sy || e.clientY)) < 3 && d.type === 'move') return;
    const ent = M.find(p, d.sel.k, d.sel.id);
    if (!ent) return;
    d.moved = true;
    const g = mods.alt ? 0 : S().snap;
    const dx = w.x - d.start.x, dy = w.y - d.start.y;
    const o = d.orig;

    if (d.type === 'move') {
      if (d.sel.k === 'item' || d.sel.k === 'plant') {
        const step = mods.alt ? 0 : Math.min(0.05, S().snap || 0.01);
        ent.x = G.round(G.snap(o.x + dx, step)); ent.y = G.round(G.snap(o.y + dy, step));
      } else if (d.sel.k === 'room' || d.sel.k === 'area') {
        const ref = o.pts[0];
        const ox = G.snap(ref.x + dx, g) - ref.x, oy = G.snap(ref.y + dy, g) - ref.y;
        ent.pts = o.pts.map((q) => ({ x: G.round(q.x + ox), y: G.round(q.y + oy) }));
      } else if (d.sel.k === 'wall') {
        // Square moves by default: only straight across the wall, so walls meeting it stay at right
        // angles. Shift moves it freely.
        let ox, oy;
        const v = M.wallVec(o);
        if (mods.shift) {
          ox = G.snap(o.x1 + dx, g) - o.x1; oy = G.snap(o.y1 + dy, g) - o.y1;
        } else {
          const dn = G.snap(dx * v.nx + dy * v.ny, g);
          ox = v.nx * dn; oy = v.ny * dn;
        }
        ent.x1 = G.round(o.x1 + ox); ent.y1 = G.round(o.y1 + oy); ent.x2 = G.round(o.x2 + ox); ent.y2 = G.round(o.y2 + oy);
        applyLinks(d.links, ox, oy);
        const arrow = Math.abs(ox) >= Math.abs(oy) ? (ox >= 0 ? '→ ' : '← ') : (oy >= 0 ? '↓ ' : '↑ ');
        T.dragLabel = { x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2, text: arrow + FP.draw.fm(Math.hypot(ox, oy)) + ' m' };
      } else if (d.sel.k === 'fence') {
        const ox = G.snap(o.x1 + dx, g) - o.x1, oy = G.snap(o.y1 + dy, g) - o.y1;
        ent.x1 = G.round(o.x1 + ox); ent.y1 = G.round(o.y1 + oy); ent.x2 = G.round(o.x2 + ox); ent.y2 = G.round(o.y2 + oy);
        applyLinks(d.links, ox, oy);
      } else if (d.sel.k === 'gate') {
        const fe = M.find(p, 'fence', ent.fence);
        if (fe) {
          const v = M.wallVec(fe), pr = G.project(w, v.a, v.b);
          ent.pos = G.round(Math.max(ent.w / 2, Math.min(v.L - ent.w / 2, G.snap(pr.t * v.L, mods.alt ? 0 : Math.min(0.05, S().snap || 0.01)))));
        }
      } else if (d.sel.k === 'opening') {
        const wl = M.find(p, 'wall', ent.wall);
        if (wl) {
          const v = M.wallVec(wl);
          const pr = G.project(w, v.a, v.b);
          ent.pos = G.round(Math.max(ent.w / 2, Math.min(v.L - ent.w / 2, G.snap(pr.t * v.L, mods.alt ? 0 : Math.min(0.05, S().snap || 0.01)))));
        }
      }
    } else if (d.type === 'handle') {
      if (d.sel.k === 'wall') {
        const fixed = d.h === '1' ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
        const q = orthoTarget(fixed, w, { excludeWall: ent.id });
        const from = d.h === '1' ? { x: o.x1, y: o.y1 } : { x: o.x2, y: o.y2 };
        if (d.h === '1') { ent.x1 = G.round(q.x); ent.y1 = G.round(q.y); } else { ent.x2 = G.round(q.x); ent.y2 = G.round(q.y); }
        applyLinks(d.links, q.x - from.x, q.y - from.y);
        for (const op of p.openings) if (op.wall === ent.id) M.clampOpening(p, op);
        T.dragLabel = { x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2, text: FP.draw.fm(Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1)) + ' m long' };
      } else if (d.sel.k === 'fence') {
        const fixed = d.h === '1' ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
        const q = orthoTarget(fixed, w, { excludeFence: ent.id });
        const from = d.h === '1' ? { x: o.x1, y: o.y1 } : { x: o.x2, y: o.y2 };
        if (d.h === '1') { ent.x1 = G.round(q.x); ent.y1 = G.round(q.y); } else { ent.x2 = G.round(q.x); ent.y2 = G.round(q.y); }
        applyLinks(d.links, q.x - from.x, q.y - from.y);
        T.dragLabel = { x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2, text: FP.draw.fm(Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1)) + ' m long' };
      } else if (d.sel.k === 'room' || d.sel.k === 'area') {
        const i = +d.h;
        const q = snapPoint(w, { excludeShape: ent.id });
        if (G.isAxisRect(o.pts)) {
          const c = o.pts[i];
          ent.pts = o.pts.map((v, j) => {
            if (j === i) return { x: q.x, y: q.y };
            return { x: Math.abs(v.x - c.x) < 1e-6 ? q.x : v.x, y: Math.abs(v.y - c.y) < 1e-6 ? q.y : v.y };
          });
        } else {
          ent.pts[i] = { x: G.round(q.x), y: G.round(q.y) };
        }
      } else if (d.sel.k === 'plant') {
        ent.r = G.round(Math.max(0.15, Math.hypot(w.x - ent.x, w.y - ent.y)), 2);
      }
    }
    M.clampGates(p);
    A().refresh();
  }

  /* wall tool */
  function downWall(w) {
    const st = S();
    if (!T.pts || !T.pts.length) { T = { pts: [snapPoint(w)] }; T.target = T.pts[0]; drawOverlay(); return; }
    const a = T.pts[T.pts.length - 1];
    const b = orthoTarget(a, w);
    if (G.len(a, b) < 0.05) return;
    A().mutate((p) => {
      const made = M.addWall(p, a, b, st.opts.wallT, 'interior');
      for (const m of made) m.kind = st.opts.wallKind === 'auto' ? M.classifyWall(p, m) : st.opts.wallKind;
    });
    if (T.pts.length >= 2 && G.len(b, T.pts[0]) < 0.01) { T = {}; drawOverlay(); return; }
    T.pts.push(b);
  }

  /* fence tool: click along the line of the fence; each stretch becomes a fence run */
  function downFence(w) {
    const st = S();
    if (!T.pts || !T.pts.length) { T = { pts: [snapPoint(w, {})] }; T.target = T.pts[0]; drawOverlay(); return; }
    const a = T.pts[T.pts.length - 1];
    const b = orthoTarget(a, w);
    if (G.len(a, b) < 0.1) return;
    const kind = st.opts.fenceKind, fe = { id: M.uid('f'), kind, x1: G.round(a.x), y1: G.round(a.y), x2: G.round(b.x), y2: G.round(b.y), h: st.opts.fenceH[kind] };
    A().mutate((p) => p.fences.push(fe));
    T.pts.push(b);
  }

  /* room & area tools */
  function downShape(w) {
    const st = S();
    if (st.opts.shape === 'rect') {
      T = { a: snapPoint(w) };
      T.b = T.a;
      drag = { type: 'rect' };
      return;
    }
    const q = T.poly && T.poly.length ? orthoTarget(T.poly[T.poly.length - 1], w) : snapPoint(w);
    if (!T.poly) T.poly = [];
    if (T.poly.length >= 3 && G.len(q, T.poly[0]) < px(10)) return finishPoly();
    if (T.poly.length && G.len(q, T.poly[T.poly.length - 1]) < 0.02) return;
    T.poly.push(q);
    drawOverlay();
  }
  function finishPoly() {
    if (T.poly && T.poly.length >= 3) createShape(T.poly.map((q) => ({ x: G.round(q.x), y: G.round(q.y) })));
    T = {};
    drawOverlay();
  }

  function createShape(pts) {
    const st = S(), o = st.opts;
    if (st.tool === 'room') {
      const r = { id: M.uid('r'), kind: o.roomKind, use: o.roomUse, floor: C.roomKinds[o.roomKind].floor, pts };
      A().mutate((p) => {
        r.name = M.nextName(p, o.roomKind);
        p.rooms.push(r);
        if (o.roomWalls && o.roomUse === 'indoor') {
          const made = M.addPolyWalls(p, pts, o.wallT, 'interior');
          for (const m of made) m.kind = M.classifyWall(p, m);
        }
      });
      A().select({ k: 'room', id: r.id });
    } else {
      const a = { id: M.uid('a'), name: C.materials[o.material].label, material: o.material, pts };
      A().mutate((p) => p.areas.push(a));
      A().select({ k: 'area', id: a.id });
    }
  }

  function itemGhost(w) {
    const st = S();
    const d = C.items[st.opts.item];
    const step = mods.alt ? 0 : Math.min(0.05, S().snap || 0.01);
    const sz = st.opts.itemSize[st.opts.item] || [d.w, d.h];
    return { id: 'ghost', kind: st.opts.item, x: G.round(G.snap(w.x, step)), y: G.round(G.snap(w.y, step)), w: sz[0], h: sz[1], rot: st.opts.itemRot || 0 };
  }

  function onMove(e) {
    const w = toWorld(e);
    cursor = w;
    const st = S();
    if (drag && drag.type === 'pan') {
      V.x = drag.vx - (e.clientX - drag.sx) / V.s;
      V.y = drag.vy - (e.clientY - drag.sy) / V.s;
      applyView();
      return;
    }
    if (drag && (drag.type === 'move' || drag.type === 'handle')) return moveSelect(e, w);
    if (drag && drag.type === 'moveMany') return moveMany(e, w);
    if (drag && drag.type === 'marquee') {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      T.box = { a: drag.a, b: w };
      drawOverlay();
      return;
    }
    if (drag && drag.type === 'rect') { T.b = snapPoint(w); drawOverlay(); return; }
    if (drag && drag.type === 'zone') { T.b = snapPoint(w); drawOverlay(); return; }
    if (drag && drag.type === 'measure') { T.b = mods.shift ? snapPoint(w) : orthoTarget(T.a, w); drawOverlay(); return; }

    T.snapDot = null;
    if (st.preview) { updateHud(); return; }
    switch (st.tool) {
      case 'select': {
        const h = pick(e);
        if ((h && h.id) !== (hover && hover.id)) { hover = h; drawOverlay(); } else updateHud();
        return;
      }
      case 'wall':
        if (T.pts && T.pts.length) T.target = orthoTarget(T.pts[T.pts.length - 1], w);
        else snapPoint(w);
        break;
      case 'fence':
        if (T.pts && T.pts.length) T.target = orthoTarget(T.pts[T.pts.length - 1], w);
        else snapPoint(w);
        break;
      case 'room': case 'area':
        if (T.poly && T.poly.length) T.target = orthoTarget(T.poly[T.poly.length - 1], w);
        else snapPoint(w);
        break;
      case 'door': case 'window': T.op = openingGhost(w); break;
      case 'gate': T.gate = gateGhost(w); break;
      case 'item': T.ghost = itemGhost(w); break;
      case 'plant': T.ghost = { id: 'ghost', kind: st.opts.plant, x: w.x, y: w.y, r: C.plants[st.opts.plant].r }; break;
      case 'measure': if (!T.a) snapPoint(w); break;
      case 'laser': T.laser = mods.alt ? null : laserAt(w); break;
      case 'zone': if (!T.a) snapPoint(w); break;
    }
    drawOverlay();
  }

  function onUp(e) {
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    const d = drag;
    drag = null;
    stage.classList.remove('dragging');
    if (!d) return;
    delete T.dragLabel;
    if (d.type === 'move' || d.type === 'handle' || d.type === 'moveMany') A().endChange(d.moved);
    if (d.type === 'marquee') {
      const box = T.box;
      delete T.box;
      if (!d.moved || !box) { if (!d.add) A().select(null); else drawOverlay(); return; }
      const hits = marqueeRefs(box), base = d.add ? A().curRefs() : [];
      A().selectMany(base.concat(hits.filter((h) => !base.some((b) => b.id === h.id))));
      drawOverlay();
      return;
    }
    if (d.type === 'zone') {
      const r = { kind: 'rect', x: G.round(Math.min(T.a.x, T.b.x)), y: G.round(Math.min(T.a.y, T.b.y)), w: G.round(Math.abs(T.b.x - T.a.x)), h: G.round(Math.abs(T.b.y - T.a.y)) };
      T = {};
      if (r.w >= 0.05 && r.h >= 0.05) marks.push(r);
      drawOverlay();
      return;
    }
    if (d.type === 'rect') {
      const x = Math.min(T.a.x, T.b.x), y = Math.min(T.a.y, T.b.y), w = Math.abs(T.b.x - T.a.x), h = Math.abs(T.b.y - T.a.y);
      T = {};
      if (w >= 0.3 && h >= 0.3) createShape(G.rectPts(G.round(x), G.round(y), G.round(w), G.round(h)));
      else drawOverlay();
    }
  }

  function onDblClick(e) {
    const st = S();
    if (st.tool === 'wall' || st.tool === 'fence') { T = {}; drawOverlay(); return; }
    if ((st.tool === 'room' || st.tool === 'area') && T.poly) return finishPoly();
    if (st.tool === 'select') {
      const hit = pick(e);
      if (hit) { A().select(hit); FP.panels.focusFirstField(); }
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const zoomMode = S().wheel !== 'pan' || e.ctrlKey || e.metaKey;
    if (zoomMode) {
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      zoomAt(k, e.clientX, e.clientY);
    } else {
      V.x += e.deltaX / V.s; V.y += e.deltaY / V.s;
      applyView();
    }
  }

  /* ---------- keyboard hooks (called by app) ---------- */
  function cancel() {
    if (drag && drag.type === 'marquee') { drag = null; delete T.box; drawOverlay(); return true; }
    if (drag) return;
    const st = S();
    if (st.tool !== 'select' && Object.keys(T).length && !T.ghost && !T.op && !T.laser) { T = {}; drawOverlay(); return true; }
    if (st.tool !== 'select') { A().setTool('select'); return true; }
    return false;
  }
  function enter() {
    const st = S();
    if ((st.tool === 'wall' || st.tool === 'fence') && T.pts) { T = {}; drawOverlay(); return true; }
    if ((st.tool === 'room' || st.tool === 'area') && T.poly) { finishPoly(); return true; }
    return false;
  }
  function setModifier(name, on) {
    mods[name] = on;
    if (name === 'space') stage.classList.toggle('panning', on);
    updateHud();
  }
  function rotateGhost(delta) {
    const st = S();
    st.opts.itemRot = ((st.opts.itemRot || 0) + delta + 360) % 360;
    if (T.ghost && st.tool === 'item') T.ghost.rot = st.opts.itemRot;
    drawOverlay();
  }
  function resetTool() { T = {}; hover = null; drawOverlay(); }

  function init() {
    svg = document.getElementById('canvas');
    sceneEl = document.getElementById('scene');
    overlayEl = document.getElementById('overlay');
    defsEl = document.getElementById('defs');
    stage = document.getElementById('stage');
    hud = document.getElementById('hud');
    defsEl.innerHTML = FP.draw.defs();
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('pointerleave', () => { if (!drag) { hover = null; T.ghost = null; T.op = null; T.laser = null; drawOverlay(); } });
    new ResizeObserver(() => applyView()).observe(stage);
  }

  FP.editor = { selectAll, clearMarks, init, redraw, drawOverlay, applyView, zoomAt, zoomTo, fit, cancel, enter, setModifier, rotateGhost, resetTool, BASE_SCALE, view: V };
})();
