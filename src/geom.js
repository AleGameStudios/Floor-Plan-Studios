// Plane geometry in metres. Points are {x, y}; polygons are arrays of points.
window.FP = window.FP || {};

FP.geom = {
  EPS: 1e-6,

  len(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); },

  snap(v, step) { return step > 0 ? Math.round(v / step) * step : v; },

  round(v, d) { const k = Math.pow(10, d == null ? 3 : d); return Math.round(v * k) / k; },

  area(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  },

  centroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const f = p.x * q.y - q.x * p.y;
      a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
    }
    if (Math.abs(a) < 1e-9) {
      const b = FP.geom.bbox(pts);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
  },

  // A label anchor that stays inside L-shaped rooms: centroid if inside, else the
  // centre of the largest horizontal span through the polygon.
  labelPoint(pts) {
    const c = FP.geom.centroid(pts);
    if (FP.geom.pointInPoly(c, pts)) return c;
    const b = FP.geom.bbox(pts);
    let best = null;
    for (let k = 1; k < 10; k++) {
      const y = b.y + (b.h * k) / 10;
      const xs = [];
      for (let i = 0, n = pts.length; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
      xs.sort((u, v) => u - v);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const w = xs[i + 1] - xs[i];
        if (!best || w > best.w) best = { w, x: (xs[i] + xs[i + 1]) / 2, y };
      }
    }
    return best ? { x: best.x, y: best.y } : c;
  },

  bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },

  pointInPoly(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  },

  // Closest point on segment ab to p, with t in [0, 1] and distance d.
  project(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a.x + dx * t, y = a.y + dy * t;
    return { t, x, y, d: Math.hypot(p.x - x, p.y - y) };
  },

  isAxisRect(pts) {
    if (pts.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      if (Math.abs(a.x - b.x) > 1e-3 && Math.abs(a.y - b.y) > 1e-3) return false;
    }
    return true;
  },

  // Every edge horizontal or vertical (rectangles, L- and T-shapes).
  isOrtho(pts) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.abs(a.x - b.x) > 1e-3 && Math.abs(a.y - b.y) > 1e-3) return false;
    }
    return true;
  },

  // Drop repeated corners and corners in the middle of a straight edge.
  simplify(pts) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-6) continue;
      out.push(b);
    }
    return out.length >= 3 ? out : pts.slice();
  },

  rectPts(x, y, w, h) {
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  },

  rotate(p, deg) {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  },

  // Axis-aligned extents of a w×h box rotated by deg around its centre.
  rotatedExtents(w, h, deg) {
    const r = (deg * Math.PI) / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    return { w: w * c + h * s, h: w * s + h * c };
  },

  // Remove interval [a, b] from a sorted list of intervals.
  subtract(intervals, a, b) {
    const out = [];
    for (const [s, e] of intervals) {
      if (b <= s || a >= e) { out.push([s, e]); continue; }
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    }
    return out;
  }
};
