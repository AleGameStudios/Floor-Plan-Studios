// Narrow, explicit bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

// View preferences bundled in my-data/ (theme, detail, lens…) are applied once per bundle, before the page reads
// them, and only where this computer has no choice of its own yet.
try {
  const b = ipcRenderer.sendSync('prefs:bundled');
  if (b && localStorage.getItem('fp.bundle') !== b.stamp) {
    for (const [k, v] of Object.entries(b.prefs || {})) if (/^fp\./.test(k) && localStorage.getItem(k) == null) localStorage.setItem(k, String(v));
    localStorage.setItem('fp.bundle', b.stamp);
  }
} catch (e) { /* storage unavailable: defaults apply */ }

contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (filePath, content, name) => ipcRenderer.invoke('file:save', filePath, content, name),
  saveFileAs: (content, name) => ipcRenderer.invoke('file:saveAs', content, name),
  exportPng: (dataUrl, name) => ipcRenderer.invoke('file:exportPng', dataUrl, name),
  exportSvg: (svg, name) => ipcRenderer.invoke('file:exportSvg', svg, name),
  designsList: () => ipcRenderer.invoke('designs:list'),
  designsLoad: (id) => ipcRenderer.invoke('designs:load', id),
  designsSave: (id, payload) => ipcRenderer.invoke('designs:save', id, payload),
  designsDelete: (id) => ipcRenderer.invoke('designs:delete', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  claudeStatus: () => ipcRenderer.invoke('claude:status'),
  claudeRun: (req) => ipcRenderer.invoke('claude:run', req),
  claudeCancel: () => ipcRenderer.invoke('claude:cancel'),
  setDirty: (d) => ipcRenderer.send('app:dirty', d),
  setTitle: (t) => ipcRenderer.send('app:title', t),
  setTheme: (t) => ipcRenderer.send('app:theme', t),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd))
});
