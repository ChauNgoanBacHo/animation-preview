import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spinePreview', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-spine-folder', folderPath),
  selectSoundFolder: () => ipcRenderer.invoke('select-sound-folder'),
  scanSoundFolder: (folderPath) => ipcRenderer.invoke('scan-sound-folder', folderPath),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  saveBatchSpineExport: (payload) => ipcRenderer.invoke('save-batch-spine-export', payload),
});
