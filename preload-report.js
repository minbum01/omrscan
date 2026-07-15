const { contextBridge, ipcRenderer } = require('electron');

// 채점/결과 새창(보기 전용)에서 사용할 수 있는 API — 메인 창의 preload보다 훨씬 좁은 권한
contextBridge.exposeInMainWorld('reportAPI', {
    onContent: (callback) => ipcRenderer.on('report:content', (_e, html) => callback(html)),
    navigate:  (payload) => ipcRenderer.send('report:navigate', payload),
});
