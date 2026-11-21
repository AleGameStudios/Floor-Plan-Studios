// Floorplan Studio: Electron main process.
// Owns windows, menus, file dialogs and the bridge to the local Claude Code CLI.
const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

let win = null;
let dirty = false;
let claudeChild = null;

/* ---------- settings ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

/* ---------- window + menu ---------- */
function send(cmd) { if (win) win.webContents.send('menu', cmd); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Home', accelerator: 'Shift+CmdOrCtrl+H', click: () => send('home') },
        { label: 'New Design…', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open Sample House', click: () => send('sample') },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Export Copy As .fplan…', accelerator: 'Shift+CmdOrCtrl+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: 'Export Render as PNG…', accelerator: 'CmdOrCtrl+E', click: () => send('exportPng') },
        { label: 'Export Render as SVG…', click: () => send('exportSvg') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: () => send('duplicate') },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Plan View', accelerator: 'CmdOrCtrl+1', click: () => send('viewPlan') },
        { label: 'Render View', accelerator: 'CmdOrCtrl+2', click: () => send('viewRender') },
        { label: '3D View', accelerator: 'CmdOrCtrl+3', click: () => send('view3d') },
        { label: 'Walk Through (First Person)', accelerator: 'CmdOrCtrl+4', click: () => send('walk') },
        { label: 'Zoom to Fit', accelerator: 'CmdOrCtrl+0', click: () => send('zoomFit') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1024, minHeight: 640,
    title: 'Floorplan Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111315' : '#f4f5f7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('close', (e) => {
    if (!dirty) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'This project has unsaved changes.', detail: 'Closing the window discards them.'
    });
    if (r !== 0) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

/* ---------- bundled designs, settings and preferences ---------- */
// my-data/ (in the project; resources/my-data in an installed app) carries designs, settings and view
// preferences to another computer. Each new bundle (my-data/bundle.json "stamp") is imported once: designs
// that are missing here, or older here than in the bundle, are copied in; nothing newer is overwritten.
const bundleDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'my-data') : path.join(__dirname, 'my-data'));
function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; } }
function importBundledData() {
  const dir = bundleDir(), info = readJson(path.join(dir, 'bundle.json'), null);
  if (!info || !info.stamp) return;
  const marker = path.join(app.getPath('userData'), 'imported-bundle.txt');
  try { if (fs.readFileSync(marker, 'utf8') === String(info.stamp)) return; } catch (e) { /* first import */ }
  const src = path.join(dir, 'designs');
  fs.mkdirSync(designsDir(), { recursive: true });
  for (const f of fs.existsSync(src) ? fs.readdirSync(src).filter((n) => n.endsWith('.fpdesign')) : []) {
    const theirs = readJson(path.join(src, f), null), mine = readJson(path.join(designsDir(), f), null);
    if (!theirs || !theirs.meta) continue;
    if (!mine || !mine.meta || (mine.meta.updatedAt || 0) < (theirs.meta.updatedAt || 0)) fs.copyFileSync(path.join(src, f), path.join(designsDir(), f));
  }
  // settings already chosen on this computer win over the bundled ones
  writeSettings(Object.assign({}, readJson(path.join(dir, 'settings.json'), {}), readSettings()));
  fs.writeFileSync(marker, String(info.stamp));
}
// The preload asks once, before the page runs, for preferences it hasn't applied yet.
ipcMain.on('prefs:bundled', (e) => {
  const info = readJson(path.join(bundleDir(), 'bundle.json'), null);
  e.returnValue = info && info.stamp ? { stamp: String(info.stamp), prefs: readJson(path.join(bundleDir(), 'preferences.json'), {}) } : null;
});

app.whenReady().then(() => {
  try { importBundledData(); } catch (e) { console.error('Could not import bundled designs:', e); }
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---------- files ---------- */
const PROJECT_FILTERS = [{ name: 'Floorplan project', extensions: ['fplan', 'json'] }];

ipcMain.on('app:dirty', (_e, d) => { dirty = !!d; if (win) win.setDocumentEdited(dirty); });
ipcMain.on('app:title', (_e, t) => { if (win) win.setTitle(String(t)); });
ipcMain.on('app:theme', (_e, t) => { nativeTheme.themeSource = ['light', 'dark'].includes(t) ? t : 'system'; });

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: PROJECT_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});

