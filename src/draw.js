// Turns a project into SVG markup, in metres. Two looks share one scene graph:
//   plan   - flat CAD-style drawing for editing
//   render - illustrated top-down render (textures, furniture, planting, shadows, dimensions)
// Every selectable shape carries data-k (kind) and data-id so the editor can hit-test it.
window.FP = window.FP || {};

(function () {
  const G = FP.geom, M = FP.model, C = FP.catalog;
  const f = (v) => Math.round(v * 1000) / 1000;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ptsAttr = (pts) => pts.map((p) => f(p.x) + ',' + f(p.y)).join(' ');
  const fm = (v) => v.toFixed(2);

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let s = hash(String(seed)) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  /* ---------- shared defs: textures, gradients, shadows ---------- */
  function speckle(id, size, base, colors, n, rmin, rmax, seed) {
    const r = rng(seed || id);
    let s = '<pattern id="' + id + '" width="' + size + '" height="' + size + '" patternUnits="userSpaceOnUse"><rect width="' + size + '" height="' + size + '" fill="' + base + '"/>';
    for (let i = 0; i < n; i++) {
      s += '<circle cx="' + f(r() * size) + '" cy="' + f(r() * size) + '" r="' + f(rmin + r() * (rmax - rmin)) + '" fill="' + pick(r, colors) + '"/>';
    }
    return s + '</pattern>';
  }

  function grass() {
    const r = rng('grass'), size = 3;
    let s = '<pattern id="pat-grass" width="' + size + '" height="' + size + '" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#86b35e"/>';
    for (let i = 0; i < 14; i++) s += '<circle cx="' + f(r() * 3) + '" cy="' + f(r() * 3) + '" r="' + f(0.2 + r() * 0.4) + '" fill="' + pick(r, ['#7aa854', '#93bf69']) + '" opacity=".45"/>';
    for (let i = 0; i < 220; i++) {
      const x = r() * 3, y = r() * 3, l = 0.05 + r() * 0.08, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
      s += '<line x1="' + f(x) + '" y1="' + f(y) + '" x2="' + f(x + Math.cos(a) * l) + '" y2="' + f(y + Math.sin(a) * l) + '" stroke="' + pick(r, ['#6b9a45', '#9cc870', '#77a650', '#a9d27e', '#5f8e3d']) + '" stroke-width=".018" stroke-linecap="round"/>';
    }
    return s + '</pattern>';
  }

  function planks(id, plankH, rows, width, tones, seam, seed) {
    const r = rng(seed || id);
    const H = plankH * rows;
    let s = '<pattern id="' + id + '" width="' + width + '" height="' + f(H) + '" patternUnits="userSpaceOnUse">';
    for (let i = 0; i < rows; i++) {
      let x = -r() * 1.2;
      const y = i * plankH;
      while (x < width) {
        const l = 0.9 + r() * 1.1;
        s += '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(l) + '" height="' + f(plankH) + '" fill="' + pick(r, tones) + '" stroke="' + seam + '" stroke-width=".008"/>';
        x += l;
      }
    }
    return s + '</pattern>';
  }

  function grid(id, size, base, line, lw) {
    return '<pattern id="' + id + '" width="' + size + '" height="' + size + '" patternUnits="userSpaceOnUse"><rect width="' + size + '" height="' + size + '" fill="' + base + '"/><path d="M' + size + ' 0H0V' + size + '" fill="none" stroke="' + line + '" stroke-width="' + lw + '"/></pattern>';
  }

  function rectGrid(id, w, h, line, lw, stagger) {
    const d = stagger ? 'M0 0H' + w + 'M0 ' + h + 'H' + w + 'M0 0V' + h + 'M' + w / 2 + ' ' + h + 'V' + 2 * h : 'M' + w + ' 0H0V' + h;
    return '<pattern id="' + id + '" width="' + w + '" height="' + (stagger ? 2 * h : h) + '" patternUnits="userSpaceOnUse"><path d="' + d + '" fill="none" stroke="' + line + '" stroke-width="' + lw + '"/></pattern>';
  }
  // Floor overlays: seams, grout, veins and grain in translucent tones, laid over each room's own floor colour.
  function overlays() {
    const dk = (a) => 'rgba(40,28,16,' + a + ')', lt = (a) => 'rgba(255,255,255,' + a + ')';
    let s = '';
    s += planks('ov-wood', 0.18, 8, 3, [lt(0), lt(0.08), dk(0.05), dk(0.09), lt(0.04)], dk(0.35), 'pat-wood');
    s += planks('ov-wideplank', 0.3, 6, 4, [lt(0), lt(0.07), dk(0.05), dk(0.1)], dk(0.35));
    s += planks('ov-deck', 0.14, 10, 3, [lt(0), dk(0.06), lt(0.05), dk(0.1)], dk(0.45), 'pat-deck');
    let ch = '<pattern id="ov-chevron" width=".6" height=".6" patternUnits="userSpaceOnUse"><path d="M0 0V.6M.3 0V.6';
    for (let k = -3; k <= 6; k++) { const y = k * 0.1; ch += 'M0 ' + f(y + 0.3) + 'L.3 ' + f(y) + 'M.3 ' + f(y) + 'L.6 ' + f(y + 0.3); }
    s += ch + '" fill="none" stroke="' + dk(0.32) + '" stroke-width=".008"/></pattern>';
    s += grid('ov-tile', 0.6, 'none', dk(0.22), 0.012);
    s += rectGrid('ov-porcelain', 1.2, 0.6, dk(0.16), 0.008, true);
    s += grid('ov-marble', 0.6, 'none', dk(0.1), 0.006);
    s += speckle('ov-terrazzo', 0.5, 'none', [dk(0.28), lt(0.6), 'rgba(150,128,100,.45)', 'rgba(110,116,120,.45)'], 140, 0.005, 0.013);
    s += grid('ov-stone', 0.45, 'none', dk(0.2), 0.01);
    s += rectGrid('ov-slate', 0.4, 0.3, dk(0.45), 0.015, true);
    s += speckle('ov-carpet', 0.6, 'none', [dk(0.05), lt(0.1)], 60, 0.01, 0.025);
    s += speckle('ov-concrete-s', 2, 'none', [dk(0.06), lt(0.08), dk(0.04)], 90, 0.01, 0.04);
    s += '<pattern id="ov-concrete" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="url(#ov-concrete-s)"/><path d="M2 0H0V2" fill="none" stroke="' + dk(0.18) + '" stroke-width=".02"/></pattern>';
    s += grid('ov-pavers', 0.3, 'none', lt(0.5), 0.014);
    return s;
  }

  let defsCache = null;
  function defs() {
    if (defsCache) return defsCache;
    let s = '<defs>';
    s += grass();
    s += overlays();
    s += planks('pat-wood', 0.18, 8, 3, ['#d9b582', '#d0a974', '#ddbd8c', '#cca46c', '#d6b07c'], '#b38a59');
    s += planks('pat-deck', 0.14, 10, 3, ['#b68858', '#c09466', '#ab7d4e', '#bb8f60'], '#86603b');
    s += grid('pat-tile', 0.6, '#efe9df', '#d6cdbf', 0.012);
    s += grid('pat-stone', 0.45, '#e7e4de', '#cbc6bd', 0.01);
    s += grid('pat-pavers', 0.5, '#e6d3b8', '#cbb291', 0.014);
    s += speckle('pat-carpet', 0.6, '#e6ddcf', ['#ddd2c2', '#ece5d9'], 60, 0.01, 0.025);
    s += speckle('pat-concrete', 2, '#d2d0ca', ['#c6c3bc', '#dddbd5', '#bfbcb5'], 90, 0.01, 0.04);
    s += speckle('pat-gravel', 1, '#dcd3c2', ['#c9bfac', '#ebe4d6', '#b9ae98', '#d1c7b4'], 160, 0.012, 0.035);
    s += speckle('pat-mulch', 1, '#87613f', ['#6e4c2f', '#9a7351', '#7a5636', '#a37e5b'], 140, 0.015, 0.045);
    s += speckle('pat-sand', 1, '#ebdcb4', ['#e2d2a6', '#f3e7c6'], 80, 0.01, 0.03);
    s += speckle('pat-hedge', 1.2, '#4c7735', ['#5b8a41', '#6a9a4b', '#3f672c', '#78a756'], 70, 0.12, 0.26);
    s += '<pattern id="pat-concrete-j" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="url(#pat-concrete)"/><path d="M2 0H0V2" fill="none" stroke="#b5b2ab" stroke-width=".02"/></pattern>';
    s += '<pattern id="pat-water" width="2" height="1.2" patternUnits="userSpaceOnUse"><path d="M0 .3q.25-.12 .5 0t.5 0 .5 0 .5 0M0 .9q.25-.12 .5 0t.5 0 .5 0 .5 0" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width=".03"/></pattern>';
    s += '<linearGradient id="g-water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93def1"/><stop offset="1" stop-color="#46a9d3"/></linearGradient>';
    s += '<pattern id="pat-hatch" width=".35" height=".35" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2=".35" stroke="#b9a98e" stroke-width=".025"/></pattern>';
    s += '<pattern id="pat-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#e2e5de" stroke-width=".02"/></pattern>';
    s += '<pattern id="pat-grid5" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#d3d8cd" stroke-width=".04"/></pattern>';
    s += '<pattern id="pat-grid-d" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#262a2f" stroke-width=".02"/></pattern>';
    s += '<pattern id="pat-grid5-d" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#323840" stroke-width=".04"/></pattern>';
    s += '<pattern id="pat-hatch-d" width=".35" height=".35" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2=".35" stroke="#6b6253" stroke-width=".025"/></pattern>';
    s += '<radialGradient id="g-tree" cx=".38" cy=".34" r=".72"><stop offset="0" stop-color="#a3d070"/><stop offset=".55" stop-color="#6fa349"/><stop offset="1" stop-color="#457a2f"/></radialGradient>';
    s += '<radialGradient id="g-fruit" cx=".38" cy=".34" r=".72"><stop offset="0" stop-color="#b2d67a"/><stop offset=".6" stop-color="#7cad4f"/><stop offset="1" stop-color="#4f8434"/></radialGradient>';
    s += '<radialGradient id="g-shrub" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#8fc261"/><stop offset="1" stop-color="#4d8133"/></radialGradient>';
    s += '<radialGradient id="g-conifer" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#5f9a58"/><stop offset="1" stop-color="#2e5e32"/></radialGradient>';
    s += '<linearGradient id="g-palm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5d8f3a"/><stop offset="1" stop-color="#9ccb63"/></linearGradient>';
    s += '<linearGradient id="g-car" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9ced4"/><stop offset=".5" stop-color="#f4f6f8"/><stop offset="1" stop-color="#c9ced4"/></linearGradient>';
    const shadow = (id, dx, dy, sd, op) => '<filter id="' + id + '" filterUnits="userSpaceOnUse" x="-200" y="-200" width="600" height="600"><feDropShadow dx="' + dx + '" dy="' + dy + '" stdDeviation="' + sd + '" flood-color="#1d2a14" flood-opacity="' + op + '"/></filter>';
    s += shadow('sh-wall', 0.07, 0.09, 0.05, 0.38);
    s += shadow('sh-item', 0.03, 0.05, 0.03, 0.22);
    s += shadow('sh-tree', 0.35, 0.5, 0.22, 0.32);
    s += '</defs>';
    defsCache = s;
    return s;
  }

  // Plan-view palettes. The render view keeps its natural colours in both themes.
  const PAL = {
    light: {
      bg: '#eef0ec', lot: '#fbfbf9', lotEdge: '#9a9d94', grid: 'url(#pat-grid)', grid5: 'url(#pat-grid5)',
      wallExt: '#34363a', wallInt: '#62646a', roomEdge: '#bdb6a8', text: '#26292e', textSoft: '#6a6e73', halo: '#ffffff',
      areaEdge: '#8f8a7d', plant: '#4f7d36', door: '#3f4247', arc: '#8a8d92', glass: '#e3f1f7', passage: '#9a9da2',
      tintAlpha: 1
    },
    dark: {
      bg: '#15171a', lot: '#1d2024', lotEdge: '#5b6068', grid: 'url(#pat-grid-d)', grid5: 'url(#pat-grid5-d)',
      wallExt: '#e9eaec', wallInt: '#b5b8be', roomEdge: '#4a4f57', text: '#eceef1', textSoft: '#9aa0a8', halo: '#1d2024',
      areaEdge: '#6a6f77', plant: '#86c06a', door: '#d6d8dc', arc: '#7d838c', glass: '#2b4552', passage: '#6d737b',
      tintAlpha: 0.22
    }
  };
  let PL = PAL.light; // palette for the scene being drawn; set by scene()

  const GROUND_FILL = { lawn: 'url(#pat-grass)', concrete: 'url(#pat-concrete-j)', pavers: 'url(#pat-pavers)', gravel: 'url(#pat-gravel)', deck: 'url(#pat-deck)', mulch: 'url(#pat-mulch)', hedge: 'url(#pat-hedge)', water: 'url(#g-water)', sand: 'url(#pat-sand)' };

  /* ---------- furniture ---------- */
  const R = (x, y, w, h, fill, stroke, sw, rx) =>
    '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '"' + (rx ? ' rx="' + f(rx) + '"' : '') +
    ' fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 0.015) + '"' : '') + '/>';
  const Ci = (x, y, r, fill, stroke, sw) => '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(r) + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 0.015) + '"' : '') + '/>';
  const El = (x, y, rx, ry, fill, stroke, sw) => '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 0.015) + '"' : '') + '/>';
  const Ln = (x1, y1, x2, y2, stroke, sw) => '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '" stroke="' + stroke + '" stroke-width="' + (sw || 0.015) + '"/>';

  function chair(cx, cy, rot, c) {
    return '<g transform="translate(' + f(cx) + ' ' + f(cy) + ') rotate(' + rot + ')">' + R(-0.21, -0.2, 0.42, 0.4, c || '#efe7da', '#a8957c', 0.012, 0.06) + R(-0.21, -0.2, 0.42, 0.08, '#b89a74', null, 0, 0.03) + '</g>';
  }
  function sofaShape(x, y, w, h, body, cushion) {
    let s = R(x, y, w, h, body, '#8f877b', 0.015, 0.1);
    s += R(x + 0.04, y + 0.04, w - 0.08, 0.2, cushion, null, 0, 0.06);
    const n = Math.max(1, Math.round((w - 0.4) / 0.75));
    const cw = (w - 0.4) / n;
    for (let i = 0; i < n; i++) s += R(x + 0.2 + i * cw + 0.02, y + 0.27, cw - 0.04, h - 0.33, cushion, '#b5ab9c', 0.01, 0.06);
    s += R(x, y + 0.04, 0.18, h - 0.04, body, null, 0, 0.07) + R(x + w - 0.18, y + 0.04, 0.18, h - 0.04, body, null, 0, 0.07);
    return s;
  }

  const ITEM = {
    'bed-double': (w, h) => bed(w, h, 2),
    'bed-single': (w, h) => bed(w, h, 1),
    'nightstand': (w, h) => R(-w / 2, -h / 2, w, h, '#a57f5b', '#7d5d3f', 0.012, 0.03) + Ci(0, 0.02, Math.min(w, h) * 0.22, '#f6e7b8', '#d8c28a', 0.01),
    'wardrobe': (w, h) => R(-w / 2, -h / 2, w, h, '#cfae86', '#8f6f4c', 0.015) + Ln(-w / 2, -h / 2 + 0.06, w / 2, -h / 2 + 0.06, '#8f6f4c', 0.012) + Ln(-w / 2 + 0.02, -h / 2 + 0.08, w / 2 - 0.02, h / 2 - 0.02, '#b8956c', 0.01) + Ln(w / 2 - 0.02, -h / 2 + 0.08, -w / 2 + 0.02, h / 2 - 0.02, '#b8956c', 0.01),
    'dresser': (w, h) => R(-w / 2, -h / 2, w, h, '#b8916a', '#80603f', 0.014, 0.02) + Ln(0, -h / 2, 0, h / 2, '#80603f', 0.01),
    'sofa': (w, h) => sofaShape(-w / 2, -h / 2, w, h, '#cdc6b9', '#e4ded2'),
    'sofa-l': (w, h) => {
      const d = 0.9;
      let s = R(-w / 2, -h / 2, w, d, '#cdc6b9', '#8f877b', 0.015, 0.1);
      s += R(w / 2 - d, -h / 2, d, h, '#cdc6b9', '#8f877b', 0.015, 0.1);
      s += R(-w / 2 + 0.04, -h / 2 + 0.04, w - 0.08, 0.2, '#e4ded2', null, 0, 0.06);
      s += R(w / 2 - 0.24, -h / 2 + 0.04, 0.2, h - 0.08, '#e4ded2', null, 0, 0.06);
      s += R(-w / 2 + 0.2, -h / 2 + 0.27, w - d - 0.22, d - 0.33, '#e4ded2', '#b5ab9c', 0.01, 0.06);
      s += R(w / 2 - d + 0.06, -h / 2 + 0.27, d - 0.33, h - 0.47, '#e4ded2', '#b5ab9c', 0.01, 0.06);
      s += R(-w / 2, -h / 2 + 0.04, 0.18, d - 0.04, '#cdc6b9', null, 0, 0.07);
      return s + R(w / 2 - d, h / 2 - 0.18, d, 0.18, '#cdc6b9', null, 0, 0.07);
    },
    'armchair': (w, h) => sofaShape(-w / 2, -h / 2, w, h, '#b9a68c', '#d9cab3'),
    'coffee-table': (w, h) => R(-w / 2, -h / 2, w, h, '#8c6a4a', '#5f4630', 0.014, 0.05) + R(-w / 2 + 0.08, -h / 2 + 0.08, w - 0.16, h - 0.16, '#9b7957', null, 0, 0.03),
    'tv-unit': (w, h) => R(-w / 2, -h / 2, w, h, '#6d5644', '#4a392b', 0.012, 0.02) + R(-w * 0.32, -h / 2 + 0.04, w * 0.64, 0.06, '#1f1f22', null, 0, 0.01),
    'rug': (w, h) => R(-w / 2, -h / 2, w, h, '#e8decd', '#cdbb9e', 0.02, 0.04) + R(-w / 2 + 0.12, -h / 2 + 0.12, w - 0.24, h - 0.24, 'none', '#cdb999', 0.015),
    'dining-6': (w, h) => dining(w, h, 3),
    'dining-4': (w, h) => dining(w, h, 2),
    'counter': (w, h) => R(-w / 2, -h / 2, w, h, '#dedcd6', '#8f8c86', 0.015) + Ln(-w / 2, -h / 2 + 0.03, w / 2, -h / 2 + 0.03, '#a8a49d', 0.01),
    'island': (w, h) => R(-w / 2, -h / 2, w, h, '#ebe9e4', '#8f8c86', 0.015, 0.03) + R(-w / 2 + 0.05, -h / 2 + 0.05, w - 0.1, h - 0.1, 'none', '#d0cdc6', 0.008, 0.02),
    'stools': (w, h) => { let s = ''; for (let i = 0; i < 3; i++) s += Ci(-w / 2 + w / 6 + (i * w) / 3, 0, Math.min(h, w / 3) * 0.42, '#9c7c5b', '#6e5239', 0.012); return s; },
    'stove': (w, h) => R(-w / 2, -h / 2, w, h, '#2b2b2e', '#111', 0.01, 0.02) + [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => Ci((a * w) / 4.4, (b * h) / 4.4, Math.min(w, h) * 0.13, 'none', '#777', 0.012)).join(''),
    'sink-kitchen': (w, h) => R(-w / 2, -h / 2, w, h, '#dedcd6', '#8f8c86', 0.012) + R(-w / 2 + 0.07, -h / 2 + 0.12, w - 0.14, h - 0.2, '#c7ccd1', '#8b9197', 0.012, 0.05) + Ci(0, -h / 2 + 0.06, 0.025, '#8b9197'),
    'fridge': (w, h) => R(-w / 2, -h / 2, w, h, '#e9ebee', '#8a9097', 0.015, 0.02) + Ln(-w / 2, -h / 2 + 0.1, w / 2, -h / 2 + 0.1, '#b9bec4', 0.01),
    'toilet': (w, h) => R(-w / 2, -h / 2, w, h * 0.28, '#fbfbfb', '#9aa3a9', 0.012, 0.03) + El(0, -h / 2 + h * 0.6, w / 2 - 0.01, h * 0.34, '#ffffff', '#9aa3a9', 0.012) + El(0, -h / 2 + h * 0.62, w / 2 - 0.07, h * 0.24, '#e8f0f3', null),
    'basin': (w, h) => R(-w / 2, -h / 2, w, h, '#f4f2ee', '#9aa3a9', 0.012, 0.03) + El(0, 0.03, w * 0.32, h * 0.3, '#e1ecf1', '#9aa3a9', 0.01) + Ci(0, -h / 2 + 0.06, 0.02, '#8b9197'),
    'vanity-double': (w, h) => R(-w / 2, -h / 2, w, h, '#f4f2ee', '#9aa3a9', 0.012, 0.03) + El(-w / 4, 0.03, w * 0.15, h * 0.3, '#e1ecf1', '#9aa3a9', 0.01) + El(w / 4, 0.03, w * 0.15, h * 0.3, '#e1ecf1', '#9aa3a9', 0.01),
    'shower': (w, h) => R(-w / 2, -h / 2, w, h, '#dcebf2', '#7ea4b6', 0.015) + Ln(-w / 2, -h / 2, w / 2, h / 2, '#a9c6d3', 0.01) + Ln(w / 2, -h / 2, -w / 2, h / 2, '#a9c6d3', 0.01) + Ci(0, 0, 0.04, '#7ea4b6'),
    'bathtub': (w, h) => R(-w / 2, -h / 2, w, h, '#fbfbfb', '#9aa3a9', 0.014, 0.12) + R(-w / 2 + 0.08, -h / 2 + 0.08, w - 0.16, h - 0.16, '#dcecf3', '#a9c6d3', 0.01, 0.18),
    'washer': (w, h) => R(-w / 2, -h / 2, w, h, '#f1f2f4', '#8a9097', 0.014, 0.03) + Ci(0, 0.03, Math.min(w, h) * 0.3, '#cfd8de', '#8a9097', 0.012),
    'desk': (w, h) => R(-w / 2, -h / 2, w, h, '#c6a47c', '#80603f', 0.014, 0.02) + R(-0.25, -h / 2 + 0.06, 0.5, 0.05, '#2b2b2e', null, 0, 0.01),
    'chair': (w, h) => R(-w / 2, -h / 2, w, h, '#4a4f57', '#2f3237', 0.012, 0.08) + R(-w / 2, -h / 2, w, h * 0.22, '#363a40', null, 0, 0.05),
    'bookshelf': (w, h) => { let s = R(-w / 2, -h / 2, w, h, '#a8835e', '#6f5238', 0.014); const c = ['#c85d4a', '#3f6e9c', '#d9b04a', '#5f8f62', '#e6ddd0']; for (let i = 0; i < 7; i++) s += R(-w / 2 + 0.04 + (i * (w - 0.08)) / 7, -h / 2 + 0.05, (w - 0.08) / 7 - 0.01, h - 0.1, c[i % 5], null); return s; },
    'car': (w, h) => {
      let s = R(-w / 2, -h / 2, w, h, 'url(#g-car)', '#8a9097', 0.02, 0.45);
      s += '<path d="M' + f(-w / 2 + 0.14) + ' ' + f(h * 0.12) + ' Q0 ' + f(h * 0.06) + ' ' + f(w / 2 - 0.14) + ' ' + f(h * 0.12) + ' L' + f(w / 2 - 0.22) + ' ' + f(h * 0.25) + ' Q0 ' + f(h * 0.21) + ' ' + f(-w / 2 + 0.22) + ' ' + f(h * 0.25) + 'Z" fill="#3c4650"/>';
      s += '<path d="M' + f(-w / 2 + 0.2) + ' ' + f(-h * 0.3) + ' Q0 ' + f(-h * 0.34) + ' ' + f(w / 2 - 0.2) + ' ' + f(-h * 0.3) + ' L' + f(w / 2 - 0.25) + ' ' + f(-h * 0.22) + ' Q0 ' + f(-h * 0.25) + ' ' + f(-w / 2 + 0.25) + ' ' + f(-h * 0.22) + 'Z" fill="#3c4650"/>';
      s += R(-w / 2 + 0.24, -h * 0.2, w - 0.48, h * 0.3, '#e6e9ec', '#b6bcc2', 0.012, 0.12);
      s += El(-w / 2 + 0.25, h * 0.44, 0.12, 0.05, '#fff7d1') + El(w / 2 - 0.25, h * 0.44, 0.12, 0.05, '#fff7d1');
      return s;
    },
    'lounger': (w, h) => R(-w / 2, -h / 2, w, h, '#f1eee8', '#8f877b', 0.014, 0.08) + R(-w / 2 + 0.05, -h / 2 + 0.05, w - 0.1, h * 0.32, '#e0d8ca', null, 0, 0.06) + Ln(-w / 2, -h / 2 + h * 0.4, w / 2, -h / 2 + h * 0.4, '#b5ab9c', 0.01),
    'outdoor-table': (w, h) => {
      const r = Math.min(w, h) / 2;
      let s = '';
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; s += chair(Math.cos(a) * (r - 0.22), Math.sin(a) * (r - 0.22), (i * 90 + 90) % 360, '#d8d2c6'); }
      return s + Ci(0, 0, r * 0.5, '#b58b5e', '#7d5d3f', 0.015) + Ci(0, 0, r * 0.08, '#e9e3d6');
    },
    'outdoor-sofa': (w, h) => sofaShape(-w / 2, -h / 2, w, h, '#8f9894', '#dfe5e2'),
    'bbq': (w, h) => { let s = R(-w / 2, -h / 2, w, h, '#3b3d40', '#1e1f21', 0.014, 0.03); for (let i = 1; i < 6; i++) s += Ln(-w / 2 + 0.08, -h / 2 + (i * h) / 6, w * 0.15, -h / 2 + (i * h) / 6, '#777', 0.01); return s + R(w * 0.2, -h / 2 + 0.06, w * 0.25, h - 0.12, '#55585c', null, 0, 0.02); },
    'bench': (w, h) => { let s = ''; for (let i = 0; i < 4; i++) s += R(-w / 2, -h / 2 + (i * h) / 4 + 0.01, w, h / 4 - 0.02, '#b58b5e', '#7d5d3f', 0.01, 0.01); return s; },
    'planter': (w, h) => { const r = Math.min(w, h) / 2; return Ci(0, 0, r, '#b8835a', '#7d5a3c', 0.015) + Ci(-r * 0.2, -r * 0.15, r * 0.55, 'url(#g-shrub)') + Ci(r * 0.25, r * 0.1, r * 0.5, 'url(#g-shrub)'); }
  };

  function bed(w, h, pillows) {
    const x = -w / 2, y = -h / 2;
    let s = R(x, y, w, h, '#f8f6f1', '#a39b8e', 0.015, 0.04);
    s += R(x, y, w, 0.08, '#8a6a4c', null, 0, 0.02);
    const pw = (w - 0.1 - pillows * 0.08) / pillows;
    for (let i = 0; i < pillows; i++) s += R(x + 0.09 + i * (pw + 0.08), y + 0.14, pw, 0.32, '#ffffff', '#cfc8bb', 0.012, 0.07);
    s += R(x + 0.02, y + h * 0.36, w - 0.04, h * 0.62, '#cbb89f', '#a8957c', 0.012, 0.03);
    s += R(x + 0.02, y + h * 0.36, w - 0.04, 0.14, '#ddd0bd', null, 0, 0.03);
    return s;
  }
  function dining(w, h, perSide) {
    const tw = w - 0.8, th = h - 0.8;
    let s = '';
    for (let i = 0; i < perSide; i++) {
      const cx = -tw / 2 + (tw * (i + 0.5)) / perSide;
      s += chair(cx, -h / 2 + 0.22, 0) + chair(cx, h / 2 - 0.22, 180);
    }
    return s + R(-tw / 2, -th / 2, tw, th, '#b48a5f', '#7a5a3b', 0.015, 0.03) + R(-tw / 2 + 0.05, -th / 2 + 0.05, tw - 0.1, th - 0.1, '#bd956a', null, 0, 0.02);
  }

  function itemSvg(it) {
    const fn = ITEM[it.kind];
    const body = fn ? fn(it.w, it.h) : R(-it.w / 2, -it.h / 2, it.w, it.h, '#e6e1d8', '#8f877b', 0.015);
    return '<g data-k="item" data-id="' + it.id + '" transform="translate(' + f(it.x) + ' ' + f(it.y) + ') rotate(' + f(it.rot || 0) + ')">' +
      R(-it.w / 2, -it.h / 2, it.w, it.h, 'transparent') + body + '</g>';
  }

  /* ---------- plants ---------- */
  function plantSvg(pl, render) {
    const r = pl.r, rnd = rng(pl.id);
    let s = '<g data-k="plant" data-id="' + pl.id + '" transform="translate(' + f(pl.x) + ' ' + f(pl.y) + ')">';
    if (!render) {
      const dash = pl.kind === 'shrub' || pl.kind === 'flowers' ? '' : ' stroke-dasharray=".18 .1"';
      s += '<circle r="' + f(r) + '" fill="#7fae5a" fill-opacity=".18" stroke="' + PL.plant + '" stroke-width=".03"' + dash + '/>';
      s += Ln(-r * 0.25, 0, r * 0.25, 0, PL.plant, 0.025) + Ln(0, -r * 0.25, 0, r * 0.25, PL.plant, 0.025);
      return s + '</g>';
    }
    if (pl.kind === 'palm') {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i * 360) / n + rnd() * 18;
        const l = r * (0.85 + rnd() * 0.15);
        s += '<g transform="rotate(' + f(a) + ')"><path d="M0 0Q' + f(l * 0.5) + ' ' + f(-l * 0.2) + ' ' + f(l) + ' 0Q' + f(l * 0.5) + ' ' + f(l * 0.2) + ' 0 0Z" fill="url(#g-palm)" stroke="#456f2a" stroke-width=".02"/>' + Ln(0, 0, l * 0.95, 0, '#3f6b2a', 0.02) + '</g>';
      }
      s += Ci(0, 0, r * 0.12, '#7a5a3a', '#5a3f27', 0.02);
    } else if (pl.kind === 'conifer') {
      let d = '';
      for (let i = 0; i < 24; i++) { const a = (i * Math.PI) / 12, rr = i % 2 ? r * 0.72 : r; d += (i ? 'L' : 'M') + f(Math.cos(a) * rr) + ' ' + f(Math.sin(a) * rr); }
      s += '<path d="' + d + 'Z" fill="url(#g-conifer)" stroke="#264f29" stroke-width=".02"/>';
      s += Ci(0, 0, r * 0.35, '#4e8a4c', null) + Ci(0, 0, r * 0.08, '#6a4a2e');
    } else if (pl.kind === 'shrub' || pl.kind === 'flowers') {
      const n = pl.kind === 'shrub' ? 5 : 4;
      for (let i = 0; i < n; i++) { const a = (i * 2 * Math.PI) / n + rnd(); s += Ci(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, r * (0.5 + rnd() * 0.15), 'url(#g-shrub)'); }
      if (pl.kind === 'flowers') {
        const cols = ['#f2a7c3', '#f7d35b', '#ffffff', '#e86a8a', '#c39bf0'];
        for (let i = 0; i < 9; i++) { const a = rnd() * 2 * Math.PI, d = rnd() * r * 0.7; s += Ci(Math.cos(a) * d, Math.sin(a) * d, r * 0.13, pick(rnd, cols)); }
      }
    } else {
      const grad = pl.kind === 'fruit' ? 'url(#g-fruit)' : 'url(#g-tree)';
      const n = 7 + Math.floor(rnd() * 3);
      s += Ci(0, 0, r * 0.62, grad);
      for (let i = 0; i < n; i++) {
        const a = (i * 2 * Math.PI) / n + rnd() * 0.4;
        s += Ci(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48, r * (0.46 + rnd() * 0.08), grad);
      }
      s += Ci(-r * 0.1, -r * 0.12, r * 0.4, grad);
      if (pl.kind === 'fruit') for (let i = 0; i < 8; i++) { const a = rnd() * 2 * Math.PI, d = rnd() * r * 0.8; s += Ci(Math.cos(a) * d, Math.sin(a) * d, 0.07, pick(rnd, ['#e8873a', '#d94f3b', '#f0b13c'])); }
    }
    return s + '</g>';
  }

  /* ---------- walls & openings ---------- */
  function wallSvg(p, w, render) {
    const v = M.wallVec(w);
    const ops = p.openings.filter((o) => o.wall === w.id).map((o) => M.openingGeo(p, o)).filter(Boolean).sort((a, b) => a.from - b.from);
    let iv = [[0, v.L]];
    for (const g of ops) iv = G.subtract(iv, g.from, g.to);
    const h = w.t / 2;
    let s = '<g data-k="wall" data-id="' + w.id + '">';
    for (const [a, b] of iv) {
      if (b - a < 0.005) continue;
      const s0 = a - (a < 1e-6 ? h : 0), s1 = b + (b > v.L - 1e-6 ? h : 0);
      const P = (d, k) => ({ x: v.a.x + v.ux * d + v.nx * k, y: v.a.y + v.uy * d + v.ny * k });
      s += '<polygon points="' + ptsAttr([P(s0, -h), P(s1, -h), P(s1, h), P(s0, h)]) + '" fill="' + (render ? '#2c2b29' : (w.kind === 'exterior' ? PL.wallExt : PL.wallInt)) + '"/>';
    }
    return s + '</g>';
  }

  function openingSvg(p, o, render) {
    const g = M.openingGeo(p, o);
    if (!g) return '';
    const { v, t } = g, h = t / 2;
    const P = (pt, k) => ({ x: pt.x + v.nx * k, y: pt.y + v.ny * k });
    let s = '<g data-k="opening" data-id="' + o.id + '">';
    s += '<polygon points="' + ptsAttr([P(g.s, -h - 0.15), P(g.e, -h - 0.15), P(g.e, h + 0.15), P(g.s, h + 0.15)]) + '" fill="transparent"/>';
    if (o.type === 'window') {
      s += '<polygon points="' + ptsAttr([P(g.s, -h), P(g.e, -h), P(g.e, h), P(g.s, h)]) + '" fill="' + (render ? '#bfe4f3' : PL.glass) + '" stroke="#5f9bb5" stroke-width=".015"/>';
      s += Ln(P(g.s, -h * 0.25).x, P(g.s, -h * 0.25).y, P(g.e, -h * 0.25).x, P(g.e, -h * 0.25).y, '#5f9bb5', 0.012);
      s += Ln(P(g.s, h * 0.25).x, P(g.s, h * 0.25).y, P(g.e, h * 0.25).x, P(g.e, h * 0.25).y, '#5f9bb5', 0.012);
    } else if (o.type === 'sliding') {
      const half = o.w / 2 + 0.04;
      const m1 = { x: g.s.x + v.ux * half, y: g.s.y + v.uy * half }, m2 = { x: g.e.x - v.ux * half, y: g.e.y - v.uy * half };
      const panel = (a, b, k) => '<polygon points="' + ptsAttr([P(a, k - 0.025), P(b, k - 0.025), P(b, k + 0.025), P(a, k + 0.025)]) + '" fill="#cfe8f3" stroke="#5f9bb5" stroke-width=".012"/>';
      s += panel(g.s, m1, -0.035) + panel(m2, g.e, 0.035);
    } else if (o.type === 'door') {
      const side = o.side || 1;
      const H = o.hinge === 'end' ? g.e : g.s, other = o.hinge === 'end' ? g.s : g.e;
      const tip = { x: H.x + v.nx * side * o.w, y: H.y + v.ny * side * o.w };
      const cross = (tip.x - H.x) * (other.y - H.y) - (tip.y - H.y) * (other.x - H.x);
      s += Ln(H.x, H.y, tip.x, tip.y, render ? '#7a5c40' : PL.door, render ? 0.05 : 0.035);
      s += '<path d="M' + f(tip.x) + ' ' + f(tip.y) + 'A' + f(o.w) + ' ' + f(o.w) + ' 0 0 ' + (cross > 0 ? 1 : 0) + ' ' + f(other.x) + ' ' + f(other.y) + '" fill="none" stroke="' + (render ? '#8d8172' : PL.arc) + '" stroke-width=".015"' + (render ? '' : ' stroke-dasharray=".08 .05"') + '/>';
    } else if (!render) {
      s += Ln(P(g.s, -h).x, P(g.s, -h).y, P(g.e, -h).x, P(g.e, -h).y, PL.passage, 0.012).replace('/>', ' stroke-dasharray=".1 .08"/>');
      s += Ln(P(g.s, h).x, P(g.s, h).y, P(g.e, h).x, P(g.e, h).y, PL.passage, 0.012).replace('/>', ' stroke-dasharray=".1 .08"/>');
    }
    return s + '</g>';
  }

  /* ---------- labels & dimensions ---------- */
  function roomLabel(p, r, render) {
    const b = G.bbox(r.pts), c = G.labelPoint(r.pts);
    const fs = Math.max(0.16, Math.min(0.32, Math.min(b.w, b.h) / 6));
    // sizes and areas are clear, inside the walls
    const size = M.clearSize(p, r), area = M.clearArea(p, r);
    // every room shows length × width (overall extents for L-shapes) and its usable area
    const line2 = size ? fm(size.w) + ' × ' + fm(size.h) + ' m' + (size.rect ? '' : ' overall') : '';
    const line3 = area.toFixed(1) + ' m² usable';
    const fill = render ? '#2f2a24' : PL.text;
    const halo = render ? '#fbf8f2' : PL.halo;
    let s = '<g class="lbl" text-anchor="middle" font-family="Avenir Next, Helvetica Neue, Arial, sans-serif" paint-order="stroke" stroke="' + halo + '" stroke-width="' + f(fs * 0.28) + '" stroke-linejoin="round" pointer-events="none">';
    s += '<text x="' + f(c.x) + '" y="' + f(c.y - fs * 0.15) + '" font-size="' + f(fs) + '" font-weight="600" fill="' + fill + '">' + esc(r.name) + '</text>';
    s += '<text x="' + f(c.x) + '" y="' + f(c.y + fs * 0.95) + '" font-size="' + f(fs * 0.78) + '" fill="' + fill + '">' + line2 + '</text>';
    s += '<text x="' + f(c.x) + '" y="' + f(c.y + fs * 1.9) + '" font-size="' + f(fs * 0.7) + '" fill="' + (render ? '#5c5348' : PL.textSoft) + '">' + line3 + '</text>';
    return s + '</g>';
  }

  function dimLine(x1, y1, x2, y2, label, side) {
    const horiz = Math.abs(y2 - y1) < 1e-6;
    const tick = (x, y) => Ln(x - 0.12, y + 0.12, x + 0.12, y - 0.12, PL.text, 0.025);
    let s = Ln(x1, y1, x2, y2, PL.text, 0.02) + tick(x1, y1) + tick(x2, y2);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const fs = 0.3;
    if (horiz) s += '<text x="' + f(mx) + '" y="' + f(my - 0.12 * side) + '" dominant-baseline="' + (side > 0 ? 'auto' : 'hanging') + '" font-size="' + fs + '" text-anchor="middle">' + label + '</text>';
    else s += '<text transform="translate(' + f(mx - 0.12 * side) + ' ' + f(my) + ') rotate(-90)" dominant-baseline="' + (side > 0 ? 'auto' : 'hanging') + '" font-size="' + fs + '" text-anchor="middle">' + label + '</text>';
    return s;
  }

  // A chain of dimensions between wall faces. Every wall adds both faces as stops, so spans read as
  // clear sizes inside the walls; the short stretch across a wall gets ticks but no number.
  function faceStops(lines, lo, hi) {
    const v = [lo, hi];
    for (const [c, t] of lines) v.push(c - t / 2, c + t / 2);
    const out = [];
    for (const x of v.filter((u) => u >= lo - 1e-6 && u <= hi + 1e-6).sort((u, w) => u - w)) if (!out.length || x - out[out.length - 1] > 0.005) out.push(x);
    return out;
  }
  function chain(stops, fixed, horiz, side) {
    let s = '';
    for (let i = 0; i + 1 < stops.length; i++) {
      const a = stops[i], b = stops[i + 1];
      const lbl = b - a >= 0.35 ? fm(b - a) : '';
      s += horiz ? dimLine(a, fixed, b, fixed, lbl, side) : dimLine(fixed, a, fixed, b, lbl, side);
    }
    return s;
  }

  function dimensions(p) {
    const hb = M.houseBounds(p);
    let s = '<g class="dims" font-family="Avenir Next, Helvetica Neue, Arial, sans-serif" fill="' + PL.text + '" paint-order="stroke" stroke-linejoin="round" pointer-events="none">';
    s += dimLine(0, -1.1, p.lot.w, -1.1, fm(p.lot.w) + ' m', 1);
    s += dimLine(-1.1, 0, -1.1, p.lot.h, fm(p.lot.h) + ' m', 1);
    if (hb && p.walls.length) {
      // wall lines and the thickest wall on each
      const vx = new Map(), hy = new Map();
      for (const w of p.walls) {
        if (Math.abs(w.x1 - w.x2) < 1e-6) vx.set(w.x1, Math.max(vx.get(w.x1) || 0, w.t));
        if (Math.abs(w.y1 - w.y2) < 1e-6) hy.set(w.y1, Math.max(hy.get(w.y1) || 0, w.t));
      }
      // overall size to the outer faces of the outermost walls
      const ext = (lines, lo, hi) => { let a = lo, b = hi; for (const [c, t] of lines) { a = Math.min(a, c - t / 2); b = Math.max(b, c + t / 2); } return [a, b]; };
      const [x0, x1] = ext(vx, hb.x, hb.x + hb.w), [y0, y1] = ext(hy, hb.y, hb.y + hb.h);
      s += dimLine(x0, y0 - 1.0, x1, y0 - 1.0, fm(x1 - x0) + ' m', 1);
      s += dimLine(x0 - 1.0, y0, x0 - 1.0, y1, fm(y1 - y0) + ' m', 1);
      const sx = faceStops(vx, x0, x1), sy = faceStops(hy, y0, y1);
      if (sx.length <= 48) s += chain(sx, y1 + 1.0, true, -1);
      if (sy.length <= 48) s += chain(sy, x1 + 1.0, false, -1);
    }
    return s + '</g>';
  }

  /* ---------- scene ---------- */
  // opts: { mode: 'plan'|'render', dims: bool, layers: { house, furniture, landscape } }
  function scene(p, opts) {
    opts = opts || {};
    const render = opts.mode === 'render';
    const L = Object.assign({ house: true, furniture: true, landscape: true }, opts.layers || {});
    const W = p.lot.w, H = p.lot.h;
    const dark = opts.theme === 'dark';
    PL = dark ? PAL.dark : PAL.light;
    const surround = render ? (dark ? '#191b1e' : '#e7e9e1') : PL.bg;
    let s = opts.noDefs ? '' : defs();

    s += '<rect x="-60" y="-60" width="' + f(W + 120) + '" height="' + f(H + 120) + '" fill="' + surround + '"/>';
    if (render) {
      s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#pat-grass)"/>';
    } else {
      s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + PL.lot + '"/>';
      s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + PL.grid + '"/><rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + PL.grid5 + '"/>';
    }
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none" stroke="' + (render ? '#7d6b55' : PL.lotEdge) + '" stroke-width=".06" stroke-dasharray="' + (render ? '0' : '.4 .2') + '"/>';

    if (L.landscape) {
      s += '<g class="areas">';
      for (const a of p.areas) {
        const fill = render ? GROUND_FILL[a.material] || '#ccc' : (C.materials[a.material] || {}).flat || '#ccc';
        s += '<g data-k="area" data-id="' + a.id + '">';
        s += '<polygon points="' + ptsAttr(a.pts) + '" fill="' + fill + '"' + (render ? '' : ' stroke="' + PL.areaEdge + '" stroke-width=".02"' + (dark ? ' fill-opacity=".35"' : '')) + '/>';
        if (render && a.material === 'water') s += '<polygon points="' + ptsAttr(a.pts) + '" fill="url(#pat-water)" stroke="#eeeae0" stroke-width=".22"/>';
        if (render && a.material === 'hedge') s += '<polygon points="' + ptsAttr(a.pts) + '" fill="none" stroke="#3d6329" stroke-width=".04"/>';
        s += '</g>';
      }
      s += '</g>';
    }

    if (L.house) {
      s += '<g class="rooms">';
      for (const r of p.rooms) {
        const k = C.roomKinds[r.kind] || C.roomKinds.other;
        s += '<g data-k="room" data-id="' + r.id + '">';
        if (render) {
          s += '<polygon points="' + ptsAttr(r.pts) + '" fill="' + esc(M.floorColor(r)) + '"/>';
          if (C.floors[r.floor]) s += '<polygon points="' + ptsAttr(r.pts) + '" fill="url(#ov-' + r.floor + ')"/>';
          if (r.use === 'covered') s += '<polygon points="' + ptsAttr(r.pts) + '" fill="none" stroke="#8b7a63" stroke-width=".05" stroke-dasharray=".25 .15"/>';
        } else {
          s += '<polygon points="' + ptsAttr(r.pts) + '" fill="' + k.tint + '" fill-opacity="' + f(PL.tintAlpha * (r.use === 'outdoor' ? 0.55 : 1)) + '" stroke="' + PL.roomEdge + '" stroke-width=".02"' + (r.use === 'indoor' ? '' : ' stroke-dasharray=".2 .12"') + '/>';
          if (r.use === 'covered') s += '<polygon points="' + ptsAttr(r.pts) + '" fill="url(#' + (dark ? 'pat-hatch-d' : 'pat-hatch') + ')" pointer-events="none"/>';
        }
        s += '</g>';
      }
      s += '</g>';
    }

    if (L.furniture) {
      s += '<g class="items"' + (render ? ' filter="url(#sh-item)"' : '') + '>';
      for (const it of p.items) s += itemSvg(it);
      s += '</g>';
    }

    if (L.house) {
      s += '<g class="walls"' + (render ? ' filter="url(#sh-wall)"' : '') + '>';
      for (const w of p.walls) s += wallSvg(p, w, render);
      s += '</g><g class="openings">';
      for (const o of p.openings) s += openingSvg(p, o, render);
      s += '</g>';
    }

    if (L.landscape) {
      s += '<g class="plants"' + (render ? ' filter="url(#sh-tree)"' : '') + '>';
      for (const pl of p.plants) s += plantSvg(pl, render);
      s += '</g>';
    }

    if (L.house) {
      s += '<g class="labels">';
      for (const r of p.rooms) s += roomLabel(p, r, render);
      s += '</g>';
    }
    if (opts.dims !== false) s += dimensions(p).replace('paint-order', 'stroke="' + surround + '" stroke-width=".08" paint-order');
    return s;
  }

  // A standalone SVG document of the whole lot, for export.
  function documentSvg(p, opts) {
    const pad = 2.6;
    const x = -pad, y = -pad, w = p.lot.w + pad * 2, h = p.lot.h + pad * 2;
    const ppm = (opts && opts.pxPerM) || 60;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(w * ppm) + '" height="' + Math.round(h * ppm) + '" viewBox="' + f(x) + ' ' + f(y) + ' ' + f(w) + ' ' + f(h) + '">' + scene(p, opts) + '</svg>';
  }

  FP.draw = { scene, documentSvg, itemSvg, plantSvg, defs, fm };
})();
