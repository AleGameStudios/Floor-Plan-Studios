// Everything the user can place: room kinds, floor and ground materials, plants, furniture.
// Sizes are real-world metres. Furniture at rot 0 has its back (headboard, sofa back,
// toilet tank, counter back) on its top edge and faces +y (down the screen).
window.FP = window.FP || {};

FP.catalog = {
  uses: {
    indoor: { label: 'Indoor', hint: 'Counts toward house m²' },
    covered: { label: 'Covered', hint: 'Roof only, open sides (gallery, carport, porch)' },
    outdoor: { label: 'Outdoor', hint: 'No roof (patio, terrace)' }
  },

  roomKinds: {
    living: { label: 'Living', floor: 'wood', tint: '#efe3cf' },
    dining: { label: 'Dining', floor: 'wood', tint: '#efe3cf' },
    kitchen: { label: 'Kitchen', floor: 'tile', tint: '#ece6da' },
    bedroom: { label: 'Bedroom', floor: 'wood', tint: '#e6e2ef' },
    bath: { label: 'Bathroom', floor: 'stone', tint: '#dcebf0' },
    office: { label: 'Office', floor: 'wood', tint: '#e9e6dc' },
    closet: { label: 'Walk-in closet', floor: 'wood', tint: '#ece4d6' },
    laundry: { label: 'Laundry', floor: 'tile', tint: '#e2e8e6' },
    circulation: { label: 'Circulation', floor: 'wood', tint: '#f0ebe1' },
    storage: { label: 'Storage', floor: 'concrete', tint: '#e5e2dc' },
    garage: { label: 'Garage', floor: 'concrete', tint: '#e2e2df' },
    gallery: { label: 'Gallery', floor: 'pavers', tint: '#e8dccb' },
    porch: { label: 'Porch', floor: 'pavers', tint: '#e8dccb' },
    other: { label: 'Room', floor: 'tile', tint: '#ebe7df' }
  },

  // color is the default finish; rooms can override it (room.floorColor). wood: true picks the wood palette.
  floors: {
    wood: { label: 'Wood planks', color: '#c9a273', wood: true },
    chevron: { label: 'Chevron parquet', color: '#c39a6b', wood: true },
    wideplank: { label: 'Wide planks', color: '#b8916a', wood: true },
    tile: { label: 'Ceramic tile', color: '#ece6db' },
    porcelain: { label: 'Large porcelain', color: '#dedad3' },
    marble: { label: 'Marble', color: '#efede8' },
    terrazzo: { label: 'Terrazzo', color: '#e6e1d8' },
    stone: { label: 'Stone tile', color: '#e4e0d9' },
    slate: { label: 'Slate', color: '#5d6166' },
    carpet: { label: 'Carpet', color: '#d9d0c1' },
    concrete: { label: 'Polished concrete', color: '#c9c7c1' },
    pavers: { label: 'Terracotta pavers', color: '#c98a5f' },
    deck: { label: 'Timber deck', color: '#b68858', wood: true }
  },

  // Colour swatches offered in the inspector (any colour can also be typed in).
  palettes: {
    wood: [['#dcc3a0', 'Light ash'], ['#c9a273', 'Natural oak'], ['#c08a52', 'Honey'], ['#a9a39a', 'Grey wash'], ['#6e4b33', 'Walnut'], ['#3a3029', 'Ebony']],
    floor: [['#f1efea', 'White'], ['#e4d9c7', 'Warm beige'], ['#cfc8bd', 'Greige'], ['#c9cacb', 'Light grey'], ['#8d8f91', 'Mid grey'], ['#55585c', 'Charcoal'], ['#c98a5f', 'Terracotta'], ['#a9b5a0', 'Sage']],
    wall: [['#f7f6f2', 'White'], ['#f3eee4', 'Warm white'], ['#e6dfd2', 'Linen'], ['#d9d2c6', 'Greige'], ['#d5d7d8', 'Soft grey'], ['#c4cdb8', 'Sage'], ['#c9d9e3', 'Sky'], ['#e8d3cc', 'Blush'], ['#d9b99b', 'Sand'], ['#c98b6b', 'Terracotta'], ['#4b5d4f', 'Forest'], ['#2f3d55', 'Navy'], ['#3d3f42', 'Charcoal']],
    exterior: [['#f4f2ee', 'White'], ['#efe6d4', 'Cream'], ['#d9c7a7', 'Sand'], ['#cfd1d2', 'Light grey'], ['#9fae98', 'Sage'], ['#a4553d', 'Red brick'], ['#7a5a43', 'Brown'], ['#3a3c3f', 'Charcoal'], ['#232426', 'Black']],
    roof: [['#b5633f', 'Terracotta'], ['#8f3b2c', 'Red'], ['#5e4636', 'Brown'], ['#4f6650', 'Green'], ['#5f666e', 'Slate grey'], ['#3d4146', 'Charcoal'], ['#24262a', 'Black'], ['#b9bcbd', 'Light grey']],
    trim: [['#f8f7f4', 'White'], ['#d9d4ca', 'Stone'], ['#7c8287', 'Grey'], ['#4a3c31', 'Bronze'], ['#a77d55', 'Oak'], ['#232426', 'Black']]
  },

  wallFinishes: {
    render: { label: 'Smooth render' },
    stucco: { label: 'Textured stucco' },
    brick: { label: 'Brick' },
    stone: { label: 'Natural stone' },
    siding: { label: 'Wood siding' },
    batten: { label: 'Board and batten' },
    concrete: { label: 'Exposed concrete' }
  },

  roofMaterials: {
    clay: { label: 'Clay tile' },
    tile: { label: 'Concrete tile' },
    slate: { label: 'Slate' },
    shingle: { label: 'Shingle' },
    metal: { label: 'Standing-seam metal' },
    membrane: { label: 'Flat membrane' }
  },

  doorStyles: { flush: { label: 'Flush' }, panel: { label: 'Panelled' }, glass: { label: 'Glazed' }, plank: { label: 'Timber plank' } },
  windowGrids: { none: { label: 'Clear glass' }, cross: { label: 'Cross bars' }, colonial: { label: 'Colonial grid' } },
  columns: { square: { label: 'Square' }, round: { label: 'Round' }, timber: { label: 'Timber posts' } },

  // House styles: one click sets the exterior, roof, windows, doors and interior finishes.
  // floor / wetFloor go to living spaces and to kitchens, baths and laundries.
  styles: {
    modern: {
      label: 'Modern', blurb: 'White render, flat roof with parapet, black frames',
      roof: { type: 'parapet', material: 'membrane', color: '#cfcac2', pitch: 5, overhang: 0.3 },
      finish: 'render', extColor: '#f4f2ee', trim: '#232426', window: 'none', door: 'flush', doorColor: '#2d2f33',
      intDoor: 'flush', intDoorColor: '#f3f1ec', wall: '#f7f6f2', ceiling: '#fbfaf8', cornice: false, columns: 'square',
      floor: ['porcelain', '#dedad3'], wetFloor: ['porcelain', '#cfc8bd']
    },
    mediterranean: {
      label: 'Mediterranean', blurb: 'Lime stucco, clay hip roof, terracotta floors',
      roof: { type: 'hip', material: 'clay', color: '#b5633f', pitch: 22, overhang: 0.5 },
      finish: 'stucco', extColor: '#f3ece0', trim: '#4a3c31', window: 'none', door: 'plank', doorColor: '#6b4a33',
      intDoor: 'panel', intDoorColor: '#8a6448', wall: '#f6f1e7', ceiling: '#fbf8f2', cornice: false, columns: 'round',
      floor: ['pavers', '#c98a5f'], wetFloor: ['tile', '#e9e1d2']
    },
    farmhouse: {
      label: 'Modern farmhouse', blurb: 'Board and batten, black metal gable, oak floors',
      roof: { type: 'gable', material: 'metal', color: '#2f3337', pitch: 35, overhang: 0.45 },
      finish: 'batten', extColor: '#f4f3ef', trim: '#232426', window: 'cross', door: 'glass', doorColor: '#232426',
      intDoor: 'panel', intDoorColor: '#f3f1ec', wall: '#f3eee4', ceiling: '#fbfaf8', cornice: false, columns: 'timber',
      floor: ['wideplank', '#c08a52'], wetFloor: ['tile', '#ece6db']
    },
    scandinavian: {
      label: 'Scandinavian', blurb: 'Black timber cladding, steep gable, pale ash',
      roof: { type: 'gable', material: 'metal', color: '#24262a', pitch: 40, overhang: 0.25 },
      finish: 'siding', extColor: '#2d2e30', trim: '#a77d55', window: 'none', door: 'flush', doorColor: '#a77d55',
      intDoor: 'flush', intDoorColor: '#f3f1ec', wall: '#f7f6f2', ceiling: '#ffffff', cornice: false, columns: 'timber',
      floor: ['wideplank', '#dcc3a0'], wetFloor: ['porcelain', '#d5d7d8']
    },
    tropical: {
      label: 'Tropical modern', blurb: 'Deep eaves, dark tile hip roof, timber accents',
      roof: { type: 'hip', material: 'tile', color: '#3d4146', pitch: 20, overhang: 1.0 },
      finish: 'render', extColor: '#efe6d4', trim: '#4a3c31', window: 'none', door: 'plank', doorColor: '#8a6448',
      intDoor: 'flush', intDoorColor: '#b38b62', wall: '#f3eee4', ceiling: '#fbf8f2', cornice: false, columns: 'timber',
      floor: ['porcelain', '#e4d9c7'], wetFloor: ['stone', '#e4e0d9']
    },
    classic: {
      label: 'Classic', blurb: 'Red brick, slate hip roof, white colonial windows',
      roof: { type: 'hip', material: 'slate', color: '#4a4f57', pitch: 30, overhang: 0.4 },
      finish: 'brick', extColor: '#a4553d', trim: '#f8f7f4', window: 'colonial', door: 'panel', doorColor: '#2f3d55',
      intDoor: 'panel', intDoorColor: '#f8f7f4', wall: '#f3eee4', ceiling: '#fbfaf8', cornice: true, columns: 'round',
      floor: ['chevron', '#b8895a'], wetFloor: ['marble', '#efede8']
    },
    rustic: {
      label: 'Rustic', blurb: 'Stone walls, shingle gable, walnut planks',
      roof: { type: 'gable', material: 'shingle', color: '#5e4636', pitch: 32, overhang: 0.6 },
      finish: 'stone', extColor: '#b9ad9c', trim: '#5a4635', window: 'cross', door: 'plank', doorColor: '#6e4b33',
      intDoor: 'plank', intDoorColor: '#8a6448', wall: '#efe6d4', ceiling: '#f6f1e7', cornice: false, columns: 'timber',
      floor: ['wideplank', '#6e4b33'], wetFloor: ['slate', '#5d6166']
    },
    minimalist: {
      label: 'Minimalist', blurb: 'Board-formed concrete, flat roof, concrete floors',
      roof: { type: 'flat', material: 'membrane', color: '#bdbbb6', pitch: 5, overhang: 0.3 },
      finish: 'concrete', extColor: '#bdbbb6', trim: '#3a3c3f', window: 'none', door: 'flush', doorColor: '#3a3c3f',
      intDoor: 'flush', intDoorColor: '#ecebe8', wall: '#f7f6f2', ceiling: '#ffffff', cornice: false, columns: 'square',
      floor: ['concrete', '#c9c7c1'], wetFloor: ['terrazzo', '#e6e1d8']
    }
  },

  // Ground surfaces for the plot. Drawn in list order, so later ones sit on top.
  materials: {
    lawn: { label: 'Lawn', flat: '#b9d79a' },
    concrete: { label: 'Concrete', flat: '#d4d2cc' },
    pavers: { label: 'Pavers', flat: '#d9c7ad' },
    gravel: { label: 'Gravel', flat: '#ddd5c4' },
    deck: { label: 'Timber deck', flat: '#cfa77b' },
    mulch: { label: 'Garden bed', flat: '#a98563' },
    hedge: { label: 'Hedge', flat: '#6f9a55' },
    water: { label: 'Pool / water', flat: '#9fd6ea' },
    sand: { label: 'Sand', flat: '#ece0bd' }
  },

  plants: {
    tree: { label: 'Shade tree', r: 2.5 },
    fruit: { label: 'Fruit tree', r: 1.6 },
    palm: { label: 'Palm', r: 1.8 },
    conifer: { label: 'Conifer', r: 1.1 },
    shrub: { label: 'Shrub', r: 0.6 },
    flowers: { label: 'Flowers', r: 0.4 }
  },

  items: {
    'bed-double': { label: 'Double bed', w: 1.6, h: 2.0, group: 'Bedroom' },
    'bed-single': { label: 'Single bed', w: 0.9, h: 1.9, group: 'Bedroom' },
    'nightstand': { label: 'Nightstand', w: 0.45, h: 0.4, group: 'Bedroom' },
    'wardrobe': { label: 'Wardrobe', w: 1.5, h: 0.6, group: 'Bedroom' },
    'dresser': { label: 'Dresser', w: 1.2, h: 0.5, group: 'Bedroom' },
    'sofa': { label: 'Sofa', w: 2.2, h: 0.9, group: 'Living' },
    'sofa-l': { label: 'L-shaped sofa', w: 2.6, h: 1.8, group: 'Living' },
    'armchair': { label: 'Armchair', w: 0.85, h: 0.85, group: 'Living' },
    'coffee-table': { label: 'Coffee table', w: 1.1, h: 0.6, group: 'Living' },
    'tv-unit': { label: 'TV unit', w: 1.8, h: 0.4, group: 'Living' },
    'rug': { label: 'Rug', w: 2.4, h: 1.7, group: 'Living' },
    'dining-6': { label: 'Dining table, 6 seats', w: 2.6, h: 1.7, group: 'Dining' },
    'dining-4': { label: 'Dining table, 4 seats', w: 1.8, h: 1.6, group: 'Dining' },
    'counter': { label: 'Kitchen counter', w: 2.4, h: 0.6, group: 'Kitchen' },
    'island': { label: 'Kitchen island', w: 2.0, h: 0.9, group: 'Kitchen' },
    'stools': { label: 'Bar stools (3)', w: 1.6, h: 0.45, group: 'Kitchen' },
    'stove': { label: 'Cooktop', w: 0.6, h: 0.6, group: 'Kitchen' },
    'sink-kitchen': { label: 'Kitchen sink', w: 0.8, h: 0.6, group: 'Kitchen' },
    'fridge': { label: 'Fridge', w: 0.75, h: 0.7, group: 'Kitchen' },
    'toilet': { label: 'Toilet', w: 0.4, h: 0.7, group: 'Bathroom' },
    'basin': { label: 'Basin', w: 0.6, h: 0.45, group: 'Bathroom' },
    'vanity-double': { label: 'Double vanity', w: 1.4, h: 0.5, group: 'Bathroom' },
    'shower': { label: 'Shower', w: 0.9, h: 0.9, group: 'Bathroom' },
    'bathtub': { label: 'Bathtub', w: 1.7, h: 0.75, group: 'Bathroom' },
    'washer': { label: 'Washing machine', w: 0.6, h: 0.6, group: 'Bathroom' },
    'desk': { label: 'Desk', w: 1.4, h: 0.7, group: 'Office' },
    'chair': { label: 'Chair', w: 0.5, h: 0.5, group: 'Office' },
    'bookshelf': { label: 'Bookshelf', w: 1.0, h: 0.35, group: 'Office' },
    'car': { label: 'Car', w: 1.85, h: 4.5, group: 'Outdoor' },
    'lounger': { label: 'Sun lounger', w: 0.7, h: 1.9, group: 'Outdoor' },
    'outdoor-table': { label: 'Outdoor table, 4 seats', w: 1.8, h: 1.8, group: 'Outdoor' },
    'outdoor-sofa': { label: 'Outdoor sofa', w: 2.0, h: 0.85, group: 'Outdoor' },
    'bbq': { label: 'Barbecue', w: 1.2, h: 0.6, group: 'Outdoor' },
    'bench': { label: 'Bench', w: 1.5, h: 0.5, group: 'Outdoor' },
    'planter': { label: 'Planter', w: 0.6, h: 0.6, group: 'Outdoor' }
  },

  // h = opening height, sill = height of its bottom edge above the floor
  openings: {
    door: { label: 'Door', w: 0.9, h: 2.1, sill: 0 },
    sliding: { label: 'Sliding door', w: 1.8, h: 2.1, sill: 0 },
    window: { label: 'Window', w: 1.2, h: 1.2, sill: 0.9 },
    opening: { label: 'Open passage', w: 1.5, h: 2.4, sill: 0 }
  },

  roofs: {
    flat: { label: 'Flat' },
    parapet: { label: 'Flat with parapet' },
    gable: { label: 'Gable (two slopes)' },
    hip: { label: 'Hip (four slopes)' },
    shed: { label: 'Shed (one slope)' },
    butterfly: { label: 'Butterfly (V)' }
  }
};
