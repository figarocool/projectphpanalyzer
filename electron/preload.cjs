const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
  analyzeProject: (projectPath) => ipcRenderer.invoke('analyze:project', projectPath),
  readResult: (resultFile) => ipcRenderer.invoke('analyze:readResult', resultFile),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  logToFile: (msg) => {
    try {
      require('fs').appendFileSync('/tmp/electron-analyzer.log', new Date().toISOString() + ' [RENDERER] ' + msg + '\n')
    } catch (_) {}
  },
  historyList: () => ipcRenderer.invoke('history:list'),
  loadCached: (projectPath) => ipcRenderer.invoke('history:loadCached', projectPath),
  historyDelete: (projectPath) => ipcRenderer.invoke('history:delete', projectPath),
  cleanupScan: (projectPath) => ipcRenderer.invoke('cleanup:scan', projectPath),
  cleanupDelete: (projectPath, files) => ipcRenderer.invoke('cleanup:backupAndDelete', projectPath, files),
  backupList: (projectPath) => ipcRenderer.invoke('backup:list', projectPath),
  backupRestore: (backupId, files) => ipcRenderer.invoke('backup:restore', backupId, files),
  onProgress: (callback) => {
    ipcRenderer.on('analysis:progress', (_event, pct) => callback(pct))
  },
  computeLayout: (graphData) => ipcRenderer.invoke('layout:compute', graphData),
  auditDatabase: (projectPath) => ipcRenderer.invoke('database:audit', projectPath),
  dbCleanup: (projectPath, actions) => ipcRenderer.invoke('db:cleanup', projectPath, actions),
  fileRead: (filePath) => ipcRenderer.invoke('file:read', filePath),
  fileSave: (filePath, content) => ipcRenderer.invoke('file:save', filePath, content),
  sqliteSchema: (dbPath) => ipcRenderer.invoke('sqlite:schema', dbPath),
})
