// 3D view built from the same project data as the plan.
// Plan (x, y) maps to 3D (x, z); y is up. Furniture rot r (clockwise in plan) is rotation.y = -r.
// Modes: orbit ("dollhouse") and walk (first person with wall collision). Plan up is north.
window.FP = window.FP || {};

(function () {
  const M = FP.model, G = FP.geom, C = FP.catalog;
  const A = () => FP.app;
  const S = () => FP.app.state;
  const LAYER_OF = { wall: 'house', opening: 'house', room: 'house', item: 'furniture', area: 'landscape', plant: 'landscape' };
  const BODY = 0.22;
  const FLOOR = 0.04; // finished floor level; ground surfaces sit just above 0, furniture on the floor

  /* ---------- walkthrough preferences ---------- */
  const pref = (key, def, lo, hi) => { try { const v = parseFloat(localStorage.getItem(key)); return v >= lo && v <= hi ? v : def; } catch (e) { return def; } };
  const save = (key, v) => { try { localStorage.setItem(key, String(v)); } catch (e) { /* storage unavailable */ } };
  // Person: eye level is about 11 cm below the top of the head; pace is a normal indoor stroll.
  let personH = pref('fp.height', 1.72, 1.2, 2.2);
  let pace = pref('fp.pace', 1.2, 0.6, 2.5);
  // Lens: "wide" is a Panini projection (very wide view, edges not stretched); "normal" is a plain camera lens.
  let lens = 'wide';
  try { if (localStorage.getItem('fp.lens') === 'normal') lens = 'normal'; } catch (e) { /* storage unavailable */ }
  let fovWide = pref('fp.fovw', 130, 90, 160);
  let fovNormal = pref('fp.fov', 100, 60, 120);
  // Size feel: rooms on a flat screen read about 20% smaller than in person. Walking at feel k is the same
  // picture as the house scaled up by k (game studios build interiors 20–30% larger for this reason).
  // The model never changes; only eye height, pace and body width shrink by 1/k.
  let feel = pref('fp.feel', 1.2, 1, 1.5);
  // Straight verticals: looking up or down shifts the lens (two-point perspective) instead of tilting.
  let straight = pref('fp.straight', 1, 0, 1) > 0.5;
  // Time of day for the sun, 6:00–19:00.
  let hour = pref('fp.time', 14, 6, 19);
  const eye = () => FLOOR + (personH - 0.11) / feel;

  let T = null; // THREE, resolved lazily so the plan still works if WebGL is unavailable
  let host, renderer, scene, camera, root, hemi, fill, sun, sky, post = null, pmrem = null, envRT = null, envScene = null, selHelper = null;
  let active = false, raf = 0, last = 0, dirty = true;
  let showRoof = false;
  const wallGroups = new Map();
  let collide = [];
  const orbit = { tx: 15, ty: 0, tz: 20, dist: 45, az: 0.7, pol: 0.95 };
  const walk = { on: false, locked: false, x: 0, z: 0, yaw: 0, pitch: 0, shift: 0, keys: {} };
  let gesture = null;
  const mats = new Map(), texs = new Map();

  /* ---------- small helpers ---------- */
  // mulberry32: well-mixed, so scattered specks and grain carry no hidden lattice that could alias into stripes
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash = (str) => str.split('').reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  function mat(color, o) {
    const key = color + JSON.stringify(o || {});
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0 }, o || {})));
    return mats.get(key);
  }
  function tag(obj, k, id) { obj.traverse((c) => { c.userData.k = k; c.userData.id = id; }); return obj; }
  function shadows(obj, cast) { obj.traverse((c) => { if (c.isMesh) { c.castShadow = cast !== false; c.receiveShadow = true; } }); return obj; }

  // Colour helpers for texture drawing. f < 0 darkens toward black, f > 0 lightens toward white.
  function hexRgb(h) { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const toneRgb = (h, f) => hexRgb(h).map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  function tone(h, f, a) { const c = toneRgb(h, f); return a == null ? 'rgb(' + c + ')' : 'rgba(' + c + ',' + a + ')'; }
  const toneHex = (h, f) => '#' + toneRgb(h, f).map((v) => v.toString(16).padStart(2, '0')).join('');
  const vary = (h, r, amt) => tone(h, (r() * 2 - 1) * amt);

  // Detail level: 0 low, 1 medium, 2 high. Drives texture resolution, relief, trim, lighting and post-processing.
  let quality = 1;
  try { const v = parseInt(localStorage.getItem('fp.detail'), 10); if (v >= 0 && v <= 2) quality = v; } catch (e) { /* storage unavailable */ }
  const TEX_SIZE = [256, 512, 1024];
  // Relief strength at High, as a normal map built from each texture's brightness. Only coarse features
  // (seams, grout, mortar, tiles) get relief; fine grain and fabric stay flat so nothing shimmers at an angle.
  const RELIEF = {
    wood: 1, wideplank: 1.2, chevron: 1, deck: 1.5, tile: 1.5, porcelain: 1, stone: 1.5, slate: 2, pavers: 2,
    'x-stucco': 1.2, 'x-brick': 2.5, 'x-stone': 3, 'x-siding': 2.5, 'x-batten': 2.5, 'x-concrete': 1,
    'r-clay': 3, 'r-tile': 2.5, 'r-slate': 2.5, 'r-shingle': 2.5, 'r-metal': 1.5, bark: 1.5
  };
  // [roughness, metalness] per finish
  const ROUGH = {
    wood: [0.55], wideplank: [0.6], chevron: [0.5], deck: [0.8], tile: [0.35], porcelain: [0.22], marble: [0.1], terrazzo: [0.3],
    stone: [0.6], slate: [0.7], carpet: [1], concrete: [0.45], pavers: [0.8],
    'x-render': [0.92], 'x-stucco': [0.95], 'x-brick': [0.9], 'x-stone': [0.9], 'x-siding': [0.75], 'x-batten': [0.75], 'x-concrete': [0.85],
    'r-clay': [0.75], 'r-tile': [0.8], 'r-slate': [0.55], 'r-shingle': [0.95], 'r-metal': [0.35, 0.55], 'r-membrane': [0.95]
  };
  const GROUND = { concrete: '#cfcdc7', pavers: '#e0cdb0', deck: '#b68858', gravel: '#d9d0bf', mulch: '#86603e', sand: '#ebdcb4', grass: '#7dac57' };

  // Grain: lines at uneven spacing and strength. Evenly spaced lines would beat against the screen's pixels
  // into moiré stripes on surfaces seen at an angle.
  function grainLines(g, r, x, y, w, h, u, color, vertical) {
    g.strokeStyle = color;
    const n = Math.max(2, Math.round((vertical ? w : h) / (5 * u)));
    for (let j = 0; j < n; j++) {
      const ph = r() * 6, at = (j + 0.5 + (r() - 0.5) * 0.8) / n;
      g.globalAlpha = 0.35 + r() * 0.65;
      g.lineWidth = (0.5 + r() * 0.8) * u;
      g.beginPath();
      if (vertical) {
        const xx = x + at * w;
        g.moveTo(xx, y);
        for (let yy = y; yy <= y + h; yy += 10 * u) g.lineTo(xx + Math.sin(yy / (40 * u) + ph) * 1.2 * u, yy);
      } else {
        const yy = y + at * h;
        g.moveTo(x, yy);
        for (let xx = x; xx <= x + w; xx += 10 * u) g.lineTo(xx, yy + Math.sin(xx / (40 * u) + ph) * 1.2 * u);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  function speckle(g, s, r, n, size, colors) {
    for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; g.fillRect(r() * s, r() * s, size, size); }
  }
  function clouds(g, s, r, n, rad, color) {
    for (let i = 0; i < n; i++) { g.fillStyle = color; g.beginPath(); g.arc(r() * s, r() * s, rad * (0.4 + r()), 0, 7); g.fill(); }
  }
  // Rows of planks; lengths are fractions of the texture.
  function planks(g, s, r, u, q, c, rows, len, knots) {
    const rh = s / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * s * 0.5;
      while (x < s) {
        const l = s * (len[0] + r() * (len[1] - len[0]));
        g.fillStyle = vary(c, r, 0.09);
        g.fillRect(x, i * rh, l, rh);
        if (q > 0) grainLines(g, r, x, i * rh, l, rh, u, tone(c, -0.4, 0.2));
        if (q > 0 && knots && r() < 0.35) { g.fillStyle = tone(c, -0.4, 0.45); g.beginPath(); g.ellipse(x + r() * l, i * rh + rh * (0.3 + r() * 0.4), 5 * u, 2.5 * u, 0, 0, 7); g.fill(); }
        g.fillStyle = tone(c, -0.5, 0.55); g.fillRect(x, i * rh, 1.5 * u, rh);
        x += l;
      }
      g.fillStyle = tone(c, -0.5, 0.6); g.fillRect(0, i * rh, s, 1.2 * u);
    }
  }
  // cols × rows tiles with grout; stagger offsets every other row by half a tile. Colours repeat across the wrap.
  function tileGrid(g, s, r, u, cols, rows, c, amt, grout, gw, stagger) {
    const tw = s / cols, th = s / rows;
    for (let j = 0; j < rows; j++) {
      const shades = Array.from({ length: cols }, () => vary(c, r, amt));
      const off = stagger && j % 2 ? tw / 2 : 0;
      for (let i = 0; i <= cols; i++) { g.fillStyle = shades[i % cols]; g.fillRect(i * tw - off, j * th, tw, th); }
      g.fillStyle = grout;
      g.fillRect(0, j * th, s, gw * u);
      for (let i = 0; i <= cols; i++) g.fillRect(i * tw - off, j * th, gw * u, th);
    }
  }

  // Canvas textures: draw(g, size, rnd, u, k, quality, base colour). Floors, finishes and roofs are drawn in their
  // base colour and tile in metres (m); trims (plaster, grain, weave, bark) are near-white and tinted by the material.
  const TEX = {
    grass: { m: 2.5, draw(g, s, r, u, k) {
      g.fillStyle = '#7dac57'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 18 * k; i++) { g.fillStyle = i % 2 ? 'rgba(95,141,61,.35)' : 'rgba(148,192,106,.3)'; g.beginPath(); g.arc(r() * s, r() * s, (10 + r() * 30) * u, 0, 7); g.fill(); }
      g.lineWidth = 1.2 * u;
      for (let i = 0; i < 900 * k; i++) { g.strokeStyle = ['#6b9a46', '#94c06a', '#88b55f', '#5f8d3d', '#a3cc78'][i % 5]; const x = r() * s, y = r() * s; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3 * u, y - (3 + r() * 5) * u); g.stroke(); }
    } },
    wood: { m: 2.16, draw(g, s, r, u, k, q, c) { planks(g, s, r, u, q, c, 12, [0.3, 0.7]); } },
    wideplank: { m: 2.4, draw(g, s, r, u, k, q, c) { planks(g, s, r, u, q, c, 8, [0.5, 0.95], true); } },
    chevron: { m: 1.2, draw(g, s, r, u, k, q, c) {
      const cols = 2, cw = s / cols, n = 12, bw = s / n, d = cw / 2;
      const shades = Array.from({ length: cols * n * 2 }, () => vary(c, r, 0.1));
      g.strokeStyle = tone(c, -0.5, 0.5); g.lineWidth = 1.2 * u;
      for (let ci = 0; ci < cols; ci++) for (let j = -n; j < 2 * n; j++) for (const side of [0, 1]) {
        const x0 = ci * cw + side * d, x1 = x0 + d, y0 = j * bw;
        g.fillStyle = shades[((ci * n + ((j % n) + n) % n) * 2) + side];
        g.beginPath();
        if (!side) { g.moveTo(x0, y0 + d); g.lineTo(x1, y0); g.lineTo(x1, y0 + bw); g.lineTo(x0, y0 + d + bw); }
        else { g.moveTo(x0, y0); g.lineTo(x1, y0 + d); g.lineTo(x1, y0 + d + bw); g.lineTo(x0, y0 + bw); }
        g.closePath(); g.fill(); g.stroke();
      }
    } },
    deck: { m: 1.6, draw(g, s, r, u, k, q, c) {
      const rows = 10, rh = s / rows;
      for (let i = 0; i < rows; i++) {
        g.fillStyle = vary(c, r, 0.08); g.fillRect(0, i * rh, s, rh);
        if (q > 0) grainLines(g, r, 0, i * rh, s, rh, u, tone(c, -0.4, 0.25));
        g.fillStyle = tone(c, -0.45); g.fillRect(0, i * rh, s, 2 * u);
      }
    } },
    tile: { m: 1.2, draw(g, s, r, u, k, q, c) { tileGrid(g, s, r, u, 2, 2, c, 0.03, tone(c, -0.18), 2.2); } },
    porcelain: { m: 2.4, draw(g, s, r, u, k, q, c) {
      tileGrid(g, s, r, u, 2, 4, c, 0.025, tone(c, -0.15), 1.2, true);
      clouds(g, s, r, 30 * k, 40 * u, tone(c, 0.15, 0.06));
    } },
    marble: { m: 1.2, draw(g, s, r, u, k, q, c) {
      tileGrid(g, s, r, u, 2, 2, c, 0.02, tone(c, -0.12), 1);
      clouds(g, s, r, 24 * k, 50 * u, tone(c, -0.08, 0.05));
      for (let i = 0; i < 10 * k; i++) {
        g.strokeStyle = tone(c, i % 3 ? -0.35 : -0.2, 0.15 + r() * 0.2); g.lineWidth = (0.5 + r() * 1.6) * u;
        let x = r() * s, y = r() * s;
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 9; j++) { x += (r() - 0.25) * s * 0.12; y += (r() - 0.5) * s * 0.1; g.lineTo(x, y); }
        g.stroke();
      }
    } },
    terrazzo: { m: 1, draw(g, s, r, u, k, q, c) {
      g.fillStyle = c; g.fillRect(0, 0, s, s);
      const chips = [tone(c, -0.35), tone(c, -0.2), tone(c, 0.4), '#a99b88', '#7e8386', '#c49a77', '#efe9df'];
      for (let i = 0; i < 1100 * k; i++) {
        g.fillStyle = chips[i % chips.length];
        const x = r() * s, y = r() * s, z = (1.2 + r() * 3.5) * u;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + z, y + z * 0.3); g.lineTo(x + z * 0.6, y + z); g.lineTo(x - z * 0.2, y + z * 0.7); g.fill();
      }
    } },
    stone: { m: 0.9, draw(g, s, r, u, k, q, c) { tileGrid(g, s, r, u, 2, 2, c, 0.04, tone(c, -0.2), 2); speckle(g, s, r, 300 * k, u, [tone(c, -0.3, 0.3)]); } },
    slate: { m: 1.2, draw(g, s, r, u, k, q, c) {
      g.fillStyle = tone(c, -0.5); g.fillRect(0, 0, s, s);
      const rows = 4, rh = s / rows;
      for (let j = 0; j < rows; j++) {
        let x = 0;
        while (x < s - 4 * u) {
          const w = Math.min(s - x, s * (0.2 + r() * 0.25));
          g.fillStyle = vary(c, r, 0.16); g.fillRect(x + 1.5 * u, j * rh + 1.5 * u, w - 3 * u, rh - 3 * u);
          x += w;
        }
      }
      speckle(g, s, r, 400 * k, u, [tone(c, 0.2, 0.25), tone(c, -0.3, 0.3)]);
    } },
    pavers: { m: 1.2, draw(g, s, r, u, k, q, c) { tileGrid(g, s, r, u, 4, 4, c, 0.1, tone(c, 0.45), 3); speckle(g, s, r, 250 * k, u, [tone(c, -0.25, 0.3)]); } },
    carpet: { m: 1, draw(g, s, r, u, k, q, c) { g.fillStyle = c; g.fillRect(0, 0, s, s); speckle(g, s, r, 700 * k, 2 * u, [tone(c, -0.06), tone(c, 0.08)]); } },
    concrete: { m: 2, draw(g, s, r, u, k, q, c) {
      g.fillStyle = c || '#cfcdc7'; g.fillRect(0, 0, s, s);
      clouds(g, s, r, 10 * k, 35 * u, tone(c || '#cfcdc7', -0.1, 0.15));
      speckle(g, s, r, 700 * k, 2 * u, [tone(c || '#cfcdc7', -0.06), tone(c || '#cfcdc7', 0.06)]);
      g.fillStyle = tone(c || '#cfcdc7', -0.15); g.fillRect(0, 0, s, 2 * u); g.fillRect(0, 0, 2 * u, s);
    } },
    gravel: { m: 1, draw(g, s, r, u, k) { g.fillStyle = '#d9d0bf'; g.fillRect(0, 0, s, s); for (let i = 0; i < 1400 * k; i++) { g.fillStyle = ['#c9bfac', '#ebe4d6', '#b9ae98', '#a89d88'][i % 4]; g.beginPath(); g.arc(r() * s, r() * s, (1 + r() * 2) * u, 0, 7); g.fill(); } } },
    mulch: { m: 1, draw(g, s, r, u, k) { g.fillStyle = '#86603e'; g.fillRect(0, 0, s, s); for (let i = 0; i < 1200 * k; i++) { g.fillStyle = ['#6e4c2f', '#9a7351', '#7a5636', '#5c3f26'][i % 4]; g.fillRect(r() * s, r() * s, (3 + r() * 4) * u, 2 * u); } } },
    sand: { m: 1, draw(g, s, r, u, k) { g.fillStyle = '#ebdcb4'; g.fillRect(0, 0, s, s); speckle(g, s, r, 600 * k, 2 * u, ['#e2d2a6', '#f3e7c6']); } },

    // exterior wall finishes
    'x-render': { m: 3, draw(g, s, r, u, k, q, c) { g.fillStyle = c; g.fillRect(0, 0, s, s); clouds(g, s, r, 14 * k, 60 * u, tone(c, -0.06, 0.08)); speckle(g, s, r, 900 * k, u, [tone(c, -0.05), tone(c, 0.05)]); } },
    'x-stucco': { m: 1, draw(g, s, r, u, k, q, c) {
      g.fillStyle = c; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 90 * k; i++) { g.fillStyle = tone(c, (r() - 0.5) * 0.14, 0.4); g.beginPath(); g.ellipse(r() * s, r() * s, (6 + r() * 18) * u, (3 + r() * 8) * u, r() * 3, 0, 7); g.fill(); }
      speckle(g, s, r, 2200 * k, u, [tone(c, -0.12), tone(c, 0.1)]);
    } },
    'x-brick': { m: 0.9, draw(g, s, r, u, k, q, c) {
      const cols = 4, rows = 12, bw = s / cols, bh = s / rows, mo = Math.max(1, s * 0.011);
      g.fillStyle = '#cfc8bc'; g.fillRect(0, 0, s, s);
      for (let j = 0; j < rows; j++) {
        const shades = Array.from({ length: cols }, () => (r() < 0.12 ? tone(c, -0.22 - r() * 0.1) : vary(c, r, 0.11)));
        const off = j % 2 ? bw / 2 : 0;
        for (let i = 0; i <= cols; i++) {
          g.fillStyle = shades[i % cols];
          g.fillRect(i * bw - off + mo / 2, j * bh + mo / 2, bw - mo, bh - mo);
        }
      }
      if (q > 0) speckle(g, s, r, 900 * k, u, [tone(c, -0.3, 0.3), tone(c, 0.25, 0.25)]);
    } },
    'x-stone': { m: 1.2, draw(g, s, r, u, k, q, c) {
      g.fillStyle = tone(c, -0.4); g.fillRect(0, 0, s, s);
      let y = 0;
      while (y < s - 2) {
        const h = Math.min(s - y, s * (0.09 + r() * 0.1));
        let x = 0;
        while (x < s - 2) {
          const w = Math.min(s - x, s * (0.12 + r() * 0.2));
          g.fillStyle = vary(toneHex(c, [0, 0.12, -0.1][Math.floor(r() * 3)]), r, 0.12);
          g.beginPath();
          const p = 2.5 * u;
          g.moveTo(x + p + r() * p, y + p); g.lineTo(x + w - p, y + p + r() * p); g.lineTo(x + w - p - r() * p, y + h - p); g.lineTo(x + p, y + h - p - r() * p);
          g.fill();
          x += w;
        }
        y += h;
      }
      speckle(g, s, r, 600 * k, u, [tone(c, -0.3, 0.25), tone(c, 0.3, 0.25)]);
    } },
    'x-siding': { m: 1.2, draw(g, s, r, u, k, q, c) {
      const rows = 8, rh = s / rows;
      for (let j = 0; j < rows; j++) {
        g.fillStyle = vary(c, r, 0.04); g.fillRect(0, j * rh, s, rh);
        if (q > 0) grainLines(g, r, 0, j * rh, s, rh, u, tone(c, -0.35, 0.12));
        g.fillStyle = tone(c, 0.2, 0.45); g.fillRect(0, j * rh, s, 1.2 * u);
        g.fillStyle = tone(c, -0.55, 0.65); g.fillRect(0, (j + 1) * rh - 2.5 * u, s, 2.5 * u);
      }
    } },
    'x-batten': { m: 1.2, draw(g, s, r, u, k, q, c) {
      const cols = 4, cw = s / cols, bw = s * 0.045;
      for (let i = 0; i < cols; i++) { g.fillStyle = vary(c, r, 0.03); g.fillRect(i * cw, 0, cw, s); if (q > 0) grainLines(g, r, i * cw, 0, cw, s, u, tone(c, -0.3, 0.1), true); }
      for (let i = 0; i <= cols; i++) {
        const x = i * cw - bw / 2;
        g.fillStyle = tone(c, -0.45, 0.6); g.fillRect(x + bw, 0, 2.5 * u, s);
        g.fillStyle = tone(c, 0.05); g.fillRect(x, 0, bw, s);
        g.fillStyle = tone(c, 0.25, 0.6); g.fillRect(x, 0, 1.2 * u, s);
      }
    } },
    'x-concrete': { m: 2.4, draw(g, s, r, u, k, q, c) {
      g.fillStyle = c; g.fillRect(0, 0, s, s);
      clouds(g, s, r, 20 * k, 40 * u, tone(c, -0.1, 0.12));
      g.fillStyle = tone(c, -0.12, 0.35);
      for (let j = 1; j < 16; j++) g.fillRect(0, (j * s) / 16, s, u);
      g.fillStyle = tone(c, -0.3, 0.7);
      g.fillRect(0, 0, s, 1.5 * u); g.fillRect(0, s / 2, s, 1.5 * u); g.fillRect(0, 0, 1.5 * u, s); g.fillRect(s / 2, 0, 1.5 * u, s);
      for (const x of [0.125, 0.375, 0.625, 0.875]) for (const y of [0.125, 0.375, 0.625, 0.875]) { g.beginPath(); g.arc(x * s, y * s, 3 * u, 0, 7); g.fill(); }
      speckle(g, s, r, 800 * k, u, [tone(c, -0.15), tone(c, 0.1)]);
    } },

    // roofs: u runs along the eaves, v up the slope (canvas top = ridge side)
    'r-clay': { m: 1.2, draw(g, s, r, u, k, q, c) {
      const cols = 6, rows = 4, cw = s / cols, rh = s / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = i * cw, y = j * rh, base = vary(c, r, 0.12), cap = i % 2 === 0;
        const gr = g.createLinearGradient(x, 0, x + cw, 0);
        gr.addColorStop(0, tone(c, -0.45)); gr.addColorStop(0.5, cap ? tone(c, 0.18) : base); gr.addColorStop(1, tone(c, -0.45));
        g.fillStyle = cap ? gr : base; g.fillRect(x, y, cw, rh);
        if (!cap) { g.fillStyle = tone(c, -0.25, 0.5); g.fillRect(x, y, cw, rh); }
        g.fillStyle = tone(c, -0.6, 0.55); g.fillRect(x, y + rh - 4 * u, cw, 4 * u);
      }
    } },
    'r-tile': { m: 1.2, draw(g, s, r, u, k, q, c) {
      const cols = 4, rows = 4, tw = s / cols, rh = s / rows;
      for (let j = 0; j < rows; j++) {
        const off = j % 2 ? tw / 2 : 0, shades = Array.from({ length: cols }, () => vary(c, r, 0.06));
        for (let i = 0; i <= cols; i++) {
          const x = i * tw - off, gr = g.createLinearGradient(0, j * rh, 0, (j + 1) * rh);
          gr.addColorStop(0, tone(c, 0.1)); gr.addColorStop(1, shades[i % cols]);
          g.fillStyle = gr; g.fillRect(x, j * rh, tw, rh);
          g.fillStyle = tone(c, -0.5, 0.6); g.fillRect(x, j * rh, 1.5 * u, rh);
        }
        g.fillStyle = tone(c, -0.6, 0.6); g.fillRect(0, (j + 1) * rh - 3 * u, s, 3 * u);
      }
    } },
    'r-slate': { m: 1.2, draw(g, s, r, u, k, q, c) { tileGrid(g, s, r, u, 4, 6, c, 0.1, tone(c, -0.55), 1.6, true); for (let j = 1; j <= 6; j++) { g.fillStyle = tone(c, -0.6, 0.5); g.fillRect(0, (j * s) / 6 - 2 * u, s, 2 * u); } } },
    'r-shingle': { m: 1, draw(g, s, r, u, k, q, c) {
      const rows = 7, rh = s / rows;
      for (let j = 0; j < rows; j++) {
        let x = -r() * s * 0.2;
        while (x < s) { const w = s * (0.25 + r() * 0.15); g.fillStyle = vary(c, r, 0.13); g.fillRect(x, j * rh, w, rh); g.fillStyle = tone(c, -0.5, 0.6); g.fillRect(x, j * rh, 1.5 * u, rh); x += w; }
        g.fillStyle = tone(c, -0.6, 0.6); g.fillRect(0, (j + 1) * rh - 3 * u, s, 3 * u);
      }
      if (q > 0) speckle(g, s, r, 1500 * k, u, [tone(c, 0.2, 0.4), tone(c, -0.3, 0.4)]);
    } },
    'r-metal': { m: 1, draw(g, s, r, u, k, q, c) {
      for (let i = 0; i < 2; i++) {
        const x = (i * s) / 2, gr = g.createLinearGradient(x, 0, x + s / 2, 0);
        gr.addColorStop(0, tone(c, 0.06)); gr.addColorStop(0.5, c); gr.addColorStop(1, tone(c, -0.06));
        g.fillStyle = gr; g.fillRect(x, 0, s / 2, s);
        g.fillStyle = tone(c, 0.35); g.fillRect(x, 0, 2 * u, s);
        g.fillStyle = tone(c, -0.5); g.fillRect(x + 2 * u, 0, 2 * u, s);
      }
    } },
    'r-membrane': { m: 2, draw(g, s, r, u, k, q, c) { g.fillStyle = c; g.fillRect(0, 0, s, s); speckle(g, s, r, 1500 * k, u, [tone(c, -0.08), tone(c, 0.08)]); g.fillStyle = tone(c, -0.1, 0.4); g.fillRect(0, s / 2, s, 1.5 * u); g.fillRect(0, 0, s, 1.5 * u); } },

    // trims, tinted by the material colour
    // fine, low-contrast grain repeated 4× per metre so it reads as plaster, not stains
    plaster: { m: 0.25, draw(g, s, r, u, k) { g.fillStyle = '#fbfbfb'; g.fillRect(0, 0, s, s); speckle(g, s, r, 900 * k, u, ['#f5f5f5', '#ffffff', '#f2f2f2']); } },
    grain: { m: 1, draw(g, s, r, u) { g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, s, s); grainLines(g, r, 0, 0, s, s, u, 'rgba(120,120,120,.28)'); } },
    // fabric: soft random slubs and fibres rather than a regular grid (a grid turns into stripes at a distance)
    weave: { m: 0.5, draw(g, s, r, u, k) {
      g.fillStyle = '#f5f5f5'; g.fillRect(0, 0, s, s);
      clouds(g, s, r, 30 * k, 20 * u, 'rgba(0,0,0,.015)');
      for (let i = 0; i < 700 * k; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,.03)' : 'rgba(255,255,255,.12)';
        if (r() < 0.5) g.fillRect(r() * s, r() * s, (2 + r() * 6) * u, 0.6 * u); else g.fillRect(r() * s, r() * s, 0.6 * u, (2 + r() * 6) * u);
      }
    } },
    bark: { m: 1, draw(g, s, r, u, k) { g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, s, s); for (let i = 0; i < 120 * k; i++) { g.fillStyle = 'rgba(60,60,60,.25)'; g.fillRect(r() * s, r() * s, 1.5 * u, (10 + r() * 30) * u); } } }
  };
  function tex(key, base) {
    const ck = key + '|' + (base || '');
    if (texs.has(ck)) return texs.get(ck);
    const spec = TEX[key] || TEX.concrete, size = TEX_SIZE[quality], u = size / 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    spec.draw(c.getContext('2d'), size, rng(hash(ck)), u, u * u, quality, base || '#cccccc');
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(1 / spec.m, 1 / spec.m);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = quality === 2 ? 8 : 4;
    texs.set(ck, t);
    return t;
  }
  // Normal map from a texture's brightness: dark seams, grout and mortar read as dips. Unlike a bump map
  // (which works from screen-space slopes) it mipmaps cleanly, so relief never breaks into lines at an angle.
  function normalTex(key, base) {
    const ck = 'n:' + key + '|' + (base || '');
    if (texs.has(ck)) return texs.get(ck);
    const src = tex(key, base), n = Math.min(512, src.image.width), c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.drawImage(src.image, 0, 0, n, n);
    const img = g.getImageData(0, 0, n, n), d = img.data, h = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) h[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
    const k = (RELIEF[key] * n) / 256;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const nx = (h[y * n + ((x + n - 1) % n)] - h[y * n + ((x + 1) % n)]) * k;
      const ny = (h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x]) * k; // canvas rows run down, texture v runs up
      const L = Math.hypot(nx, ny, 1), i = (y * n + x) * 4;
      d[i] = (nx / L * 0.5 + 0.5) * 255; d[i + 1] = (ny / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.copy(src.repeat);
    t.anisotropy = src.anisotropy;
    texs.set(ck, t);
    return t;
  }
  // Textured material; at High, coarse finishes get relief from a normal map so grout, seams and mortar catch the light.
  function texMaterial(key, color, roughness, metalness, base) {
    const k = 'tex:' + key + (color || '') + roughness + '|' + (metalness || 0) + '|' + (base || '');
    if (!mats.has(k)) {
      const m = new T.MeshStandardMaterial({ map: tex(key, base), color: color || '#ffffff', roughness, metalness: metalness || 0 });
      if (quality === 2 && RELIEF[key]) m.normalMap = normalTex(key, base);
      mats.set(k, m);
    }
    return mats.get(k);
  }
  // A finish drawn in its own colour (floors, wall cladding, roofing). Low detail uses the flat colour.
  function finish(key, base) {
    const rm = ROUGH[key] || [0.85];
    if (quality === 0) return mat(base, { roughness: rm[0], metalness: rm[1] || 0 });
    return texMaterial(key, '#ffffff', rm[0], rm[1], base);
  }
  const texMat = (key) => (key === 'grass' ? (quality === 0 ? mat('#7dac57') : texMaterial('grass', null, 0.95)) : finish(key, GROUND[key] || '#cfcdc7'));
  const floorMat = (r) => finish(C.floors[r.floor] ? r.floor : 'tile', M.floorColor(r));
  const paint = (color) => (quality === 0 ? mat(color, { roughness: 0.95 }) : texMaterial('plaster', color, 0.92));
  const extMat = (st) => finish('x-' + (C.wallFinishes[st.finish] ? st.finish : 'render'), st.extColor);

  // Furniture finishes by base colour. Low keeps flat colours; Medium and High add grain, weave and gloss.
  const FINISH = {
    '#a77d55': 'grain', '#cfae86': 'grain', '#a8835e': 'grain', '#6d5644': 'grain', '#9b7451': 'grain', '#b58b5e': 'grain',
    '#8f7357': 'grain', '#9c7c5b': 'grain', '#8a6a4c': 'grain', '#7d5d3f': 'grain', '#b89a74': 'grain',
    '#cdc5b6': 'weave', '#ddd6c9': 'weave', '#b9a68c': 'weave', '#d9cab3': 'weave', '#8f9894': 'weave', '#dfe5e2': 'weave',
    '#e6ddcf': 'weave', '#c7b49a': 'weave', '#e9e4da': 'weave', '#e3d6c1': 'weave', '#fbfaf7': 'weave', '#ffffff': 'weave',
    '#f1eee8': 'weave', '#e0d8ca': 'weave', '#d8d2c6': 'weave', '#6b4a2f': 'bark', '#8a6a48': 'bark'
  };
  const GLOSS = { '#f5f3ef': [0.25, 0], '#e9ebee': [0.3, 0.1], '#f1f2f4': [0.3, 0.1], '#c3c8cd': [0.3, 0.7], '#1f2023': [0.4, 0.2], '#bdb8af': [0.35, 0], '#3c4650': [0.15, 0.3], '#d6dade': [0.3, 0.5], '#f0eee9': [0.5, 0] };
  function surface(color) {
    if (quality === 0) return mat(color);
    const f = FINISH[color], gl = GLOSS[color];
    if (f) return texMaterial(f, color, 0.8);
    return mat(color, gl ? { roughness: gl[0], metalness: gl[1] } : {});
  }
  // Material kit handed to the furniture and plant models (src/furniture3d.js).
  const KIT = {
    wood: (c) => (quality ? texMaterial('grain', c, 0.55) : mat(c)),
    fabric: (c) => (quality ? texMaterial('weave', c, 0.95) : mat(c, { roughness: 0.95 })),
    leather: (c) => mat(c, { roughness: 0.45 }),
    matte: (c) => mat(c, { roughness: 0.85 }),
    gloss: (c) => mat(c, { roughness: 0.18 }),
    metal: (c) => mat(c, { roughness: 0.3, metalness: quality ? 0.85 : 0.3 }),
    glass: () => GLASS(),
    mirror: () => mat('#dfe6ea', { roughness: 0.03, metalness: quality ? 1 : 0.3 }),
    emissive: (c) => mat(c, { emissive: c, emissiveIntensity: 0.9, roughness: 0.6 }),
    leaf: (c) => mat(c, { roughness: 0.85, flatShading: true, side: T.DoubleSide }),
    bark: (c) => (quality ? texMaterial('bark', c, 0.95) : mat(c))
  };

  // Plan polygon -> horizontal shape. (x, -y) plus rotation.x = -PI/2 puts it at plan (x, y), facing up.
  const shape = (pts) => new T.Shape(pts.map((q) => new T.Vector2(q.x, -q.y)));
  function flat(pts, material, y) {
    const m = new T.Mesh(new T.ShapeGeometry(shape(pts)), material);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    return m;
  }
  function slab(pts, material, y, depth) {
    const m = new T.Mesh(new T.ExtrudeGeometry(shape(pts), { depth, bevelEnabled: false }), material);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    return shadows(m);
  }
  // Box between local corners (x0..x1, y0..y1, z0..z1).
  function B(x0, x1, y0, y1, z0, z1, material) {
    const m = new T.Mesh(new T.BoxGeometry(Math.max(0.005, x1 - x0), Math.max(0.005, y1 - y0), Math.max(0.005, z1 - z0)), typeof material === 'string' ? surface(material) : material);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return m;
  }
  function Cyl(x, z, r, y0, y1, material, seg) {
    const m = new T.Mesh(new T.CylinderGeometry(r, r, y1 - y0, seg || 14), typeof material === 'string' ? surface(material) : material);
    m.position.set(x, (y0 + y1) / 2, z);
    return m;
  }
  // Box UVs in metres so textures keep their real size, continuous along a wall:
  // s is the box centre's distance along the wall and y its centre height.
  function metreUV(geo, s, y) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), yy = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, x + s, z);
      else if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, z, yy + y);
      else uv.setXY(i, x + s, yy + y);
    }
    uv.needsUpdate = true;
    return geo;
  }
  // Box running along a wall from s0 to s1 (metres from its start), y0..y1 high, depth across the wall, shifted k along the normal.
  // material may be an array: [end, end, top, bottom, +normal face, −normal face].
  function along(v, s0, s1, y0, y1, depth, material, k) {
    const geo = new T.BoxGeometry(Math.max(0.005, s1 - s0), Math.max(0.005, y1 - y0), depth);
    const mid = (s0 + s1) / 2, off = k || 0;
    if (Array.isArray(material)) metreUV(geo, mid, (y0 + y1) / 2);
    const m = new T.Mesh(geo, material);
    m.position.set(v.a.x + v.ux * mid + v.nx * off, (y0 + y1) / 2, v.a.y + v.uy * mid + v.ny * off);
    m.rotation.y = -Math.atan2(v.uy, v.ux);
    return m;
  }
  // Box from point a to point b ([x, y, z]) with a w × h cross-section; dy lifts it.
  function beam(a, b, w, h, material, dy) {
    const P = new T.Vector3(a[0], a[1] + (dy || 0), a[2]), Q = new T.Vector3(b[0], b[1] + (dy || 0), b[2]);
    const m = new T.Mesh(new T.BoxGeometry(w, h, Math.max(0.01, P.distanceTo(Q))), material);
    m.position.copy(P).add(Q).multiplyScalar(0.5);
    m.lookAt(Q);
    return m;
  }

  /* ---------- built-in soft shading ---------- */
  // Rooms read as rooms when their corners are a little darker. Instead of computing that on screen (which can
  // break into lines on surfaces seen at an angle), soft gradient strips multiply the light down where walls meet
  // the floor and ceiling, and a soft shadow sits under each piece of furniture. They are part of the model,
  // so they look the same from every angle. Medium and High only.
  function shadeTex(key, draw) {
    if (texs.has(key)) return texs.get(key);
    const c = document.createElement('canvas');
    draw(c, c.getContext('2d'));
    const t = new T.CanvasTexture(c);
    texs.set(key, t);
    return t;
  }
  function shadeMat(key, draw) {
    if (!mats.has(key)) {
      mats.set(key, new T.MeshBasicMaterial({
        map: shadeTex(key, draw), blending: T.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false,
        toneMapped: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4
      }));
    }
    return mats.get(key);
  }
  // v = 0 at the corner (darkest), 1 at the far edge (no change)
  const EDGE = () => shadeMat('shade:edge', (c, g) => {
    c.width = 4; c.height = 128;
    // canvas rows run down and v runs up, so the bottom row is the corner
    for (let r = 0; r < 128; r++) { const v = Math.round(255 * (1 - 0.3 * Math.pow(r / 127, 2.4))); g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(0, r, 4, 1); }
  });
  const BLOB = () => shadeMat('shade:blob', (c, g) => {
    c.width = c.height = 128;
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    g.filter = 'blur(12px)';
    g.fillStyle = '#a8a8a8';
    g.fillRect(26, 26, 76, 76);
  });
  // Quad from four [x, y, z] corners; v runs 0 → 1 from the first edge (a–b) to the second (d–c).
  function shadeQuad(a, b, c, d, material) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    const m = new T.Mesh(geo, material);
    m.userData.shade = true;
    m.renderOrder = 1;
    return m;
  }

  /* ---------- walls, openings ---------- */
  const TRIM = () => mat('#f2f0eb', { roughness: 0.5 });
  const GLASS = () => mat('#c4dde6', { transparent: true, opacity: 0.3, roughness: 0.02, metalness: 0.1 });
  const PICK = () => { if (!mats.has('pick')) mats.set('pick', new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); return mats.get('pick'); };
  const indoor = (r) => !!r && r.use === 'indoor';

  // H is the wall top above the ground: wall height measured from the finished floor, plus FLOOR.
  // Sill heights are from the finished floor too, so a 0.9 m sill sits 0.9 m above the floorboards.
  function openingSpans(p, wall, H) {
    const clear = H - FLOOR;
    return p.openings.filter((o) => o.wall === wall.id).map((o) => {
      const g = M.openingGeo(p, o);
      if (!g) return null;
      const h = Math.min(o.h, clear);
      const sill = FLOOR + Math.max(0, Math.min(clear - h, o.sill || 0));
      return { o, g, from: g.from, to: g.to, sill, top: Math.min(H, sill + h) };
    }).filter(Boolean).sort((a, b) => a.from - b.from);
  }

  // The room on each face of a wall changes where other rooms' corners meet it. Runs cover [0, L] and say
  // which room each face looks into (plus = the +normal side), so paint and cladding go on the right faces.
  function roomAt(p, q) {
    let hit = null;
    for (const r of p.rooms) if (G.pointInPoly(q, r.pts)) { if (r.use === 'indoor') return r; hit = hit || r; }
    return hit;
  }
  function wallRuns(p, w, v) {
    const half = w.t / 2, cuts = [0, v.L];
    for (const r of p.rooms) for (const q of r.pts) {
      const dx = q.x - v.a.x, dy = q.y - v.a.y, s = dx * v.ux + dy * v.uy;
      if (Math.abs(dx * v.nx + dy * v.ny) < half + 0.35 && s > 0.03 && s < v.L - 0.03) cuts.push(s);
    }
    cuts.sort((a, b) => a - b);
    const runs = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < 0.01) continue;
      const m = (a + b) / 2, side = (k) => roomAt(p, { x: v.a.x + v.ux * m + v.nx * k * (half + 0.08), y: v.a.y + v.uy * m + v.ny * k * (half + 0.08) });
      runs.push({ a, b, plus: side(1), minus: side(-1) });
    }
    return runs;
  }
  const runAt = (runs, s) => runs.find((r) => s >= r.a - 1e-6 && s <= r.b + 1e-6) || runs[0] || { plus: null, minus: null };

  function buildWall(p, w, H) {
    const group = new T.Group(), st = p.settings.style;
    const v = M.wallVec(w), half = w.t / 2, ext = extMat(st);
    const spans = openingSpans(p, w, H), runs = wallRuns(p, w, v);
    const face = (room) => (indoor(room) ? paint(M.wallColor(p, room)) : ext);
    const mats6 = (run) => { const a = face(run.plus), b = face(run.minus); const e = indoor(run.plus) ? a : b; return [e, e, ext, e, a, b]; };
    const ends = (a, b) => [a < 1e-6 ? -(half - 0.002) : a, b > v.L - 1e-6 ? v.L + half - 0.002 : b];
    const piece = (s0, s1, y0, y1, run) => { const [a, b] = ends(s0, s1); group.add(tag(along(v, a, b, y0, y1, w.t, mats6(run)), 'wall', w.id)); };
    let solid = [[0, v.L]];
    for (const s of spans) solid = G.subtract(solid, s.from, s.to);
    // Trim on indoor faces: skirting from Medium, cornice where the style has one.
    const shade = [];
    // point on a face: s along the wall, height y, d from the centre line on side k
    const at = (s, y, k, d) => [v.a.x + v.ux * s + v.nx * k * d, y, v.a.y + v.uy * s + v.ny * k * d];
    const trimFaces = (s0, s1, run, y0, y1) => {
      if (quality === 0) return;
      for (const [room, k] of [[run.plus, 1], [run.minus, -1]]) {
        if (!indoor(room)) continue;
        if (s1 - s0 > 0.05) {
          const f = half + 0.016, E = EDGE();
          if (y0 <= FLOOR + 0.01) {
            shade.push(shadeQuad(at(s0, FLOOR, k, f), at(s1, FLOOR, k, f), at(s1, FLOOR + 0.4, k, f), at(s0, FLOOR + 0.4, k, f), E));
            shade.push(shadeQuad(at(s0, FLOOR + 0.002, k, half), at(s1, FLOOR + 0.002, k, half), at(s1, FLOOR + 0.002, k, half + 0.4), at(s0, FLOOR + 0.002, k, half + 0.4), E));
          }
          if (y1 >= H - 0.01) {
            shade.push(shadeQuad(at(s0, H, k, half + 0.002), at(s1, H, k, half + 0.002), at(s1, H - 0.35, k, half + 0.002), at(s0, H - 0.35, k, half + 0.002), E));
            shade.push(shadeQuad(at(s0, H - 0.004, k, half), at(s1, H - 0.004, k, half), at(s1, H - 0.004, k, half + 0.35), at(s0, H - 0.004, k, half + 0.35), E));
          }
        }
        if (y0 <= FLOOR + 0.01 && s1 - s0 > 0.05) group.add(tag(along(v, s0, s1, FLOOR, FLOOR + 0.09, 0.014, TRIM(), k * (half + 0.007)), 'wall', w.id));
        if (st.cornice && y1 >= H - 0.01 && s1 - s0 > 0.05) {
          group.add(tag(along(v, s0, s1, H - 0.1, H, 0.018, TRIM(), k * (half + 0.009)), 'wall', w.id));
          group.add(tag(along(v, s0, s1, H - 0.035, H, 0.05, TRIM(), k * (half + 0.025)), 'wall', w.id));
        }
      }
    };
    for (const [a, b] of solid) {
      if (b - a < 0.005) continue;
      for (const run of runs) {
        const s0 = Math.max(a, run.a), s1 = Math.min(b, run.b);
        if (s1 - s0 < 0.005) continue;
        piece(s0, s1, 0, H, run);
        trimFaces(s0, s1, run, 0, H);
      }
    }
    for (const s of spans) {
      const run = runAt(runs, (s.from + s.to) / 2);
      if (s.sill > 0.005) { piece(s.from, s.to, 0, s.sill, run); trimFaces(s.from, s.to, run, 0, s.sill); }
      if (s.top < H - 0.005) { piece(s.from, s.to, s.top, H, run); trimFaces(s.from, s.to, run, s.top, H); }
      group.add(buildOpening(p, s, v, w.t, run));
    }
    shadows(group);
    for (const m of shade) group.add(m); // after shadows(): strips neither cast nor receive
    return group;
  }

  function doorLeaf(w, h, kind, color) {
    const g = new T.Group(), d = 0.04;
    const body = kind === 'plank' ? KIT.wood(color) : mat(color, { roughness: 0.5 });
    if (kind === 'glass') {
      const st = 0.11;
      g.add(B(0, st, 0, h, -d / 2, d / 2, body), B(w - st, w, 0, h, -d / 2, d / 2, body), B(st, w - st, 0, 0.24, -d / 2, d / 2, body), B(st, w - st, h - st, h, -d / 2, d / 2, body));
      g.add(B(st, w - st, 0.24, h - st, -0.006, 0.006, GLASS()));
      if (quality) g.add(B(st, w - st, (h + 0.24) / 2 - 0.015, (h + 0.24) / 2 + 0.015, -0.012, 0.012, body));
    } else {
      g.add(B(0, w, 0, h, -d / 2, d / 2, body));
      if (quality && kind === 'panel') {
        const mx = 0.1, gx = 0.09, pw = (w - 2 * mx - gx) / 2, y1 = 0.12, ym = h * 0.42, y2 = h - 0.12;
        for (const z of [1, -1]) for (const [x0, x1] of [[mx, mx + pw], [w - mx - pw, w - mx]]) for (const [ya, yb] of [[y1, ym - 0.05], [ym + 0.05, y2]]) g.add(B(x0, x1, ya, yb, z * d / 2 - 0.002, z * d / 2 + z * 0.008, body));
      }
      if (quality && kind === 'plank') {
        const n = Math.max(2, Math.round(w / 0.13)), dark = mat(tone(color, -0.5), { roughness: 0.8 });
        for (let i = 1; i < n; i++) for (const z of [1, -1]) g.add(B((i * w) / n - 0.004, (i * w) / n + 0.004, 0.02, h - 0.02, z * (d / 2 - 0.002) - 0.001, z * (d / 2 + 0.001), dark));
      }
    }
    if (quality) {
      const metal = KIT.metal('#c9ccce');
      for (const z of [1, -1]) {
        g.add(B(w - 0.09, w - 0.05, 0.97, 1.07, z * d / 2, z * (d / 2 + 0.01), metal));
        g.add(B(w - 0.08, w - 0.06, 1.0, 1.025, z * (d / 2 + 0.01), z * (d / 2 + 0.05), metal));
        g.add(B(w - 0.2, w - 0.06, 1.0, 1.025, z * (d / 2 + 0.04), z * (d / 2 + 0.06), metal));
      }
    }
    return g;
  }

  // Casing around an opening on each indoor face.
  function casing(group, v, a, b, y0, y1, half, run, material, withSill) {
    if (quality === 0) return;
    for (const [room, k] of [[run.plus, 1], [run.minus, -1]]) {
      if (!indoor(room)) continue;
      const off = k * (half + 0.008);
      group.add(along(v, a - 0.07, a, withSill ? y0 - 0.07 : y0, y1 + 0.07, 0.016, material, off), along(v, b, b + 0.07, withSill ? y0 - 0.07 : y0, y1 + 0.07, 0.016, material, off));
      group.add(along(v, a - 0.07, b + 0.07, y1, y1 + 0.07, 0.016, material, off));
      if (withSill) group.add(along(v, a - 0.07, b + 0.07, y0 - 0.07, y0, 0.016, material, off));
    }
  }

  // Floor-length linen curtains, gathered at both sides, on living-space and bedroom windows (High only).
  const CURTAIN_ROOMS = ['bedroom', 'living', 'dining', 'office'];
  function curtains(g, v, a, b, top, half, run, outSide) {
    if (quality < 2) return;
    const inSide = outSide ? -outSide : 0, room = inSide > 0 ? run.plus : inSide < 0 ? run.minus : null;
    if (!indoor(room) || !CURTAIN_ROOMS.includes(room.kind)) return;
    const fab = KIT.fabric('#ece6db'), off = inSide * (half + 0.1), y1 = top + 0.12;
    for (const [s0, dir] of [[a - 0.22, 1], [b + 0.22, -1]]) {
      for (let i = 0; i < 5; i++) {
        const x = s0 + dir * i * 0.06;
        g.add(along(v, Math.min(x, x + dir * 0.065), Math.max(x, x + dir * 0.065), FLOOR + 0.015, y1, 0.03, fab, off + inSide * (i % 2 ? 0.022 : 0)));
      }
    }
    g.add(along(v, a - 0.3, b + 0.3, y1, y1 + 0.025, 0.025, KIT.metal('#b9bcbf'), off));
  }

  function buildOpening(p, s, v, t, run) {
    const o = s.o, g = new T.Group(), st = p.settings.style, half = t / 2;
    const y0 = s.sill, y1 = s.top, a = s.from, b = s.to;
    const inP = indoor(run.plus), inM = indoor(run.minus);
    const outSide = inP && !inM ? -1 : !inP && inM ? 1 : 0; // which face looks outside
    const exterior = !(inP && inM);
    g.add(along(v, a, b, y0, y1, t + 0.08, PICK()));
    const trim = mat(st.trim, { roughness: 0.45 });
    if (o.type === 'window' || o.type === 'sliding') {
      const f = 0.055, fd = Math.min(t, 0.08);
      g.add(along(v, a, b, y0, y0 + f, fd, trim), along(v, a, b, y1 - f, y1, fd, trim));
      g.add(along(v, a, a + f, y0, y1, fd, trim), along(v, b - f, b, y0, y1, fd, trim));
      if (o.type === 'window') {
        const n = Math.max(1, Math.round((b - a) / 0.9)), pw = (b - a) / n;
        for (let i = 0; i < n; i++) {
          const pa = a + i * pw, pb = pa + pw;
          if (i) g.add(along(v, pa - f / 2, pa + f / 2, y0, y1, fd, trim));
          g.add(along(v, pa + f / 2, pb - f / 2, y0 + f, y1 - f, 0.012, GLASS()));
          // glazing bars
          const bar = 0.022, ga = pa + (i ? f / 2 : f), gb = pb - (i < n - 1 ? f / 2 : f), ya = y0 + f, yb = y1 - f;
          const cols = st.window === 'colonial' ? (gb - ga > 0.55 ? 3 : 2) : st.window === 'cross' ? 2 : 1;
          const rows = st.window === 'colonial' ? Math.max(2, Math.round((yb - ya) / 0.4)) : st.window === 'cross' ? 2 : 1;
          for (let c = 1; c < cols; c++) { const x = ga + ((gb - ga) * c) / cols; g.add(along(v, x - bar / 2, x + bar / 2, ya, yb, 0.03, trim)); }
          for (let r = 1; r < rows; r++) { const y = ya + ((yb - ya) * r) / rows; g.add(along(v, ga, gb, y - bar / 2, y + bar / 2, 0.03, trim)); }
        }
        // stone sill outside, timber stool inside
        if (quality && y0 > FLOOR + 0.05) {
          if (outSide) g.add(along(v, a - 0.05, b + 0.05, y0 - 0.045, y0, half + 0.05, mat('#dcd7cd', { roughness: 0.7 }), outSide * (half + 0.05) / 2));
          const inSide = outSide ? -outSide : inP ? 1 : 0;
          if (inSide) g.add(along(v, a - 0.04, b + 0.04, y0 - 0.025, y0, half + 0.035, TRIM(), inSide * (half + 0.035) / 2));
        }
        casing(g, v, a, b, y0, y1, half, run, TRIM(), false);
        curtains(g, v, a, b, y1, half, run, outSide);
      } else {
        const m = (a + b) / 2;
        g.add(along(v, a + f, m + 0.04, y0 + f, y1 - f, 0.02, GLASS(), -0.03), along(v, m - 0.04, b - f, y0 + f, y1 - f, 0.02, GLASS(), 0.03));
        g.add(along(v, m - 0.03, m + 0.03, y0, y1, 0.03, trim, -0.03), along(v, m - 0.03, m + 0.03, y0, y1, 0.03, trim, 0.03));
        g.add(along(v, a + f, m + 0.04, y0 + f, y0 + 0.1, 0.03, trim, -0.03), along(v, m - 0.04, b - f, y0 + f, y0 + 0.1, 0.03, trim, 0.03));
        if (quality) g.add(along(v, m - 0.07, m - 0.05, y0 + 0.9, y0 + 1.15, 0.05, KIT.metal('#c9ccce'), -0.06));
        casing(g, v, a, b, y0, y1, half, run, TRIM(), false);
        curtains(g, v, a, b, y1, half, run, outSide);
      }
    } else if (o.type === 'door') {
      const f = 0.045, extDoor = exterior;
      const color = extDoor ? st.doorColor : st.intDoorColor, kind = extDoor ? st.door : st.intDoor;
      const frame = mat(extDoor ? st.trim : st.intDoorColor, { roughness: 0.5 });
      g.add(along(v, a, b, y1 - f, y1, t + 0.02, frame), along(v, a, a + f, y0, y1, t + 0.02, frame), along(v, b - f, b, y0, y1, t + 0.02, frame));
      casing(g, v, a, b, y0, y1, half, run, mat(st.intDoorColor, { roughness: 0.5 }), false);
      // leaf drawn fully open, matching the plan symbol
      const side = o.side || 1, w = b - a - 2 * f;
      const hingeAt = o.hinge === 'end' ? b - f : a + f;
      const leaf = doorLeaf(w, y1 - y0 - f - 0.005, kind, color);
      const dx = v.nx * side, dz = v.ny * side;
      leaf.position.set(v.a.x + v.ux * hingeAt, y0, v.a.y + v.uy * hingeAt);
      leaf.rotation.y = -Math.atan2(dz, dx);
      g.add(leaf);
      // light switch on the latch side of each indoor face, at the usual 1.1 m
      if (quality) {
        const s = o.hinge === 'end' ? a - 0.14 : b + 0.14, plate = mat('#f7f6f3', { roughness: 0.3 });
        for (const [room, k] of [[run.plus, 1], [run.minus, -1]]) if (indoor(room)) g.add(along(v, s - 0.04, s + 0.04, y0 + 1.06, y0 + 1.14, 0.012, plate, k * (half + 0.006)));
      }
    } else if (quality) {
      casing(g, v, a, b, y0, y1, half, run, mat(st.intDoorColor, { roughness: 0.5 }), false);
    }
    return tag(g, 'opening', o.id);
  }

  /* ---------- roof ---------- */
  // Triangles [[x,y,z] × 3] to a geometry with UVs in metres: u along the eaves, v up the slope.
  // Roof faces are turned to face up; vertical infill faces are made two-sided.
  function surfaceGeo(tris) {
    const pos = [], uv = [], up = new T.Vector3(0, 1, 0);
    const A1 = new T.Vector3(), B1 = new T.Vector3(), C1 = new T.Vector3(), n = new T.Vector3(), t = new T.Vector3(), bt = new T.Vector3();
    const push = (P, Q, R) => { for (const X of [P, Q, R]) { pos.push(X.x, X.y, X.z); uv.push(X.dot(t), X.dot(bt)); } };
    for (let i = 0; i + 2 < tris.length; i += 3) {
      A1.fromArray(tris[i]); B1.fromArray(tris[i + 1]); C1.fromArray(tris[i + 2]);
      n.subVectors(B1, A1).cross(new T.Vector3().subVectors(C1, A1)).normalize();
      if (n.y < -0.01) { n.negate(); const tmp = B1.clone(); B1.copy(C1); C1.copy(tmp); }
      t.crossVectors(up, n);
      if (t.lengthSq() < 1e-6) t.set(1, 0, 0); else t.normalize();
      bt.crossVectors(n, t);
      push(A1, B1, C1);
      if (Math.abs(n.y) < 0.01) push(A1, C1, B1);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  }

  function roof(p, H) {
    const R = p.settings.roof, st = p.settings.style, g = new T.Group();
    const top = finish('r-' + (C.roofMaterials[R.material] ? R.material : 'membrane'), R.color), ext = extMat(st);
    const rooms = p.rooms.filter(indoor);
    if (R.type === 'flat' || R.type === 'parapet') {
      for (const r of rooms) g.add(slab(r.pts, [top, ext], H, R.slab));
      // outside walls rise past the slab edge; a parapet rises further and gets a coping
      const up = R.slab + (R.type === 'parapet' ? M.PARAPET : 0.02);
      for (const w of p.walls) {
        const v = M.wallVec(w), half = w.t / 2;
        for (const run of wallRuns(p, w, v)) {
          if (indoor(run.plus) === indoor(run.minus)) continue;
          const a = run.a < 1e-6 ? -half : run.a, b = run.b > v.L - 1e-6 ? v.L + half : run.b;
          g.add(along(v, a, b, H, H + up, w.t, [ext, ext, ext, ext, ext, ext]));
          if (R.type === 'parapet' && quality) g.add(along(v, a - 0.02, b + 0.02, H + up, H + up + 0.04, w.t + 0.05, mat('#d6d2ca', { roughness: 0.7 })));
        }
      }
    } else {
      const b = M.roofBounds(p);
      if (b) g.add(pitched(b, H, R, top, ext, st));
    }
    // ceilings, painted and lit by downlights
    const ceil = mat(st.ceiling, { roughness: 0.95, side: T.BackSide });
    const lamp = mat('#fffaf0', { emissive: '#fff1d6', emissiveIntensity: 1.4 }), ring = mat('#e9e7e2', { roughness: 0.4 });
    for (const r of rooms) {
      g.add(flat(r.pts, ceil, H - 0.002)); // untagged, so clicks pass through to the floor
      if (!quality) continue;
      const bb = G.bbox(r.pts), nx = Math.max(1, Math.round((bb.w - 0.6) / 1.7)), ny = Math.max(1, Math.round((bb.h - 0.6) / 1.7));
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = bb.x + (bb.w * (i + 0.5)) / nx, y = bb.y + (bb.h * (j + 0.5)) / ny;
        if (!G.pointInPoly({ x, y }, r.pts)) continue;
        g.add(Cyl(x, y, 0.06, H - 0.008, H - 0.002, ring, 18), Cyl(x, y, 0.045, H - 0.01, H - 0.004, lamp, 18));
      }
    }
    // covered areas: slab, ceiling and columns where they stand free of the house
    const nearWall = (q) => p.walls.some((w) => G.project(q, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }).d < w.t / 2 + 0.12);
    for (const r of p.rooms) {
      if (r.use !== 'covered') continue;
      g.add(slab(r.pts, [mat(st.ceiling, { roughness: 0.9 }), mat(st.trim, { roughness: 0.6 })], H - 0.18, 0.18));
      for (const q of r.pts) if (!nearWall(q)) g.add(tag(column(q.x, q.y, H - 0.18, st), 'room', r.id));
    }
    return shadows(g);
  }

  function column(x, y, top, st) {
    const g = new T.Group(), white = mat('#f4f1ec', { roughness: 0.7 });
    if (st.columns === 'timber') {
      const w = KIT.wood('#9b7451');
      g.add(B(-0.075, 0.075, 0, top, -0.075, 0.075, w));
      if (quality) g.add(B(-0.11, 0.11, 0, 0.04, -0.11, 0.11, mat('#5b5d60', { roughness: 0.5, metalness: 0.5 })), B(-0.2, 0.2, top - 0.12, top, -0.06, 0.06, w));
    } else if (st.columns === 'round') {
      g.add(Cyl(0, 0, 0.11, 0, top, white, 20));
      if (quality) g.add(B(-0.16, 0.16, 0, 0.08, -0.16, 0.16, white), B(-0.16, 0.16, top - 0.06, top, -0.16, 0.16, white), Cyl(0, 0, 0.135, top - 0.12, top - 0.06, white, 20));
    } else {
      g.add(B(-0.1, 0.1, 0, top, -0.1, 0.1, mat(st.trim === '#f8f7f4' ? '#f4f1ec' : st.extColor, { roughness: 0.8 })));
    }
    g.position.set(x, 0, y);
    return g;
  }

  // Pitched roofs cover the bounding box of the indoor rooms. Work in (u = long axis, s = short axis).
  function pitched(b, H, R, topMat, ext, st) {
    const o = R.overhang, tan = Math.tan((R.pitch * Math.PI) / 180), alongX = b.w >= b.h;
    const u0 = (alongX ? b.x : b.y) - o, u1 = (alongX ? b.x + b.w : b.y + b.h) + o;
    const s0 = alongX ? b.y : b.x, span = alongX ? b.h : b.w, s1 = s0 + span, sc = s0 + span / 2;
    const P = (u, y, s) => (alongX ? [u, y, s] : [s, y, u]);
    const roofT = [], wallT = [], eaves = [], rakes = [];
    const quad = (list, a, bb, c, d) => list.push(a, bb, c, a, c, d);
    const eave = H - o * tan, top = H + (span / 2) * tan;
    if (R.type === 'gable' || R.type === 'hip') {
      const hs = R.type === 'hip' ? Math.min(span / 2 + o, (u1 - u0) / 2) : 0;
      quad(roofT, P(u0, eave, s0 - o), P(u1, eave, s0 - o), P(u1 - hs, top, sc), P(u0 + hs, top, sc));
      quad(roofT, P(u0, eave, s1 + o), P(u1, eave, s1 + o), P(u1 - hs, top, sc), P(u0 + hs, top, sc));
      eaves.push([P(u0, eave, s0 - o), P(u1, eave, s0 - o)], [P(u0, eave, s1 + o), P(u1, eave, s1 + o)]);
      if (R.type === 'hip') {
        roofT.push(P(u0, eave, s0 - o), P(u0, eave, s1 + o), P(u0 + hs, top, sc), P(u1, eave, s0 - o), P(u1, eave, s1 + o), P(u1 - hs, top, sc));
        eaves.push([P(u0, eave, s0 - o), P(u0, eave, s1 + o)], [P(u1, eave, s0 - o), P(u1, eave, s1 + o)]);
      } else {
        for (const u of [u0 + o, u1 - o]) wallT.push(P(u, H, s0), P(u, H, s1), P(u, top - 0.02, sc));
        for (const u of [u0, u1]) rakes.push([P(u, eave, s0 - o), P(u, top, sc)], [P(u, eave, s1 + o), P(u, top, sc)]);
      }
    } else if (R.type === 'shed') {
      const hi = H + span * tan;
      quad(roofT, P(u0, hi + o * tan, s0 - o), P(u1, hi + o * tan, s0 - o), P(u1, eave, s1 + o), P(u0, eave, s1 + o));
      for (const u of [u0 + o, u1 - o]) wallT.push(P(u, H, s0), P(u, H, s1), P(u, hi, s0));
      quad(wallT, P(u0 + o, H, s0), P(u1 - o, H, s0), P(u1 - o, hi, s0), P(u0 + o, hi, s0));
      eaves.push([P(u0, eave, s1 + o), P(u1, eave, s1 + o)]);
      rakes.push([P(u0, hi + o * tan, s0 - o), P(u1, hi + o * tan, s0 - o)]);
      for (const u of [u0, u1]) rakes.push([P(u, hi + o * tan, s0 - o), P(u, eave, s1 + o)]);
    } else { // butterfly: high outer edges, valley down the middle at wall-top height
      const rise = (span / 2) * tan, yE = H + (span / 2 + o) * tan;
      quad(roofT, P(u0, yE, s0 - o), P(u1, yE, s0 - o), P(u1, H, sc), P(u0, H, sc));
      quad(roofT, P(u0, yE, s1 + o), P(u1, yE, s1 + o), P(u1, H, sc), P(u0, H, sc));
      for (const u of [u0 + o, u1 - o]) wallT.push(P(u, H, s0), P(u, H + rise, s0), P(u, H, sc), P(u, H, sc), P(u, H + rise, s1), P(u, H, s1));
      for (const s of [s0, s1]) quad(wallT, P(u0 + o, H, s), P(u1 - o, H, s), P(u1 - o, H + rise, s), P(u0 + o, H + rise, s));
      rakes.push([P(u0, yE, s0 - o), P(u1, yE, s0 - o)], [P(u0, yE, s1 + o), P(u1, yE, s1 + o)]);
      for (const u of [u0, u1]) rakes.push([P(u, yE, s0 - o), P(u, H, sc)], [P(u, yE, s1 + o), P(u, H, sc)]);
    }
    const g = new T.Group();
    const rg = surfaceGeo(roofT);
    g.add(new T.Mesh(rg, topMat), new T.Mesh(rg, mat('#efebe4', { roughness: 0.9, side: T.BackSide })));
    if (wallT.length) g.add(new T.Mesh(surfaceGeo(wallT), ext));
    if (quality) {
      const trim = mat(st.trim, { roughness: 0.5 }), gutter = mat(st.trim === '#f8f7f4' ? '#eeeeec' : '#55595e', { roughness: 0.35, metalness: 0.4 });
      const cx = alongX ? (u0 + u1) / 2 : sc, cz = alongX ? sc : (u0 + u1) / 2;
      for (const [a, bb] of eaves) {
        g.add(beam(a, bb, 0.035, 0.2, trim, -0.06));
        // round gutter hung just outside the fascia
        const mx = (a[0] + bb[0]) / 2, mz = (a[2] + bb[2]) / 2, ex = bb[0] - a[0], ez = bb[2] - a[2], L = Math.hypot(ex, ez);
        let nx = -ez / L, nz = ex / L;
        if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
        const gm = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, L, 10), gutter);
        gm.position.set(mx + nx * 0.075, a[1] - 0.12, mz + nz * 0.075);
        gm.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(ex / L, 0, ez / L));
        g.add(gm);
      }
      for (const [a, bb] of rakes) g.add(beam(a, bb, 0.035, 0.2, trim, -0.06));
    }
    return shadows(g);
  }

  /* ---------- furniture and plants: detailed models from src/furniture3d.js, a plain box if one is missing ---------- */
  function buildItem(it) {
    let g = null;
    if (FP.furniture3d) { try { g = FP.furniture3d.item(it.kind, it.w, it.h, T, quality, KIT); } catch (e) { console.warn('furniture model failed', it.kind, e); g = null; } }
    if (!g) { g = new T.Group(); g.add(B(-it.w / 2, it.w / 2, 0, 0.8, -it.h / 2, it.h / 2, '#dddad4')); }
    g.position.set(it.x, FLOOR, it.y);
    g.rotation.y = (-(it.rot || 0) * Math.PI) / 180;
    tag(shadows(g), 'item', it.id);
    // soft contact shadow on the floor under the piece
    if (quality && it.kind !== 'rug') {
      const x = it.w / 2 + 0.12, z = it.h / 2 + 0.12, y = 0.003;
      g.add(shadeQuad([-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z], BLOB()));
    }
    return g;
  }

  function buildPlant(pl) {
    const rnd = rng(hash(pl.id));
    let g = null;
    if (FP.furniture3d) { try { g = FP.furniture3d.plant(pl.kind, pl.r, T, quality, KIT, rnd); } catch (e) { console.warn('plant model failed', pl.kind, e); g = null; } }
    if (!g) {
      g = new T.Group();
      const r = pl.r;
      g.add(Cyl(0, 0, 0.12, 0, 1.6 + r * 0.3, '#6b4a2f', 8));
      const c = new T.Mesh(new T.IcosahedronGeometry(r * 0.85, 1), mat('#5f9442', { flatShading: true })); c.position.y = 1.6 + r * 0.7; g.add(c);
    }
    g.position.set(pl.x, 0, pl.y);
    return tag(shadows(g), 'plant', pl.id);
  }

  /* ---------- whole scene ---------- */
  function dispose(obj) { obj.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); }

  function build() {
    const p = A().shownProject(), st = S(), H = p.settings.wallH + FLOOR, L = st.layers;
    if (root) { scene.remove(root); dispose(root); }
    root = new T.Group();
    wallGroups.clear();

    const outside = flat([{ x: -80, y: -80 }, { x: p.lot.w + 80, y: -80 }, { x: p.lot.w + 80, y: p.lot.h + 80 }, { x: -80, y: p.lot.h + 80 }], mat('#9fbf86'), -0.02);
    root.add(tag(outside, 'ground', 'outside'));
    root.add(tag(flat(G.rectPts(0, 0, p.lot.w, p.lot.h), texMat('grass'), 0), 'ground', 'lot'));

    if (L.landscape.visible) {
      p.areas.forEach((a, i) => {
        let m;
        if (a.material === 'hedge') m = slab(a.pts, mat('#4c7735', { flatShading: true }), 0, 1.3);
        else if (a.material === 'water') m = flat(a.pts, mat('#4fb0d8', { roughness: 0.05, metalness: 0.1 }), 0.075 + i * 0.002); // above any deck around it
        else if (a.material === 'deck') m = slab(a.pts, texMat('deck'), 0, 0.06);
        else m = flat(a.pts, texMat(a.material === 'lawn' ? 'grass' : a.material), 0.01 + i * 0.002);
        root.add(tag(m, 'area', a.id));
      });
      for (const pl of p.plants) root.add(buildPlant(pl));
    }
    if (L.house.visible) {
      for (const r of p.rooms) root.add(tag(flat(r.pts, floorMat(r), FLOOR), 'room', r.id));
      for (const w of p.walls) { const g = buildWall(p, w, H); wallGroups.set(w.id, g); root.add(g); }
      const rf = roof(p, H);
      rf.visible = showRoof || walk.on;
      rf.name = 'roof';
      root.add(rf);
    }
    if (L.furniture.visible) for (const it of p.items) root.add(buildItem(it));
    scene.add(root);
    buildCollision(p, H);
    placeSun(p);
    syncSelection();
    dirty = true;
  }

  /* ---------- light, sky and time of day ---------- */
  // Sun position for the hour (plan up = north): east in the morning, south at noon, west in the evening.
  function sunState() {
    const t = Math.max(0, Math.min(1, (hour - 6) / 12));
    const el = Math.max(0.06, Math.sin(t * Math.PI) * 1.1), az = ((hour - 12) * 15 * Math.PI) / 180;
    const day = Math.min(1, el / 0.55);
    return { x: -Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el), el, day };
  }
  const mix = (a, b, k) => new T.Color(a).lerp(new T.Color(b), k);
  function placeSun(p) {
    const cx = p.lot.w / 2, cz = p.lot.h / 2, R = Math.max(p.lot.w, p.lot.h), s = sunState();
    sun.position.set(cx + s.x * R * 1.6, s.y * R * 1.6, cz + s.z * R * 1.6);
    sun.target.position.set(cx, 0, cz);
    sun.color.copy(mix('#ffad66', '#fff4e4', s.day));
    sun.intensity = quality ? 1.2 + 1.9 * s.day : 1.7;
    const c = sun.shadow.camera;
    c.left = -R * 0.8; c.right = R * 0.8; c.top = R * 0.8; c.bottom = -R * 0.8; c.near = 1; c.far = R * 4;
    c.updateProjectionMatrix();
    paintSky(cx, cz, s);
    dirty = true;
  }
  function skyColors(s) {
    return { top: mix('#56739e', '#5b9bd8', s.day), hor: mix('#f2c79f', '#dfeaf3', s.day), ground: mix('#9a8f82', '#d3cdc3', s.day) };
  }
  // Gradient sky dome, plus a matching environment map from Medium up so every surface gets soft sky light
  // and glossy floors, glass and metal reflect it.
  function paintSky(cx, cz, s) {
    if (!sky) return;
    const k = skyColors(s), pos = sky.geometry.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const c = k.hor.clone().lerp(k.top, Math.pow(Math.max(0, pos.getY(i) / 450), 0.55));
      col.push(c.r, c.g, c.b);
    }
    sky.geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    sky.position.set(cx, 0, cz);
    sky.visible = quality > 0;
    scene.background = k.hor.clone();
    hemi.color.copy(k.top.clone().lerp(new T.Color('#ffffff'), 0.6));
    hemi.groundColor.copy(k.ground);
    if (quality === 0) { scene.environment = null; return; }
    const key = hour + '|' + quality;
    if (envRT && envRT.key === key) { scene.environment = envRT.texture; return; }
    if (!envScene) {
      envScene = new T.Scene();
      envScene.add(new T.Mesh(new T.SphereGeometry(50, 32, 16), new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    }
    const env = envScene.children[0].geometry, ep = env.attributes.position, ec = [];
    const glow = new T.Color('#fff6e8');
    for (let i = 0; i < ep.count; i++) {
      const y = ep.getY(i) / 50;
      const c = y >= 0 ? k.hor.clone().lerp(k.top, Math.pow(y, 0.6)) : k.hor.clone().lerp(k.ground, Math.min(1, -y * 4));
      // brighter toward the sun so light has a direction even in the shade
      const d = (ep.getX(i) * s.x + ep.getY(i) * s.y + ep.getZ(i) * s.z) / 50;
      c.lerp(glow, Math.max(0, d) * 0.5 * s.day);
      ec.push(c.r * 1.1, c.g * 1.1, c.b * 1.1);
    }
    env.setAttribute('color', new T.Float32BufferAttribute(ec, 3));
    if (!pmrem) pmrem = new T.PMREMGenerator(renderer);
    const old = envRT;
    envRT = pmrem.fromScene(envScene, 0.04);
    envRT.key = key;
    scene.environment = envRT.texture;
    if (old) old.dispose();
  }

  function rebuildWall(id) {
    const p = A().shownProject(), w = M.find(p, 'wall', id), old = wallGroups.get(id);
    if (!w || !old) return;
    root.remove(old); dispose(old);
    const g = buildWall(p, w, p.settings.wallH + FLOOR);
    wallGroups.set(id, g);
    root.add(g);
    syncSelection();
  }

  // Solid wall stretches the walker can't pass. Doorways and passages taller than 1.8 m are open.
  function buildCollision(p, H) {
    collide = [];
    for (const w of p.walls) {
      const v = M.wallVec(w);
      let iv = [[0, v.L]];
      for (const s of openingSpans(p, w, H)) if (s.o.type !== 'window' && s.sill < 0.3 && s.top - s.sill > 1.8) iv = G.subtract(iv, s.from + 0.05, s.to - 0.05);
      for (const [a, b] of iv) collide.push({ a: { x: v.a.x + v.ux * a, y: v.a.y + v.uy * a }, b: { x: v.a.x + v.ux * b, y: v.a.y + v.uy * b }, t: w.t / 2 });
    }
  }
  function blocked(x, z) {
    const q = { x, y: z }, body = BODY / feel;
    for (const s of collide) if (G.project(q, s.a, s.b).d < s.t + body) return true;
    return false;
  }

  /* ---------- selection ---------- */
  // Bounding box of what you see, leaving out the shading strips and contact shadows around it.
  function boxOf(obj) {
    const box = new T.Box3();
    obj.updateWorldMatrix(true, true);
    obj.traverse((c) => { if (c.isMesh && !c.userData.shade) box.expandByObject(c); });
    return box;
  }
  function objectFor(sel) {
    if (!sel || !root) return null;
    if (sel.k === 'wall') return wallGroups.get(sel.id) || null;
    let found = null;
    root.traverse((c) => { if (!found && c.userData.id === sel.id && c.userData.k === sel.k && (c.isGroup || c.isMesh)) found = c; });
    if (found && found.parent && found.parent.userData.id === sel.id) found = found.parent;
    return found;
  }
  function syncSelection() {
    if (!scene) return;
    if (selHelper) { scene.remove(selHelper); selHelper.geometry.dispose(); selHelper = null; }
    const st = S();
    if (st.preview || !st.sel) { dirty = true; return; }
    const obj = objectFor(st.sel);
    if (!obj) return;
    const box = boxOf(obj);
    if (box.isEmpty()) return;
    box.expandByScalar(0.03);
    selHelper = new T.Box3Helper(box, new T.Color(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0f7b6c'));
    selHelper.material.depthTest = false; // stay visible through walls
    selHelper.renderOrder = 999;
    selHelper.visible = !walk.on;
    scene.add(selHelper);
    dirty = true;
  }

  /* ---------- camera ---------- */
  function applyOrbit() {
    const sp = Math.sin(orbit.pol), cp = Math.cos(orbit.pol);
    camera.position.set(orbit.tx + orbit.dist * sp * Math.sin(orbit.az), orbit.ty + orbit.dist * cp, orbit.tz + orbit.dist * sp * Math.cos(orbit.az));
    camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
    const lbl = document.getElementById('zoomLabel');
    if (lbl && orbit.fitDist) lbl.textContent = Math.round((orbit.fitDist / orbit.dist) * 100) + '%';
    dirty = true;
  }
  function fit() {
    if (walk.on) return;
    const p = A().shownProject(), hb = M.houseBounds(p);
    const b = hb && hb.w > 0 ? hb : { x: 0, y: 0, w: p.lot.w, h: p.lot.h };
    orbit.tx = b.x + b.w / 2; orbit.tz = b.y + b.h / 2; orbit.ty = 0;
    orbit.dist = orbit.fitDist = Math.max(12, Math.max(b.w, b.h) * 1.7);
    orbit.az = 0.55; orbit.pol = 0.9;
    applyOrbit();
  }
  function zoom(k) { if (walk.on) return; orbit.dist = Math.max(3, Math.min(180, orbit.dist / k)); applyOrbit(); }

  /* ---------- walking ---------- */
  // Walking fills the window (panels hidden) and F toggles full screen: a bigger picture reads closer to real size.
  function immersive(on) {
    document.body.classList.toggle('walking', on);
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  function startWalk() {
    const p = A().shownProject();
    walk.on = true; walk.keys = {};
    immersive(true);
    camera.near = 0.05;
    applyFov();
    let spot = null;
    for (const o of p.openings) {
      if (o.type !== 'door') continue;
      const g = M.openingGeo(p, o);
      if (!g) continue;
      for (const sgn of [1, -1]) {
        const out = { x: g.c.x + g.v.nx * sgn * 1.8, y: g.c.y + g.v.ny * sgn * 1.8 };
        if (!p.rooms.some((r) => r.use === 'indoor' && G.pointInPoly(out, r.pts))) { spot = { x: out.x, z: out.y, yaw: Math.atan2(-g.v.nx * sgn, -g.v.ny * sgn) + Math.PI }; break; }
      }
      if (spot) break;
    }
    if (!spot) spot = { x: p.lot.w / 2, z: p.lot.h - 2, yaw: 0 };
    walk.x = spot.x; walk.z = spot.z; walk.yaw = spot.yaw; walk.pitch = 0;
    const rf = root && root.getObjectByName('roof');
    if (rf) rf.visible = true;
    if (selHelper) selHelper.visible = false;
    requestLock();
    FP.panels.updateTool();
    dirty = true;
  }
  // Bottom-left readout while walking: the room you're in and its clear size inside the walls.
  let readoutRoom;
  function walkReadout() {
    const box = document.getElementById('walkHud');
    if (!box) return;
    const p = A().shownProject();
    const r = p.rooms.find((rm) => G.pointInPoly({ x: walk.x, y: walk.z }, rm.pts));
    const id = r ? r.id : null;
    if (id === readoutRoom && !box.hidden) return;
    readoutRoom = id;
    box.hidden = false;
    box.textContent = '';
    if (!r) { box.textContent = 'Outside'; return; }
    const b = document.createElement('b');
    b.textContent = r.name;
    const clear = M.clearSize(p, r);
    const line = (clear ? clear.w.toFixed(2) + ' × ' + clear.h.toFixed(2) + ' m' + (clear.rect ? '' : ' overall') + ' · ' : '') + M.clearArea(p, r).toFixed(1) + ' m² usable';
    box.append(b, document.createTextNode('  ' + line));
  }
  function setPerson(h) { personH = Math.max(1.2, Math.min(2.2, h)); save('fp.height', personH); dirty = true; }
  function setPace(v) { pace = Math.max(0.6, Math.min(2.5, v)); save('fp.pace', pace); }

  function exitWalk() {
    const box = document.getElementById('walkHud');
    if (box) box.hidden = true;
    readoutRoom = undefined;
    walk.on = false;
    walk.shift = 0;
    immersive(false);
    camera.near = 0.1;
    applyFov();
    if (document.pointerLockElement) document.exitPointerLock();
    const rf = root && root.getObjectByName('roof');
    if (rf) rf.visible = showRoof;
    if (selHelper) selHelper.visible = true;
    applyOrbit();
    FP.panels.updateTool();
  }
  function requestLock() { try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not available */ } }
  const LENS_TILT = 0.55; // looking further up or down than this tilts the camera too
  function stepWalk(dt) {
    const k = walk.keys;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    if (f || s) {
      const speed = ((k.ShiftLeft || k.ShiftRight ? pace * 2.2 : pace) * dt) / feel;
      const len = Math.hypot(f, s);
      const dx = ((-Math.sin(walk.yaw) * f + Math.cos(walk.yaw) * s) / len) * speed;
      const dz = ((-Math.cos(walk.yaw) * f - Math.sin(walk.yaw) * s) / len) * speed;
      const p = A().shownProject();
      const nx = Math.max(-5, Math.min(p.lot.w + 5, walk.x + dx)), nz = Math.max(-5, Math.min(p.lot.h + 5, walk.z + dz));
      if (!blocked(nx, nz)) { walk.x = nx; walk.z = nz; } else if (!blocked(nx, walk.z)) walk.x = nx; else if (!blocked(walk.x, nz)) walk.z = nz;
      dirty = true;
    }
    const lp = straight ? Math.max(-LENS_TILT, Math.min(LENS_TILT, walk.pitch)) : 0, cp = walk.pitch - lp;
    walk.shift = Math.tan(lp);
    camera.position.set(walk.x, eye(), walk.z);
    camera.lookAt(walk.x - Math.sin(walk.yaw) * Math.cos(cp), eye() + Math.sin(cp), walk.z - Math.cos(walk.yaw) * Math.cos(cp));
    walkReadout();
  }

  /* ---------- pointer ---------- */
  const ray = () => new T.Raycaster();
  function ndc(e) {
    const r = renderer.domElement.getBoundingClientRect();
    return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  function hits(e) {
    const rc = ray();
    rc.setFromCamera(ndc(e), camera);
    return rc.intersectObject(root, true).filter((h) => h.object.userData.k);
  }
  function pickable(h) {
    const k = h.object.userData.k;
    if (k === 'ground') return false;
    const layer = S().layers[LAYER_OF[k]];
    return !!layer && layer.visible && !layer.locked;
  }
  function planeHit(e, plane) {
    const rc = ray();
    rc.setFromCamera(ndc(e), camera);
    const out = new T.Vector3();
    return rc.ray.intersectPlane(plane, out) ? out : null;
  }

  function onDown(e) {
    if (walk.on) { if (!walk.locked) requestLock(); return; }
    renderer.domElement.setPointerCapture(e.pointerId);
    const st = S();
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    gesture = { type: pan ? 'pan' : 'orbit', sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    if (pan || st.preview) return;

    const all = hits(e);
    const floorHit = all.find((x) => ['ground', 'room', 'area'].includes(x.object.userData.k));
    if ((st.tool === 'item' || st.tool === 'plant') && floorHit) {
      const pt = floorHit.point;
      if (st.tool === 'item') {
        const d = C.items[st.opts.item];
        const it = { id: M.uid('i'), kind: st.opts.item, x: G.round(G.snap(pt.x, 0.05)), y: G.round(G.snap(pt.z, 0.05)), w: d.w, h: d.h, rot: st.opts.itemRot || 0 };
        A().mutate((p) => p.items.push(it));
        A().select({ k: 'item', id: it.id });
      } else {
        const pl = { id: M.uid('p'), kind: st.opts.plant, x: G.round(G.snap(pt.x, 0.1)), y: G.round(G.snap(pt.z, 0.1)), r: C.plants[st.opts.plant].r };
        A().mutate((p) => p.plants.push(pl));
        A().select({ k: 'plant', id: pl.id });
      }
      gesture = null;
      return;
    }
    const h = all.find(pickable);
    if (!h) return; // empty space: orbit, deselect on click
    const sel = { k: h.object.userData.k, id: h.object.userData.id };
    gesture.hit = sel;
    if (sel.k === 'item' || sel.k === 'plant') {
      const p = st.project, ent = M.find(p, sel.k, sel.id);
      const pt = planeHit(e, new T.Plane(new T.Vector3(0, 1, 0), 0));
      if (ent && pt) gesture = Object.assign(gesture, { type: 'drag', ent, offX: pt.x - ent.x, offZ: pt.z - ent.y, obj: objectFor(sel) });
    } else if (sel.k === 'opening') {
      const p = st.project, o = M.find(p, 'opening', sel.id), w = o && M.find(p, 'wall', o.wall);
      if (o && w) {
        const v = M.wallVec(w);
        const plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(v.nx, 0, v.ny), new T.Vector3(v.a.x, 0, v.a.y));
        const pt = planeHit(e, plane);
        if (pt) {
          const s = (pt.x - v.a.x) * v.ux + (pt.z - v.a.y) * v.uy;
          gesture = Object.assign(gesture, { type: 'slide', ent: o, v, plane, ds: s - o.pos, dy: pt.y - o.sill });
        }
      }
    }
    if (!st.sel || st.sel.id !== sel.id) A().select(sel);
    if (gesture.type === 'drag' || gesture.type === 'slide') A().beginChange();
  }

  function onMove(e) {
    if (walk.on) return;
    const g = gesture;
    if (!g) { hoverCursor(e); return; }
    const dx = e.clientX - g.lx, dy = e.clientY - g.ly;
    g.lx = e.clientX; g.ly = e.clientY;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 3) g.moved = true;
    if (!g.moved) return;
    if (g.type === 'orbit') {
      orbit.az -= dx * 0.008;
      orbit.pol = Math.max(0.12, Math.min(1.48, orbit.pol - dy * 0.008));
      applyOrbit();
    } else if (g.type === 'pan') {
      const k = orbit.dist * 0.0016;
      const rx = Math.cos(orbit.az), rz = -Math.sin(orbit.az), fx = -Math.sin(orbit.az), fz = -Math.cos(orbit.az);
      orbit.tx += (-dx * rx + dy * -fx) * k; orbit.tz += (-dx * rz + dy * -fz) * k;
      applyOrbit();
    } else if (g.type === 'drag') {
      const pt = planeHit(e, new T.Plane(new T.Vector3(0, 1, 0), 0));
      if (!pt) return;
      const step = e.altKey ? 0 : Math.min(0.05, S().snap || 0.01);
      g.ent.x = G.round(G.snap(pt.x - g.offX, step));
      g.ent.y = G.round(G.snap(pt.z - g.offZ, step));
      if (g.obj) g.obj.position.set(g.ent.x, g.obj.position.y, g.ent.y);
      syncSelection();
    } else if (g.type === 'slide') {
      const pt = planeHit(e, g.plane);
      if (!pt) return;
      const o = g.ent, H = S().project.settings.wallH, step = e.altKey ? 0 : 0.05;
      const s = (pt.x - g.v.a.x) * g.v.ux + (pt.z - g.v.a.y) * g.v.uy;
      o.pos = G.round(Math.max(o.w / 2, Math.min(g.v.L - o.w / 2, G.snap(s - g.ds, step))));
      o.sill = G.round(Math.max(0, Math.min(H - o.h, G.snap(pt.y - g.dy, step))));
      rebuildWall(o.wall);
    }
  }

  function onUp(e) {
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.type === 'drag' || g.type === 'slide') A().endChange(g.moved);
    else if (!g.moved && !g.hit && g.type === 'orbit' && S().sel) A().select(null);
  }

  function hoverCursor(e) {
    if (S().preview) return;
    const h = hits(e).find(pickable);
    const k = h && h.object.userData.k;
    renderer.domElement.style.cursor = k === 'item' || k === 'plant' || k === 'opening' ? 'move' : (S().tool === 'item' || S().tool === 'plant') ? 'crosshair' : 'grab';
  }

  function onWheel(e) {
    e.preventDefault();
    if (walk.on) return;
    orbit.dist = Math.max(3, Math.min(180, orbit.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    applyOrbit();
  }

  function onMouseLook(e) {
    if (!walk.on || !walk.locked) return;
    walk.yaw -= e.movementX * 0.0022;
    walk.pitch = Math.max(-1.35, Math.min(1.35, walk.pitch - e.movementY * 0.0022));
    dirty = true;
  }
  function onKey(e, down) {
    if (!walk.on || !active) return;
    const t = document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (down && e.code === 'Escape' && !walk.locked) { exitWalk(); return; }
    if (down && e.code === 'KeyF' && !e.repeat) { toggleFullscreen(); e.preventDefault(); return; }
    walk.keys[e.code] = down;
    if (/^(Key[WASD]|Arrow|Shift)/.test(e.code)) e.preventDefault();
  }

  /* ---------- lifecycle ---------- */
  function ensure() {
    if (renderer) return true;
    T = window.THREE;
    if (!T) return false;
    host = document.getElementById('view3d');
    try {
      renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(50, 1, 0.1, 600);
    hemi = new T.HemisphereLight('#eef6ff', '#b3aa96', 1.15);
    fill = new T.AmbientLight('#fff8ee', 0.35);
    sun = new T.DirectionalLight('#fff4e2', 1.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(hemi, fill, sun, sun.target);
    sky = new T.Mesh(new T.SphereGeometry(450, 32, 16), new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);
    post = FP.post3d(T, renderer);
    applyQuality();
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', onMouseLook);
    document.addEventListener('keydown', (e) => onKey(e, true));
    document.addEventListener('keyup', (e) => onKey(e, false));
    document.addEventListener('pointerlockchange', () => { walk.locked = document.pointerLockElement === cv; FP.panels.updateTool(); });
    new ResizeObserver(resize).observe(host);
    resize();
    return true;
  }
  function resize() {
    if (!renderer) return;
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyFov();
  }
  // Orbit keeps a 50° vertical lens. Walking sets the projection every frame (see draw).
  function applyFov() {
    if (!camera) return;
    camera.fov = 50;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const fovNow = () => (lens === 'wide' ? fovWide : fovNormal);
  function setFov(deg) {
    if (lens === 'wide') { fovWide = Math.max(90, Math.min(160, Math.round(deg))); save('fp.fovw', fovWide); }
    else { fovNormal = Math.max(60, Math.min(120, Math.round(deg))); save('fp.fov', fovNormal); }
    dirty = true;
  }
  const PANINI = 0.5; // half-strength Panini: edges barely stretch and straight lines barely bow
  function draw() {
    // Medium and High always go through the lens pass, so shading multiplies in linear light before tone mapping
    if (walk.on) post.render(scene, camera, { hfov: fovNow(), shift: walk.shift, panini: lens === 'wide' ? PANINI : 0, pass: quality > 0 });
    else post.render(scene, camera, { hfov: (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI, shift: 0, panini: 0, pass: quality > 0 });
  }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    if (walk.on) stepWalk(dt);
    if (dirty || walk.on) { draw(); dirty = false; }
  }

  function show() {
    if (!ensure()) { A().toast('3D needs WebGL, which is not available here.'); return false; }
    active = true;
    host.hidden = false;
    resize();
    const first = !root;
    build();
    if (first) fit(); else applyOrbit();
    if (!raf) { last = 0; raf = requestAnimationFrame(loop); }
    return true;
  }
  function hide() {
    active = false;
    if (walk.on) exitWalk();
    if (host) host.hidden = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function rebuild() { if (active && !gesture) build(); }
  function setRoof(v) {
    showRoof = v;
    const rf = root && root.getObjectByName('roof');
    if (rf && !walk.on) rf.visible = v;
    dirty = true;
  }

  /* ---------- detail level ---------- */
  function applyQuality() {
    if (!renderer) return;
    renderer.setPixelRatio(quality === 0 ? 1 : Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = quality ? T.ACESFilmicToneMapping : T.NoToneMapping;
    renderer.toneMappingExposure = quality ? 1.05 : 1;
    // Medium and High light the scene from the sky's environment map; Low keeps the simple sky/ground light.
    hemi.intensity = quality ? 0.35 : 1.6;
    fill.intensity = quality ? 0 : 0.6;
    const ms = [1024, 2048, 4096][quality];
    sun.shadow.mapSize.set(ms, ms);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (sky) sky.visible = quality > 0;
    resize();
  }
  function setQuality(q) {
    q = Math.max(0, Math.min(2, Math.round(q)));
    if (q === quality) return;
    quality = q;
    save('fp.detail', q);
    for (const t of texs.values()) t.dispose();
    texs.clear();
    for (const m of mats.values()) m.dispose();
    mats.clear();
    applyQuality();
    if (active) build();
  }
  // World-space size of an entity's 3D model, in metres (x across, y up, z = plan depth).
  function sizeOf(sel) {
    const o = objectFor(sel);
    if (!o) return null;
    const v = boxOf(o).getSize(new T.Vector3());
    return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
  }

  function screenshot() { draw(); return renderer.domElement.toDataURL('image/png'); }
  // Window coordinates of a plan point at height y (used by tests and tooltips).
  function screenOf(x, planY, y) {
    const v = new T.Vector3(x, y, planY).project(camera), r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  FP.view3d = {
    show, hide, rebuild, syncSelection, fit, zoom, startWalk, exitWalk, setRoof, screenshot, screenOf,
    setQuality, sizeOf, quality: () => quality, setFov, fov: fovNow,
    setPerson, person: () => personH, setPace, pace: () => pace,
    lens: () => lens, setLens(v) { lens = v === 'normal' ? 'normal' : 'wide'; save('fp.lens', lens); dirty = true; },
    feel: () => feel, setFeel(v) { feel = Math.max(1, Math.min(1.5, Math.round(v * 20) / 20)); save('fp.feel', feel); dirty = true; },
    straight: () => straight, setStraight(v) { straight = !!v; save('fp.straight', straight ? 1 : 0); dirty = true; },
    time: () => hour, setTime(h) { hour = Math.max(6, Math.min(19, h)); save('fp.time', hour); if (scene && root) placeSun(A().shownProject()); },
    toggleFullscreen,
    // Stand at plan point (x, y) facing yaw degrees (0 = north, 90 = west), looking pitch degrees up; starts walking if needed.
    walkTo(x, y, yawDeg, pitchDeg) { if (!walk.on) startWalk(); walk.x = x; walk.z = y; walk.yaw = ((yawDeg || 0) * Math.PI) / 180; walk.pitch = ((pitchDeg || 0) * Math.PI) / 180; dirty = true; },
    isActive: () => active, isWalking: () => walk.on, isLocked: () => walk.locked, roofShown: () => showRoof
  };
})();
