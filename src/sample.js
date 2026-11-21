// Starter project: the mirrored single-storey plan (gallery on the left) on a 30 × 40 m lot,
// with a carport, pool, walkways, planting and a first pass of furniture.
window.FP = window.FP || {};

FP.sample = function () {
  const M = FP.model, G = FP.geom;
  const p = M.newProject('My house');
  p.lot = { w: 30, h: 40 };
  const OX = 7, OY = 10; // house origin inside the lot
  const P = (x, y) => ({ x: x + OX, y: y + OY });
  const R = (x, y, w, h) => G.rectPts(x + OX, y + OY, w, h);

  const room = (name, kind, use, pts, floor) => {
    p.rooms.push({ id: M.uid('r'), name, kind, use, pts, floor: floor || FP.catalog.roomKinds[kind].floor });
  };
  room('Gallery', 'gallery', 'covered', [P(0, 0), P(4, 0), P(4, 8), P(3, 8), P(3, 12.5), P(0, 12.5)]);
  room('Kitchen', 'kitchen', 'indoor', R(4, 0, 4, 4));
  room('Dining', 'dining', 'indoor', R(4, 4, 4, 4));
  room('Living', 'living', 'indoor', R(3, 8, 5, 4.5));
  room('Main entry', 'porch', 'covered', R(3, 12.5, 5, 1.2));
  room('Circulation', 'circulation', 'indoor', R(8, 0, 1.5, 17.8));
  room('Bedroom 3', 'bedroom', 'indoor', R(9.5, 0, 3, 3));
  room('Bedroom 2', 'bedroom', 'indoor', R(9.5, 3, 3, 3));
  room('Bathroom', 'bath', 'indoor', R(9.5, 6, 3, 1.8));
  room('Office', 'office', 'indoor', R(9.5, 7.8, 3, 2));
  room('Ensuite', 'bath', 'indoor', R(9.5, 9.8, 2.5, 3));
  room('Walk-in closet', 'closet', 'indoor', R(12, 9.8, 2.5, 3));
  room('Master bedroom', 'bedroom', 'indoor', R(9.5, 12.8, 5, 5));
  room('Carport', 'garage', 'covered', R(14.5, 11.8, 3.5, 6));

  const wall = (x1, y1, x2, y2, kind) => {
    const w = { id: M.uid('w'), x1: x1 + OX, y1: y1 + OY, x2: x2 + OX, y2: y2 + OY, kind, t: kind === 'exterior' ? 0.2 : 0.12 };
    p.walls.push(w);
    return w;
  };
  const kitchenN = wall(4, 0, 8, 0, 'exterior');
  const galleryE = wall(4, 0, 4, 8, 'exterior');
  wall(4, 8, 3, 8, 'exterior');
  const livingW = wall(3, 8, 3, 12.5, 'exterior');
  const livingS = wall(3, 12.5, 8, 12.5, 'exterior');
  const hallW = wall(8, 0, 8, 12.5, 'interior');
  wall(8, 12.5, 8, 17.8, 'exterior');
  const wingN = wall(8, 0, 12.5, 0, 'exterior');
  const wingE = wall(12.5, 0, 12.5, 9.8, 'exterior');
  const closetN = wall(12.5, 9.8, 14.5, 9.8, 'exterior');
  wall(14.5, 9.8, 14.5, 17.8, 'exterior');
  const masterS = wall(8, 17.8, 14.5, 17.8, 'exterior');
  const hallE = wall(9.5, 0, 9.5, 17.8, 'interior');
  wall(9.5, 3, 12.5, 3, 'interior');
  wall(9.5, 6, 12.5, 6, 'interior');
  wall(9.5, 7.8, 12.5, 7.8, 'interior');
  wall(9.5, 9.8, 12.5, 9.8, 'interior');
  wall(12, 9.8, 12, 12.8, 'interior');
  const suiteS = wall(9.5, 12.8, 14.5, 12.8, 'interior');

  // side: the door leaf swings toward the wall normal (-uy, ux) times side.
  const op = (w, type, pos, width, side) => p.openings.push({ id: M.uid('o'), wall: w.id, type, pos, w: width, side: side || 1, hinge: 'start' });
  op(livingS, 'door', 4.1, 1.0, -1);
  op(galleryE, 'sliding', 6, 1.8);
  op(livingW, 'sliding', 2.25, 1.8);
  op(hallW, 'opening', 10.15, 4.7);
  op(wingN, 'door', 0.75, 0.9, 1);
  op(hallE, 'door', 2.4, 0.8, -1);
  op(hallE, 'door', 5.4, 0.8, -1);
  op(hallE, 'door', 6.9, 0.7, -1);
  op(hallE, 'door', 9.3, 0.8, -1);
  op(hallE, 'door', 13.6, 0.9, -1);
  op(suiteS, 'door', 1.9, 0.7, -1);
  op(suiteS, 'sliding', 3.75, 1.6);
  op(kitchenN, 'window', 2, 1.6);
  op(wingE, 'window', 1.5, 1.2);
  op(wingE, 'window', 4.5, 1.2);
  op(wingE, 'window', 6.9, 0.6);
  op(wingE, 'window', 8.8, 1.0);
  op(closetN, 'window', 1, 0.6);
  op(masterS, 'window', 4.0, 1.6);

  const area = (name, material, pts) => p.areas.push({ id: M.uid('a'), name, material, pts });
  const W = (x, y, w, h) => G.rectPts(x, y, w, h);
  area('Hedge', 'hedge', W(0.3, 1, 1, 36));
  area('Hedge', 'hedge', W(28.7, 1, 1, 26));
  area('Pool deck', 'deck', W(11.5, 2, 11, 6.2));
  area('Pool', 'water', W(13, 3, 8, 4));
  area('Driveway', 'concrete', W(21.5, 27.8, 3.5, 12.2));
  area('Front walkway', 'pavers', W(12.2, 23.7, 1.4, 16.3));
  area('Front bed', 'mulch', W(7.6, 24.4, 4, 1.6));
  area('Fence bed', 'mulch', W(1.5, 37.6, 10, 1.6));

  const plant = (kind, x, y, r) => p.plants.push({ id: M.uid('p'), kind, x, y, r: r || FP.catalog.plants[kind].r });
  plant('tree', 4.5, 4.5); plant('tree', 26, 5); plant('tree', 26, 15.5, 2.2); plant('tree', 4, 31);
  plant('palm', 4.6, 13); plant('palm', 4.6, 19.5);
  plant('fruit', 18, 34); plant('fruit', 7.5, 35);
  plant('conifer', 27.6, 24); plant('conifer', 27.6, 31);
  for (const x of [8.4, 9.4, 10.4, 11.3]) plant('shrub', x, 25.2, 0.45);
  for (const x of [2.5, 3.6, 4.7, 5.8, 6.9, 8.0, 9.1, 10.2]) plant('flowers', x, 38.4, 0.38);

  const item = (kind, x, y, rot, w, h, local) => {
    const d = FP.catalog.items[kind];
    p.items.push({ id: M.uid('i'), kind, x: x + (local ? OX : 0), y: y + (local ? OY : 0), w: w || d.w, h: h || d.h, rot: rot || 0 });
  };
  const L = (kind, x, y, rot, w, h) => item(kind, x, y, rot, w, h, true);
  L('bed-double', 13.4, 15.3, 90); L('nightstand', 14.15, 14.2, 90); L('nightstand', 14.15, 16.4, 90);
  L('dresser', 11.2, 17.45, 180);
  L('bed-single', 11.45, 1.0, 90); L('wardrobe', 11.3, 2.64, 180);
  L('bed-single', 11.45, 4.0, 90); L('wardrobe', 11.3, 5.64, 180);
  L('toilet', 12.05, 6.45, 90); L('basin', 12.15, 7.35, 90); L('shower', 11.0, 6.5);
  L('desk', 12.0, 8.8, 90); L('chair', 11.35, 8.8, 270);
  L('shower', 10.05, 10.35); L('toilet', 11.6, 10.3, 90); L('vanity-double', 9.85, 11.85, 270);
  L('wardrobe', 13.25, 10.2, 0, 2.3);
  L('counter', 6, 0.4, 0, 3.8); L('counter', 4.4, 1.7, 270, 2.0); L('sink-kitchen', 5.3, 0.4); L('stove', 7.0, 0.4);
  L('island', 6.4, 2.3); L('stools', 6.4, 3.0); L('fridge', 7.55, 3.4, 90);
  L('dining-6', 6, 6, 90);
  L('rug', 5.4, 10.4); L('sofa-l', 5.4, 9.1); L('coffee-table', 5.4, 10.6); L('tv-unit', 5.4, 12.2, 180);
  L('planter', 3.45, 13.1);
  item('car', 23.25, 24.8, 0);
  item('outdoor-table', 9, 12.6, 0); item('bbq', 9.2, 10.45, 0); item('outdoor-sofa', 7.6, 20.2, 90);
  item('lounger', 12.25, 5, 0); item('lounger', 21.75, 5, 0);
  // Laid out above on wall centre lines; grow the rooms so these sizes are clear inside the walls.
  return M.toClearSizes(p);
};
