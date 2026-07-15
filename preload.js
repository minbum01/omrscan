const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(웹페이지)에서 사용할 수 있는 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 세션
    // saveSession의 3번째 인자는 실제 이미지 데이터가 아니라 "이번 세션에 있어야 할 전체 파일명 목록"
    // (정리/cleanup 판단용). 실제 이미지 바이트는 saveSessionImagesChunk로 청크 단위 전송.
    saveSession:            (name, data, expectedFilenames) => ipcRenderer.invoke('session:save', name, data, expectedFilenames),
    saveSessionImagesChunk: (name, images) => ipcRenderer.invoke('session:save-images-chunk', name, images),
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

    // Exam / Session 신모델 (Phase 1-C) — 설계: 참고자료/md/세션병합_데이터모델_설계.md
    listExams:           () => ipcRenderer.invoke('exam:list'),
    loadExam:            (examId) => ipcRenderer.invoke('exam:load', examId),
    saveExam:            (examId, data) => ipcRenderer.invoke('exam:save', examId, data),
    deleteExam:          (examId) => ipcRenderer.invoke('exam:delete', examId),

    listExamSessions:    (examId) => ipcRenderer.invoke('examSession:list', examId),
    loadExamSession:     (examId, sessionId) => ipcRenderer.invoke('examSession:load', examId, sessionId),
    saveExamSession:     (examId, sessionId, data, images) => ipcRenderer.invoke('examSession:save', examId, sessionId, data, images),
    deleteExamSession:   (examId, sessionId) => ipcRenderer.invoke('examSession:delete', examId, sessionId),

    listMergeSnapshots:  (examId) => ipcRenderer.invoke('mergeSnapshot:list', examId),
    saveMergeSnapshot:   (examId, snapId, data) => ipcRenderer.invoke('mergeSnapshot:save', examId, snapId, data),
    loadMergeSnapshot:   (examId, snapId) => ipcRenderer.invoke('mergeSnapshot:load', examId, snapId),
    deleteMergeSnapshot: (examId, snapId) => ipcRenderer.invoke('mergeSnapshot:delete', examId, snapId),

    // 앱 정보
    getDataPath: () => ipcRenderer.invoke('app:getDataPath'),
    saveLog: (text) => ipcRenderer.invoke('app:saveLog', text),
    saveReport: (sessionName, html) => ipcRenderer.invoke('app:saveReport', sessionName, html),

    // 앱 종료 관련
    onBeforeClose: (callback) => ipcRenderer.on('app:before-close', callback),
    confirmClose:  () => ipcRenderer.send('app:close-confirmed'),
    cancelClose:   () => ipcRenderer.send('app:close-cancelled'),

    // 채점/결과 새창 보기 (보기 전용 — 메인 창이 데이터를 밀어주고, 새창의 클릭 요청을 받음)
    openReportWindow:        () => ipcRenderer.send('report:open'),
    updateReportContent:     (html) => ipcRenderer.send('report:updateContent', html),
    onReportNavigateRequest: (callback) => ipcRenderer.on('report:navigateRequest', (_e, payload) => callback(payload)),
    onReportClosed:          (callback) => ipcRenderer.on('report:closed', () => callback()),

    // Electron 환경 여부
    isElectron: true,
});
