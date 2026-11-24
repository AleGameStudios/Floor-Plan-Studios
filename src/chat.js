// Chat with Claude: a docked panel where the owner can ask questions about the design and ask for changes.
// Each message goes to the local Claude Code CLI (same bridge as "Ask Claude"). When Claude answers with an
// edit, it goes through the same validation as every other suggestion (FP.claude.proposal), then it is either
// applied straight away as one undo step or kept as a preview, depending on the "Apply changes automatically" switch.
window.FP = window.FP || {};

(function () {
  const I = FP.icons;
  const A = () => FP.app;
  const S = () => FP.app.state;
  const P = () => FP.app.state.project;
  const $ = (id) => document.getElementById(id);
  const api = window.api || null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };

  const LABEL = { rooms: 'Rooms', walls: 'Walls', openings: 'Doors & windows', items: 'Furniture', areas: 'Surfaces', plants: 'Plants', fences: 'Fences', gates: 'Gates' };
  const IDEAS = [
    'How big is the house, and what is the biggest room?',
    'What would you improve about this layout?',
    'Make the kitchen 1 m wider.'
  ];

  // One conversation per design, kept while the app is open.
  const convos = new Map();
  let shownFor = null;           // design id the panel currently shows
  let open = false;
  let running = false;
  let auto = store.get('fp.chat.auto') !== '0';
  let status = null;             // last Claude Code status check
  let ticker = 0;
  let t0 = 0;
  let draft = '';
  let loginRunning = false;
  let loginUrl = null;
  let loginErr = '';

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  }

  const key = () => S().designId || '_';
  const convo = () => { const k = key(); if (!convos.has(k)) convos.set(k, []); return convos.get(k); };

  /* ---------- Claude Code status ---------- */
  async function checkStatus(force) {
    if (!api) { status = { found: false, error: 'The chat needs the desktop app.' }; return; }
    if (status && status.found && status.subscription && !force) return;
    status = null; draw();
    try { status = await api.claudeStatus(); } catch (e) { status = { found: false, error: String(e && e.message || e) }; }
    draw();
  }
  // Sign in with a Claude account without leaving the app: the CLI opens the browser, we wait for it to finish.
  async function signIn() {
    if (!api || loginRunning) return;
    loginRunning = true; loginUrl = null; loginErr = '';
    draw();
    let r;
    try { r = await api.claudeLogin(); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    loginRunning = false; loginUrl = null;
    if (!r.ok && r.error !== 'Cancelled.') loginErr = r.error;
    await checkStatus(true);
    if (ready()) A().toast('Signed in. You can chat now.');
  }
  if (api && api.onLoginUrl) api.onLoginUrl((u) => { loginUrl = u; if (loginRunning) draw(); });

  const ready = () => !!(status && status.found && status.subscription);

  /* ---------- describing a change ---------- */
  function describe(d) {
    const parts = [];
    for (const [k, label] of Object.entries(LABEL)) {
      const x = d.lists[k];
      if (!x || !(x.added + x.changed + x.removed)) continue;
      const bits = [];
      if (x.added) bits.push('+' + x.added);
      if (x.changed) bits.push(x.changed + ' changed');
      if (x.removed) bits.push('−' + x.removed);
      parts.push(label + ' ' + bits.join(' '));
    }
    if (d.lot) parts.push('Lot size');
    if (d.look) parts.push('Style / roof');
    return parts.join(' · ');
  }

  /* ---------- sending ---------- */
  function selection() {
    const st = S();
    if (!st.sel) return null;
    const e = FP.model.find(P(), st.sel.k, st.sel.id);
    if (!e) return null;
    return { kind: st.sel.k, id: st.sel.id, name: e.name || (FP.catalog.items[e.kind] || {}).label || '' };
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || running) return;
    if (!api) { A().toast('The chat only works in the desktop app.'); return; }
    if (!$('modal').hidden) { A().toast('Close the open dialog first.'); return; }
    if (!ready()) { await checkStatus(true); if (!ready()) return; }

    const list = convo();
    const history = list.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    list.push({ role: 'user', text });
    draft = '';
    running = true; t0 = Date.now();
    const seq = A().editSeq();
    const forKey = key();
    draw(true);
    ticker = setInterval(() => { const n = document.querySelector('#chat .thinking .t'); if (n) n.textContent = 'Thinking · ' + Math.round((Date.now() - t0) / 1000) + ' s'; }, 500);

    let res;
    try {
      res = await api.claudeRun(FP.claude.buildChatRequest(P(), { message: text, history, selection: selection() }));
    } catch (e) {
      res = { ok: false, error: String(e && e.message || e) };
    }
    clearInterval(ticker);
    running = false;
    const target = convos.get(forKey) || list;

    if (!res || !res.ok) {
      const msg = (res && res.error) || 'Claude did not answer.';
      target.push({ role: 'assistant', text: msg === 'Cancelled.' ? 'Stopped.' : msg, error: msg !== 'Cancelled.' });
      if (/not signed in|billed per use|not found/i.test(msg)) status = null;
      draw(true);
      return;
    }

    const data = res.data || {};
    const m = { role: 'assistant', text: String(data.reply || '').trim() || 'Done.' };
    if (data.design && forKey === key()) {
      try {
        const next = FP.claude.proposal(P(), data.design);
        const diff = FP.claude.diff(P(), next);
        if (!diff.total) {
          m.text += '\n\n(Nothing in the design actually changed.)';
        } else {
          const stale = A().editSeq() !== seq;
          const blocked = !!S().preview;
          m.change = { project: next, summary: data.design.summary || '', what: describe(diff), applied: false, undone: false, seq: 0 };
          if (auto && !stale && !blocked && A().applyNow(next)) {
            m.change.applied = true;
            m.change.seq = A().editSeq();
          } else if (auto && (stale || blocked)) {
            m.change.note = stale ? 'You edited the design while I was working, so I did not apply this on top of your edits.' : 'A suggestion is being previewed, so I did not apply this.';
          }
        }
      } catch (e) {
        m.text += '\n\n(I could not use the change I came up with: ' + String(e && e.message || e) + ')';
      }
    } else if (data.design) {
      m.text += '\n\n(You switched designs while I was working, so I left the change out.)';
    }
    target.push(m);
    draw(true);
  }

  /* ---------- drawing ---------- */
  function bubble(m, i) {
    if (m.role === 'user') return el('div', { class: 'msg user' }, el('div', { class: 'b' }, m.text));
    const b = el('div', { class: 'b' + (m.error ? ' err' : '') }, m.text);
    const wrap = el('div', { class: 'msg bot' }, b);
    const c = m.change;
    if (c) {
      const actions = el('div', { class: 'actions' });
      let state;
      if (c.applied && c.undone) state = 'Undone';
      else if (c.applied) state = 'Applied to your design';
      else state = 'Not applied yet';
      const card = el('div', { class: 'change' + (c.applied && !c.undone ? ' on' : '') },
        el('div', { class: 'h' }, el('span', { class: 'i', html: I.sparkle }), el('span', {}, state)),
        c.what ? el('div', { class: 's' }, c.what) : null,
        c.note ? el('div', { class: 's' }, c.note) : null,
        actions);
      if (c.applied && !c.undone) {
        actions.append(el('button', { class: 'btn small', onclick: () => undoChange(c) }, 'Undo'));
      } else if (!c.applied) {
        actions.append(
          el('button', { class: 'accent-btn small', onclick: () => { if (A().applyNow(c.project)) { c.applied = true; c.undone = false; c.seq = A().editSeq(); A().toast('Change applied. ⌘Z undoes it.'); draw(); } } }, 'Apply'),
          el('button', { class: 'btn small', onclick: () => { A().propose(c.project, c.summary || 'Suggested by chat.', 'Chat suggestion'); } }, 'Preview'));
      }
      if (c.applied && c.undone) {
        actions.append(el('button', { class: 'btn small', onclick: () => { if (A().applyNow(c.project)) { c.undone = false; c.seq = A().editSeq(); draw(); } } }, 'Apply again'));
      }
      wrap.append(card);
    }
    return wrap;
  }

  function undoChange(c) {
    if (A().editSeq() !== c.seq) { A().toast('You have edited the design since. Use the Undo button at the top to step back.'); return; }
    A().undo();
    c.undone = true;
    draw();
  }

  function draw(scroll) {
    const root = $('chat');
    if (!root) return;
    const prev = root.querySelector('.msgs');
    const keepTop = prev && !scroll ? prev.scrollTop : null;
    root.innerHTML = '';

    const pill = el('span', { class: 'pill' }, 'Checking Claude Code…');
    if (status) {
      if (status.found && status.subscription) {
        pill.textContent = status.plan + ' plan · no extra charge';
        pill.className = 'pill ok';
        pill.title = 'Signed in as ' + (status.email || 'your Claude account') + ' · ' + (status.version || '') + ' · ' + (status.path || '');
      } else {
        pill.textContent = status.found ? 'Not on a subscription' : 'Not available';
        pill.className = 'pill err';
      }
    }
    const head = el('header', {},
      el('span', { class: 'i', html: I.chat, style: 'color:var(--accent)' }),
      el('h2', {}, 'Chat'),
      pill,
      el('span', { class: 'grow' }),
      el('button', { class: 'icon-btn', title: 'Start a new conversation', 'aria-label': 'New conversation', html: I.trash, onclick: () => { if (running) return; convos.set(key(), []); draw(true); } }),
      el('button', { class: 'icon-btn', title: 'Close chat', 'aria-label': 'Close chat', html: I.close, onclick: () => setOpen(false) }));

    const msgs = el('div', { class: 'msgs' });
    const list = convo();
    if (status && !ready() && status.error) {
      const acts = el('div', { class: 'actions' });
      if (loginRunning) {
        acts.append(el('span', { class: 'spinner' }), el('span', { class: 'note' }, 'Waiting for you to finish signing in in your browser…'));
        if (loginUrl) acts.append(el('button', { class: 'btn small', onclick: () => api.openExternal(loginUrl) }, 'Open sign-in page'));
        acts.append(el('button', { class: 'btn small', onclick: () => api.claudeLoginCancel() }, 'Cancel'));
      } else {
        if (status.found) acts.append(el('button', { class: 'accent-btn small', onclick: signIn }, 'Sign in with Claude'));
        acts.append(el('button', { class: 'btn small', onclick: () => checkStatus(true) }, 'Check again'));
      }
      msgs.append(el('div', { class: 'msg bot' },
        el('div', { class: 'b err' }, status.found && !loginRunning && /not signed in/i.test(status.error) ? 'Claude Code is not signed in yet. Use the button below, then approve the sign-in in your browser.' : status.error),
        loginErr ? el('div', { class: 'b err' }, loginErr) : null,
        acts));
    }
    if (!list.length && !running) {
      msgs.append(el('div', { class: 'empty' },
        el('div', { class: 'big', html: I.sparkle }),
        el('p', {}, 'Ask anything about your design, or tell me what to change. I can see your whole plan.'),
        IDEAS.map((t) => el('button', { class: 'idea', onclick: () => { const ta = $('chat').querySelector('textarea'); ta.value = t; draft = t; ta.focus(); } }, t))));
    }
    list.forEach((m, i) => msgs.append(bubble(m, i)));
    if (running) msgs.append(el('div', { class: 'msg bot thinking' }, el('div', { class: 'b' }, el('span', { class: 'spinner' }), el('span', { class: 't' }, 'Thinking · ' + Math.round((Date.now() - t0) / 1000) + ' s'))));

    const ta = el('textarea', {
      rows: 2, placeholder: ready() || !status ? 'Ask a question or describe a change…' : 'Claude Code is not ready yet',
      oninput: (e) => { draft = e.target.value; },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const t = ta.value; ta.value = ''; send(t); }
      }
    });
    ta.value = draft;
    const go = running
      ? el('button', { class: 'btn', onclick: () => api && api.claudeCancel() }, 'Stop')
      : el('button', { class: 'accent-btn', title: 'Send (Enter)', onclick: () => { const t = ta.value; ta.value = ''; send(t); } }, el('span', { class: 'i', html: I.send }), 'Send');
    const model = el('select', { title: 'Which Claude model answers', onchange: (e) => api && api.setSettings({ claudeModel: e.target.value }) },
      [['', 'Default model'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([v, l]) => el('option', { value: v }, l)));
    if (api) api.getSettings().then((s) => { model.value = (s && s.claudeModel) || ''; });
    const sw = el('label', { class: 'auto', title: 'On: changes are applied as soon as Claude makes them (one undo step). Off: you preview each change and apply it yourself.' },
      el('input', { type: 'checkbox', checked: auto, onchange: (e) => { auto = e.target.checked; store.set('fp.chat.auto', auto ? '1' : '0'); } }),
      'Auto-apply changes');
    const comp = el('div', { class: 'composer' }, ta, el('div', { class: 'row' }, sw, el('span', { class: 'grow' }), model, go));

    root.append(head, msgs, comp);
    if (keepTop != null) msgs.scrollTop = keepTop; else msgs.scrollTop = msgs.scrollHeight;
    if (!running && open && document.activeElement === document.body && scroll) ta.focus();
  }

  /* ---------- open / close ---------- */
  function setOpen(v) {
    open = v;
    const root = $('chat');
    root.hidden = !v;
    $('btnChat').classList.toggle('active', v);
    if (v) { shownFor = key(); draw(true); checkStatus(false); const ta = root.querySelector('textarea'); if (ta) ta.focus(); }
  }
  function toggle() { setOpen(!open); }
  function onDesignChange() { if (open && shownFor !== key()) { shownFor = key(); draft = ''; draw(true); } }

  FP.chat = { toggle, open: () => setOpen(true), close: () => setOpen(false), onDesignChange, isBusy: () => running };
})();