async function saveAs(content, name) {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: (name || 'My house').replace(/[\\/:*?"<>|]/g, '-') + '.fplan', filters: PROJECT_FILTERS
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content);
  return r.filePath;
}
ipcMain.handle('file:save', async (_e, p, content, name) => {
  if (!p) return saveAs(content, name);
  fs.writeFileSync(p, content);
  return p;
});
ipcMain.handle('file:saveAs', (_e, content, name) => saveAs(content, name));

ipcMain.handle('file:exportPng', async (_e, dataUrl, name) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: (name || 'render') + '.png', filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return r.filePath;
});
ipcMain.handle('file:exportSvg', async (_e, svg, name) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: (name || 'render') + '.svg', filters: [{ name: 'SVG image', extensions: ['svg'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, svg);
  return r.filePath;
});

/* ---------- design library: every design autosaves here ---------- */
const designsDir = () => path.join(app.getPath('userData'), 'designs');
function designFile(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('Invalid design id');
  return path.join(designsDir(), id + '.fpdesign');
}
ipcMain.handle('designs:list', () => {
  let files = [];
  try { files = fs.readdirSync(designsDir()).filter((f) => f.endsWith('.fpdesign')); } catch (e) { return []; }
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(designsDir(), f), 'utf8'));
      if (d && d.meta && d.meta.id) out.push(d.meta);
    } catch (e) { /* skip unreadable file */ }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});
ipcMain.handle('designs:load', (_e, id) => {
  try { return JSON.parse(fs.readFileSync(designFile(id), 'utf8')); } catch (e) { return null; }
});
ipcMain.handle('designs:save', (_e, id, payload) => {
  fs.mkdirSync(designsDir(), { recursive: true });
  const f = designFile(id), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, f);
  return true;
});
// Deleting moves the file to the Trash, so it can be recovered.
ipcMain.handle('designs:delete', async (_e, id) => {
  try { await shell.trashItem(designFile(id)); return true; } catch (e) { return false; }
});

ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const s = Object.assign(readSettings(), patch || {});
  writeSettings(s);
  return s;
});

/* ---------- Claude Code CLI bridge ---------- */
const isWin = process.platform === 'win32';
// Apps opened from Finder get a minimal PATH, so borrow the login shell's PATH once.
// Windows apps already get the full user PATH.
let shellPath = null;
function loginShellPath() {
  if (shellPath) return Promise.resolve(shellPath);
  if (isWin) return Promise.resolve((shellPath = process.env.PATH || ''));
  return new Promise((resolve) => {
    const sh = process.env.SHELL || '/bin/zsh';
    execFile(sh, ['-ilc', 'printf "__P__%s__E__" "$PATH"'], { timeout: 8000 }, (_err, out) => {
      const m = /__P__(.*)__E__/.exec(out || '');
      shellPath = (m ? m[1] : '') || process.env.PATH || '';
      resolve(shellPath);
    });
  });
}
function isExec(p) {
  try { if (!isWin) fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch (e) { return false; }
}
async function resolveClaude() {
  const s = readSettings();
  const home = os.homedir();
  const candidates = [s.claudePath].concat(isWin
    ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
    : [path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  ).filter(Boolean);
  for (const c of candidates) if (isExec(c)) return c;
  const p = await loginShellPath();
  for (const dir of p.split(path.delimiter)) {
    for (const name of isWin ? ['claude.exe', 'claude.cmd'] : ['claude']) {
      const c = path.join(dir, name);
      if (dir && isExec(c)) return c;
    }
  }
  return null;
}
// How to start the CLI. An npm install on Windows is a .cmd shim, which can't be started without a shell
// (and shell quoting would mangle the JSON arguments), so run its script with Electron's own Node instead.
function claudeCommand(bin) {
  if (isWin && /\.(cmd|bat)$/i.test(bin)) {
    const script = path.join(path.dirname(bin), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (fs.existsSync(script)) return { file: process.execPath, pre: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { file: bin, pre: [], env: {} };
}

// Subscription only: strip every variable that would make the CLI bill an API key,
// a custom endpoint or a cloud provider instead of the signed-in Claude account.
const BILLED_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'
];
function childEnv(PATH) {
  const env = Object.assign({}, process.env, { PATH: PATH || process.env.PATH });
  for (const k of BILLED_ENV) delete env[k];
  return env;
}

function runProcess(bin, args, input, timeoutMs) {
  return loginShellPath().then((PATH) => new Promise((resolve) => {
    const cmd = claudeCommand(bin);
    const child = spawn(cmd.file, cmd.pre.concat(args), { cwd: os.tmpdir(), env: Object.assign(childEnv(PATH), cmd.env), windowsHide: true });
    claudeChild = child;
    let out = '', err = '', done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); claudeChild = null; resolve(r); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ code: -1, out, err: 'Timed out after ' + Math.round(timeoutMs / 1000) + ' s.' }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ code: -1, out, err: e.message }));
    child.on('close', (code, signal) => finish({ code, out, err: signal === 'SIGTERM' && !err ? 'Cancelled.' : err }));
    if (input != null) { child.stdin.write(input); }
    child.stdin.end();
  }));
}

