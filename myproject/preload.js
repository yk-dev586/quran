const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quranAPI', {
  getData: () => ipcRenderer.invoke('app:get-data'),
  getTranslation: code => ipcRenderer.invoke('app:get-translation', code),
  getLanguage: code => ipcRenderer.invoke('app:get-language', code),
  getAudio: (reciter, chapter) => ipcRenderer.invoke('app:get-audio', { reciter, chapter }),
  getAudioCheck: reciter => ipcRenderer.invoke('app:get-audio-check', { reciter }),
  saveState: state => ipcRenderer.invoke('app:save-state', state),
  fetchPrayerMonth: params => ipcRenderer.invoke('app:fetch-prayer-month', params),
  getPrayerMethods: () => ipcRenderer.invoke('app:get-prayer-methods'),
  chooseFont: () => ipcRenderer.invoke('app:choose-font'),
  copyText: text => ipcRenderer.invoke('app:copy-text', text),
  exportState: payload => ipcRenderer.invoke('app:export-state', payload),
  importState: () => ipcRenderer.invoke('app:import-state'),
  openFolder: folder => ipcRenderer.invoke('app:open-folder', folder),
  quit: () => ipcRenderer.send('app:quit')
});
