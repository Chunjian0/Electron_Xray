const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startXray: (cfg) => ipcRenderer.invoke('xray-start', cfg),
  stopXray: () => ipcRenderer.invoke('xray-stop'),
  getVersion: () => ipcRenderer.invoke('get-version')
});


(() => {
  try {
    const savedTheme = localStorage.getItem('theme') || 'auto';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const finalTheme = savedTheme === 'auto'
      ? (prefersDark ? 'dark' : 'light')
      : savedTheme;

    if (finalTheme === 'dark') {
      document.documentElement.classList.add('dark-theme');
    }
  } catch (err) {
    console.error('[preload.js] Theme preload error:', err);
  }
})();
