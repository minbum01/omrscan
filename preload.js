const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(웹페이지)에서 사용할 수 있는 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 세션
    saveSession:   (name, data, images) => ipcRenderer.invoke('session:save', name, data, images),
    loadSession:   (name) => ipcRenderer.invoke('session:load', name),
    listSessions:  () => ipcRenderer.invoke('session:list'),
    deleteSession: (name) => ipcRenderer.invoke('session:delete', name),

    // 세션 트리/그룹/이동/이름변경
    sessionTree:        () => ipcRenderer.invoke('session:tree'),
    sessionCreateGroup: (rel) => ipcRenderer.invoke('session:createGroup', rel),
    sessionMove:        (src, dest) => ipcRenderer.invoke('session:move', src, dest),
    sessionRename:      (oldRel, newRel) => ipcRenderer.invoke('session:rename', oldRel, newRel),
    sessionDeleteGroup: (rel) => ipcRenderer.invoke('session:deleteGroup', rel),

    // 양식(Template)
    saveTemplate:        (rel, data) => ipcRenderer.invoke('template:save', rel, data),
    loadTemplate:        (rel) => ipcRenderer.invoke('template:load', rel),
    templateTree:        () => ipcRenderer.invoke('template:tree'),
    templateCreateGroup: (rel) => ipcRenderer.invoke('template:createGroup', rel),
    templateMove:        (src, dest) => ipcRenderer.invoke('template:move', src, dest),
    templateRename:      (oldRel, newRel) => ipcRenderer.invoke('template:rename', oldRel, newRel),
    templateDelete:      (rel) => ipcRenderer.invoke('template:delete', rel),
    templateDeleteGroup: (rel) => ipcRenderer.invoke('template:deleteGroup', rel),

    // 앱 정보
    getDataPath: () => ipcRenderer.invoke('app:getDataPath'),
    saveLog: (text) => ipcRenderer.invoke('app:saveLog', text),
    saveReport: (sessionName, html) => ipcRenderer.invoke('app:saveReport', sessionName, html),

    // 앱 종료 관련
    onBeforeClose: (callback) => ipcRenderer.on('app:before-close', callback),
    confirmClose:  () => ipcRenderer.send('app:close-confirmed'),
    cancelClose:   () => ipcRenderer.send('app:close-cancelled'),

    // Electron 환경 여부
    isElectron: true,
});