// Ask the CLI how it is signed in, with the same stripped environment the requests use.
// Only a claude.ai subscription login is allowed, so requests count against the plan
// instead of being billed per token.
async function subscriptionCheck(bin) {
  const r = await runProcess(bin, ['auth', 'status'], null, 20000);
  let s = null;
  try { s = JSON.parse(r.out); } catch (e) { /* older CLI or not signed in */ }
  if (!s || !s.loggedIn) {
    return { ok: false, error: 'Claude Code is not signed in. Open a terminal (Terminal on Mac, PowerShell on Windows), run "claude auth login", and sign in with your Claude account.' };
  }
  if (s.authMethod !== 'claude.ai' || !s.subscriptionType) {
    return { ok: false, error: 'Claude Code is signed in with ' + (s.authMethod || 'an API key') + ', which is billed per use, so Floorplan Studio will not use it. Run "claude auth logout", then "claude auth login" and choose your Claude account.' };
  }
  const tier = String(s.planTier || s.subscriptionType);
  const plan = tier.replace(/^max_(\d+)x$/, 'Max $1x').replace(/^max$/, 'Max').replace(/^pro$/, 'Pro');
  return { ok: true, plan, email: s.email };
}

ipcMain.handle('claude:status', async () => {
  const bin = await resolveClaude();
  if (!bin) return { found: false, error: 'Claude Code was not found. Install it, or set its path in Settings.' };
  const r = await runProcess(bin, ['--version'], null, 20000);
  if (r.code !== 0) return { found: false, path: bin, error: (r.err || 'Could not run claude --version').trim() };
  const sub = await subscriptionCheck(bin);
  return { found: true, path: bin, version: (r.out || '').trim(), subscription: sub.ok, plan: sub.plan, email: sub.email, error: sub.ok ? null : sub.error };
});

function extractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch (e) { return null; }
}

ipcMain.handle('claude:run', async (_e, req) => {
  const bin = await resolveClaude();
  if (!bin) return { ok: false, error: 'Claude Code was not found. Install it, or set its path in Settings.' };
  const sub = await subscriptionCheck(bin);
  if (!sub.ok) return { ok: false, error: sub.error };
  const s = readSettings();
  const images = (Array.isArray(req.images) ? req.images : [])
    .filter((i) => i && /^image\/(png|jpeg|webp|gif)$/.test(i.mediaType) && typeof i.data === 'string');
  // Images travel as a stream-json user message; plain prompts go in as text.
  const streaming = images.length > 0;
  // --setting-sources '' also skips any apiKeyHelper configured in Claude Code settings.
  const args = [
    '-p', '--output-format', streaming ? 'stream-json' : 'json',
    '--tools', '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--system-prompt', req.system || ''
  ];
  if (streaming) args.push('--input-format', 'stream-json', '--verbose');
  if (req.schema) args.push('--json-schema', JSON.stringify(req.schema));
  if (s.claudeModel) args.push('--model', s.claudeModel);
  const input = streaming
    ? JSON.stringify({ type: 'user', message: { role: 'user', content: images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })).concat([{ type: 'text', text: req.prompt || '' }]) } }) + '\n'
    : req.prompt || '';
  const r = await runProcess(bin, args, input, (req.timeoutSec || 600) * 1000);
  let env = null;
  if (streaming) {
    for (const line of (r.out || '').split('\n')) {
      try { const ev = JSON.parse(line); if (ev && ev.type === 'result') env = ev; } catch (e) { /* partial or non-JSON line */ }
    }
  } else {
    try { env = JSON.parse(r.out); } catch (e) { /* not JSON */ }
  }
  if (!env) {
    return { ok: false, error: (r.err || r.out || 'Claude Code returned no output.').trim().slice(0, 2000) };
  }
  if (env.is_error) {
    return { ok: false, error: String(env.result || env.error || 'Claude Code reported an error.').slice(0, 2000) };
  }
  const data = env.structured_output || extractJson(env.result);
  if (!data) return { ok: false, error: 'Claude replied, but not with the expected JSON.', raw: String(env.result || '').slice(0, 4000) };
  return { ok: true, data, ms: env.duration_ms };
});

ipcMain.handle('claude:cancel', () => {
  if (claudeChild) { claudeChild.kill('SIGTERM'); return true; }
  return false;
});
