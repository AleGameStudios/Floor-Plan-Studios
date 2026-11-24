// Claude Code integration: describe the exact plan to Claude, ask it to furnish rooms and
// landscape the plot, then validate the answer and merge it into the project.
// Claude decides placement only; the app draws the render from the real geometry.
window.FP = window.FP || {};

(function () {
  const C = FP.catalog, M = FP.model, G = FP.geom;
  const r2 = (v) => Math.round(v * 100) / 100;

  const SYSTEM = 'You are an experienced residential interior designer and landscape architect. ' +
    'You place furniture, fixtures, plants and ground surfaces into an exact metric floor plan so the app can draw it ' +
    'as an illustrated top-down render. Respect real-world sizes, clearances and the plan geometry exactly. ' +
    'Reply only with data that matches the JSON schema.';

  function keepClear(p, o) {
    const g = M.openingGeo(p, o);
    if (!g || o.type === 'window') return null;
    const v = g.v;
    const pts = [];
    if (o.type === 'door') {
      const k = (o.side || 1) * o.w;
      pts.push(g.s, g.e, { x: g.s.x + v.nx * k, y: g.s.y + v.ny * k }, { x: g.e.x + v.nx * k, y: g.e.y + v.ny * k });
    } else {
      for (const k of [-0.9, 0.9]) pts.push({ x: g.s.x + v.nx * k, y: g.s.y + v.ny * k }, { x: g.e.x + v.nx * k, y: g.e.y + v.ny * k });
    }
    const b = G.bbox(pts);
    return { reason: o.type === 'door' ? 'door swing' : o.type === 'sliding' ? 'sliding door passage' : 'open passage', x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) };
  }

  function buildRequest(p, o) {
    const scope = o.roomIds && o.roomIds.length ? new Set(o.roomIds) : null;
    const rooms = p.rooms.map((r) => {
      const b = G.bbox(r.pts);
      return {
        id: r.id, name: r.name, kind: r.kind, use: r.use, floor: r.floor,
        area_m2: r2(G.area(r.pts)), rectangular: G.isAxisRect(r.pts),
        bbox: { x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) },
        outline: r.pts.map((q) => [r2(q.x), r2(q.y)]),
        furnish: !!o.furnish && (!scope || scope.has(r.id))
      };
    });
    const walls = p.walls.map((w) => ({ from: [r2(w.x1), r2(w.y1)], to: [r2(w.x2), r2(w.y2)], thickness: w.t, kind: w.kind }));
    const openings = p.openings.map((op) => {
      const g = M.openingGeo(p, op);
      return g && { type: op.type, center: [r2(g.c.x), r2(g.c.y)], width: op.w, wall_direction: Math.abs(g.v.ux) > Math.abs(g.v.uy) ? 'horizontal' : 'vertical' };
    }).filter(Boolean);
    const clear = p.openings.map((op) => keepClear(p, op)).filter(Boolean);

    const keptItems = p.items.filter((it) => !(o.furnish && o.replaceItems && inScope(p, it, scope)));
    const keptPlants = o.landscape && o.replaceLandscape ? [] : p.plants;
    const keptAreas = o.landscape && o.replaceLandscape ? [] : p.areas;

    const catalog = Object.entries(C.items).filter(([, d]) => d.layer !== 'landscape').map(([k, d]) => k + ' — ' + d.label + ', ' + d.w + ' × ' + d.h + ' m');
    const plantKinds = Object.entries(C.plants).map(([k, d]) => k + ' — ' + d.label + ', typical canopy radius ' + d.r + ' m');

    const plan = {
      lot: { width: p.lot.w, depth: p.lot.h },
      rooms, walls, openings, keep_clear: clear,
      existing_items: keptItems.map((it) => ({ kind: it.kind, x: r2(it.x), y: r2(it.y), w: it.w, h: it.h, rot: it.rot })),
      existing_plants: keptPlants.map((pl) => ({ kind: pl.kind, x: r2(pl.x), y: r2(pl.y), r: pl.r })),
      existing_ground: keptAreas.map((a) => ({ material: a.material, name: a.name, pts: a.pts.map((q) => [r2(q.x), r2(q.y)]) }))
    };

    const tasks = [];
    if (o.furnish) tasks.push('Furnish every room with "furnish": true. Leave rooms with "furnish": false alone. Also pick a floor for each furnished room.');
    else tasks.push('Do not add furniture: return an empty items list and an empty floors list.');
    if (o.landscape) tasks.push('Landscape the whole plot outside the house: plants plus ground surfaces (walkways, driveway, patios, garden beds, hedges).');
    else tasks.push('Do not landscape: return empty plants and areas lists.');

    const prompt = [
      'TASK',
      ...tasks.map((t) => '- ' + t),
      o.wishes ? '- Owner\'s wishes: ' + o.wishes : '- No particular style requested: aim for a warm, modern, liveable home.',
      '',
      'COORDINATES',
      '- Metres. x grows to the right (east), y grows downward (south). The lot spans x 0..' + p.lot.w + ' and y 0..' + p.lot.h + '.',
      '- Walls are centre lines with a thickness. A room\'s usable floor is its outline shrunk by half the wall thickness.',
      '',
      'FURNITURE',
      '- x, y is the centre. w is the size along x and h the size along y before rotation. rot is 0, 90, 180 or 270, clockwise.',
      '- At rot 0 the back of an item (headboard, sofa back, toilet cistern, counter back, wardrobe back) is on its top edge and it faces +y (south).',
      '  Back against a north wall: rot 0. East wall: rot 90. South wall: rot 180. West wall: rot 270.',
      '- Each item must sit fully inside the usable floor of one room, with no overlap with other items or existing_items.',
      '  Exceptions: stove and sink-kitchen sit on top of a counter run; a rug may sit under a sofa, coffee table or bed.',
      '- Keep every keep_clear rectangle empty and leave 0.8 m walking paths between doors.',
      '- Use catalog sizes; you may scale w and h by up to 25% to fit. Set "room" to the room id ("" outdoors).',
      '- Kitchens: counters along walls with stove, sink and fridge; island only if 1 m clearance remains. Bathrooms: toilet, basin, shower or tub.',
      '- Covered rooms such as galleries, porches and carports get outdoor furniture; a carport or garage gets a car.',
      '',
      'LANDSCAPE',
      '- Plants: x, y is the trunk; r is the canopy radius. Keep trunks outside indoor and covered rooms and inside the lot.',
      '  Canopies may overhang paths, but keep tree trunks at least 1.5 m from house walls and off pools and walkways.',
      '- Ground areas are polygons (pts in drawing order, at least 3 points) with a material. Do not overlap the house or each other.',
      '  Undrawn ground is lawn, so never add lawn. Connect the front door and any carport to the lot edge if no path exists yet.',
      '',
      'CATALOG — item kinds',
      ...catalog.map((c) => '- ' + c),
      '',
      'CATALOG — plant kinds',
      ...plantKinds.map((c) => '- ' + c),
      '',
      'PLAN (JSON)',
      JSON.stringify(plan)
    ].join('\n');

    const num = { type: 'number' };
    const schema = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: Object.keys(C.items) }, room: { type: 'string' }, x: num, y: num, w: num, h: num, rot: num }, required: ['kind', 'room', 'x', 'y', 'w', 'h', 'rot'] } },
        floors: { type: 'array', items: { type: 'object', properties: { room: { type: 'string' }, floor: { type: 'string', enum: Object.keys(C.floors) } }, required: ['room', 'floor'] } },
        plants: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: Object.keys(C.plants) }, x: num, y: num, r: num }, required: ['kind', 'x', 'y', 'r'] } },
        areas: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, material: { type: 'string', enum: Object.keys(C.materials).filter((k) => k !== 'lawn') }, pts: { type: 'array', items: { type: 'array', items: num } } }, required: ['name', 'material', 'pts'] } },
        notes: { type: 'string' }
      },
      required: ['items', 'floors', 'plants', 'areas', 'notes']
    };
    return { system: SYSTEM, prompt, schema, timeoutSec: 900 };
  }

  function inScope(p, it, scope) {
    const room = p.rooms.find((r) => G.pointInPoly(it, r.pts));
    if (!scope) return true;
    return !!room && scope.has(room.id);
  }

  const fin = (v) => typeof v === 'number' && isFinite(v);

  // Merge Claude's answer into the project. Returns counts for the toast.
  function apply(p, data, o) {
    const scope = o.roomIds && o.roomIds.length ? new Set(o.roomIds) : null;
    const out = { items: 0, plants: 0, areas: 0, floors: 0, skipped: 0 };
    if (o.furnish && o.replaceItems) p.items = p.items.filter((it) => !inScope(p, it, scope));
    if (o.landscape && o.replaceLandscape) { p.plants = []; p.areas = []; }

    for (const it of data.items || []) {
      if (!C.items[it.kind] || ![it.x, it.y, it.w, it.h].every(fin)) { out.skipped++; continue; }
      const rot = (((Math.round((fin(it.rot) ? it.rot : 0) / 90) * 90) % 360) + 360) % 360;
      const w = Math.max(0.15, Math.min(8, it.w)), h = Math.max(0.15, Math.min(8, it.h));
      let x = it.x, y = it.y;
      const room = p.rooms.find((r) => r.id === it.room);
      if (room) {
        const b = G.bbox(room.pts), e = G.rotatedExtents(w, h, rot), m = 0.08;
        if (e.w < b.w - 2 * m) x = Math.max(b.x + m + e.w / 2, Math.min(b.x + b.w - m - e.w / 2, x));
        if (e.h < b.h - 2 * m) y = Math.max(b.y + m + e.h / 2, Math.min(b.y + b.h - m - e.h / 2, y));
      }
      p.items.push({ id: M.uid('i'), kind: it.kind, x: G.round(x), y: G.round(y), w: G.round(w), h: G.round(h), rot });
      out.items++;
    }
    for (const f of data.floors || []) {
      const room = p.rooms.find((r) => r.id === f.room);
      if (room && C.floors[f.floor]) { room.floor = f.floor; out.floors++; }
    }
    for (const pl of data.plants || []) {
      if (!C.plants[pl.kind] || ![pl.x, pl.y, pl.r].every(fin)) { out.skipped++; continue; }
      if (pl.x < 0 || pl.y < 0 || pl.x > p.lot.w || pl.y > p.lot.h) { out.skipped++; continue; }
      p.plants.push({ id: M.uid('p'), kind: pl.kind, x: G.round(pl.x), y: G.round(pl.y), r: G.round(Math.max(0.15, Math.min(8, pl.r)), 2) });
      out.plants++;
    }
    const ground = [];
    for (const a of data.areas || []) {
      if (!C.materials[a.material] || !Array.isArray(a.pts)) { out.skipped++; continue; }
      const pts = a.pts.filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]))
        .map((q) => ({ x: G.round(Math.max(0, Math.min(p.lot.w, q[0]))), y: G.round(Math.max(0, Math.min(p.lot.h, q[1]))) }));
      if (pts.length < 3 || G.area(pts) < 0.05) { out.skipped++; continue; }
      ground.push({ id: M.uid('a'), name: a.name || C.materials[a.material].label, material: a.material, pts });
      out.areas++;
    }
    // New ground goes under what the user already drew, in Claude's order.
    p.areas = ground.concat(p.areas);
    out.notes = data.notes || '';
    return out;
  }

  /* ---------- whole-design requests: "Describe it" and "Ask Claude to change…" ---------- */
  const LISTS = ['lot', 'walls', 'openings', 'rooms', 'areas', 'plants', 'fences', 'gates', 'items'];
  const HEX = /^#[0-9a-f]{6}$/i;

  const DESIGN_SYSTEM = 'You are an experienced residential architect, interior designer and landscape architect. ' +
    'You create and edit house-and-plot projects stored as exact metric JSON. The app draws plans and illustrated renders ' +
    'straight from your numbers, so geometry must be precise and consistent. Reply only with data matching the JSON schema.';

  const MODEL_RULES = [
    'DATA MODEL',
    '- Units are metres. x grows east (right), y grows south (down). The lot runs from (0, 0) to (lot.w, lot.h).',
    '- walls: centre lines from (x1, y1) to (x2, y2) with thickness t (exterior about 0.2, interior about 0.12) and kind exterior or interior.',
    '  Walls meet exactly at shared end points, or end on another wall (T-junction). Never overlap or duplicate walls.',
    '- openings sit on a wall by id. pos is the distance from that wall\'s (x1, y1) end to the opening centre; w is the width; it must fit inside the wall.',
    '  type: door, sliding, window, or opening (open passage without a leaf).',
    '  side 1 swings a door toward the wall\'s left normal: for a wall drawn toward +x that is south (+y), for a wall drawn toward +y that is west (-x). side -1 swings the other way.',
    '  hinge start or end puts the hinge on the jamb nearer (x1, y1) or (x2, y2).',
    '  h is the opening height and sill the height of its bottom edge above the floor (doors: sill 0, h 2.1; windows: sill about 0.9, h about 1.2). sill + h must stay below the wall height (lot.wall_height).',
    '- rooms: outline polygon [[x, y], ...] on wall centre lines, no repeated closing point.',
    '  Room sizes the owner gives, and sizes written on drawings, are CLEAR sizes between wall faces. A room\'s centre-line outline is its clear size plus half the thickness of each wall around it: a 3 × 3 m room inside 0.12 m walls is 3.12 × 3.12 m on centre lines; with one 0.2 m exterior wall on a side it is 3.16 m that way.',
    '  kind: ' + Object.keys(C.roomKinds).join(', ') + '. use: indoor (enclosed, counts as house area), covered (roof only: gallery, porch, carport), outdoor.',
    '  floor: ' + Object.keys(C.floors).join(', ') + '.',
    '- areas: ground surfaces of the plot outside the house, polygon pts plus material (' + Object.entries(C.materials).filter(([k]) => k !== 'lawn').map(([k, d]) => k + ' = ' + d.label).join(', ') + '). Use asphalt, crushed, dirt or cobble for roads and driveways, and flagstone, setts, brick, pebbles, granite or pavers for paths, as fits the style. Later areas draw on top. Undrawn ground is lawn, so never add lawn.',
    '  floor_color and wall_color: "#rrggbb" for that room\'s floor finish and wall paint, or "" for the defaults (floor type\'s standard colour, the house paint).',
    '- look: the house style and roof. style ' + Object.keys(C.styles).join(', ') + ' sets the exterior, roof, doors, windows, paint and floors in one go; "keep" leaves it.',
    '  roof (' + Object.keys(C.roofs).join(', ') + '), roofing (' + Object.keys(C.roofMaterials).join(', ') + '), wall_finish (' + Object.keys(C.wallFinishes).join(', ') + ') or "keep"; roof_color, exterior_color, paint (house wall paint) "#rrggbb" or "".',
    '- plants: trunk x, y and canopy radius r; kind ' + Object.keys(C.plants).join(', ') + '.',
    '- fences: straight runs from (x1, y1) to (x2, y2), outside the house; kind ' + Object.entries(C.fences).map(([k, d]) => k + ' (' + d.label + ', default height ' + d.h + ' m)').join(' or ') + '; h is the height in metres (0.3 to 3.6); color "#rrggbb" or "" for the default. Chain runs end to end to go round a corner. Put a gate on the run where one belongs instead of leaving a gap.',
    '- gates: sit on a fence run and cut it open. fence is the id of that run, pos the metres from the run start (x1, y1) to the centre of the gate, w its width, h its height, kind ' + Object.entries(C.gates).map(([k, d]) => k + ' (' + d.label + ', ' + d.w + ' m wide)').join(', ') + '; swing 1 or -1 is the side it opens to, hinge start or end, color "#rrggbb" or "" for the default. Use a driveway or double gate where a car enters.',
    '- items: furniture centre x, y; w along x and h along y before rotation; rot 0, 90, 180 or 270 clockwise. At rot 0 the back (headboard, sofa back, counter back) is on the north edge.',
    '  kinds and typical sizes: ' + Object.entries(C.items).map(([k, d]) => k + ' ' + d.w + '×' + d.h).join(', ') + '.',
    '  Outdoor site items (x, y is the centre, w and h are free, rot in degrees): ' + Object.entries(C.items).filter(([, d]) => d.layer === 'landscape').map(([k, d]) => k + ' (' + d.label + ', typically ' + d.w + '×' + d.h + ')').join(', ') + '. Put them on open ground outside the house, clear of walls, fences and each other; never inside a room. Size a soccer field or court to the space left on the plot.',
    '',
    'QUALITY',
    '- Exterior walls form a closed outline around all indoor rooms. Walls run along every room outline, except open-plan joins, which get no wall or an "opening".',
    '- Room outlines tile the house without overlaps. Every room is reachable: doors between rooms, a front door (1.0 m) on an exterior wall, windows on exterior walls of bedrooms and living spaces.',
    '- Realistic clear sizes: bedrooms at least 9 m² inside the walls, corridors at least 1.1 m wide between wall faces, interior doors 0.8 to 0.9 m.',
    '- Keep the house at least 3 m from every lot boundary unless told otherwise. Covered galleries and porches have no walls of their own.',
    '- Furniture stays fully inside its room, clear of door swings. Plants and surfaces stay outside the house and inside the lot.',
    '- ids: keep the id of everything you keep or modify. Give new things short new ids such as "w31" or "r9".'
  ].join('\n');

  function compact(p) {
    return {
      lot: { w: p.lot.w, h: p.lot.h, wall_height: p.settings.wallH },
      walls: p.walls.map((w) => ({ id: w.id, x1: r2(w.x1), y1: r2(w.y1), x2: r2(w.x2), y2: r2(w.y2), t: w.t, kind: w.kind })),
      openings: p.openings.map((o) => ({ id: o.id, wall: o.wall, pos: r2(o.pos), w: o.w, h: o.h, sill: o.sill, type: o.type, hinge: o.hinge || 'start', side: o.side || 1 })),
      rooms: p.rooms.map((r) => {
        const c = M.clearSize(p, r);
        return { id: r.id, name: r.name, kind: r.kind, use: r.use, floor: r.floor, floor_color: r.floorColor || '', wall_color: r.wallColor || '', pts: r.pts.map((q) => [r2(q.x), r2(q.y)]), clear_size: c ? [r2(c.w), r2(c.h)] : null, clear_area_m2: r2(M.clearArea(p, r)) };
      }),
      look: { style: p.settings.style.preset, roof: p.settings.roof.type, roofing: p.settings.roof.material, roof_color: p.settings.roof.color, wall_finish: p.settings.style.finish, exterior_color: p.settings.style.extColor, paint: p.settings.style.wall },
      areas: p.areas.map((a) => ({ id: a.id, name: a.name, material: a.material, pts: a.pts.map((q) => [r2(q.x), r2(q.y)]) })),
      plants: p.plants.map((pl) => ({ id: pl.id, kind: pl.kind, x: r2(pl.x), y: r2(pl.y), r: pl.r })),
      fences: p.fences.map((fe) => ({ id: fe.id, kind: fe.kind, x1: r2(fe.x1), y1: r2(fe.y1), x2: r2(fe.x2), y2: r2(fe.y2), h: fe.h, color: fe.color || '' })),
      gates: p.gates.map((g) => ({ id: g.id, fence: g.fence, pos: r2(g.pos), w: g.w, h: g.h, kind: g.kind, swing: g.swing || 1, hinge: g.hinge || 'start', color: g.color || '' })),
      items: p.items.map((it) => ({ id: it.id, kind: it.kind, x: r2(it.x), y: r2(it.y), w: it.w, h: it.h, rot: it.rot || 0 }))
    };
  }

  function designSchema() {
    const n = { type: 'number' }, s = { type: 'string' };
    const poly = { type: 'array', items: { type: 'array', items: n } };
    const obj = (props, req) => ({ type: 'object', properties: props, required: req || Object.keys(props) });
    const en = (list) => ({ type: 'string', enum: list });
    return obj({
      summary: s,
      unchanged: { type: 'array', items: en(LISTS) },
      lot: obj({ w: n, h: n }),
      walls: { type: 'array', items: obj({ id: s, x1: n, y1: n, x2: n, y2: n, t: n, kind: en(['exterior', 'interior']) }) },
      openings: { type: 'array', items: obj({ id: s, wall: s, pos: n, w: n, h: n, sill: n, type: en(Object.keys(C.openings)), hinge: en(['start', 'end']), side: n }) },
      rooms: { type: 'array', items: obj({ id: s, name: s, kind: en(Object.keys(C.roomKinds)), use: en(Object.keys(C.uses)), floor: en(Object.keys(C.floors)), floor_color: s, wall_color: s, pts: poly }) },
      look: obj({ style: en(['keep'].concat(Object.keys(C.styles))), roof: en(['keep'].concat(Object.keys(C.roofs))), roofing: en(['keep'].concat(Object.keys(C.roofMaterials))), wall_finish: en(['keep'].concat(Object.keys(C.wallFinishes))), roof_color: s, exterior_color: s, paint: s }),
      areas: { type: 'array', items: obj({ id: s, name: s, material: en(Object.keys(C.materials).filter((k) => k !== 'lawn')), pts: poly }) },
      plants: { type: 'array', items: obj({ id: s, kind: en(Object.keys(C.plants)), x: n, y: n, r: n }) },
      fences: { type: 'array', items: obj({ id: s, kind: en(Object.keys(C.fences)), x1: n, y1: n, x2: n, y2: n, h: n, color: s }) },
      gates: { type: 'array', items: obj({ id: s, fence: s, pos: n, w: n, h: n, kind: en(Object.keys(C.gates)), swing: n, hinge: en(['start', 'end']), color: s }) },
      items: { type: 'array', items: obj({ id: s, kind: en(Object.keys(C.items)), x: n, y: n, w: n, h: n, rot: n }) }
    });
  }

  // o: { fresh, instruction, furnish, landscape }
  function buildDesignRequest(p, o) {
    const task = o.fresh
      ? [
        'TASK: design a new project from the owner\'s description below, on a lot of ' + p.lot.w + ' × ' + p.lot.h + ' m (change the lot only if the description gives other dimensions).',
        '- Return every list in full and leave "unchanged" empty.',
        o.furnish ? '- Furnish every room.' : '- Do not add furniture: items is an empty list.',
        o.landscape ? '- Landscape the plot: paths to the front door and any carport, garden beds, trees and plants.' : '- Do not landscape: areas and plants are empty lists.'
      ]
      : [
        'TASK: change the current project as the owner asks below. Change only what the request needs; keep everything else exactly as it is, with the same ids and numbers.',
        '- Return each list you change in full (including its untouched entries). Put the names of lists you did not touch in "unchanged" and return those as empty lists.',
        '- If walls move, keep room outlines, openings, and furniture consistent with them.'
      ];
    const prompt = [
      ...task,
      '- "summary": one or two plain sentences telling the owner what you changed or designed.',
      '',
      'OWNER\'S ' + (o.fresh ? 'DESCRIPTION' : 'REQUEST') + ':',
      o.instruction,
      '',
      MODEL_RULES,
      '',
      o.fresh ? 'CURRENT LOT (empty): ' + JSON.stringify({ lot: { w: p.lot.w, h: p.lot.h } }) : 'CURRENT PROJECT (JSON):\n' + JSON.stringify(compact(p))
    ].join('\n');
    return { system: DESIGN_SYSTEM, prompt, schema: designSchema(), timeoutSec: 900 };
  }

  // "From a floor-plan image": same as a fresh design, with the image attached by the caller (req.images).
  function buildImageRequest(p, o) {
    const instruction = [
      'Recreate the floor plan in the attached image as a project, to scale.',
      '- Written dimensions win over how the drawing looks. Where labels and drawing disagree, follow the labels and keep the order and adjacency of the rooms.',
      '- Keep room names exactly as written in the image.',
      '- Reproduce the walls, doors (with their swing side), windows, galleries, porches, carports and garden features shown.',
      '- If the image shows the plot boundary, match it; otherwise place the house sensibly on the lot.',
      o.notes ? '- Then apply these changes from the owner: ' + o.notes : ''
    ].filter(Boolean).join('\n');
    return buildDesignRequest(p, { fresh: true, instruction, furnish: o.furnish, landscape: o.landscape });
  }

  // Turn Claude's answer into a full, validated project. Lists named in "unchanged" keep the current data.
  function proposal(cur, data) {
    const next = JSON.parse(JSON.stringify(cur));
    const keep = new Set(data.unchanged || []);
    const ids = new Set();
    const idOf = (v, prefix) => {
      let id = typeof v === 'string' && v ? v : M.uid(prefix);
      if (ids.has(id)) id = M.uid(prefix);
      ids.add(id);
      return id;
    };
    const pts = (list) => (Array.isArray(list) ? list : [])
      .filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]))
      .map((q) => ({ x: G.round(q[0]), y: G.round(q[1]) }));
    const take = (name) => !keep.has(name) && Array.isArray(data[name]);

    if (!keep.has('lot') && data.lot && fin(data.lot.w) && fin(data.lot.h) && data.lot.w >= 5 && data.lot.h >= 5) {
      next.lot = { w: G.round(Math.min(500, data.lot.w)), h: G.round(Math.min(500, data.lot.h)) };
    }
    if (take('walls')) {
      next.walls = data.walls.filter((w) => [w.x1, w.y1, w.x2, w.y2].every(fin) && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 0.05)
        .map((w) => ({ id: idOf(w.id, 'w'), x1: G.round(w.x1), y1: G.round(w.y1), x2: G.round(w.x2), y2: G.round(w.y2), t: fin(w.t) ? Math.max(0.05, Math.min(0.6, w.t)) : 0.15, kind: w.kind === 'exterior' ? 'exterior' : 'interior' }));
    }
    if (take('openings')) {
      next.openings = data.openings.filter((o) => C.openings[o.type] && fin(o.pos) && fin(o.w))
        .map((o) => {
          const d = C.openings[o.type];
          return {
            id: idOf(o.id, 'o'), wall: o.wall, pos: G.round(o.pos), w: G.round(Math.max(0.3, o.w)),
            h: fin(o.h) && o.h > 0.2 ? G.round(o.h) : d.h, sill: fin(o.sill) && o.sill >= 0 ? G.round(o.sill) : d.sill,
            type: o.type, hinge: o.hinge === 'end' ? 'end' : 'start', side: o.side < 0 ? -1 : 1
          };
        });
    }
    const wallIds = new Set(next.walls.map((w) => w.id));
    next.openings = next.openings.filter((o) => wallIds.has(o.wall));
    for (const o of next.openings) M.clampOpening(next, o);
    if (take('rooms')) {
      next.rooms = data.rooms.map((r) => {
        const room = {
          id: idOf(r.id, 'r'), name: r.name || 'Room', kind: C.roomKinds[r.kind] ? r.kind : 'other',
          use: C.uses[r.use] ? r.use : 'indoor', floor: C.floors[r.floor] ? r.floor : 'tile', pts: pts(r.pts)
        };
        // Colours the user picked survive Claude's edits (the floor colour only while the floor type stays).
        const old = cur.rooms.find((q) => q.id === room.id);
        if (old && old.wallColor) room.wallColor = old.wallColor;
        if (old && old.floorColor && old.floor === room.floor) room.floorColor = old.floorColor;
        if (HEX.test(r.wall_color)) room.wallColor = r.wall_color.toLowerCase(); else if (r.wall_color === '') room.wallColor = null;
        if (HEX.test(r.floor_color)) room.floorColor = r.floor_color.toLowerCase(); else if (r.floor_color === '') room.floorColor = null;
        return room;
      }).filter((r) => r.pts.length >= 3 && G.area(r.pts) > 0.1);
    }
    // House style first (it may set floors), then single overrides.
    const look = data.look || {};
    if (C.styles[look.style] && look.style !== cur.settings.style.preset) {
      M.applyStyle(next, look.style, take('rooms'));
      // the style clears room paint; keep any colour Claude chose for a room
      if (take('rooms')) for (const r of data.rooms) { const room = next.rooms.find((q) => q.id === r.id); if (room && HEX.test(r.wall_color)) room.wallColor = r.wall_color.toLowerCase(); }
    }
    if (C.roofs[look.roof]) next.settings.roof.type = look.roof;
    if (C.roofMaterials[look.roofing]) next.settings.roof.material = look.roofing;
    if (C.wallFinishes[look.wall_finish]) next.settings.style.finish = look.wall_finish;
    if (HEX.test(look.roof_color)) next.settings.roof.color = look.roof_color.toLowerCase();
    if (HEX.test(look.exterior_color)) next.settings.style.extColor = look.exterior_color.toLowerCase();
    if (HEX.test(look.paint)) next.settings.style.wall = look.paint.toLowerCase();
    if (take('areas')) {
      next.areas = data.areas.filter((a) => C.materials[a.material])
        .map((a) => ({ id: idOf(a.id, 'a'), name: a.name || C.materials[a.material].label, material: a.material, pts: pts(a.pts) }))
        .filter((a) => a.pts.length >= 3 && G.area(a.pts) > 0.05);
    }
    if (take('plants')) {
      next.plants = data.plants.filter((pl) => C.plants[pl.kind] && [pl.x, pl.y, pl.r].every(fin))
        .map((pl) => ({ id: idOf(pl.id, 'p'), kind: pl.kind, x: G.round(pl.x), y: G.round(pl.y), r: G.round(Math.max(0.15, Math.min(8, pl.r)), 2) }));
    }
    if (take('fences')) {
      next.fences = (data.fences || []).filter((fe) => C.fences[fe.kind] && [fe.x1, fe.y1, fe.x2, fe.y2].every(fin) && Math.hypot(fe.x2 - fe.x1, fe.y2 - fe.y1) > 0.05)
        .map((fe) => {
          const o = { id: idOf(fe.id, 'f'), kind: fe.kind, x1: G.round(fe.x1), y1: G.round(fe.y1), x2: G.round(fe.x2), y2: G.round(fe.y2), h: G.round(Math.max(0.3, Math.min(3.6, fin(fe.h) && fe.h > 0 ? fe.h : C.fences[fe.kind].h)), 2) };
          if (HEX.test(fe.color)) o.color = fe.color.toLowerCase();
          return o;
        });
    }
    if (take('gates')) {
      next.gates = (data.gates || []).filter((g) => C.gates[g.kind] && typeof g.fence === 'string' && [g.pos, g.w].every(fin))
        .map((g) => {
          const d = C.gates[g.kind], o = {
            id: idOf(g.id, 'g'), fence: g.fence, pos: G.round(g.pos), w: G.round(Math.max(0.4, Math.min(8, g.w))),
            h: G.round(Math.max(0.4, Math.min(3.6, fin(g.h) && g.h > 0 ? g.h : d.h)), 2), kind: g.kind, swing: g.swing < 0 ? -1 : 1, hinge: g.hinge === 'end' ? 'end' : 'start'
          };
          if (HEX.test(g.color)) o.color = g.color.toLowerCase();
          return o;
        });
    }
    {
      // a gate needs its fence run: drop any whose run is gone, and keep the rest on it
      const ids = new Set((next.fences || []).map((fe) => fe.id));
      next.gates = (next.gates || []).filter((g) => ids.has(g.fence));
      for (const g of next.gates) M.clampGate(next, g);
    }
    if (take('items')) {
      next.items = data.items.filter((it) => C.items[it.kind] && [it.x, it.y, it.w, it.h].every(fin))
        .map((it) => ({ id: idOf(it.id, 'i'), kind: it.kind, x: G.round(it.x), y: G.round(it.y), w: G.round(Math.max(0.15, Math.min(8, it.w))), h: G.round(Math.max(0.15, Math.min(8, it.h))), rot: (((Math.round((fin(it.rot) ? it.rot : 0) / 90) * 90) % 360) + 360) % 360 }));
    }
    return M.normalize(next);
  }

  // Key-order-independent JSON, so re-serialised entities compare equal.
  // Numbers compare at 1 cm, so Claude re-rounding an untouched coordinate does not count as a change.
  function canon(v) {
    if (typeof v === 'number' && isFinite(v)) return String(Math.round(v * 100) / 100);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }

  // What changed between two projects, by id.
  function diff(a, b) {
    const out = { lists: {}, changedIds: new Set(), total: 0 };
    for (const key of ['walls', 'openings', 'rooms', 'areas', 'plants', 'fences', 'gates', 'items']) {
      const before = new Map((a[key] || []).map((e) => [e.id, canon(e)]));
      const after = new Map((b[key] || []).map((e) => [e.id, canon(e)]));
      const d = { added: 0, removed: 0, changed: 0 };
      for (const [id, v] of after) {
        if (!before.has(id)) { d.added++; out.changedIds.add(id); } else if (before.get(id) !== v) { d.changed++; out.changedIds.add(id); }
      }
      for (const id of before.keys()) if (!after.has(id)) d.removed++;
      out.lists[key] = d;
      out.total += d.added + d.removed + d.changed;
    }
    if (a.lot.w !== b.lot.w || a.lot.h !== b.lot.h) { out.lot = true; out.total++; }
    if (canon(a.settings.style) !== canon(b.settings.style) || canon(a.settings.roof) !== canon(b.settings.roof)) { out.look = true; out.total++; }
    const sa = M.stats(a), sb = M.stats(b);
    out.indoor = [sa.indoor, sb.indoor];
    out.covered = [sa.covered, sb.covered];
    return out;
  }

  // Furnish/landscape answers become a proposal too: applied to a copy, never to the live project.
  function furnishProposal(cur, data, o) {
    const next = JSON.parse(JSON.stringify(cur));
    const counts = apply(next, data, o);
    return { project: M.normalize(next), counts };
  }

  /* ---------- import a house: where should it go? ---------- */
  function placeSchema() {
    return { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'integer', enum: [0, 90, 180, 270] }, note: { type: 'string' } }, required: ['x', 'y', 'rotation', 'note'] };
  }
  // target: the plot being landscaped; src: the house design to bring in; o: { instruction }
  function buildPlaceRequest(target, src, o) {
    const fp = M.houseFootprint(src), here = M.houseFootprint(target);
    const sides = M.SIDES;
    const turns = {};
    for (const r of [0, 90, 180, 270]) turns[r] = Object.assign({ footprint_w: r2(M.turnedSize(fp, r).w), footprint_h: r2(M.turnedSize(fp, r).h) }, Object.fromEntries(sides.map((s) => [s + '_side_of_house_ends_up_facing', M.turnSide(s, r)])));
    const rooms = src.rooms.map((r) => { const b = G.bbox(r.pts); return { name: r.name, kind: r.kind, use: r.use, side_of_house: M.sideOf(fp, { x: b.x + b.w / 2, y: b.y + b.h / 2 }) }; });
    const data = {
      plot: { w: target.lot.w, h: target.lot.h },
      house_to_place: {
        name: src.name, footprint_w: r2(fp.w), footprint_h: r2(fp.h),
        exterior_door_sides: M.doorSides(src, fp), rooms,
        facing_after_each_rotation: turns
      },
      already_on_plot: {
        existing_building_footprint: here ? { x: r2(here.x), y: r2(here.y), w: r2(here.w), h: r2(here.h) } : null,
        surfaces: target.areas.map((a) => { const b = G.bbox(a.pts); return { name: a.name, material: a.material, x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) }; }),
        plants: target.plants.map((pl) => ({ kind: pl.kind, x: r2(pl.x), y: r2(pl.y), r: pl.r })),
        fences: target.fences.map((fe) => ({ kind: fe.kind, x1: r2(fe.x1), y1: r2(fe.y1), x2: r2(fe.x2), y2: r2(fe.y2) }))
      }
    };
    const prompt = [
      'TASK: decide where a finished house goes on a plot that is being landscaped, and which way it faces.',
      '',
      'COORDINATES: metres. x grows east (right), y grows south (down). North is up, the plot runs from (0, 0) to (plot.w, plot.h).',
      'ROTATION turns the whole house clockwise by 0, 90, 180 or 270 degrees. "facing_after_each_rotation" lists the footprint size and where each side of the house ends up for every rotation.',
      'RETURN x, y = the top-left corner of the house footprint AFTER rotation (its outer wall faces), and the rotation.',
      '',
      'RULES',
      '- The whole footprint stays inside the plot: 0 <= x, x + footprint_w <= plot.w, 0 <= y, y + footprint_h <= plot.h, using the footprint size for the rotation you choose.',
      '- Do not overlap the existing building, ground surfaces such as pools, decks or paths, or fences. Plants standing where the house lands are removed, so prefer clear ground, but never aim at a tree on purpose.',
      '- Unless the owner says otherwise, keep at least 3 m between the house and the plot edges.',
      '- The owner says which side the street is on. If they do not, infer it from a driveway or path that reaches a plot edge; if that is unclear too, assume the street is the south edge.',
      '- By default the main entrance (the first exterior_door_sides entry) faces the street.',
      '- Round x and y to 0.05. "note": one short sentence in plain language saying where the house goes and which way its entrance and main rooms face.',
      '',
      'DATA (JSON):',
      JSON.stringify(data),
      '',
      "OWNER'S INSTRUCTION:",
      o.instruction
    ].join('\n');
    return { system: 'You are an experienced architect and site planner. Reply only with data matching the JSON schema.', prompt, schema: placeSchema(), timeoutSec: 180 };
  }
  // Check Claude's answer and keep the house on the plot.
  function placement(target, src, data) {
    const fp = M.houseFootprint(src), fin = (v) => typeof v === 'number' && isFinite(v);
    let rot = [0, 90, 180, 270].includes(data.rotation) ? data.rotation : 0;
    let s = M.turnedSize(fp, rot);
    if ((s.w > target.lot.w || s.h > target.lot.h) && !(M.turnedSize(fp, rot + 90).w > target.lot.w || M.turnedSize(fp, rot + 90).h > target.lot.h)) { rot = (rot + 90) % 360; s = M.turnedSize(fp, rot); }
    const clamp = (v, hi) => G.round(Math.max(0, Math.min(Math.max(0, hi), fin(v) ? v : 0)), 2);
    return { x: clamp(data.x, target.lot.w - s.w), y: clamp(data.y, target.lot.h - s.h), rot, note: String(data.note || '') };
  }

  /* ---------- chat: talk to Claude about the design, and let it edit the design when asked ---------- */
  const CHAT_SYSTEM = 'You are Claude, the design assistant built into Floorplan Studio, a desktop app for designing a house and the plot it stands on. ' +
    'You chat with the owner: you answer questions about their design, architecture, building, furnishing and landscaping in plain, friendly language, ' +
    'and when they ask for a change you edit the design. The app draws plans and renders straight from your numbers, so edits must be precise. ' +
    'Reply only with data matching the JSON schema.';

  function chatSchema() {
    return { type: 'object', properties: { reply: { type: 'string' }, design: designSchema() }, required: ['reply'] };
  }

  // o: { message, history: [{ role: 'user' | 'assistant', text }], selection: { kind, name, id } | null }
  function buildChatRequest(p, o) {
    const st = M.stats(p);
    const history = (o.history || []).slice(-12).map((m) => (m.role === 'user' ? 'OWNER: ' : 'YOU: ') + String(m.text || '').slice(0, 1500));
    const sel = o.selection ? 'The owner currently has this selected in the app: ' + o.selection.kind + (o.selection.name ? ' "' + o.selection.name + '"' : '') + ' (id ' + o.selection.id + '). "This", "it" or "here" most likely means that.' : 'Nothing is selected in the app.';
    const prompt = [
      'HOW TO ANSWER',
      '- "reply": your message to the owner. Plain text, friendly and short (usually 1 to 5 sentences; a short list is fine). No markdown headings, no code, never mention JSON, ids or the schema: call things by their room names.',
      '- Questions, opinions, advice, measurements: answer from the real numbers in the project below and leave "design" out entirely.',
      '- Change requests ("make", "move", "add", "widen", "change", "remove", "furnish", "yes, do it"): include "design" with the edit, and say in "reply" what you changed. Do the sensible thing instead of asking when the request is clear enough.',
      '- If a request is ambiguous, risky or could go several ways, ask one short question in "reply" and leave "design" out.',
      '- If a change would break something (a room too small, no door, outside the lot), say so, and either do the closest sound version or ask.',
      '- Never say you changed something unless "design" contains that change. Everything you change is shown to the owner and can be undone.',
      '- Inside "design": change only what the request needs and keep everything else exactly as it is, with the same ids and numbers. Return each list you change in full (including its untouched entries); name the lists you did not touch in "unchanged" and return those as empty lists. "summary" is one plain sentence about the change. If walls move, keep room outlines, openings and furniture consistent with them.',
      '',
      sel,
      '',
      'AREAS (clear floor inside the walls): indoor ' + r2(st.indoor) + ' m², covered ' + r2(st.covered) + ' m², outdoor rooms ' + r2(st.outdoor) + ' m²; lot ' + r2(st.lot) + ' m².',
      '',
      history.length ? 'CONVERSATION SO FAR:\n' + history.join('\n') : 'This is the start of the conversation.',
      '',
      'OWNER\'S NEW MESSAGE:',
      o.message,
      '',
      MODEL_RULES,
      '',
      'CURRENT PROJECT (JSON):\n' + JSON.stringify(compact(p))
    ].join('\n');
    return { system: CHAT_SYSTEM, prompt, schema: chatSchema(), timeoutSec: 900 };
  }

  FP.claude = { buildPlaceRequest, placement, buildRequest, buildChatRequest, apply, buildDesignRequest, buildImageRequest, proposal, diff, furnishProposal };
})();
