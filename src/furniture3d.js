// Detailed low-poly furniture and plant models for the 3D view, built from core THREE primitives.
// Local frame: footprint w (x) × h (z) centred on the origin, floor at y = 0, back at z = -h/2, front faces +z.
// Quality 0/1/2 = low/medium/high. Meshes are merged per material before returning, so each model is a
// handful of draw calls. Materials come only from the caller's cached factories (mats).
window.FP = window.FP || {};

(function () {
  let T = null, Q = 1, M = null;
  const PI = Math.PI;
  const OAK = '#b08a5e', WALNUT = '#6b4a33', TEAK = '#9b7451', LINEN = '#d9d2c4', GREYF = '#a7a39c';
  const BLACK = '#262729', CHROME = '#d7dadd', STEEL = '#bfc4c8', CERAMIC = '#f7f7f5', BRASS = '#c2a46e', IRON = '#2e3032';
  const BOOKS = ['#7d4b3a', '#3f5a6b', '#8a8f6a', '#c9b48a', '#5b4a6b', '#a85d4a', '#2f4a3f', '#d8cfbf', '#6b6f73', '#b8873f', '#8c3f3f', '#46505c'];

  const q3 = (lo, mid, hi) => (Q === 0 ? lo : Q === 1 ? mid : hi);
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const SHADE = () => M.matte('#24221f'); // dark backing that shows through the gaps between fronts

  /* ---------- primitives ---------- */
  function at(o, x, y, z, ry) { o.position.set(x || 0, y || 0, z || 0); if (ry) o.rotation.y = ry; return o; }
  function mesh(geo, mat, x, y, z) { return at(new T.Mesh(geo, mat), x, y, z); }
  function group(parent, x, y, z, ry) { const g = at(new T.Group(), x, y, z, ry); if (parent) parent.add(g); return g; }
  // Box between corners (either order).
  function box(x0, x1, y0, y1, z0, z1, mat) {
    return mesh(new T.BoxGeometry(Math.max(0.002, Math.abs(x1 - x0)), Math.max(0.002, Math.abs(y1 - y0)), Math.max(0.002, Math.abs(z1 - z0))), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  // Box geometry with edges rounded to radius r using k segments per edge (0 = sharp).
  // flatTop keeps the top face flat and its edges square (open basins).
  function rgeo(sx, sy, sz, r, k, flatTop) {
    r = Math.min(r, sx / 2, sy / 2, sz / 2) * 0.999;
    if (!k || r < 0.0015) return new T.BoxGeometry(sx, sy, sz);
    const n = 2 * k + 1, g = new T.BoxGeometry(1, 1, 1, n, n, n), p = g.attributes.position.array, nr = g.attributes.normal.array;
    const hs = [sx / 2, sy / 2, sz / 2], d = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < p.length; i += 3) {
      let len = 0;
      for (let a = 0; a < 3; a++) {
        const hh = hs[a], j = Math.round((p[i + a] + 0.5) * n), v = j <= k ? -hh + (r * j) / k : hh - (r * (n - j)) / k;
        c[a] = Math.max(-hh + r, Math.min(flatTop && a === 1 ? hh : hh - r, v));
        d[a] = v - c[a];
        len += d[a] * d[a];
      }
      len = Math.sqrt(len);
      const s = len > r ? r / len : 1, top = flatTop && nr[i + 1] > 0.5;
      for (let a = 0; a < 3; a++) {
        p[i + a] = c[a] + d[a] * s;
        if (!top && len > 1e-7) nr[i + a] = d[a] / len;
      }
    }
    return g;
  }
  // Rounded box between corners; k caps the edge segments (default 2), Low is always sharp.
  function rbox(x0, x1, y0, y1, z0, z1, r, mat, k, flatTop) {
    const kk = Q === 0 ? 0 : Math.min(k == null ? 2 : k, Q);
    return mesh(rgeo(Math.max(0.002, x1 - x0), Math.max(0.002, y1 - y0), Math.max(0.002, z1 - z0), r, kk, flatTop), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  // Flip a closed indexed geometry inside out so its inner faces show (basins, tubs).
  function inside(geo) {
    const ix = geo.index.array, nr = geo.attributes.normal.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    for (let i = 0; i < nr.length; i++) nr[i] = -nr[i];
    return geo;
  }
  // Vertical cylinder or frustum.
  function cyl(x, z, rt, rb, y0, y1, mat, n, open) {
    return mesh(new T.CylinderGeometry(rt, rb, Math.max(0.002, y1 - y0), n || q3(8, 12, 20), 1, !!open), mat, x, (y0 + y1) / 2, z);
  }
  // Disc facing +z (dials, portholes, mirrors), from z0 to z1.
  function disc(x, y, z0, z1, r, mat, n) {
    const geo = new T.CylinderGeometry(r, r, Math.max(0.002, z1 - z0), n || q3(12, 20, 32));
    geo.rotateX(PI / 2);
    return mesh(geo, mat, x, y, (z0 + z1) / 2);
  }
  // Round rod from a to b (radius r at a, r2 at b).
  function rod(a, b, r, mat, n, r2) {
    const d = b.clone().sub(a), len = d.length();
    const m = mesh(new T.CylinderGeometry(r2 == null ? r : r2, r, len, n || q3(4, 6, 8)), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return m;
  }
  // Square bar from a to b, t thick across x and u across z.
  function bar(a, b, t, mat, u) {
    const d = b.clone().sub(a), len = d.length();
    const m = mesh(new T.BoxGeometry(t, len, u || t), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return m;
  }
  // Surface of revolution around y from [radius, y] points (bottom to top shows the outside).
  function lathe(pts, mat, n, x, y, z) {
    return mesh(new T.LatheGeometry(pts.map((p) => new T.Vector2(Math.max(0, p[0]), p[1])), n || q3(10, 16, 24)), mat, x, y, z);
  }
  function torusGeo(R, r, n, arc) { return new T.TorusGeometry(R, r, q3(4, 6, 8), n || q3(12, 20, 32), arc || PI * 2); }
  // Lumpy blob: icosphere pushed in and out by smooth noise of direction, so shared corners stay joined.
  function lumpy(geo, amt, ph) {
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2], l = Math.hypot(x, y, z) || 1, ux = x / l, uy = y / l, uz = z / l;
      const f = 1 + amt * (Math.sin(ux * 5.1 + ph) * Math.cos(uz * 4.3 - ph * 0.7) + 0.7 * Math.sin(uy * 6.7 + ph * 1.9) * Math.cos(ux * 3.1 + uz * 2.3));
      p[i] = x * f; p[i + 1] = y * f; p[i + 2] = z * f;
    }
    geo.computeVertexNormals();
    return geo;
  }

  /* ---------- outlines and extrusions ---------- */
  function rrect(p, x0, y0, x1, y1, r) {
    r = Math.max(0, Math.min(r, (x1 - x0) / 2 - 1e-4, (y1 - y0) / 2 - 1e-4));
    if (r <= 0.001) { p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); return p; }
    p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.absarc(x1 - r, y0 + r, r, -PI / 2, 0, false);
    p.lineTo(x1, y1 - r); p.absarc(x1 - r, y1 - r, r, 0, PI / 2, false);
    p.lineTo(x0 + r, y1); p.absarc(x0 + r, y1 - r, r, PI / 2, PI, false);
    p.lineTo(x0, y0 + r); p.absarc(x0 + r, y0 + r, r, PI, PI * 1.5, false);
    return p;
  }
  function poly(pts) { const s = new T.Shape(); pts.forEach((q, i) => (i ? s.lineTo(q[0], q[1]) : s.moveTo(q[0], q[1]))); return s; }
  function extrude(shape, depth, bev, bsegs) {
    return new T.ExtrudeGeometry(shape, { depth: Math.max(0.001, depth - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: bsegs || q3(1, 2, 3), curveSegments: q3(2, 4, 6) });
  }
  // Plan outline (u = x, v = -z) extruded up from y0 by hgt. A bevel grows the outline by bev at mid-height.
  function slabY(shape, y0, hgt, bev, mat, bsegs) {
    const geo = extrude(shape, hgt, bev, bsegs);
    geo.rotateX(-PI / 2);
    geo.translate(0, y0 + bev, 0);
    return new T.Mesh(geo, mat);
  }
  // Side outline (u = z, v = y) extruded across x, centred, wd wide in total.
  function slabX(shape, wd, bev, mat, bsegs) {
    const geo = extrude(shape, wd, bev, bsegs);
    geo.rotateY(-PI / 2);
    geo.translate(wd / 2 - bev, 0, 0);
    return new T.Mesh(geo, mat);
  }
  // Flat outline facing up at height y.
  function flatY(shape, y, mat) {
    const geo = new T.ShapeGeometry(shape, q3(3, 6, 10));
    geo.rotateX(-PI / 2);
    geo.translate(0, y, 0);
    return new T.Mesh(geo, mat);
  }

  /* ---------- shared parts ---------- */
  // Drawer or door front: zf is its front face, t its thickness, gap the reveal on each side.
  function panel(g, x0, x1, y0, y1, zf, t, mat, gap) {
    const e = gap == null ? 0.0015 : gap;
    g.add(box(x0 + e, x1 - e, y0 + e, y1 - e, zf - t, zf, mat));
  }
  // Bar pull centred at (x, y) on a front whose face is at zf; sticks out 2 cm.
  function pull(g, x, y, zf, len, vertical, mat) {
    const hx = vertical ? 0.006 : len / 2, hy = vertical ? len / 2 : 0.006;
    if (Q < 2) { g.add(box(x - hx, x + hx, y - hy, y + hy, zf, zf + 0.02, mat)); return; }
    g.add(box(x - hx, x + hx, y - hy, y + hy, zf + 0.009, zf + 0.02, mat));
    for (const s of [-1, 1]) {
      const ox = vertical ? 0 : s * (len / 2 - 0.012), oy = vertical ? s * (len / 2 - 0.012) : 0;
      g.add(disc(x + ox, y + oy, zf, zf + 0.01, 0.004, mat, 6));
    }
  }
  function vase(g, x, y, z, s, mat) {
    g.add(lathe([[0, 0], [0.045, 0], [0.065, 0.05], [0.06, 0.13], [0.03, 0.2], [0.034, 0.24], [0.026, 0.24], [0, 0.2]].map((p) => [p[0] * s, y + p[1] * s]), mat, q3(8, 12, 18), x, 0, z));
  }
  function bookStack(g, x, y, z, ry, n) {
    const p = group(g, x, y, z, ry);
    let yy = 0;
    for (let i = 0; i < n; i++) {
      const bw = 0.22 - i * 0.025, bd = 0.16 - i * 0.015, t = 0.022 + (i % 2) * 0.01;
      p.add(box(-bw / 2, bw / 2, yy, yy + t, -bd / 2, bd / 2, M.matte(BOOKS[(i * 5 + 1) % BOOKS.length])));
      yy += t;
    }
  }
  // Small leafy plant in a pot: pot radius pr, foliage radius fr, standing on y.
  function pottedPlant(g, x, y, z, pr, fr, rnd) {
    g.add(lathe([[pr * 0.75, 0], [pr, pr * 1.1], [pr * 1.05, pr * 1.2], [pr * 0.9, pr * 1.2], [0, pr * 1.1]].map((p) => [p[0], y + p[1]]), M.gloss('#e9e5dd'), q3(8, 12, 16), x, 0, z));
    const n = q3(1, 2, 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = i ? fr * 0.35 : 0;
      const b = mesh(lumpy(new T.IcosahedronGeometry(fr * (i ? 0.7 : 1), 1), 0.15, rnd() * 9), M.leaf(i % 2 ? '#5f8f45' : '#4f7f3a'), x + Math.cos(a) * d, y + pr * 1.2 + fr * 0.8, z + Math.sin(a) * d);
      b.scale.y = 0.85;
      g.add(b);
    }
  }

  /* ---------- merge ---------- */
  function flipWinding(geo) {
    for (const key of ['position', 'normal', 'uv']) {
      const a = geo.attributes[key];
      if (!a) continue;
      const s = a.itemSize, arr = a.array;
      for (let i = 0; i < a.count; i += 3) for (let c = 0; c < s; c++) { const j = (i + 1) * s + c, k = (i + 2) * s + c, t = arr[j]; arr[j] = arr[k]; arr[k] = t; }
    }
  }
  // Bake every mesh into one geometry per material.
  function merge(root) {
    root.updateMatrixWorld(true);
    const by = new Map();
    root.traverse((o) => { if (o.isMesh) { if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(o); } });
    const out = new T.Group();
    by.forEach((list, mat) => {
      const parts = list.map((o) => {
        const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        o.geometry.dispose();
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.applyMatrix4(o.matrixWorld);
        if (o.matrixWorld.determinant() < 0) flipWinding(geo);
        return geo;
      });
      let n = 0;
      parts.forEach((p) => { n += p.attributes.position.count; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let o = 0;
      parts.forEach((p) => {
        pos.set(p.attributes.position.array, o * 3);
        nor.set(p.attributes.normal.array, o * 3);
        if (p.attributes.uv) uv.set(p.attributes.uv.array, o * 2);
        o += p.attributes.position.count;
        p.dispose();
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      out.add(new T.Mesh(geo, mat));
    });
    return out;
  }

  const ITEMS = {};

  /* ---------- bedroom ---------- */
  function bed(g, w, h, pillows) {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, wood = M.wood(OAK), head = M.fabric('#9d978d'), legH = Q ? 0.1 : 0;
    if (Q) for (const sx of [-1, 1]) for (const z of [z0 + 0.14, z1 - 0.07]) g.add(cyl(sx * (w / 2 - 0.07), z, 0.028, 0.02, 0, legH + 0.01, wood, 8));
    g.add(rbox(x0 + 0.01, x1 - 0.01, legH, 0.33, z0 + 0.07, z1, 0.012, wood, 1));
    // upholstered headboard, channel-tufted at High
    if (Q === 2) {
      const n = Math.max(3, Math.round(w / 0.2)), pw = w / n;
      for (let i = 0; i < n; i++) g.add(rbox(x0 + i * pw + 0.002, x0 + (i + 1) * pw - 0.002, 0.12, 1.06, z0, z0 + 0.075, 0.035, head, 1));
    } else g.add(rbox(x0, x1, 0.12, 1.06, z0, z0 + 0.075, 0.035, head));
    g.add(rbox(x0 + 0.03, x1 - 0.03, 0.3, 0.54, z0 + 0.08, z1 - 0.02, 0.04, M.fabric('#f4f2ee'), 1));
    const zf = z0 + Math.min(0.62, h * 0.32);
    g.add(rbox(x0 + 0.008, x1 - 0.008, 0.4, 0.6, zf, z1 - 0.005, 0.05, M.fabric('#e7e1d6')));
    g.add(rbox(x0 + 0.01, x1 - 0.01, 0.44, 0.615, zf - 0.02, zf + 0.24, 0.045, M.fabric('#f6f4ef')));
    if (Q) g.add(rbox(x0, x1, 0.43, 0.622, z1 - Math.min(0.6, h * 0.3), z1 - Math.min(0.22, h * 0.11), 0.02, M.fabric('#8d9c8f'), 1));
    // pillows propped against the headboard
    const pd = Math.min(0.46, h * 0.24), pw = Math.min(0.78, (w - 0.14 - (pillows - 1) * 0.04) / pillows);
    for (let i = 0; i < pillows; i++) {
      const p = group(g, (i - (pillows - 1) / 2) * (pw + 0.04), 0.67, z0 + 0.075 + pd / 2 + 0.02);
      p.rotation.x = 0.35;
      p.add(rbox(-pw / 2, pw / 2, -0.065, 0.065, -pd / 2, pd / 2, 0.06, M.fabric('#fbfaf7')));
    }
    if (Q) {
      const s = Math.min(0.45, w * 0.32), c = group(g, 0, 0.6 + s * 0.5, z0 + 0.075 + pd + 0.05);
      c.rotation.x = 1.2;
      c.add(rbox(-s / 2, s / 2, -0.07, 0.07, -s / 2, s / 2, 0.065, M.fabric('#b8835e')));
    }
  }
  ITEMS['bed-double'] = (g, w, h) => bed(g, w, h, 2);
  ITEMS['bed-single'] = (g, w, h) => bed(g, w, h, 1);

  ITEMS['nightstand'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, wood = M.wood(WALNUT), legH = Q ? 0.14 : 0, top = 0.56, zf = z1 - 0.02;
    if (Q) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(sx * (w / 2 - 0.045), sz * (h / 2 - 0.045), 0.016, 0.011, 0, legH + 0.005, wood, 8));
    g.add(rbox(x0, x1, top - 0.025, top, z0, z1, 0.006, wood, 1));
    g.add(box(x0 + 0.005, x0 + 0.025, legH, top - 0.025, z0 + 0.005, zf, wood), box(x1 - 0.025, x1 - 0.005, legH, top - 0.025, z0 + 0.005, zf, wood));
    g.add(box(x0 + 0.025, x1 - 0.025, legH, legH + 0.022, z0 + 0.005, zf, wood));
    g.add(box(x0 + 0.025, x1 - 0.025, legH, top - 0.025, z0 + 0.005, z0 + 0.02, wood));
    const dy = legH + (top - legH) * 0.5;
    g.add(box(x0 + 0.025, x1 - 0.025, dy, top - 0.025, z0 + 0.02, zf - 0.018, wood));
    panel(g, x0 + 0.026, x1 - 0.026, dy, top - 0.026, zf, 0.018, M.wood('#7a5640'));
    pull(g, 0, (dy + top - 0.026) / 2, zf, Math.min(0.12, w * 0.3), false, M.metal(BRASS));
    if (Q) {
      // table lamp: ceramic base, brass stem, glowing shade
      const lx = x0 + w * 0.4, lz = z0 + h * 0.42, s = Math.min(1, w / 0.45, h / 0.4);
      g.add(lathe([[0, 0], [0.055, 0], [0.068, 0.025], [0.072, 0.1], [0.05, 0.18], [0.016, 0.205], [0, 0.21]].map((p) => [p[0] * s, top + p[1] * s]), M.gloss('#c9d3cc'), 0, lx, 0, lz));
      g.add(cyl(lx, lz, 0.006, 0.006, top + 0.2 * s, top + 0.29 * s, M.metal(BRASS), 6));
      g.add(cyl(lx, lz, 0.085 * s, 0.115 * s, top + 0.25 * s, top + 0.42 * s, M.emissive('#f6e8cc'), q3(10, 16, 24)));
      if (Q === 2 && w >= 0.4 && h >= 0.35) bookStack(g, x1 - 0.13, top, z1 - 0.12, 0.3, 2);
    }
  };

  ITEMS['wardrobe'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, H = 2.1, oak = M.wood(OAK), door = M.wood('#bf9a6e'), zf = z1 - 0.022;
    const nd = Math.max(1, Math.round(w / 0.5)), dw = (w - 0.01) / nd, hm = M.metal(BLACK);
    g.add(box(x0 + 0.02, x1 - 0.02, 0, 0.08, z0 + 0.02, zf - 0.06, M.matte('#3a3530')));
    g.add(box(x0, x1, 0.08, H, z0, zf - 0.018, oak));
    g.add(box(x0 + 0.004, x1 - 0.004, 0.082, H - 0.004, zf - 0.0185, zf - 0.0175, SHADE()));
    for (let i = 0; i < nd; i++) {
      const a = x0 + 0.005 + i * dw, b = a + dw;
      panel(g, a, b, 0.083, H - 0.003, zf, 0.017, door, 0.002);
      const hx = (i % 2 === 0 && i + 1 < nd) || nd === 1 ? b - 0.045 : a + 0.045;
      pull(g, hx, 1.05, zf, Q ? 0.42 : 0.3, true, hm);
    }
  };

  ITEMS['dresser'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, H = 0.8, legH = Q ? 0.13 : 0, wal = M.wood(WALNUT), fr = M.wood('#7a5640'), zf = z1 - 0.022;
    if (Q) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(sx * (w / 2 - 0.06), sz * (h / 2 - 0.06), 0.02, 0.013, 0, legH + 0.005, wal, 8));
    g.add(rbox(x0, x1, H - 0.025, H, z0, z1, 0.006, wal, 1));
    g.add(box(x0 + 0.006, x1 - 0.006, legH, H - 0.025, z0, zf - 0.018, wal));
    g.add(box(x0 + 0.01, x1 - 0.01, legH + 0.003, H - 0.028, zf - 0.0185, zf - 0.0175, SHADE()));
    const cols = w >= 1 ? 2 : 1, rows = 3, fx0 = x0 + 0.01, fw = (w - 0.02) / cols, fy0 = legH + 0.005, fh = (H - 0.03 - fy0) / rows;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      panel(g, fx0 + c * fw, fx0 + (c + 1) * fw, fy0 + r * fh, fy0 + (r + 1) * fh, zf, 0.018, fr, 0.0025);
      pull(g, fx0 + (c + 0.5) * fw, fy0 + (r + 0.5) * fh, zf, Math.min(0.16, fw * 0.35), false, M.metal(BRASS));
    }
    if (Q === 2) {
      vase(g, x1 - 0.16, H, z0 + h * 0.45, 1, M.gloss('#d9cbb6'));
      const f = group(g, x0 + 0.25, H, z0 + h * 0.4, 0.25);
      const fm = box(-0.09, 0.09, 0, 0.24, -0.008, 0.008, M.matte('#2b2a28'));
      fm.rotation.x = -0.15;
      f.add(fm);
      const ph = box(-0.075, 0.075, 0.015, 0.225, 0.008, 0.009, M.matte('#c7d0d3'));
      ph.rotation.x = -0.15;
      f.add(ph);
    }
  };

  /* ---------- living ---------- */
  // Back cushion standing on y, its bottom centre at (cx, cz), len wide, leaning back; ry turns it.
  function backCush(g, cx, y, cz, len, ry, mat, th, k) {
    const p = group(g, cx, y, cz, ry), c = rbox(-len / 2 + 0.005, len / 2 - 0.005, -0.21, 0.21, -th / 2, th / 2, 0.06, mat, k);
    c.position.y = 0.21;
    c.rotation.x = -0.13;
    p.add(c);
  }
  // Throw pillow, s square, its centre at (x, y, z), leaning back.
  function pillow(g, x, y, z, s, ry, mat) {
    const p = group(g, x, y, z, ry), c = rbox(-s / 2, s / 2, -s / 2, s / 2, -0.065, 0.065, 0.06, mat);
    c.rotation.x = -0.28;
    p.add(c);
  }
  function sofaLegs(g, pts, legH, mat) { if (Q) for (const [x, z] of pts) g.add(cyl(x, z, 0.022, 0.016, 0, legH + 0.01, mat, 8)); }
  function sofa(g, w, h, o) {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, arm = o.arm, legH = Q ? 0.1 : 0, fab = o.fab, bt = 0.2;
    const lp = [[x0 + 0.06, z0 + 0.06], [x1 - 0.06, z0 + 0.06], [x0 + 0.06, z1 - 0.06], [x1 - 0.06, z1 - 0.06]];
    if (w > 1.9) lp.push([0, z0 + 0.06], [0, z1 - 0.06]);
    sofaLegs(g, lp, legH, M.wood(WALNUT));
    g.add(rbox(x0, x0 + arm, legH, o.armH || 0.62, z0, z1, 0.06, fab));
    g.add(rbox(x1 - arm, x1, legH, o.armH || 0.62, z0, z1, 0.06, fab));
    g.add(rbox(x0 + arm - 0.03, x1 - arm + 0.03, legH, 0.7, z0, z0 + bt, 0.05, fab, 1));
    g.add(rbox(x0 + arm - 0.03, x1 - arm + 0.03, legH, 0.33, z0 + bt - 0.03, z1 - 0.01, 0.03, fab, 1));
    const n = o.n || Math.max(1, Math.round((w - 2 * arm) / 0.75)), cw = (w - 2 * arm) / n;
    for (let i = 0; i < n; i++) {
      const cx = x0 + arm + cw * (i + 0.5);
      g.add(rbox(cx - cw / 2 + 0.004, cx + cw / 2 - 0.004, 0.31, 0.47, z0 + bt + 0.005, z1 - 0.005, 0.05, fab));
      backCush(g, cx, 0.44, z0 + 0.15, cw, 0, fab, 0.2);
    }
    if (Q && o.pillows) {
      pillow(g, x0 + arm + 0.24, 0.67, z0 + bt + 0.12, 0.42, 0.12, o.pillows[0]);
      if (n > 1) pillow(g, x1 - arm - 0.24, 0.67, z0 + bt + 0.12, 0.42, -0.12, o.pillows[1]);
    }
  }
  ITEMS['sofa'] = (g, w, h) => sofa(g, w, h, { arm: 0.2, fab: M.fabric(GREYF), pillows: [M.fabric('#c9a27a'), M.fabric('#5f6f73')] });
  ITEMS['armchair'] = (g, w, h) => sofa(g, w, h, { arm: Math.min(0.15, w * 0.18), n: 1, armH: 0.6, fab: M.leather('#8a5a3a') });

  // Corner sofa: long run on the back edge, return (chaise) down the right edge, arm on the left end.
  ITEMS['sofa-l'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, d = Math.min(0.95, w * 0.42, h * 0.55), arm = 0.2, bt = 0.2, legH = Q ? 0.1 : 0, fab = M.fabric('#b7b0a5');
    sofaLegs(g, [[x0 + 0.06, z0 + 0.06], [x0 + 0.06, z0 + d - 0.06], [x1 - 0.06, z0 + 0.06], [x1 - 0.06, z1 - 0.06], [x1 - d + 0.06, z1 - 0.06], [x1 - d + 0.06, z0 + d - 0.06]], legH, M.wood(WALNUT));
    g.add(rbox(x0, x0 + arm, legH, 0.62, z0, z0 + d, 0.06, fab));
    g.add(rbox(x0 + arm - 0.03, x1 - bt + 0.03, legH, 0.7, z0, z0 + bt, 0.05, fab, 1));
    g.add(rbox(x1 - bt, x1, legH, 0.7, z0, z1, 0.05, fab, 1));
    g.add(rbox(x0 + arm - 0.03, x1 - bt + 0.03, legH, 0.33, z0 + bt - 0.03, z0 + d, 0.03, fab, 1));
    g.add(rbox(x1 - d, x1 - bt + 0.03, legH, 0.33, z0 + d - 0.03, z1 - 0.01, 0.03, fab, 1));
    const run = x1 - d - (x0 + arm), n = Math.max(1, Math.round(run / 0.75)), cw = run / n;
    for (let i = 0; i < n; i++) {
      const cx = x0 + arm + cw * (i + 0.5);
      g.add(rbox(cx - cw / 2 + 0.004, cx + cw / 2 - 0.004, 0.31, 0.47, z0 + bt + 0.005, z0 + d - 0.005, 0.05, fab));
      backCush(g, cx, 0.44, z0 + 0.15, cw, 0, fab, 0.2, 1);
    }
    g.add(rbox(x1 - d + 0.004, x1 - bt - 0.005, 0.31, 0.47, z0 + bt + 0.005, z0 + d - 0.004, 0.05, fab));
    g.add(rbox(x1 - d + 0.004, x1 - bt - 0.005, 0.31, 0.47, z0 + d + 0.004, z1 - 0.005, 0.05, fab));
    backCush(g, x1 - d + (d - bt) / 2, 0.44, z0 + 0.15, d - bt, 0, fab, 0.2, 1);
    const zs = z0 + 0.28, len = z1 - zs, m = Math.max(1, Math.round(len / 0.75));
    for (let j = 0; j < m; j++) backCush(g, x1 - 0.15, 0.44, zs + (len * (j + 0.5)) / m, len / m, -PI / 2, fab, 0.2, 1);
    if (Q) {
      pillow(g, x0 + arm + 0.24, 0.67, z0 + bt + 0.12, 0.42, 0.12, M.fabric('#5f6f73'));
      pillow(g, x1 - bt - 0.24, 0.67, z0 + bt + 0.24, 0.42, -PI / 4, M.fabric('#c9a27a'));
    }
  };

  ITEMS['coffee-table'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, oak = M.wood(OAK), H = 0.4, t = 0.035;
    g.add(rbox(x0, x1, H - t, H, z0, z1, 0.012, oak, 1));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(bar(V(sx * (w / 2 - 0.05), 0, sz * (h / 2 - 0.045)), V(sx * (w / 2 - 0.08), H - t, sz * (h / 2 - 0.07)), 0.034, oak));
    }
    if (Q) g.add(rbox(x0 + 0.07, x1 - 0.07, 0.1, 0.12, z0 + 0.06, z1 - 0.06, 0.005, oak, 1));
    if (Q === 2) {
      bookStack(g, x0 + 0.24, H, z0 + h * 0.55, 0.15, 3);
      g.add(lathe([[0, 0], [0.05, 0], [0.11, 0.045], [0.125, 0.07], [0.115, 0.072], [0.1, 0.04], [0.05, 0.015], [0, 0.012]].map((p) => [p[0], H + p[1]]), M.gloss('#2f3a40'), 0, x1 - 0.25, 0, z0 + h * 0.45));
    }
  };

  ITEMS['tv-unit'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, legH = Q ? 0.12 : 0, top = 0.5, wal = M.wood(WALNUT), fr = M.wood('#7a5640'), zf = z1 - 0.004, blk = M.matte('#1c1d1f');
    if (Q) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const lx = sx * (w / 2 - 0.05), lz = sz * (h / 2 - 0.05); g.add(box(lx - 0.0125, lx + 0.0125, 0, legH + 0.005, lz - 0.0125, lz + 0.0125, M.metal('#2b2c2e'))); }
    g.add(rbox(x0, x1, top - 0.025, top, z0, z1, 0.005, wal, 1));
    g.add(box(x0 + 0.005, x1 - 0.005, legH, top - 0.025, z0, zf - 0.018, wal));
    g.add(box(x0 + 0.008, x1 - 0.008, legH + 0.003, top - 0.027, zf - 0.0185, zf - 0.0175, SHADE()));
    const nf = Math.max(2, Math.round(w / 0.45)), fw = (w - 0.016) / nf;
    for (let i = 0; i < nf; i++) {
      const a = x0 + 0.008 + i * fw;
      panel(g, a, a + fw, legH + 0.004, top - 0.027, zf - (Q === 2 ? 0.004 : 0), 0.018, fr, 0.002);
      if (Q === 2) for (let x = a + 0.02; x < a + fw - 0.015; x += 0.03) g.add(box(x - 0.007, x + 0.007, legH + 0.008, top - 0.031, zf - 0.004, zf, fr));
    }
    // TV on a pedestal stand
    const sw = Math.min(w * 0.82, 1.45), sh = sw * 0.5625, tz = z0 + h * 0.42, ty = top + 0.075, st = M.metal('#3a3b3e');
    g.add(rbox(-Math.min(0.22, sw * 0.18), Math.min(0.22, sw * 0.18), top, top + 0.012, tz - Math.min(0.09, h * 0.4), tz + Math.min(0.09, h * 0.4), 0.004, st, 1));
    g.add(box(-0.03, 0.03, top + 0.01, ty + 0.1, tz - 0.035, tz - 0.015, st));
    g.add(rbox(-sw / 2, sw / 2, ty, ty + sh, tz - 0.015, tz + 0.012, 0.006, blk, 1));
    g.add(box(-sw / 2 + 0.008, sw / 2 - 0.008, ty + 0.014, ty + sh - 0.008, tz + 0.012, tz + 0.0135, M.gloss('#0b0c0e')));
    if (Q) {
      g.add(box(-sw * 0.3, sw * 0.3, ty + sh * 0.15, ty + sh * 0.75, tz - 0.045, tz - 0.015, blk));
      const sb = Math.min(0.45, w * 0.3);
      g.add(rbox(-sb, sb, top, top + 0.06, tz + 0.06, Math.min(z1 - 0.02, tz + 0.15), 0.025, M.fabric('#2e2f31')));
    }
    if (Q === 2) {
      vase(g, x1 - 0.15, top, z0 + h * 0.5, 1.1, M.gloss('#b9c4bd'));
      bookStack(g, x0 + 0.2, top, z0 + h * 0.5, -0.2, 3);
    }
  };

  ITEMS['rug'] = (g, w, h) => {
    const i = 0.02, b = Math.min(0.12, w * 0.07, h * 0.07), long = w >= h, fe = Q === 2 ? 0.035 : 0;
    const ex = long ? fe : 0, ez = long ? 0 : fe; // fringes on the short ends
    const L = (k, y, mat) => g.add(box(-w / 2 + i + ex + k, w / 2 - i - ex - k, 0, y, -h / 2 + i + ez + k, h / 2 - i - ez - k, mat));
    const field = M.fabric('#e3d6c1'), line = M.fabric('#b48a6a');
    L(0, 0.008, M.fabric('#7d6455'));
    L(b, 0.01, field);
    if (Q) { L(b + 0.04, 0.012, line); L(b + 0.055, 0.014, field); }
    if (Q === 2) {
      const s = Math.min(w, h) * 0.13, geo = new T.BoxGeometry(2 * s, 0.016, 2 * s);
      geo.rotateY(PI / 4); // diamond, stretched along the rug's length
      const m = mesh(geo, line, 0, 0.008, 0);
      m.scale.set(long ? 1.4 : 1, 1, long ? 1 : 1.4);
      g.add(m);
      const fr = M.fabric('#efe9dd');
      if (long) for (const sx of [-1, 1]) g.add(box(sx > 0 ? w / 2 - i - fe : -w / 2 + i, sx > 0 ? w / 2 - i : -w / 2 + i + fe, 0, 0.004, -h / 2 + i + 0.01, h / 2 - i - 0.01, fr));
      else for (const sz of [-1, 1]) g.add(box(-w / 2 + i + 0.01, w / 2 - i - 0.01, 0, 0.004, sz > 0 ? h / 2 - i - fe : -h / 2 + i, sz > 0 ? h / 2 - i : -h / 2 + i + fe, fr));
    }
  };

  /* ---------- dining ---------- */
  // Dining chair, 0.42 m square, facing +z with its back at -z.
  function dchair(frame, seat) {
    const c = new T.Group(), s = 0.21, lt = 0.034;
    for (const sx of [-1, 1]) {
      const x = sx * (s - 0.03);
      c.add(box(x - lt / 2, x + lt / 2, 0, 0.45, s - 0.03 - lt / 2, s - 0.03 + lt / 2, frame));
      if (Q) c.add(bar(V(x, 0, -s + 0.045), V(x, 0.86, -s + 0.018), lt, frame));
      else c.add(box(x - lt / 2, x + lt / 2, 0, 0.86, -s + 0.012, -s + 0.012 + lt, frame));
      if (Q === 2) c.add(box(x - 0.01, x + 0.01, 0.16, 0.185, -s + 0.04, s - 0.03, frame));
    }
    c.add(rbox(-s, s, 0.44, 0.49, -s + 0.02, s, 0.02, seat, 1));
    if (Q) {
      // curved back rail: an arc band bowing backwards
      const R = 0.55, a = Math.asin((s - 0.01) / R), zc = -s + 0.004 + R, m = q3(4, 6, 10), pts = [];
      for (let i = 0; i <= m; i++) { const t = -a + (2 * a * i) / m; pts.push([R * Math.sin(t), -(zc - R * Math.cos(t))]); }
      for (let i = m; i >= 0; i--) { const t = -a + (2 * a * i) / m; pts.push([(R - 0.022) * Math.sin(t), -(zc - (R - 0.022) * Math.cos(t))]); }
      c.add(slabY(poly(pts), 0.66, 0.19, Q === 2 ? 0.005 : 0, frame, 1));
    } else c.add(box(-s + 0.01, s - 0.01, 0.66, 0.85, -s, -s + 0.022, frame));
    return c;
  }
  function table(g, tw, th, mat, H) {
    H = H || 0.76;
    const x1 = tw / 2, z1 = th / 2, li = 0.06;
    g.add(rbox(-x1, x1, H - 0.035, H, -z1, z1, 0.01, mat, 1));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const geo = new T.CylinderGeometry(0.042, 0.028, H - 0.035, 4);
      geo.rotateY(PI / 4);
      g.add(mesh(geo, mat, sx * (x1 - li), (H - 0.035) / 2, sz * (z1 - li)));
    }
    if (Q) {
      for (const sz of [-1, 1]) g.add(box(-x1 + li, x1 - li, H - 0.11, H - 0.035, sz * (z1 - li) - 0.011, sz * (z1 - li) + 0.011, mat));
      for (const sx of [-1, 1]) g.add(box(sx * (x1 - li) - 0.011, sx * (x1 - li) + 0.011, H - 0.11, H - 0.035, -z1 + li, z1 - li, mat));
    }
  }
  function fruitBowl(g, x, y, z) {
    g.add(lathe([[0, 0], [0.06, 0], [0.13, 0.05], [0.15, 0.085], [0.14, 0.087], [0.12, 0.05], [0.05, 0.015], [0, 0.012]].map((p) => [p[0], y + p[1]]), M.gloss('#e9e4da'), 0, x, 0, z));
    const cols = ['#e8873a', '#c63b2b', '#9bbf4a', '#e8873a', '#e9c43a'];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3, d = i < 4 ? 0.06 : 0;
      g.add(mesh(new T.IcosahedronGeometry(0.038, 1), M.gloss(cols[i]), x + Math.cos(a) * d, y + 0.06 + (i === 4 ? 0.04 : 0), z + Math.sin(a) * d));
    }
  }
  function dining(g, w, h, per) {
    const tw = Math.max(0.6, w - 0.8), th = Math.max(0.6, h - 0.8), fr = M.wood('#8a6446'), seat = M.fabric(LINEN);
    table(g, tw, th, M.wood(OAK));
    for (let i = 0; i < per; i++) {
      const cx = -tw / 2 + (tw * (i + 0.5)) / per;
      g.add(at(dchair(fr, seat), cx, 0, -h / 2 + 0.21));
      g.add(at(dchair(fr, seat), cx, 0, h / 2 - 0.21, PI));
    }
    if (Q === 2) fruitBowl(g, 0, 0.76, 0);
  }
  ITEMS['dining-6'] = (g, w, h) => dining(g, w, h, 3);
  ITEMS['dining-4'] = (g, w, h) => dining(g, w, h, 2);

  /* ---------- kitchen ---------- */
  // Run of base cabinets wd × dp, back at -dp/2, fronts at +dp/2 (pulls stick out 2 cm more), carcass top 0.86.
  function baseRun(wd, dp, fm, hm) {
    const g = new T.Group(), x0 = -wd / 2, x1 = wd / 2, z0 = -dp / 2, zf = dp / 2, top = 0.86, pl = 0.1;
    g.add(box(x0, x1, 0, pl, z0 + 0.02, zf - 0.07, M.matte('#3a3a38')));
    g.add(box(x0, x1, pl, top, z0, zf - 0.019, fm));
    g.add(box(x0 + 0.002, x1 - 0.002, pl + 0.002, top - 0.002, zf - 0.0195, zf - 0.0185, SHADE()));
    const nm = Math.max(1, Math.round(wd / 0.6)), mw = wd / nm;
    for (let i = 0; i < nm; i++) {
      const a = x0 + i * mw, b = a + mw, drawers = nm > 1 && i % 3 === 1;
      const rows = drawers ? [pl, pl + 0.24, pl + 0.5, top] : [pl, top - 0.17, top];
      for (let r = 0; r < rows.length - 1; r++) {
        panel(g, a, b, rows[r], rows[r + 1], zf, 0.018, fm, 0.0025);
        pull(g, (a + b) / 2, drawers || r === 1 ? (rows[r] + rows[r + 1]) / 2 : rows[r + 1] - 0.06, zf, Math.min(0.2, mw * 0.4), false, hm);
      }
    }
    return g;
  }
  const WORKTOP = () => M.gloss('#e6e2db');
  ITEMS['counter'] = (g, w, h) => {
    const z0 = -h / 2, dp = h - 0.03, wt = WORKTOP();
    g.add(at(baseRun(w, dp, M.matte('#ebe8e1'), M.metal(STEEL)), 0, 0, z0 + dp / 2));
    g.add(rbox(-w / 2, w / 2, 0.86, 0.9, z0, h / 2, 0.004, wt, 1));
    g.add(box(-w / 2, w / 2, 0.9, 0.98, z0, z0 + 0.015, wt));
  };
  // Island: cabinets face -z (the cook side), worktop overhangs +z for stools, waterfall ends.
  ITEMS['island'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, wt = WORKTOP(), fm = M.matte('#56635e'), ov = Math.min(0.32, h * 0.36), wf = 0.03, dp = h - ov - 0.03;
    g.add(at(baseRun(w - 2 * wf, dp, fm, M.metal(BRASS)), 0, 0, z0 + 0.03 + dp / 2, PI));
    g.add(box(x0 + wf, x1 - wf, 0.1, 0.86, z0 + 0.03 + dp, z0 + 0.048 + dp, fm));
    g.add(rbox(x0, x1, 0.86, 0.9, z0, z1, 0.004, wt, 1));
    g.add(box(x0, x0 + wf, 0, 0.86, z0, z1, wt), box(x1 - wf, x1, 0, 0.86, z0, z1, wt));
  };
  ITEMS['stools'] = (g, w, h) => {
    const sp = w / 3, R = Math.min(h / 2, sp / 2) - 0.015, sr = Math.min(0.19, R * 0.95), sy = 0.66, leg = M.metal('#2b2c2e'), seat = M.leather('#7a4f33');
    for (let i = 0; i < 3; i++) {
      const cx = -w / 2 + sp * (i + 0.5);
      if (Q) g.add(lathe([[0, sy - 0.05], [sr - 0.01, sy - 0.05], [sr, sy - 0.035], [sr + 0.003, sy - 0.015], [sr - 0.015, sy], [sr * 0.5, sy + 0.006], [0, sy + 0.006]], seat, 0, cx, 0, 0));
      else g.add(cyl(cx, 0, sr, sr, sy - 0.05, sy, seat));
      for (let k = 0; k < 4; k++) {
        const a = PI / 4 + (k * PI) / 2;
        g.add(rod(V(cx + R * Math.cos(a), 0.006, R * Math.sin(a)), V(cx + 0.11 * Math.cos(a), sy - 0.05, 0.11 * Math.sin(a)), 0.012, leg, q3(4, 6, 6)));
      }
      if (Q) {
        const fy = 0.25, rr = R + ((0.11 - R) * fy) / (sy - 0.05), ring = mesh(torusGeo(rr, 0.008, q3(8, 16, 24)), M.metal(CHROME), cx, fy, 0);
        ring.rotation.x = PI / 2;
        g.add(ring);
      }
    }
  };
  // Cooktop: black glass at 0.9 m with zone rings; sits on a counter.
  ITEMS['stove'] = (g, w, h) => {
    const y = 0.9, rs = Math.min(w, h), ring = M.matte('#6a6d71'), ys = y + 0.0085;
    g.add(rbox(-w / 2 + 0.005, w / 2 - 0.005, y, y + 0.008, -h / 2 + 0.005, h / 2 - 0.005, 0.003, M.gloss('#141516'), 1));
    const zones = [[-0.24, -0.18, 0.17], [0.24, -0.18, 0.12], [-0.24, 0.16, 0.12], [0.24, 0.16, 0.16]];
    if (w >= 0.75) zones.push([0, -0.02, 0.13]);
    for (const [fx, fz, fr] of zones) {
      const r = rs * fr * (w >= 0.75 && fx ? 0.85 : 1), rings = Q === 2 ? [1, 0.62] : [1];
      for (const k of rings) {
        const m = mesh(new T.RingGeometry(r * k - 0.004, r * k, q3(16, 24, 40)), ring, fx * w, ys, fz * h);
        m.rotation.x = -PI / 2;
        g.add(m);
      }
    }
    if (Q) {
      const zc = h / 2 - 0.04;
      for (let i = -2; i <= 2; i++) g.add(box(i * 0.04 - 0.008, i * 0.04 + 0.008, ys - 0.0005, ys + 0.0003, zc - 0.008, zc + 0.008, ring));
      if (Q === 2) g.add(box(w / 2 - 0.08, w / 2 - 0.04, ys - 0.0005, ys + 0.0004, zc - 0.006, zc + 0.006, M.emissive('#ff4a2a')));
    }
  };
  // Sink: steel rim plate with the bowl cut out, ~1 cm proud of the worktop, bowl floor just above 0.9
  // (a deeper recess would be hidden by the counter's worktop underneath).
  ITEMS['sink-kitchen'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, y = 0.9, st = M.metal(STEEL), chr = M.metal(CHROME);
    const rx0 = x0 + 0.02, rx1 = x1 - 0.02, rz0 = z0 + 0.04, rz1 = z1 - 0.03, drain = w >= 0.72;
    const bx0 = rx0 + 0.04, bx1 = drain ? bx0 + (rx1 - rx0) * 0.58 : rx1 - 0.04, bz0 = rz0 + 0.07, bz1 = rz1 - 0.04, cr = Q ? 0.03 : 0;
    const s = rrect(new T.Shape(), rx0, -rz1, rx1, -rz0, Q ? 0.012 : 0);
    s.holes.push(rrect(new T.Path(), bx0, -bz1, bx1, -bz0, cr));
    g.add(slabY(s, y, 0.012, 0, st));
    g.add(flatY(rrect(new T.Shape(), bx0, -bz1, bx1, -bz0, cr), y + 0.0015, M.metal('#979ea4')));
    const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2;
    g.add(cyl(bcx, bcz, 0.035, 0.035, y + 0.0015, y + 0.003, M.metal('#5d6166'), q3(10, 16, 20)));
    if (Q) g.add(cyl(bcx, bcz, 0.018, 0.018, y + 0.0015, y + 0.0035, st, 12));
    if (drain && Q) for (let z = bz0 + 0.02; z < bz1 - 0.01; z += 0.035) g.add(box(bx1 + 0.04, rx1 - 0.03, y + 0.012, y + 0.0145, z - 0.004, z + 0.004, st));
    // gooseneck faucet behind the bowl
    const fz = rz0 + 0.035, R = 0.09;
    g.add(cyl(bcx, fz, 0.024, 0.027, y + 0.012, y + 0.04, chr));
    g.add(cyl(bcx, fz, 0.014, 0.016, y + 0.04, y + 0.3, chr));
    if (Q) {
      const arc = mesh(torusGeo(R, 0.014, q3(6, 12, 18), PI), chr, bcx, y + 0.3, fz + R);
      arc.rotation.y = PI / 2;
      g.add(arc);
      g.add(cyl(bcx, fz + 2 * R, 0.016, 0.014, y + 0.25, y + 0.3, chr));
      g.add(rod(V(bcx + 0.015, y + 0.17, fz), V(bcx + 0.07, y + 0.2, fz - 0.015), 0.007, chr));
    } else g.add(rod(V(bcx, y + 0.29, fz), V(bcx, y + 0.29, fz + 2 * R), 0.014, chr));
  };
  ITEMS['fridge'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, H = 1.86, door = M.metal(STEEL), hd = M.metal(CHROME), split = 0.78, zf = z1 - 0.022;
    g.add(rbox(x0 + 0.005, x1 - 0.005, Q ? 0.02 : 0, H, z0, zf - 0.05, 0.01, M.matte('#c9ccd0'), 1));
    g.add(box(x0 + 0.03, x1 - 0.03, 0, 0.075, zf - 0.07, zf - 0.05, M.matte('#2f3032')));
    g.add(rbox(x0, x1, 0.08, split - 0.004, zf - 0.055, zf, 0.008, door, 1));
    g.add(rbox(x0, x1, split + 0.004, H, zf - 0.055, zf, 0.008, door, 1));
    // vertical handle on the fridge door, horizontal one on the freezer drawer
    const hx = x1 - 0.06;
    g.add(box(hx - 0.009, hx + 0.009, split + 0.12, split + 0.78, zf + 0.012, z1, hd));
    g.add(box(-w * 0.32, w * 0.32, split - 0.1, split - 0.082, zf + 0.012, z1, hd));
    for (const y of [split + 0.16, split + 0.74]) g.add(box(hx - 0.007, hx + 0.007, y - 0.012, y + 0.012, zf, zf + 0.012, hd));
    for (const x of [-w * 0.27, w * 0.27]) g.add(box(x - 0.012, x + 0.012, split - 0.098, split - 0.084, zf, zf + 0.012, hd));
    if (Q === 2) g.add(box(x0 + 0.06, x0 + 0.16, H - 0.2, H - 0.17, zf, zf + 0.001, M.emissive('#9fd3e8')));
  };

  /* ---------- bathroom ---------- */
  ITEMS['toilet'] = (g, w, h) => {
    const z0 = -h / 2, z1 = h / 2, cer = M.gloss(CERAMIC), chr = M.metal(CHROME), tw = Math.min(w, 0.42) / 2, td = Math.min(0.19, h * 0.28);
    g.add(rbox(-tw * 0.95, tw * 0.95, 0.4, 0.765, z0 + 0.01, z0 + td, 0.02, cer));
    g.add(rbox(-tw, tw, 0.76, 0.79, z0, z0 + td + 0.01, 0.012, cer, 1));
    if (Q) g.add(cyl(0, z0 + td / 2, 0.026, 0.026, 0.79, 0.796, chr, q3(8, 12, 16)));
    // bowl: elliptical, from the tank to the front
    const bz0 = z0 + td - 0.04, zc = (bz0 + z1 - 0.01) / 2, rx = tw * 0.92, rz = (z1 - 0.01 - bz0) / 2;
    g.add(rbox(-tw * 0.55, tw * 0.55, 0, 0.4, z0 + 0.06, zc, 0.03, cer, 1));
    const bowl = Q
      ? lathe([[0.5, 0], [0.56, 0.02], [0.6, 0.12], [0.78, 0.26], [0.95, 0.35], [1, 0.39], [0.97, 0.4], [0, 0.4]], cer, q3(10, 16, 24), 0, 0, zc)
      : cyl(0, zc, 1, 0.6, 0, 0.4, cer, 10);
    bowl.scale.set(rx, 1, rz);
    g.add(bowl);
    // seat ring and closed lid
    const ring = torusGeo(0.82, 0.17, q3(10, 18, 28));
    ring.rotateX(PI / 2);
    const seat = mesh(ring, cer, 0, 0.412, zc);
    seat.scale.set(rx, 0.075, rz);
    g.add(seat);
    const lid = Q ? lathe([[0, 0], [0.98, 0], [1, 0.01], [0.96, 0.022], [0, 0.024]], cer, q3(10, 18, 28), 0, 0.424, zc + 0.005) : cyl(0, zc, 1, 1, 0.424, 0.444, cer, 12);
    lid.scale.set(rx * 0.99, Q ? 1 : 1, rz * 0.99);
    g.add(lid);
    if (Q === 2) for (const sx of [-1, 1]) g.add(box(sx * 0.07 - 0.015, sx * 0.07 + 0.015, 0.405, 0.43, zc - rz - 0.01, zc - rz + 0.03, chr));
  };

  // Faucet on a deck at (x, y, z): column, spout reaching dz towards +z, lever on top.
  function faucet(g, x, y, z, hgt, dz, chr) {
    g.add(cyl(x, z, 0.018, 0.022, y, y + hgt, chr, q3(8, 12, 16)));
    g.add(rod(V(x, y + hgt - 0.015, z), V(x, y + hgt - 0.015 - dz * 0.12, z + dz), 0.011, chr));
    if (Q) g.add(rod(V(x, y + hgt, z), V(x, y + hgt + 0.03, z - 0.04), 0.006, chr));
  }
  ITEMS['basin'] = (g, w, h) => {
    const z0 = -h / 2, z1 = h / 2, cer = M.gloss(CERAMIC), chr = M.metal(CHROME), top = 0.85, bw = w / 2 - 0.01;
    g.add(lathe([[0.1, 0], [0.085, 0.04], [0.065, 0.2], [0.06, 0.5], [0.075, top - 0.16], [0, top - 0.16]], cer, q3(8, 14, 20), 0, 0, Math.max(z0 + 0.11, z0 + h * 0.4)));
    const bz0 = z0 + 0.04, rz = (z1 - 0.01 - bz0) / 2, zc = bz0 + rz;
    const bowl = Q
      ? lathe([[0.45, top - 0.17], [0.8, top - 0.14], [0.97, top - 0.07], [1, top - 0.02], [0.985, top], [0.93, top + 0.004], [0.9, top - 0.008], [0.84, top - 0.06], [0.62, top - 0.115], [0, top - 0.125]], cer, q3(12, 20, 32), 0, 0, zc)
      : cyl(0, zc, 1, 0.75, top - 0.17, top, cer, 12);
    bowl.scale.set(bw, 1, rz);
    g.add(bowl);
    g.add(rbox(-bw * 0.7, bw * 0.7, top - 0.05, top + 0.005, z0, z0 + 0.1, 0.02, cer, 1));
    faucet(g, 0, top + 0.005, z0 + 0.05, 0.15, 0.11, chr);
    if (Q) g.add(cyl(0, zc + 0.02, 0.022, 0.022, top - 0.126, top - 0.122, chr, 12));
    // round mirror on the wall above
    const mr = Math.min(w * 0.45, 0.3), my = 1.45;
    if (Q) {
      g.add(disc(0, my, z0, z0 + 0.012, mr, M.mirror()));
      g.add(at(new T.Mesh(torusGeo(mr, 0.012, q3(16, 32, 48)), M.metal(BRASS)), 0, my, z0 + 0.012));
    } else g.add(box(-mr, mr, my - mr, my + mr, z0, z0 + 0.012, M.mirror()));
    if (Q === 2) g.add(lathe([[0, 0], [0.03, 0], [0.032, 0.1], [0.012, 0.11], [0.012, 0.13], [0, 0.13]].map((p) => [p[0], top + 0.005 + p[1]]), M.gloss('#d9cbb6'), 10, bw * 0.55, 0, z0 + 0.05));
  };

  ITEMS['vanity-double'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, wood = M.wood(OAK), cer = M.gloss(CERAMIC), chr = M.metal(CHROME), zf = z1 - 0.022, y0 = 0.32, y1 = 0.82;
    g.add(box(x0, x1, y0, y1, z0, zf - 0.018, wood));
    g.add(box(x0 + 0.003, x1 - 0.003, y0 + 0.003, y1 - 0.003, zf - 0.0185, zf - 0.0175, SHADE()));
    const cols = Math.max(2, Math.round(w / 0.6)), cw = w / cols, ym = y1 - 0.17;
    for (let c = 0; c < cols; c++) {
      const a = x0 + c * cw;
      panel(g, a, a + cw, y0, ym, zf, 0.018, wood, 0.002);
      panel(g, a, a + cw, ym, y1, zf, 0.018, wood, 0.002);
      for (const y of [ym - 0.05, y1 - 0.05]) pull(g, a + cw / 2, y, zf, Math.min(0.16, cw * 0.3), false, M.metal(BLACK));
    }
    g.add(rbox(x0, x1, y1, y1 + 0.03, z0, z1, 0.004, M.gloss('#efede8'), 1));
    // two vessel basins with tall faucets behind them
    const top = y1 + 0.03, rx = Math.min(0.24, w / 4 - 0.04), rz = Math.min(0.19, (h - 0.16) / 2), zc = z1 - 0.02 - rz;
    for (const sx of [-1, 1]) {
      const bx = (sx * w) / 4;
      const b = Q
        ? lathe([[0, 0], [0.6, 0], [0.85, 0.03], [0.98, 0.08], [1, 0.13], [0.96, 0.136], [0.93, 0.13], [0.85, 0.075], [0.55, 0.03], [0, 0.025]].map((p) => [p[0], top + p[1]]), cer, q3(12, 20, 32), bx, 0, zc)
        : cyl(bx, zc, 1, 0.65, top, top + 0.13, cer, 12);
      b.scale.set(rx, 1, rz);
      g.add(b);
      faucet(g, bx, top, Math.max(z0 + 0.05, zc - rz - 0.05), 0.28, Math.min(0.17, rz + 0.02), chr);
    }
    // mirror strip and light bar on the wall
    g.add(box(x0 + 0.05, x1 - 0.05, 1.1, 1.75, z0, z0 + 0.012, M.mirror()));
    if (Q) g.add(rbox(x0 + 0.15, x1 - 0.15, 1.8, 1.83, z0, z0 + 0.035, 0.008, M.emissive('#fbf3e2'), 1));
  };

  ITEMS['shower'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, glass = M.glass(), chr = M.metal(CHROME), prof = M.metal(BLACK), gy = 2.0, t = 0.04;
    g.add(rbox(x0, x1, 0, t, z0, z1, 0.008, M.matte('#e9e7e3'), 1));
    if (Q) g.add(box(-0.06, 0.06, t, t + 0.002, -0.06, 0.06, M.metal(STEEL)));
    // glass: fixed panel on the right, fixed + door on the front
    g.add(box(x1 - 0.008, x1, t, gy, z0, z1 - 0.01, glass));
    if (Q) {
      const mid = x0 + w * 0.42;
      g.add(box(x0 + 0.015, mid, t, gy, z1 - 0.008, z1, glass));
      g.add(box(mid - 0.03, x1 - 0.012, t + 0.01, gy - 0.01, z1 - 0.022, z1 - 0.014, glass));
      g.add(box(mid + 0.03, mid + 0.04, 0.9, 1.3, z1 - 0.014, z1, chr), box(mid + 0.03, mid + 0.04, 0.9, 1.3, z1 - 0.036, z1 - 0.022, chr));
      g.add(box(x0, x0 + 0.015, t, gy, z1 - 0.02, z1, prof), box(x1 - 0.02, x1, t, gy, z0, z0 + 0.015, prof));
      g.add(box(x1 - 0.02, x1, t, gy + 0.01, z1 - 0.02, z1, prof));
      g.add(box(x0, x1, gy, gy + 0.015, z1 - 0.02, z1, prof), box(x1 - 0.02, x1, gy, gy + 0.015, z0, z1, prof));
    } else g.add(box(x0, x1, t, gy, z1 - 0.008, z1, glass));
    // rain head on an arm from the back wall, mixer below
    const hr = Math.min(0.12, w * 0.15), ay = 2.12, reach = Math.min(0.35, h * 0.4);
    g.add(rod(V(0, ay, z0), V(0, ay, z0 + reach), 0.01, chr));
    g.add(cyl(0, z0 + reach, 0.012, 0.012, ay - 0.04, ay, chr, 8));
    g.add(cyl(0, z0 + reach, hr, hr, ay - 0.055, ay - 0.04, chr, q3(12, 20, 32)));
    if (Q === 2) g.add(cyl(0, z0 + reach, hr * 0.9, hr * 0.9, ay - 0.057, ay - 0.054, M.matte('#3a3c3e'), 24));
    g.add(disc(0, 1.1, z0, z0 + 0.012, 0.065, chr));
    g.add(rod(V(0, 1.1, z0 + 0.01), V(0, 1.1, z0 + 0.06), 0.012, chr));
    if (Q) g.add(rod(V(0, 1.1, z0 + 0.055), V(0.07, 1.12, z0 + 0.06), 0.007, chr));
    if (Q === 2) {
      const sx = x0 + 0.22;
      g.add(rod(V(sx, 0.95, z0 + 0.04), V(sx, 1.75, z0 + 0.04), 0.009, chr));
      g.add(rod(V(sx, 1.5, z0 + 0.05), V(sx, 1.68, z0 + 0.1), 0.014, chr, 0, 0.012));
      g.add(cyl(sx, z0 + 0.1, 0.035, 0.035, 1.68, 1.7, chr, 12));
    }
  };

  ITEMS['bathtub'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, cer = M.gloss(CERAMIC), chr = M.metal(CHROME), top = 0.56;
    const rim = Math.min(0.085, w * 0.07, h * 0.12), cr = Q ? Math.min(0.16, h * 0.22) : 0, bev = Q === 2 ? 0.012 : 0, oc = Q ? 0.025 : 0;
    const ix0 = x0 + rim, ix1 = x1 - rim, iz0 = z0 + rim, iz1 = z1 - rim, fl = 0.1;
    const s = rrect(new T.Shape(), x0 + bev, -z1 + bev, x1 - bev, -z0 - bev, oc);
    s.holes.push(rrect(new T.Path(), ix0 - bev, -iz1 - bev, ix1 + bev, -iz0 - bev, cr + bev));
    g.add(slabY(s, 0, top, bev, cer, q3(1, 1, 3)));
    // basin: rounded box turned inside out, open at the top
    const bt = top - bev - 0.002;
    g.add(mesh(inside(rgeo(ix1 - ix0 - 0.004, bt - fl, iz1 - iz0 - 0.004, cr, Q, true)), cer, (ix0 + ix1) / 2, (fl + bt) / 2, (iz0 + iz1) / 2));
    // deck faucet and taps on the left end
    const fx = x0 + rim * 0.5;
    g.add(cyl(fx, 0, 0.02, 0.024, top, top + 0.1, chr, q3(8, 12, 16)));
    g.add(rod(V(fx, top + 0.085, 0), V(fx + 0.15, top + 0.085, 0), 0.014, chr));
    g.add(cyl(fx + 0.15, 0, 0.014, 0.014, top + 0.06, top + 0.09, chr, 8));
    if (Q) {
      for (const sz of [-1, 1]) g.add(cyl(fx, sz * 0.09, 0.018, 0.022, top, top + 0.05, chr, 10));
      g.add(cyl(ix0 + 0.16, 0, 0.032, 0.032, fl, fl + 0.003, chr, 16));
    }
  };

  ITEMS['washer'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, body = M.gloss('#f2f2f0'), chr = M.metal(CHROME), zb = z1 - 0.02, H = 0.85;
    g.add(rbox(x0, x1, Q ? 0.015 : 0, H, z0, zb, 0.015, body));
    if (Q) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(sx * (w / 2 - 0.06), sz * (h / 2 - 0.08), 0.02, 0.02, 0, 0.016, M.matte('#555759'), 8));
    // control strip: detergent drawer, display, programme dial
    g.add(box(x0 + 0.012, x1 - 0.012, 0.73, H - 0.02, zb - 0.002, zb + 0.004, M.gloss('#e6e7e8')));
    g.add(box(x0 + 0.03, x0 + 0.03 + w * 0.32, 0.745, 0.815, zb + 0.004, zb + 0.008, body));
    if (Q) g.add(box(x0 + 0.04, x0 + 0.04 + w * 0.12, 0.75, 0.758, zb + 0.008, zb + 0.009, M.matte('#9a9c9e')));
    g.add(box(-0.02, w * 0.2, 0.76, 0.8, zb + 0.004, zb + 0.005, Q ? M.gloss('#1d2226') : M.matte('#2a2d30')));
    if (Q) g.add(box(0, 0.05, 0.772, 0.788, zb + 0.005, zb + 0.0055, M.emissive('#5ad0b0')));
    g.add(disc(x1 - 0.085, 0.78, zb + 0.004, z1, 0.034, chr));
    // porthole: chrome ring, tinted glass, dark drum behind
    const py = 0.42, pr = Math.min(0.2, w * 0.32);
    g.add(at(new T.Mesh(torusGeo(pr, 0.028, q3(16, 28, 40)), M.gloss('#cfd2d5')), 0, py, zb - 0.016));
    g.add(disc(0, py, zb, zb + 0.003, pr - 0.02, M.gloss('#2c3035')));
    if (Q) {
      const gl = mesh(new T.SphereGeometry(pr - 0.015, q3(12, 20, 28), q3(4, 6, 8), 0, PI * 2, 0, PI / 2), M.glass(), 0, py, zb);
      gl.rotation.x = PI / 2;
      gl.scale.y = 0.1;
      g.add(gl);
      if (Q === 2) g.add(at(new T.Mesh(torusGeo(pr - 0.035, 0.008, 32), M.matte('#3a3c3f')), 0, py, zb + 0.002));
    }
  };

  /* ---------- office ---------- */
  ITEMS['desk'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, oak = M.wood(OAK), fr = M.metal('#2b2c2e'), lt = 0.035, top = 0.755;
    g.add(rbox(x0, x1, top - 0.025, top, z0, z1, 0.008, oak, 1));
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.06);
      for (const sz of [-1, 1]) { const z = sz * (h / 2 - 0.06); g.add(box(x - lt / 2, x + lt / 2, 0, top - 0.025, z - lt / 2, z + lt / 2, fr)); }
      g.add(box(x - lt / 2, x + lt / 2, top - 0.055, top - 0.025, z0 + 0.04, z1 - 0.04, fr));
      if (Q) g.add(box(x - lt / 2, x + lt / 2, 0, 0.03, z0 + 0.04, z1 - 0.04, fr));
    }
    if (Q) g.add(box(x0 + 0.06, x1 - 0.06, 0.62, 0.65, z0 + 0.045, z0 + 0.075, fr));
    if (Q) {
      // monitor and keyboard
      const s = Math.min(1, (w - 0.15) / 0.62), mw = 0.31 * s, mz = z0 + Math.min(0.15, h * 0.2), blk = M.matte('#1c1d1f');
      g.add(rbox(-0.11, 0.11, top, top + 0.01, mz - 0.07, mz + 0.07, 0.004, fr, 1));
      g.add(box(-0.02, 0.02, top, top + 0.3, mz - 0.03, mz - 0.012, fr));
      g.add(rbox(-mw, mw, top + 0.15, top + 0.15 + mw * 1.15, mz - 0.012, mz + 0.01, 0.004, blk, 1));
      g.add(box(-mw + 0.008, mw - 0.008, top + 0.165, top + 0.142 + mw * 1.15, mz + 0.01, mz + 0.0115, M.gloss('#0b0c0e')));
      const kz = Math.min(z1 - 0.1, mz + 0.24);
      g.add(rbox(-0.21, 0.21, top, top + 0.016, kz - 0.065, kz + 0.065, 0.004, M.matte('#d9dadc'), 1));
      if (Q === 2 && h >= 0.55 && w >= 1) {
        g.add(rbox(0.29, 0.35, top, top + 0.025, kz - 0.04, kz + 0.06, 0.012, M.matte('#d9dadc')));
        g.add(cyl(x0 + 0.18, kz, 0.04, 0.04, top, top + 0.1, M.gloss('#3f5a6b'), 14));
        pottedPlant(g, x1 - 0.15, top, mz, 0.06, 0.1, rng(11));
      }
    }
  };

  // Office chair: five-star base on casters, gas lift, seat, tilted back, arms at medium and up.
  ITEMS['chair'] = (g, w, h) => {
    const blk = M.matte('#2b2c2e'), fab = M.fabric('#3d4044'), chr = M.metal(CHROME), R = Math.min(w, h) / 2 - 0.03, sw = Math.min(0.24, w / 2 - 0.01), sd = Math.min(0.22, h / 2 - 0.03);
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * PI) / 5 + PI / 2, cx = R * Math.cos(a), cz = R * Math.sin(a);
      g.add(rod(V(0, 0.1, 0), V(cx, Q ? 0.065 : 0.02, cz), 0.016, blk, q3(4, 6, 6)));
      if (Q) {
        const c = mesh(new T.CylinderGeometry(0.026, 0.026, 0.022, q3(8, 10, 12)), blk, cx, 0.026, cz);
        c.rotation.set(0, -a, PI / 2);
        g.add(c);
      }
    }
    g.add(cyl(0, 0, 0.035, 0.04, 0.06, 0.12, blk, 10));
    g.add(cyl(0, 0, 0.022, 0.022, 0.12, 0.43, chr, 10));
    if (Q) g.add(cyl(0, 0, 0.03, 0.03, 0.12, 0.3, blk, 10));
    g.add(box(-0.1, 0.1, 0.4, 0.45, -0.08, 0.08, blk));
    g.add(rbox(-sw, sw, 0.44, 0.51, -sd + 0.01, sd + 0.02, 0.035, fab));
    if (Q) g.add(bar(V(0, 0.45, -0.12), V(0, 0.66, -sd - 0.005), 0.05, blk, 0.02));
    const b = group(g, 0, 0.6, -sd + 0.06);
    b.rotation.x = -0.12;
    b.add(rbox(-sw * 0.9, sw * 0.9, 0, 0.47, -0.025, 0.025, 0.03, fab));
    if (Q) for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.035);
      g.add(box(x - 0.012, x + 0.012, 0.47, 0.66, -0.07, -0.04, blk));
      g.add(rbox(x - 0.03, x + 0.03, 0.66, 0.69, -0.14, 0.11, 0.012, blk, 1));
    }
  };

  ITEMS['bookshelf'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, H = 1.9, t = 0.022, wood = M.wood(OAK), pl = 0.06;
    g.add(box(x0, x0 + t, 0, H, z0, z1, wood), box(x1 - t, x1, 0, H, z0, z1, wood), box(x0, x1, H - t, H, z0, z1, wood));
    g.add(box(x0 + t, x1 - t, 0, pl, z0 + 0.01, z1 - 0.02, M.wood(WALNUT)), box(x0 + t, x1 - t, pl, pl + t, z0, z1, wood));
    g.add(box(x0 + t, x1 - t, pl + t, H - t, z0, z0 + 0.01, wood));
    const ncol = Math.max(1, Math.ceil((w - 0.15) / 0.95)), cw = (w - 2 * t - (ncol - 1) * t) / ncol, y0 = pl + t, nc = Math.max(3, Math.round((H - t - y0) / 0.34)), sp = (H - t - y0) / nc;
    for (let c = 1; c < ncol; c++) { const x = x0 + t + c * cw + (c - 1) * t; g.add(box(x, x + t, y0, H - t, z0 + 0.01, z1, wood)); }
    for (let i = 1; i < nc; i++) g.add(box(x0 + t, x1 - t, y0 + i * sp - t, y0 + i * sp, z0 + 0.01, z1, wood));
    if (!Q) return;
    // books in muted colours, a few gaps, leaning books and stacks at High
    const rnd = rng(Math.round(w * 1000) * 31 + Math.round(h * 1000) * 7 + 3), dmax = h - 0.04;
    for (let c = 0; c < ncol; c++) for (let i = 0; i < nc; i++) {
      const sy = y0 + i * sp, ch = sp - t, ax = x0 + t + c * (cw + t) + 0.01, bx = ax + cw - 0.02;
      if (Q === 2 && (i + c * 2) % 4 === 3) { vase(g, bx - 0.09, sy, z1 - dmax * 0.5, Math.min(1, ch / 0.28) * 0.9, M.gloss(i % 2 ? '#c8b89c' : '#9fb1ae')); }
      let x = ax + (rnd() < 0.3 ? rnd() * 0.1 : 0);
      const end = Q === 2 && (i + c * 2) % 4 === 3 ? bx - 0.2 : bx - (rnd() < 0.5 ? rnd() * cw * 0.3 : 0);
      while (x < end - 0.02) {
        const bw = 0.018 + rnd() * 0.028, bh = Math.min(ch - 0.02, ch * (0.62 + rnd() * 0.28)), bd = dmax * (0.7 + rnd() * 0.25), col = M.matte(BOOKS[Math.floor(rnd() * BOOKS.length)]);
        if (x + bw > end) break;
        if (Q === 2 && rnd() < 0.06 && end - x > 0.25) {
          // a horizontal stack
          let yy = sy;
          for (let k = 0; k < 3; k++) { const th = 0.025 + rnd() * 0.015; g.add(box(x, x + 0.2 - k * 0.012, yy, yy + th, z1 - 0.01 - bd, z1 - 0.01, M.matte(BOOKS[Math.floor(rnd() * BOOKS.length)]))); yy += th; }
          x += 0.22;
          continue;
        }
        if (Q === 2 && rnd() < 0.05 && end - x > 0.08) {
          const a = 0.18 + rnd() * 0.15, p = group(g, x + bh * Math.sin(a), sy, 0);
          p.rotation.z = a;
          p.add(box(0, bw, 0, bh, z1 - 0.01 - bd, z1 - 0.01, col));
          x += bh * Math.sin(a) + bw / Math.cos(a) + 0.005;
          continue;
        }
        g.add(box(x, x + bw, sy, sy + bh, z1 - 0.01 - bd, z1 - 0.01, col));
        x += bw + 0.001;
      }
    }
  };

  /* ---------- outdoor ---------- */
  // Car: extruded side profile with wheel arches, glass greenhouse, roof, wheels, lights. Front at +z.
  ITEMS['car'] = (g, w, h) => {
    const L = h / 2, bev = q3(0, 0.035, 0.05), bw = w - 0.1, s = (L - bev) / 2.25, paint = M.gloss('#3e5266'), dark = M.matte('#26282b');
    const wr = 0.33, wy = 0.33, ar = 0.39, fz = L * 0.62, rz = -L * 0.6;
    const body = new T.Shape(), P = (z, y) => [z * s, y];
    body.moveTo(...P(-2.18, 0.3));
    body.lineTo(rz - ar, 0.3); body.absarc(rz, wy, ar, PI, 0, true);
    body.lineTo(fz - ar, 0.3); body.absarc(fz, wy, ar, PI, 0, true);
    for (const p of [[2.12, 0.3], [2.22, 0.42], [2.25, 0.62], [2.18, 0.76], [1.9, 0.84], [1.0, 0.94], [0.9, 0.975], [-1.55, 1.0], [-1.85, 0.99], [-2.15, 0.95], [-2.24, 0.82], [-2.25, 0.55], [-2.22, 0.36]]) body.lineTo(...P(p[0], p[1]));
    g.add(slabX(body, bw, bev, paint, q3(1, 2, 4)));
    // greenhouse (dark glass) and a body-coloured roof skin over it
    const gw = bw - 0.16, gb = q3(0, 0.05, 0.07);
    g.add(slabX(poly([P(0.95, 0.95), P(0.05, 1.38), P(-0.25, 1.42), P(-1.05, 1.4), P(-1.55, 1.15), P(-1.72, 0.97)]), gw, gb, M.gloss('#1b2127'), q3(1, 2, 3)));
    g.add(slabX(poly([P(0.12, 1.35), P(-0.2, 1.428), P(-1.0, 1.41), P(-1.2, 1.33), P(-1.08, 1.31), P(-0.95, 1.37), P(-0.2, 1.385), P(0.05, 1.325)]), gw + 0.01, gb, paint, q3(1, 2, 3)));
    // underbody fills the wheel wells
    g.add(box(-bw / 2 + 0.24, bw / 2 - 0.24, 0.16, 0.66, -L + 0.35, L - 0.35, dark));
    if (Q) {
      // pillars
      const px = gw / 2 - 0.002;
      for (const sx of [-1, 1]) {
        g.add(box(sx * px - 0.008, sx * px + 0.008, 0.97, 1.4, -0.34 * s, -0.26 * s, paint));
        g.add(bar(V(sx * (px - 0.02), 0.97, 0.93 * s), V(sx * (px - 0.03), 1.38, 0.07 * s), 0.035, paint, 0.05));
        g.add(bar(V(sx * (px - 0.015), 0.99, -1.62 * s), V(sx * (px - 0.03), 1.38, -1.1 * s), 0.03, paint, 0.16));
      }
    }
    // wheels: tyre, rim, hub; spokes at High
    const tyre = M.matte('#1c1d1f'), rimM = M.metal('#c4c8cc'), wx = bw / 2 - 0.11;
    for (const z of [fz, rz]) for (const sx of [-1, 1]) {
      const wg = group(g, sx * wx, wy, z);
      const t = Q ? lathe([[0.21, -0.11], [0.3, -0.11], [0.325, -0.09], [wr, -0.05], [wr, 0.05], [0.325, 0.09], [0.3, 0.11], [0.21, 0.11]], tyre, q3(12, 18, 24)) : mesh(new T.CylinderGeometry(wr, wr, 0.22, 12), tyre);
      t.rotation.z = PI / 2;
      wg.add(t);
      const rim = mesh(new T.CylinderGeometry(0.215, 0.215, 0.2, q3(10, 16, 20)), Q ? dark : rimM);
      rim.rotation.z = PI / 2;
      wg.add(rim);
      if (Q) {
        const hub = mesh(new T.CylinderGeometry(0.05, 0.05, 0.014, 10), rimM, sx * 0.105, 0, 0);
        hub.rotation.z = PI / 2;
        wg.add(hub);
        for (let i = 0; i < (Q === 2 ? 5 : 0); i++) {
          const p = group(wg, 0, 0, 0);
          p.rotation.x = (i * 2 * PI) / 5;
          p.add(box(sx * 0.088, sx * 0.104, -0.022, 0.022, 0.03, 0.2, rimM));
        }
        const ring = mesh(torusGeo(0.2, 0.014, q3(12, 18, 24)), rimM, sx * 0.09, 0, 0);
        ring.rotation.y = PI / 2;
        wg.add(ring);
      }
    }
    // lights, grille, plates
    const lw = M.emissive('#f4f2ea'), lr = M.emissive('#b5121b');
    for (const sx of [-1, 1]) {
      g.add(box(sx * (bw / 2 - 0.38), sx * (bw / 2 - 0.07), 0.68, 0.75, 2.1 * s, L - 0.012, lw));
      g.add(box(sx * (bw / 2 - 0.4), sx * (bw / 2 - 0.06), 0.8, 0.88, -L + 0.005, -2.1 * s, lr));
    }
    g.add(box(-0.38, 0.38, 0.45, 0.6, 2.12 * s, L - 0.006, dark));
    if (Q) {
      g.add(box(-bw / 2 + 0.4, bw / 2 - 0.4, 0.835, 0.85, -L + 0.006, -2.1 * s, lr));
      const pl = M.matte('#f2f2ee');
      g.add(box(-0.26, 0.26, 0.42, 0.53, 2.15 * s, L, pl), box(-0.26, 0.26, 0.55, 0.66, -L, -2.15 * s, pl));
      for (const sx of [-1, 1]) {
        g.add(box(sx * (bw / 2 - 0.03), sx * (w / 2), 0.98, 1.06, 0.82 * s, 0.98 * s, paint));
        g.add(box(sx * (bw / 2 - 0.03), sx * (w / 2 - 0.005), 0.985, 1.055, 0.81 * s, 0.82 * s, dark));
      }
    }
    if (Q === 2) {
      // door seams and handles
      const sx2 = bw / 2 + 0.0015;
      for (const sx of [-1, 1]) {
        for (const [z, y0] of [[1.0, 0.36], [-0.3, 0.34], [-1.12, 0.62]]) g.add(box(sx * sx2 - 0.002, sx * sx2 + 0.002, y0, 0.97, z * s - 0.003, z * s + 0.003, dark));
        for (const z of [0.55, -0.72]) g.add(box(sx * (sx2 + 0.006) - 0.006, sx * (sx2 + 0.006) + 0.006, 0.86, 0.885, z * s - 0.06, z * s + 0.06, M.metal(CHROME)));
      }
    }
  };

  // Sun lounger: teak frame, seat cushion, backrest raised at the -z end.
  ITEMS['lounger'] = (g, w, h) => {
    const x0 = -w / 2, z0 = -h / 2, z1 = h / 2, teak = M.wood(TEAK), cush = M.fabric('#ece8df'), rx = w / 2 - 0.03, zh = z0 + Math.min(0.72, h * 0.38), bl = Math.min(0.7, h * 0.37);
    for (const sx of [-1, 1]) {
      g.add(box(sx * rx - 0.02, sx * rx + 0.02, 0.22, 0.3, z0 + 0.05, z1 - 0.02, teak));
      for (const z of [z0 + 0.09, z1 - 0.07]) g.add(box(sx * rx - 0.022, sx * rx + 0.022, 0, 0.24, z - 0.025, z + 0.025, teak));
      if (Q === 2) {
        // wheels at the head end
        const wh = mesh(new T.CylinderGeometry(0.06, 0.06, 0.025, 14), M.matte('#2b2c2e'), sx * (rx - 0.036), 0.06, z0 + 0.09);
        wh.rotation.z = PI / 2;
        g.add(wh);
      }
    }
    if (Q) for (const z of [z0 + 0.08, (zh + z1) / 2, z1 - 0.04]) g.add(box(x0 + 0.03, -x0 - 0.03, 0.24, 0.29, z - 0.02, z + 0.02, teak));
    g.add(rbox(x0 + 0.035, -x0 - 0.035, 0.3, 0.38, zh, z1 - 0.02, 0.035, cush));
    // backrest hinged at zh, raised ~50°
    const b = group(g, 0, 0.32, zh);
    b.rotation.x = 0.85;
    for (const sx of [-1, 1]) b.add(box(sx * rx - 0.02, sx * rx + 0.02, -0.04, 0.0, -bl, 0, teak));
    b.add(rbox(x0 + 0.035, -x0 - 0.035, 0, 0.08, -bl, -0.01, 0.035, cush));
    if (Q === 2) b.add(rbox(-w * 0.3, w * 0.3, 0.07, 0.14, -bl + 0.04, -bl + 0.2, 0.035, M.fabric('#c9b48a')));
    if (Q) for (const sx of [-1, 1]) g.add(rod(V(sx * (rx - 0.035), 0.3, Math.max(z0 + 0.06, zh - bl * 0.64)), V(sx * (rx - 0.035), 0.3 + bl * 0.36, zh - bl * 0.39), 0.012, teak));
  };

  ITEMS['outdoor-table'] = (g, w, h) => {
    const r = Math.min(w, h) / 2, tr = Math.min(0.55, r * 0.55), teak = M.wood(TEAK), alu = M.matte('#3c3f42'), H = 0.75;
    if (Q) g.add(lathe([[0, H - 0.03], [tr - 0.015, H - 0.03], [tr, H - 0.02], [tr, H - 0.008], [tr - 0.01, H], [0, H]], teak, q3(16, 28, 40)));
    else g.add(cyl(0, 0, tr, tr, H - 0.03, H, teak, 16));
    if (Q === 2) for (let i = -2; i <= 2; i++) { const x = (i * tr) / 3, l = Math.sqrt(tr * tr - x * x) - 0.012; g.add(box(x - 0.003, x + 0.003, H - 0.0005, H + 0.0008, -l, l, M.matte('#5a4632'))); }
    g.add(cyl(0, 0, 0.035, 0.04, 0.03, H - 0.03, alu, q3(8, 12, 16)));
    g.add(box(-0.32, 0.32, 0, 0.035, -0.025, 0.025, alu), box(-0.025, 0.025, 0, 0.035, -0.32, 0.32, alu));
    if (Q) g.add(cyl(0, 0, 0.12, 0.12, H - 0.06, H - 0.03, alu, 12));
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2, d = r - 0.22;
      g.add(at(dchair(alu, Q ? M.fabric('#dcd8cf') : alu), Math.cos(a) * d, 0, Math.sin(a) * d, Math.atan2(-Math.cos(a), -Math.sin(a))));
    }
    if (Q === 2) pottedPlant(g, 0, H, 0, 0.06, 0.09, rng(5));
  };

  ITEMS['outdoor-sofa'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, teak = M.wood(TEAK), cush = M.fabric('#dcd8cf'), arm = 0.12, bt = 0.08;
    for (const sx of [-1, 1]) {
      const a = sx < 0 ? x0 : x1 - arm, b = a + arm;
      if (!Q) { g.add(box(a, b, 0, 0.64, z0, z1, teak)); continue; }
      for (const z of [z0 + 0.03, z1 - 0.03]) g.add(box(a + 0.01, b - 0.01, 0, 0.62, z - 0.03, z + 0.03, teak));
      g.add(rbox(a, b, 0.62, 0.65, z0, z1, 0.008, teak, 1));
      g.add(box(a + 0.015, b - 0.015, 0.1, 0.14, z0 + 0.06, z1 - 0.06, teak));
      const ns = Math.max(3, Math.round((h - 0.16) / 0.07));
      for (let i = 0; i < ns; i++) { const z = z0 + 0.08 + ((i + 0.5) * (h - 0.16)) / ns; g.add(box(a + 0.025, b - 0.025, 0.14, 0.62, z - 0.014, z + 0.014, teak)); }
    }
    g.add(box(x0 + arm, x1 - arm, 0.12, 0.3, z0 + 0.03, z1 - 0.03, teak));
    if (Q) {
      g.add(box(x0 + arm, x1 - arm, 0.7, 0.74, z0, z0 + 0.04, teak));
      for (const y of [0.4, 0.55]) g.add(box(x0 + arm, x1 - arm, y - 0.03, y + 0.03, z0, z0 + 0.035, teak));
      for (const x of [x0 + arm + 0.04, x1 - arm - 0.04]) g.add(box(x - 0.025, x + 0.025, 0.3, 0.74, z0, z0 + 0.04, teak));
    } else g.add(box(x0 + arm, x1 - arm, 0.3, 0.74, z0, z0 + 0.05, teak));
    const n = Math.max(1, Math.round((w - 2 * arm) / 0.8)), cw = (w - 2 * arm) / n;
    for (let i = 0; i < n; i++) {
      const cx = x0 + arm + cw * (i + 0.5);
      g.add(rbox(cx - cw / 2 + 0.004, cx + cw / 2 - 0.004, 0.3, 0.45, z0 + bt, z1 - 0.01, 0.045, cush));
      backCush(g, cx, 0.43, z0 + bt + 0.09, cw, 0, cush, 0.16);
    }
    if (Q) {
      pillow(g, x0 + arm + 0.24, 0.65, z0 + bt + 0.25, 0.42, 0.12, M.fabric('#5e7f86'));
      pillow(g, x1 - arm - 0.24, 0.65, z0 + bt + 0.25, 0.42, -0.12, M.fabric('#d9b26a'));
    }
  };

  ITEMS['bbq'] = (g, w, h) => {
    const x0 = -w / 2, x1 = w / 2, z0 = -h / 2, z1 = h / 2, en = M.gloss('#2a2b2d'), st = M.metal(STEEL), chr = M.metal(CHROME), blk = M.matte('#1f2022');
    const bw = Math.min(0.7, w * 0.58), legH = Q ? 0.1 : 0, cz0 = z0 + 0.04, cz1 = z1 - 0.05, top = 0.86;
    // cart with steel doors
    g.add(box(-bw / 2, bw / 2, legH, 0.6, cz0, cz1 - 0.02, en));
    for (const sx of [-1, 1]) {
      panel(g, sx < 0 ? -bw / 2 : 0, sx < 0 ? 0 : bw / 2, legH + 0.01, 0.59, cz1, 0.02, st, 0.003);
      if (Q) pull(g, sx * 0.035, 0.45, cz1, 0.16, true, chr);
    }
    if (Q) {
      for (const sx of [-1, 1]) for (const z of [cz0 + 0.03, cz1 - 0.05]) g.add(box(sx * (bw / 2 - 0.03) - 0.015, sx * (bw / 2 - 0.03) + 0.015, 0, legH, z - 0.015, z + 0.015, blk));
      for (const z of [cz0 + 0.06, cz1 - 0.08]) {
        const wh = mesh(new T.CylinderGeometry(0.075, 0.075, 0.04, q3(10, 14, 20)), blk, -bw / 2 - 0.025, 0.075, z);
        wh.rotation.z = PI / 2;
        g.add(wh);
      }
    }
    // firebox, control panel with knobs, domed lid with handle
    g.add(rbox(-bw / 2, bw / 2, 0.6, top, cz0, cz1, 0.02, en, 1));
    g.add(box(-bw / 2 + 0.01, bw / 2 - 0.01, 0.64, 0.8, cz1 - 0.01, cz1 + 0.01, st));
    const nk = Math.max(2, Math.round(bw / 0.17));
    for (let i = 0; i < nk; i++) g.add(disc(-bw / 2 + (bw * (i + 0.5)) / nk, 0.72, cz1 + 0.01, cz1 + 0.035, 0.022, blk, q3(8, 12, 16)));
    const lr = (cz1 - cz0) / 2, lid = new T.CylinderGeometry(lr, lr, bw, q3(8, 16, 24), 1, false, 0, PI);
    lid.rotateZ(PI / 2);
    const lm = mesh(lid, en, 0, top, (cz0 + cz1) / 2);
    lm.scale.y = 0.75;
    g.add(lm);
    const hz = (cz0 + cz1) / 2 + lr * 0.97 + 0.035, hy = top + 0.08;
    g.add(rod(V(-bw * 0.35, hy, hz), V(bw * 0.35, hy, hz), 0.011, chr));
    if (Q) for (const sx of [-1, 1]) g.add(rod(V(sx * bw * 0.3, hy, hz), V(sx * bw * 0.3, hy - 0.01, hz - 0.045), 0.007, chr));
    if (Q === 2) { const zt = (cz0 + cz1) / 2 + Math.sqrt(Math.max(0, lr * lr - 0.16 * 0.16)); g.add(disc(0, top + 0.12, zt - 0.006, zt + 0.006, 0.03, chr)); }
    // side shelves
    for (const sx of [-1, 1]) {
      const a = sx < 0 ? x0 : bw / 2, b = sx < 0 ? -bw / 2 : x1;
      g.add(box(a, b, 0.835, 0.86, cz0 + 0.01, cz1 - 0.01, st));
      if (Q === 2) for (let k = 1; k < 4; k++) { const z = cz0 + ((cz1 - cz0) * k) / 4; g.add(box(a + 0.02, b - 0.02, 0.86, 0.862, z - 0.003, z + 0.003, M.metal('#8e9398'))); }
    }
  };

  // Garden bench: iron side frames, teak slats, backrest at -z.
  ITEMS['bench'] = (g, w, h) => {
    const z0 = -h / 2, z1 = h / 2, teak = M.wood(TEAK), iron = M.metal(IRON), ax = w / 2 - 0.03;
    for (const sx of [-1, 1]) {
      const x = sx * ax;
      g.add(box(x - 0.02, x + 0.02, 0, 0.62, z1 - 0.07, z1 - 0.03, iron));
      g.add(bar(V(x, 0, z0 + 0.13), V(x, 0.86, z0 + 0.03), 0.04, iron));
      g.add(box(x - 0.02, x + 0.02, 0.37, 0.41, z0 + 0.09, z1 - 0.03, iron));
      g.add(rbox(x - 0.032, x + 0.032, 0.62, 0.65, z0 + 0.06, z1, 0.006, teak, 1));
      if (Q) g.add(box(x - 0.015, x + 0.015, 0.08, 0.11, z0 + 0.12, z1 - 0.06, iron));
    }
    const sx0 = -ax + 0.025, sx1 = ax - 0.025, ns = Q ? 5 : 1, sd = h - 0.13, gap = Q ? 0.012 : 0, sw = (sd - gap * (ns - 1)) / ns;
    for (let i = 0; i < ns; i++) { const z = z0 + 0.1 + i * (sw + gap); g.add(rbox(sx0, sx1, 0.41, 0.435, z, z + sw, 0.004, teak, 1)); }
    const b = group(g, 0, 0.47, z0 + 0.1);
    b.rotation.x = -0.2;
    const nb = Q ? 4 : 1, bh = 0.36, bg = Q ? 0.02 : 0, bs = (bh - bg * (nb - 1)) / nb;
    for (let i = 0; i < nb; i++) { const y = i * (bs + bg); b.add(rbox(sx0, sx1, y, y + bs, -0.0125, 0.0125, 0.004, teak, 1)); }
  };

  ITEMS['planter'] = (g, w, h) => {
    const hw = w / 2 - 0.01, hd = h / 2 - 0.01, H = 0.5, pot = M.matte('#b57a55'), rnd = rng(Math.round(w * 977 + h * 131));
    const geo = new T.CylinderGeometry(Math.SQRT2 * 0.96, Math.SQRT2 * 0.8, H - (Q ? 0.04 : 0), 4);
    geo.rotateY(PI / 4);
    const m = mesh(geo, pot, 0, (H - (Q ? 0.04 : 0)) / 2, 0);
    m.scale.set(hw, 1, hd);
    g.add(m);
    if (Q) {
      const s = rrect(new T.Shape(), -hw, -hd, hw, hd, 0.01);
      s.holes.push(rrect(new T.Path(), -hw + 0.03, -hd + 0.03, hw - 0.03, hd - 0.03, 0.005));
      g.add(slabY(s, H - 0.045, 0.045, 0, pot));
    }
    g.add(box(-hw * 0.94, hw * 0.94, H - 0.07, H - 0.03, -hd * 0.94, hd * 0.94, M.matte('#4a3a2c')));
    const n = q3(2, 4, 6), rr = Math.min(hw, hd), cols = ['#5f8f45', '#4f7f3a', '#6e9e4e'];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + rnd(), d = i ? rr * 0.36 : 0, rad = rr * (i ? 0.42 + rnd() * 0.1 : 0.68);
      const b = mesh(lumpy(new T.IcosahedronGeometry(rad, Q === 2 && !i ? 2 : 1), 0.14, rnd() * 9), M.leaf(cols[i % 3]), Math.cos(a) * d, H + rad * (i ? 0.55 : 0.7) + (i ? 0 : rr * 0.15), Math.sin(a) * d);
      b.scale.y = 0.9;
      g.add(b);
    }
    if (Q === 2) for (let i = 0; i < 7; i++) {
      const a = rnd() * 6.28, tilt = 0.15 + rnd() * 0.2, len = Math.min(0.45, 0.3 + rnd() * 0.15) * Math.min(1, rr / 0.29), c = mesh(new T.ConeGeometry(0.025, len, 3), M.leaf('#7aa457'));
      const p = group(g, Math.cos(a) * rr * 0.3, H + 0.05, Math.sin(a) * rr * 0.3, PI / 2 - a), q = group(p, 0, 0, 0);
      c.position.y = len / 2;
      q.rotation.x = tilt; // lean outwards
      q.add(c);
    }
  };

  /* ---------- plants ---------- */
  function leafBlob(g, x, y, z, rad, color, detail, rnd, sy) {
    const b = mesh(lumpy(new T.IcosahedronGeometry(rad, detail), 0.16, rnd() * 20), M.leaf(color), x, y, z);
    b.scale.y = sy || 1;
    b.rotation.y = rnd() * 6.28;
    g.add(b);
    return b;
  }
  // Shade or fruit tree: leaning trunk, branches into a clustered canopy of overlapping blobs.
  function tree(g, r, rnd, fruit) {
    const th = fruit ? 1.3 + r * 0.15 : 2.2 + r * 0.3, tr = fruit ? 0.06 + r * 0.025 : 0.1 + r * 0.03, bark = M.bark(fruit ? '#6e5340' : '#6b4a2f');
    const greens = fruit ? ['#5d9440', '#6aa04a', '#4f8538'] : ['#4f7f38', '#5f9442', '#6aa04a', '#557f3a', '#476f32'];
    const la = rnd() * 6.28, ld = r * 0.06 * rnd(), top = V(Math.cos(la) * ld, th + r * 0.25, Math.sin(la) * ld);
    g.add(rod(V(0, 0, 0), top, tr, bark, q3(6, 7, 9), tr * 0.6));
    if (Q) g.add(cyl(0, 0, tr, tr * 1.45, 0, 0.18, bark, q3(6, 7, 9)));
    if (Q) {
      const nb = q3(0, 3, 5);
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * 6.28 + rnd() * 0.8, y = th * (0.72 + rnd() * 0.2), d = r * (0.35 + rnd() * 0.2);
        g.add(rod(V(top.x * (y / th), y, top.z * (y / th)), V(Math.cos(a) * d, th + r * (0.35 + rnd() * 0.3), Math.sin(a) * d), tr * 0.45, bark, 5, tr * 0.2));
      }
    }
    const cy = th + r * (fruit ? 0.6 : 0.55), n = fruit ? q3(4, 6, 9) : q3(5, 8, 12), blobs = [];
    blobs.push([0, cy, 0, r * 0.68]);
    leafBlob(g, 0, cy, 0, r * 0.68, greens[0], Q === 2 ? 2 : 1, rnd, 0.82);
    for (let i = 1; i < n; i++) {
      const a = i * 2.4 + rnd() * 0.6, upper = i % 3 === 0, rad = r * (upper ? 0.36 + rnd() * 0.1 : 0.38 + rnd() * 0.12), d = Math.max(0, Math.min(r - rad * 1.25, r * (upper ? 0.25 : 0.42 + rnd() * 0.15)));
      const x = Math.cos(a) * d, z = Math.sin(a) * d, y = cy + (upper ? r * (0.35 + rnd() * 0.15) : r * (rnd() * 0.3 - 0.18));
      blobs.push([x, y, z, rad]);
      leafBlob(g, x, y, z, rad, greens[i % greens.length], Q === 2 && i < 6 ? 2 : 1, rnd, 0.85);
    }
    if (fruit) {
      const fc = ['#e8873a', '#c63b2b', '#e9c43a'][Math.floor(rnd() * 3)], nf = q3(10, 18, 28);
      for (let i = 0; i < nf; i++) {
        const [bx, by, bz, br] = blobs[Math.floor(rnd() * blobs.length)], a = rnd() * 6.28, e = rnd() * 1.4 - 0.6;
        g.add(mesh(new T.IcosahedronGeometry(0.075, 0), M.gloss(fc), bx + Math.cos(a) * Math.cos(e) * br * 0.97, by + Math.sin(e) * br * 0.82, bz + Math.sin(a) * Math.cos(e) * br * 0.97));
      }
    }
  }
  // Palm frond in its own frame: rises along +x, droops, with leaflets either side.
  function frondGeo(len, lift, m) {
    const pos = [], sp = [];
    let px = 0, py = 0;
    for (let i = 0; i <= m; i++) {
      const t = i / m, e = lift - (lift + 1.1) * t * t;
      sp.push([px, py, t]);
      px += (Math.cos(e) * len) / m;
      py += (Math.sin(e) * len) / m;
    }
    for (let i = 0; i < m; i++) {
      const [ax, ay, t] = sp[i], [bx, by] = sp[i + 1], ll = len * (0.1 + 0.4 * Math.sin(PI * Math.min(1, t * 1.15 + 0.08)));
      for (const sd of [-1, 1]) pos.push(ax, ay, 0, bx, by, 0, ax + ll * 0.25, ay - ll * 0.4, sd * ll * 0.88);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }
  function palm(g, r, rnd) {
    const th = 3.5 + r * 0.6, bark = M.bark('#8a6a48'), n = q3(4, 7, 10), dir = rnd() * 6.28, lean = Math.min(r * 0.25, (0.04 + rnd() * 0.05) * th), pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push(V(Math.cos(dir) * lean * t * t, th * t, Math.sin(dir) * lean * t * t)); }
    for (let i = 0; i < n; i++) {
      const r0 = 0.15 - (0.06 * i) / n, r1 = 0.15 - (0.06 * (i + 1)) / n;
      g.add(rod(pts[i], pts[i + 1].clone().lerp(pts[i], -0.03), Q === 2 ? r0 * 1.06 : r0, bark, q3(6, 8, 10), r1));
    }
    const tp = pts[n], nf = q3(6, 9, 13), greens = ['#5f9a3c', '#6aa548', '#55893a'];
    if (Q) g.add(cyl(tp.x, tp.z, 0.07, 0.11, th - 0.05, th + 0.18, M.bark('#7d6a4a'), 8));
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * 6.28 + rnd() * 0.35, lift = 0.35 + rnd() * 0.5 + (i % 3 === 0 ? 0.3 : 0), geo = frondGeo(1, lift, q3(4, 9, 15)), p = geo.attributes.position.array;
      // scale so the frond reaches (r - lean) from the crown, whatever its droop
      let ext = 0;
      for (let k = 0; k < p.length; k += 3) ext = Math.max(ext, Math.hypot(p[k], p[k + 2]));
      const k = ((r - lean - 0.04) * (0.9 + rnd() * 0.1)) / ext;
      geo.scale(k, k, k);
      const f = mesh(geo, M.leaf(greens[i % 3]), tp.x, th + 0.12, tp.z);
      f.rotation.y = a;
      g.add(f);
    }
    if (Q) for (let i = 0; i < q3(0, 3, 5); i++) {
      const a = rnd() * 6.28;
      g.add(mesh(new T.IcosahedronGeometry(0.075, 1), M.matte('#7a5a33'), tp.x + Math.cos(a) * 0.13, th - 0.05 - rnd() * 0.1, tp.z + Math.sin(a) * 0.13));
    }
  }
  // Conifer: stacked ragged cones on a short trunk.
  function conifer(g, r, rnd) {
    const H = r * 3.4 + 0.5, yb = 0.45, span = H - yb, tiers = q3(3, 5, 7), cols = ['#2f5d34', '#3e6f3c', '#356b3a'];
    g.add(cyl(0, 0, 0.05 + r * 0.04, 0.08 + r * 0.06, 0, yb + 0.3, M.bark('#5e4330'), 7));
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, rad = r * (1 - 0.72 * t) * (0.86 + rnd() * 0.04), ht = span * (0.42 - 0.1 * t), y0 = yb + span * 0.82 * (i / tiers) * (1 + 0.1 / tiers);
      const geo = new T.ConeGeometry(rad, Math.min(ht, H - y0), q3(7, 9, 12), 1, true);
      if (Q) {
        const p = geo.attributes.position.array, ph = rnd() * 6;
        for (let k = 0; k < p.length; k += 3) {
          if (p[k + 1] > 0) continue;
          const a = Math.atan2(p[k + 2], p[k]), f = 1 + 0.12 * Math.sin(a * 5 + ph);
          p[k] *= f; p[k + 2] *= f; p[k + 1] -= rad * 0.12 * (0.5 + 0.5 * Math.sin(a * 7 + ph * 2));
        }
        geo.computeVertexNormals();
      }
      const c = mesh(geo, M.leaf(cols[i % 3]), (rnd() - 0.5) * r * 0.06, y0 + Math.min(ht, H - y0) / 2, (rnd() - 0.5) * r * 0.06);
      c.rotation.y = rnd() * 6.28;
      g.add(c);
    }
  }
  function shrub(g, r, rnd) {
    const n = q3(2, 4, 6), cols = ['#5d8f40', '#4f8238', '#6a9a4a'];
    leafBlob(g, 0, r * 0.62, 0, r * 0.76, cols[0], Q === 2 ? 2 : 1, rnd, 0.8);
    for (let i = 1; i < n; i++) {
      const a = i * 2.3 + rnd(), rad = r * (0.4 + rnd() * 0.12), d = Math.max(0, r - rad * 1.27);
      leafBlob(g, Math.cos(a) * d, rad * 0.85 + rnd() * r * 0.2, Math.sin(a) * d, rad, cols[i % 3], 1, rnd, 0.85);
    }
    if (Q === 2 && rnd() < 0.5) {
      const fc = rnd() < 0.5 ? '#f4f1ea' : '#e9a0b8';
      for (let i = 0; i < 10; i++) {
        const a = rnd() * 6.28, e = rnd() * 1.2;
        g.add(mesh(new T.IcosahedronGeometry(0.03, 0), M.matte(fc), Math.cos(a) * Math.cos(e) * r * 0.75, r * 0.62 + Math.sin(e) * r * 0.6, Math.sin(a) * Math.cos(e) * r * 0.75));
      }
    }
  }
  function flowers(g, r, rnd) {
    const pal = [['#e86a8a', '#f2a7c3'], ['#f7d35b', '#f2b33b'], ['#9b7fd1', '#c4b0ec'], ['#e8573f', '#f29a6b'], ['#f4f1ea', '#f7d35b']][Math.floor(rnd() * 5)];
    leafBlob(g, 0, r * 0.22, 0, r * 0.75, '#5f8f45', Q === 2 ? 2 : 1, rnd, 0.5);
    if (Q) for (let i = 0; i < q3(0, 2, 3); i++) { const a = rnd() * 6.28; leafBlob(g, Math.cos(a) * r * 0.4, r * 0.18, Math.sin(a) * r * 0.4, r * 0.45, '#6e9e4e', 1, rnd, 0.55); }
    const nb = q3(8, 16, 28);
    for (let i = 0; i < nb; i++) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r * 0.72, y = r * (0.2 + 0.32 * Math.sqrt(Math.max(0, 1 - (d / (r * 0.8)) ** 2))) + rnd() * 0.04;
      const b = mesh(new T.IcosahedronGeometry(Q ? 0.045 : 0.05, 0), M.matte(pal[i % 3 === 2 ? 1 : 0]), Math.cos(a) * d, y, Math.sin(a) * d);
      b.scale.y = 0.65;
      g.add(b);
      if (Q === 2 && i % 2 === 0) g.add(mesh(new T.IcosahedronGeometry(0.016, 0), M.matte('#f1c83c'), Math.cos(a) * d, y + 0.028, Math.sin(a) * d));
    }
  }
  const PLANTS = {
    tree: (g, r, rnd) => tree(g, r, rnd, false),
    fruit: (g, r, rnd) => tree(g, r, rnd, true),
    palm, conifer, shrub, flowers
  };

  /* ---------- API ---------- */
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function setup(t, quality, mats) { T = t; Q = quality == null ? 1 : Math.max(0, Math.min(2, quality | 0)); M = mats; }
  FP.furniture3d = {
    // Returns a THREE.Group for furniture kind, or null if unknown.
    item(kind, w, h, t, quality, mats) {
      if (!has(ITEMS, kind)) return null;
      setup(t, quality, mats);
      const g = new T.Group();
      ITEMS[kind](g, w, h);
      return merge(g);
    },
    // Returns a THREE.Group for plant kind with canopy radius r, or null if unknown. rnd() is a seeded 0..1 random fn.
    plant(kind, r, t, quality, mats, rnd) {
      if (!has(PLANTS, kind)) return null;
      setup(t, quality, mats);
      const g = new T.Group();
      PLANTS[kind](g, r, rnd || rng(7));
      const out = merge(g);
      // foliage mounds sit on the ground rather than dipping below it
      out.children.forEach((m) => {
        const p = m.geometry.attributes.position.array;
        for (let i = 1; i < p.length; i += 3) if (p[i] < 0) p[i] = 0;
        m.geometry.computeBoundingSphere();
      });
      return out;
    }
  };
})();
