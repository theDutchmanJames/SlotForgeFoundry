'use strict';
// Runs in the sandboxed page before Foundry's own code. It offers only the
// update check (Settings → Updates and the update window); no file access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'slotforgeDesktop',
  Object.freeze({
    desktop: true,
    platform: process.platform,
    // Update check; resolves to { ok, value } or { error }.
    updateCheck: (action, payload) => ipcRenderer.invoke('update:action', String(action), payload),
    onUpdateChange: callback => ipcRenderer.on('update:changed', () => callback()),
  }),
);
