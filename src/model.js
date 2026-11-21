// Project data model. All coordinates are metres; the lot's top-left corner is (0, 0).
//   walls:    { id, x1, y1, x2, y2, t, kind: 'exterior'|'interior' }   (centre lines)
//   openings: { id, wall, pos, w, type, hinge: 'start'|'end', side: 1|-1 }  pos = metres from wall start to centre
//   rooms:    { id, name, kind, use, floor, pts: [{x,y}] }               outlines on wall centre lines
//   areas:    { id, name, material, pts }                                 ground surfaces of the plot
//   plants:   { id, kind, x, y, r }
//   items:    { id, kind, x, y, w, h, rot }                               x, y = centre; rot in degrees
window.FP = window.FP || {};

(function () {
  const G = FP.geom;
  const LISTS = { wall: 'walls', opening: 'openings', room: 'rooms', area: 'areas', plant: 'plants', item: 'items' };

  const M = FP.model = {
    LISTS,

    uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 9); },

    newProject(name) {
      return M.normalize({ name: name || 'Untitled project', lot: { w: 30, h: 40 }, settings: { sizes: 'clear' } });
    },

    normalize(p) {
      p = p || {};
      p.version = 1;
      p.name = p.name || 'Untitled project';
      p.lot = p.lot || { w: 30, h: 40 };
      p.lot.w = +p.lot.w || 30; p.lot.h = +p.lot.h || 40;
      for (const k of Object.values(LISTS)) p[k] = Array.isArray(p[k]) ? p[k] : [];
      p.settings = Object.assign({ grid: 0.25, decimals: 2, wallH: 2.7 }, p.settings || {});
      p.settings.roof = Object.assign({ type: 'flat', pitch: 22, overhang: 0.5, slab: 0.3, material: 'membrane', color: '#cfcac2' }, p.settings.roof || {});
      if (!FP.catalog.roofs[p.settings.roof.type]) p.settings.roof.type = 'flat';
      if (!FP.catalog.roofMaterials[p.settings.roof.material]) p.settings.roof.material = 'membrane';
      // Exterior, doors, windows and interior defaults. Older designs get the Modern look minus its roof.
      p.settings.style = Object.assign(M.styleFields('modern'), p.settings.style || {});
      for (const o of p.openings) {
        const d = FP.catalog.openings[o.type] || FP.catalog.openings.door;
        if (!(o.h > 0)) o.h = d.h;
        if (!(o.sill >= 0)) o.sill = d.sill;
      }
      for (const r of p.rooms) {
        r.use = r.use || 'indoor';
        r.kind = r.kind || 'other';
        r.floor = r.floor || (FP.catalog.roomKinds[r.kind] || FP.catalog.roomKinds.other).floor;
      }
      return p;
    },

    list(p, k) { return p[LISTS[k]]; },
    find(p, k, id) { return (p[LISTS[k]] || []).find((e) => e.id === id) || null; },

    remove(p, k, id) {
      const key = LISTS[k];
      p[key] = p[key].filter((e) => e.id !== id);
      if (k === 'wall') p.openings = p.openings.filter((o) => o.wall !== id);
    },

    /* ---------- walls & openings ---------- */
    wallVec(w) {
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1e-9;
      const ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
      return { a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 }, L, ux, uy, nx: -uy, ny: ux };
    },

    clampOpening(p, o) {
      const w = M.find(p, 'wall', o.wall);
      if (!w) return;
      const v = M.wallVec(w);
      o.w = Math.max(0.3, Math.min(o.w, v.L));
      o.pos = Math.max(o.w / 2, Math.min(v.L - o.w / 2, o.pos));
    },

    // Geometry of an opening: jamb points s (start side) and e, centre c, wall unit u and normal n.
    openingGeo(p, o) {
      const w = M.find(p, 'wall', o.wall);
      if (!w) return null;
      const v = M.wallVec(w);
      const pos = Math.max(o.w / 2, Math.min(v.L - o.w / 2, o.pos));
      const c = { x: v.a.x + v.ux * pos, y: v.a.y + v.uy * pos };
      return {
        wall: w, v, t: w.t, c,
        s: { x: c.x - (v.ux * o.w) / 2, y: c.y - (v.uy * o.w) / 2 },
        e: { x: c.x + (v.ux * o.w) / 2, y: c.y + (v.uy * o.w) / 2 },
        from: pos - o.w / 2, to: pos + o.w / 2
      };
    },

    // Add a wall from a to b, skipping any stretch already covered by a collinear wall.
    addWall(p, a, b, t, kind) {
      const L = G.len(a, b);
      if (L < 0.05) return [];
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      const perp = (x, y) => (x - a.x) * -uy + (y - a.y) * ux;
      let iv = [[0, L]];
      for (const w of p.walls) {
        if (Math.abs(perp(w.x1, w.y1)) > 0.02 || Math.abs(perp(w.x2, w.y2)) > 0.02) continue;
        let s1 = (w.x1 - a.x) * ux + (w.y1 - a.y) * uy, s2 = (w.x2 - a.x) * ux + (w.y2 - a.y) * uy;
        if (s1 > s2) [s1, s2] = [s2, s1];
        iv = G.subtract(iv, s1, s2);
      }
      const made = [];
      for (const [s, e] of iv) {
        if (e - s < 0.05) continue;
        const w = {
          id: M.uid('w'), t: t || 0.15, kind: kind || 'interior',
          x1: G.round(a.x + ux * s), y1: G.round(a.y + uy * s),
          x2: G.round(a.x + ux * e), y2: G.round(a.y + uy * e)
        };
        p.walls.push(w);
        made.push(w);
      }
      return made;
    },

    addPolyWalls(p, pts, t, kind) {
      const made = [];
      for (let i = 0; i < pts.length; i++) made.push(...M.addWall(p, pts[i], pts[(i + 1) % pts.length], t, kind));
      return made;
    },

    // Exterior if either side of the wall is outside every indoor room.
    classifyWall(p, w) {
      const enclosed = p.rooms.filter((r) => r.use === 'indoor');
      const inside = (pt) => enclosed.some((r) => G.pointInPoly(pt, r.pts));
      const v = M.wallVec(w);
      const m = { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 };
      const a = inside({ x: m.x + v.nx * 0.3, y: m.y + v.ny * 0.3 });
      const b = inside({ x: m.x - v.nx * 0.3, y: m.y - v.ny * 0.3 });
      return a && b ? 'interior' : 'exterior';
    },

    /* ---------- rooms ---------- */
    roomArea(r) { return G.area(r.pts); },

    roomSize(r) {
      if (!G.isAxisRect(r.pts)) return null;
      const b = G.bbox(r.pts);
      return { w: b.w, h: b.h };
    },

    /* ---------- clear sizes ----------
       Room outlines sit on wall centre lines. Sizes shown to the owner are clear sizes between
       wall faces: each edge with a wall on it gives up half that wall's thickness. */

    // Half the thickness of the thickest wall running along segment ab (0 if none).
    edgeInset(p, a, b) {
      const L = G.len(a, b);
      if (L < 1e-6) return 0;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      const perp = (x, y) => Math.abs((x - a.x) * -uy + (y - a.y) * ux);
      let t = 0;
      for (const w of p.walls) {
        if (perp(w.x1, w.y1) > 0.01 || perp(w.x2, w.y2) > 0.01) continue;
        let s1 = (w.x1 - a.x) * ux + (w.y1 - a.y) * uy, s2 = (w.x2 - a.x) * ux + (w.y2 - a.y) * uy;
        if (s1 > s2) [s1, s2] = [s2, s1];
        if (s2 > 0.01 && s1 < L - 0.01) t = Math.max(t, w.t / 2);
      }
      return t;
    },

    roomInsets(p, r) {
      const b = G.bbox(r.pts), x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
      return {
        l: M.edgeInset(p, { x: x0, y: y0 }, { x: x0, y: y1 }),
        r: M.edgeInset(p, { x: x1, y: y0 }, { x: x1, y: y1 }),
        t: M.edgeInset(p, { x: x0, y: y0 }, { x: x1, y: y0 }),
        b: M.edgeInset(p, { x: x0, y: y1 }, { x: x1, y: y1 })
      };
    },

    // Clear length and width inside the walls. For L-shapes and other outlines these are the
    // overall extents; rect tells whether the room is a plain rectangle.
    clearSize(p, r) {
      const pts = G.simplify(r.pts);
      if (pts.length < 3) return null;
      const b = G.bbox(pts), n = pts.length;
      const side = (test) => {
        let t = 0;
        for (let i = 0; i < n; i++) if (test(pts[i]) && test(pts[(i + 1) % n])) t = Math.max(t, M.edgeInset(p, pts[i], pts[(i + 1) % n]));
        return t;
      };
      const l = side((q) => Math.abs(q.x - b.x) < 1e-3), rr = side((q) => Math.abs(q.x - b.x - b.w) < 1e-3);
      const t = side((q) => Math.abs(q.y - b.y) < 1e-3), bt = side((q) => Math.abs(q.y - b.y - b.h) < 1e-3);
      return { w: b.w - l - rr, h: b.h - t - bt, rect: G.isAxisRect(pts) };
    },

    // Usable floor area inside the walls. Exact for rectangles, L- and T-shapes: every edge moves
    // inwards by half its wall and the corners are re-joined. Close for slanted outlines.
    clearArea(p, r) {
      const pts = G.simplify(r.pts), n = pts.length;
      if (n < 3) return 0;
      if (G.isOrtho(pts)) {
        const sh = [];
        for (let i = 0; i < n; i++) {
          const a = pts[i], c = pts[(i + 1) % n], L = G.len(a, c);
          const ux = (c.x - a.x) / L, uy = (c.y - a.y) / L;
          let nx = -uy, ny = ux;
          if (!G.pointInPoly({ x: (a.x + c.x) / 2 + nx * 0.01, y: (a.y + c.y) / 2 + ny * 0.01 }, pts)) { nx = -nx; ny = -ny; }
          const d = M.edgeInset(p, a, c);
          sh.push({ vertical: Math.abs(ux) < 0.5, x: a.x + nx * d, y: a.y + ny * d });
        }
        const q = sh.map((e1, i) => { const e0 = sh[(i - 1 + n) % n]; return e0.vertical ? { x: e0.x, y: e1.y } : { x: e1.x, y: e0.y }; });
        return G.area(q);
      }
      let a = G.area(pts);
      for (let i = 0; i < n; i++) a -= G.len(pts[i], pts[(i + 1) % n]) * M.edgeInset(p, pts[i], pts[(i + 1) % n]);
      return Math.max(0, a);
    },

    // Set a rectangular room's clear size by moving its right and bottom walls, the same way
    // dragging those walls would: walls meeting them stretch and neighbours on the far side shrink.
    resizeClear(p, r, cw, ch) {
      const c = M.clearSize(p, r);
      if (!c || !c.rect) return;
      const b = G.bbox(r.pts);
      if (cw != null && Math.abs(cw - c.w) > 1e-4) M.shiftLine(p, true, b.x + b.w, b.y, b.y + b.h, cw - c.w);
      const b2 = G.bbox(r.pts);
      if (ch != null && Math.abs(ch - c.h) > 1e-4) M.shiftLine(p, false, b2.y + b2.h, b2.x, b2.x + b2.w, ch - c.h);
    },

    // The straight run a wall belongs to: it plus every wall on the same line joined end to end.
    lineRun(p, wall) {
      const vertical = Math.abs(wall.x1 - wall.x2) < 1e-6, horizontal = Math.abs(wall.y1 - wall.y2) < 1e-6;
      if (!vertical && !horizontal) return null;
      const at = vertical ? wall.x1 : wall.y1;
      const on = (w) => (vertical ? Math.abs(w.x1 - at) < 0.01 && Math.abs(w.x2 - at) < 0.01 : Math.abs(w.y1 - at) < 0.01 && Math.abs(w.y2 - at) < 0.01);
      const span = (w) => (vertical ? [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)]);
      const walls = [wall];
      let [a, c] = span(wall), grew = true;
      while (grew) {
        grew = false;
        for (const w of p.walls) {
          if (walls.includes(w) || !on(w)) continue;
          const [s0, s1] = span(w);
          if (s0 <= c + 0.01 && s1 >= a - 0.01) { walls.push(w); a = Math.min(a, s0); c = Math.max(c, s1); grew = true; }
        }
      }
      // a point lies on the run if it is on the line within its extent
      const touches = (x, y) => (vertical ? Math.abs(x - at) < 0.01 && y >= a - 0.01 && y <= c + 0.01 : Math.abs(y - at) < 0.01 && x >= a - 0.01 && x <= c + 0.01);
      return { walls, vertical, at, a, c, touches };
    },

    // Move a straight wall line by d, straight across itself: the whole run of walls on it that
    // overlaps [lo, hi], wall ends and room or surface corners on that run, and its openings.
    // Walls meeting the run stretch, so every corner stays square.
    shiftLine(p, vertical, at, lo, hi, d) {
      const on = (w) => (vertical ? Math.abs(w.x1 - at) < 0.01 && Math.abs(w.x2 - at) < 0.01 : Math.abs(w.y1 - at) < 0.01 && Math.abs(w.y2 - at) < 0.01);
      const span = (w) => (vertical ? [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)]);
      const seed = p.walls.find((w) => on(w) && span(w)[1] > lo + 0.01 && span(w)[0] < hi - 0.01);
      const run = seed ? M.lineRun(p, seed) : null;
      const moved = run ? run.walls : [];
      const a = run ? Math.min(run.a, lo) : lo, c = run ? Math.max(run.c, hi) : hi;
      const dx = vertical ? d : 0, dy = vertical ? 0 : d;
      const touches = (x, y) => (vertical ? Math.abs(x - at) < 0.01 && y >= a - 0.01 && y <= c + 0.01 : Math.abs(y - at) < 0.01 && x >= a - 0.01 && x <= c + 0.01);
      for (const w of p.walls) {
        const all = moved.includes(w);
        if (all || touches(w.x1, w.y1)) { w.x1 = G.round(w.x1 + dx); w.y1 = G.round(w.y1 + dy); }
        if (all || touches(w.x2, w.y2)) { w.x2 = G.round(w.x2 + dx); w.y2 = G.round(w.y2 + dy); }
      }
      for (const list of [p.rooms, p.areas]) {
        for (const r of list) r.pts = r.pts.map((q) => (touches(q.x, q.y) ? { x: G.round(q.x + dx), y: G.round(q.y + dy) } : q));
      }
      for (const o of p.openings) M.clampOpening(p, o);
    },

    // One-off conversion for designs drawn when sizes meant wall centre lines: grow every room so
    // its clear size equals the size it had on centre lines. Works per axis: each wall or room edge
    // line gets a new position, as close as possible, with every room span wide enough. Everything
    // between lines moves proportionally; the yard between the house and the lot edge absorbs the growth.
    toClearSizes(p) {
      const axisMap = (vertical) => {
        const end = vertical ? p.lot.w : p.lot.h;
        const lines = new Set(), reqs = [];
        for (const r of p.rooms) {
          if (!G.isAxisRect(r.pts)) continue;
          const b = G.bbox(r.pts), i = M.roomInsets(p, r);
          const lo = G.round(vertical ? b.x : b.y), hi = G.round(vertical ? b.x + b.w : b.y + b.h);
          const add = vertical ? i.l + i.r : i.t + i.b;
          lines.add(lo); lines.add(hi);
          if (add > 0) reqs.push({ lo, hi, need: hi - lo + add });
        }
        for (const w of p.walls) {
          if (vertical ? Math.abs(w.x1 - w.x2) < 1e-6 : Math.abs(w.y1 - w.y2) < 1e-6) lines.add(G.round(vertical ? w.x1 : w.y1));
        }
        const xs = [...lines].filter((v) => v > 0 && v < end).sort((u, v) => u - v);
        const X = new Map();
        xs.forEach((x, i) => {
          let v = i === 0 ? x : X.get(xs[i - 1]) + (x - xs[i - 1]);
          for (const q of reqs) if (q.hi === x && X.has(q.lo)) v = Math.max(v, X.get(q.lo) + q.need);
          X.set(x, v);
        });
        if (!xs.length) return { f: (v) => v, end };
        const last = xs[xs.length - 1];
        const newEnd = X.get(last) > end - 0.5 ? end + (X.get(last) - last) : end;
        const knots = [[0, 0]].concat(xs.map((x) => [x, X.get(x)]), [[end, newEnd]]);
        const f = (v) => {
          if (v <= 0) return v;
          for (let i = 1; i < knots.length; i++) {
            if (v <= knots[i][0]) {
              const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
              return x1 === x0 ? y1 : y0 + ((v - x0) * (y1 - y0)) / (x1 - x0);
            }
          }
          return v + (newEnd - end);
        };
        return { f, end: newEnd };
      };
      const mx = axisMap(true), my = axisMap(false);
      const P = (q) => ({ x: G.round(mx.f(q.x)), y: G.round(my.f(q.y)) });
      const centres = new Map(p.openings.map((o) => { const g = M.openingGeo(p, o); return [o.id, g ? g.c : null]; }));
      for (const w of p.walls) { const a = P({ x: w.x1, y: w.y1 }), b = P({ x: w.x2, y: w.y2 }); w.x1 = a.x; w.y1 = a.y; w.x2 = b.x; w.y2 = b.y; }
      for (const r of p.rooms) r.pts = r.pts.map(P);
      for (const a of p.areas) a.pts = a.pts.map(P);
      for (const e of p.items.concat(p.plants)) { const q = P(e); e.x = q.x; e.y = q.y; }
      for (const o of p.openings) {
        const c = centres.get(o.id), w = M.find(p, 'wall', o.wall);
        if (!c || !w) continue;
        const v = M.wallVec(w);
        o.pos = G.round(G.project(P(c), v.a, v.b).t * v.L);
        M.clampOpening(p, o);
      }
      p.lot = { w: G.round(mx.end, 2), h: G.round(my.end, 2) };
      p.settings.sizes = 'clear';
      return p;
    },

    nextName(p, kind) {
      const base = (FP.catalog.roomKinds[kind] || FP.catalog.roomKinds.other).label;
      const used = new Set(p.rooms.map((r) => r.name));
      if (!used.has(base)) return base;
      for (let i = 2; ; i++) if (!used.has(base + ' ' + i)) return base + ' ' + i;
    },

    // Bounding box of everything built: walls plus indoor and covered rooms.
    houseBounds(p) {
      const pts = [];
      for (const w of p.walls) pts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      for (const r of p.rooms) if (r.use !== 'outdoor') pts.push(...r.pts);
      return pts.length ? G.bbox(pts) : null;
    },

    /* ---------- heights & roof ---------- */
    // Footprint the main roof covers: indoor rooms only.
    roofBounds(p) {
      const pts = [];
      for (const r of p.rooms) if (r.use === 'indoor') pts.push(...r.pts);
      return pts.length ? G.bbox(pts) : null;
    },

    // How far the roof rises above the top of the walls.
    PARAPET: 0.45,
    roofRise(p) {
      const R = p.settings.roof, b = M.roofBounds(p);
      if (R.type === 'flat' || !b) return R.slab;
      if (R.type === 'parapet') return R.slab + M.PARAPET;
      const span = Math.min(b.w, b.h);
      const tan = Math.tan((R.pitch * Math.PI) / 180);
      return R.type === 'shed' ? span * tan : (span / 2) * tan;
    },

    /* ---------- style & finishes ---------- */
    styleFields(key) {
      const s = FP.catalog.styles[key] || FP.catalog.styles.modern;
      return {
        preset: key, finish: s.finish, extColor: s.extColor, trim: s.trim, window: s.window, door: s.door, doorColor: s.doorColor,
        intDoor: s.intDoor, intDoorColor: s.intDoorColor, wall: s.wall, ceiling: s.ceiling, cornice: s.cornice, columns: s.columns
      };
    },
    // Apply a house style: exterior, roof, doors, windows, paint; floors too unless keepFloors.
    // Room-by-room wall colours are cleared so the new paint shows everywhere.
    applyStyle(p, key, keepFloors) {
      const s = FP.catalog.styles[key];
      if (!s) return;
      p.settings.style = M.styleFields(key);
      Object.assign(p.settings.roof, s.roof);
      for (const r of p.rooms) {
        if (r.use !== 'indoor') continue;
        r.wallColor = null;
        if (keepFloors) continue;
        const f = M.WET.includes(r.kind) ? s.wetFloor : s.floor;
        r.floor = f[0]; r.floorColor = f[1];
      }
    },
    WET: ['bath', 'laundry', 'kitchen'],
    floorColor(r) { return r.floorColor || (FP.catalog.floors[r.floor] || FP.catalog.floors.tile).color; },
    wallColor(p, r) { return (r && r.wallColor) || p.settings.style.wall; },

    // Top of the roof above the floor. Wall height and roof height move together:
    // setting one keeps the roof shape and changes the other.
    roofHeight(p) { return p.settings.wallH + M.roofRise(p); },
    setRoofHeight(p, h) { p.settings.wallH = G.round(Math.max(2.2, Math.min(8, h - M.roofRise(p))), 2); },

    /* ---------- stats ---------- */
    stats(p) {
      const s = {
        rooms: [], indoor: 0, covered: 0, outdoor: 0,
        lot: p.lot.w * p.lot.h, ground: {}, groundTotal: 0,
        plants: {}, plantCount: 0, openings: {}, wallLen: { exterior: 0, interior: 0 }
      };
      // Room areas are usable floor inside the walls. "Built" adds the walls: centre-line area of
      // the indoor rooms plus the outer half of the exterior walls.
      let centre = 0, outerHalf = 0;
      for (const r of p.rooms) {
        const a = M.clearArea(p, r);
        s.rooms.push({ id: r.id, name: r.name, use: r.use, kind: r.kind, area: a, size: M.clearSize(p, r) });
        s[r.use] += a;
        if (r.use === 'indoor') centre += G.area(r.pts);
      }
      for (const w of p.walls) if (w.kind === 'exterior') outerHalf += (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) * w.t) / 2;
      s.indoorBuilt = s.indoor > 0 ? centre + outerHalf : 0;
      const order = { indoor: 0, covered: 1, outdoor: 2 };
      s.rooms.sort((a, b) => (a.use === b.use ? b.area - a.area : order[a.use] - order[b.use]));
      s.roofed = s.indoorBuilt + s.covered;
      for (const a of p.areas) {
        const v = G.area(a.pts);
        s.ground[a.material] = (s.ground[a.material] || 0) + v;
        s.groundTotal += v;
      }
      // Lot area not covered by the house or any drawn surface reads as lawn.
      s.openGround = Math.max(0, s.lot - s.roofed - s.outdoor - s.groundTotal);
      s.coverage = s.lot > 0 ? s.roofed / s.lot : 0;
      for (const pl of p.plants) { s.plants[pl.kind] = (s.plants[pl.kind] || 0) + 1; s.plantCount++; }
      for (const o of p.openings) s.openings[o.type] = (s.openings[o.type] || 0) + 1;
      for (const w of p.walls) s.wallLen[w.kind === 'exterior' ? 'exterior' : 'interior'] += Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const hb = M.houseBounds(p);
      s.house = hb;
      return s;
    }
  };
})();
