const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(웹페이지)에서 사용할 수 있는 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 세션
    saveSession: (name, data) => ipcRenderer.invoke('session:save', name, data),
    loadSession: (name) => ipcRenderer.invoke('session:load', name),
    listSessions: () => ipcRenderer.invoke('session:list'),
    deleteSession: (name) => ipcRenderer.invoke('session:delete', name),

    // 앱 정보
    getDataPath: () => ipcRenderer.invoke('app:getDataPath'),

    // Electron 환경 여부
    isElectron: true,
});
