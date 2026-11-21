// Home screen: start a new design three ways, or reopen one of your saved designs.
window.FP = window.FP || {};

(function () {
  const I = FP.icons;
  const A = () => FP.app;
  const $ = (id) => document.getElementById(id);

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }

  function ago(t) {
    const s = (Date.now() - (t || 0)) / 1000;
    if (s < 60) return 'edited just now';
    if (s < 3600) return 'edited ' + Math.round(s / 60) + ' min ago';
    if (s < 86400) return 'edited ' + Math.round(s / 3600) + ' h ago';
    if (s < 7 * 86400) { const d = Math.round(s / 86400); return 'edited ' + d + (d === 1 ? ' day' : ' days') + ' ago'; }
    return 'edited ' + new Date(t).toLocaleDateString();
  }

  const STARTERS = [
    { mode: 'scratch', icon: 'room', title: 'Start from scratch', text: 'An empty lot. Draw the walls, rooms and garden yourself.' },
    { mode: 'describe', icon: 'sparkle', title: 'Describe it', text: 'Tell Claude about the house in your own words. Preview its draft, then apply it.' },
    { mode: 'image', icon: 'image', title: 'From a floor-plan image', text: 'Drop a drawing, photo or screenshot of a plan. Claude rebuilds it to scale.' }
  ];

  async function show() {
    const root = $('home');
    root.hidden = false;
    render(root, null);
    let list = [];
    try { list = await A().listDesigns(); } catch (e) { list = []; }
    if (!root.hidden) render(root, list || []);
  }
  function hide() { $('home').hidden = true; }
  const isOpen = () => !$('home').hidden;

  function render(root, list) {
    root.innerHTML = '';
    const open = A().hasOpenDesign();
    root.append(h('div', { class: 'home-bar' },
      h('span', { class: 'home-logo', html: I.house }),
      h('span', { class: 'home-title' }, 'Floorplan Studio'),
      h('span', { class: 'grow' }),
      open ? h('button', { class: 'ghost-btn', onclick: hide }, h('span', { class: 'i', html: I.arrowLeft }), 'Back to ' + A().state.project.name) : null));

    const body = h('div', { class: 'home-body' });
    body.append(h('h1', {}, 'Start a new design'));
    body.append(h('div', { class: 'starters' }, STARTERS.map((s) => h('button', { class: 'starter', onclick: () => FP.panels.openStart(true, s.mode) },
      h('span', { class: 'starter-icon', html: I[s.icon] }),
      h('span', { class: 'starter-title' }, s.title),
      h('span', { class: 'starter-text' }, s.text)))));

    body.append(h('div', { class: 'home-row' },
      h('h2', {}, 'Your designs'),
      list && list.length ? h('span', { class: 'count' }, String(list.length)) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => A().openFile() }, h('span', { class: 'i', html: I.folder }), 'Open file…'),
      h('button', { class: 'btn', onclick: () => A().loadSample() }, h('span', { class: 'i', html: I.house }), 'Sample house')));

    if (!list) body.append(h('p', { class: 'note' }, 'Loading your designs…'));
    else if (!list.length) body.append(h('div', { class: 'empty-designs' }, h('div', { class: 'empty-title' }, 'No designs yet'), h('div', { class: 'note' }, 'Start one above, or open the sample house to look around. Every design saves itself as you work.')));
    else body.append(h('div', { class: 'designs' }, list.map(card)));
    root.append(body);
  }

  function card(m) {
    const del = h('button', { class: 'card-del', title: window.api ? 'Move to Trash' : 'Delete', 'aria-label': 'Delete ' + m.name, html: I.trash });
    let armed = 0;
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!armed) {
        del.classList.add('armed');
        del.textContent = window.api ? 'Move to Trash?' : 'Delete?';
        armed = setTimeout(() => { armed = 0; del.classList.remove('armed'); del.innerHTML = I.trash; }, 3500);
        return;
      }
      clearTimeout(armed);
      if (await A().deleteDesign(m.id)) {
        A().toast('"' + m.name + '" ' + (window.api ? 'moved to the Trash' : 'deleted'));
        show();
      }
    });
    const open = () => A().openDesign(m.id);
    const area = (m.indoor || 0).toFixed(1) + ' m² indoor' + (m.covered ? ' · ' + m.covered.toFixed(1) + ' m² covered' : '');
    return h('div', { class: 'design', role: 'button', tabindex: 0, onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
      h('div', { class: 'thumb' }, m.thumb ? h('img', { src: m.thumb, alt: '' }) : h('span', { class: 'thumb-empty', html: I.house }), del),
      h('div', { class: 'design-name' }, m.name || 'Untitled'),
      h('div', { class: 'design-meta' }, area),
      h('div', { class: 'design-meta' }, ago(m.updatedAt)));
  }

  FP.home = { show, hide, isOpen };
})();
