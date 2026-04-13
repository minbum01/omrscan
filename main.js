const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: 'OMR 채점 시스템',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');

    // 개발자 모드에서 DevTools 자동 열기
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ==========================================
// 파일 시스템 API (세션/양식 저장/로드)
// ==========================================

// 앱 데이터 폴더
function getAppDataPath() {
    const appData = app.getPath('userData');
    const omrPath = path.join(appData, 'OMR_Data');
    if (!fs.existsSync(omrPath)) fs.mkdirSync(omrPath, { recursive: true });
    return omrPath;
}

function getSessionsPath() {
    const p = path.join(getAppDataPath(), 'sessions');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
}

function getTemplatesPath() {
    const p = path.join(getAppDataPath(), 'templates');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
}

// 세션 저장
ipcMain.handle('session:save', async (event, sessionName, data) => {
    try {
        const sessionDir = path.join(getSessionsPath(), sessionName);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        const filePath = path.join(sessionDir, 'session.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true, path: filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 세션 로드
ipcMain.handle('session:load', async (event, sessionName) => {
    try {
        const filePath = path.join(getSessionsPath(), sessionName, 'session.json');
        if (!fs.existsSync(filePath)) return { success: false, error: '파일 없음' };
        const raw = fs.readFileSync(filePath, 'utf-8');
        return { success: true, data: JSON.parse(raw) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 세션 목록
ipcMain.handle('session:list', async () => {
    try {
        const sessionsDir = getSessionsPath();
        const dirs = fs.readdirSync(sessionsDir).filter(d =>
            fs.statSync(path.join(sessionsDir, d)).isDirectory()
        );
        const sessions = dirs.map(d => {
            const jsonPath = path.join(sessionsDir, d, 'session.json');
            let meta = { name: d };
            if (fs.existsSync(jsonPath)) {
                try {
                    const raw = fs.readFileSync(jsonPath, 'utf-8');
                    const data = JSON.parse(raw);
                    meta.lastUsedAt = data.savedAt || '';
                    meta.subjectCount = (data.subjects || []).length;
                    meta.studentCount = (data.students || []).length;
                    meta.imageCount = data.imageCount || 0;
                } catch (e) {}
            }
            return meta;
        });
        return sessions;
    } catch (e) {
        return [];
    }
});

// 세션 삭제 (휴지통으로 이동)
ipcMain.handle('session:delete', async (event, sessionName) => {
    try {
        const sessionDir = path.join(getSessionsPath(), sessionName);
        const trashDir = path.join(getAppDataPath(), '_trash');
        if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
        const dest = path.join(trashDir, sessionName + '_' + Date.now());
        fs.renameSync(sessionDir, dest);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 앱 데이터 경로 조회
ipcMain.handle('app:getDataPath', async () => {
    return getAppDataPath();
});
