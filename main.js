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

    // 창 닫기 전 저장 확인
    let forceClose = false;
    mainWindow.on('close', (event) => {
        if (forceClose) return; // 사용자가 확인 후 종료 허용
        event.preventDefault();
        mainWindow.webContents.send('app:before-close');
    });

    ipcMain.on('app:close-confirmed', () => {
        forceClose = true;
        mainWindow.close();
    });

    ipcMain.on('app:close-cancelled', () => {
        // 사용자가 취소 — 아무것도 안 함
    });
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

// ── 경로 안전성 검증 (상위 이동, 제어문자 금지) ──
function safeRel(rel) {
    const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleaned) return '';
    const segs = cleaned.split('/');
    for (const s of segs) {
        if (!s || s === '..' || s === '.' || /[<>:"|?*\x00-\x1f]/.test(s)) {
            throw new Error('잘못된 경로: ' + rel);
        }
    }
    return segs.join('/');
}

// 트리 빌드 공통 (세션/양식)
// type: 'session' | 'template'
function buildTree(rootPath, type) {
    const walk = (absDir, relDir) => {
        const items = [];
        let entries = [];
        try { entries = fs.readdirSync(absDir); } catch { return items; }
        for (const name of entries) {
            if (name.startsWith('_') || name === '.group') continue;
            const abs = path.join(absDir, name);
            let st; try { st = fs.statSync(abs); } catch { continue; }
            const rel = relDir ? (relDir + '/' + name) : name;

            if (st.isDirectory()) {
                // 세션: 디렉토리가 세션인지(name.json 존재) 혹은 그룹인지(.group 또는 기타) 판별
                if (type === 'session') {
                    const jsonA = path.join(abs, name + '.json');
                    const jsonB = path.join(abs, 'session.json');
                    if (fs.existsSync(jsonA) || fs.existsSync(jsonB)) {
                        // 세션 폴더
                        let meta = { name };
                        try {
                            const j = fs.existsSync(jsonA) ? jsonA : jsonB;
                            const d = JSON.parse(fs.readFileSync(j, 'utf-8'));
                            meta.lastUsedAt = d.savedAt || '';
                            meta.subjectCount = (d.subjects || []).length;
                            meta.studentCount = (d.students || []).length;
                            meta.imageCount = d.imageCount || 0;
                            meta.examName = d.examName || null;
                            meta.examDate = d.examDate || null;
                            meta.isTemplateMode = !!d.isTemplateMode;
                        } catch {}
                        items.push({ type: 'session', name, path: rel, meta, mtime: st.mtimeMs });
                    } else {
                        // 그룹 폴더
                        items.push({
                            type: 'folder', name, path: rel, mtime: st.mtimeMs,
                            children: walk(abs, rel)
                        });
                    }
                } else {
                    // 양식: 디렉토리는 그룹 폴더
                    items.push({
                        type: 'folder', name, path: rel, mtime: st.mtimeMs,
                        children: walk(abs, rel)
                    });
                }
            } else if (type === 'template' && /\.json$/i.test(name)) {
                // 양식 파일
                let meta = {};
                try {
                    const d = JSON.parse(fs.readFileSync(abs, 'utf-8'));
                    meta.savedAt = d.savedAt || '';
                    meta.roiCount = (d.rois || []).length;
                    meta.intensity = d.intensity || null;
                } catch {}
                items.push({
                    type: 'template',
                    name: name.replace(/\.json$/i, ''),
                    path: rel, meta, mtime: st.mtimeMs, size: st.size
                });
            }
        }
        return items;
    };
    return walk(rootPath, '');
}

// 그룹(디렉토리) 생성 — 세션/양식 공용
async function createGroupImpl(rootPath, rel, isSession) {
    const clean = safeRel(rel);
    const abs = path.join(rootPath, clean);
    if (fs.existsSync(abs)) throw new Error('이미 존재합니다');
    fs.mkdirSync(abs, { recursive: true });
    // 세션 루트 밑의 그룹임을 표시 (name.json과 혼동 방지)
    if (isSession) fs.writeFileSync(path.join(abs, '.group'), '', 'utf-8');
    return { success: true, path: clean };
}

// 이동 (원자적 rename)
async function moveImpl(rootPath, srcRel, destRel) {
    const src = path.join(rootPath, safeRel(srcRel));
    const dest = path.join(rootPath, safeRel(destRel));
    if (!fs.existsSync(src)) throw new Error('원본 없음');
    if (fs.existsSync(dest)) throw new Error('대상이 이미 존재합니다');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return { success: true };
}

// 휴지통으로 이동 (공용)
async function trashImpl(rootPath, rel) {
    const src = path.join(rootPath, safeRel(rel));
    if (!fs.existsSync(src)) throw new Error('대상 없음');
    const trashDir = path.join(getAppDataPath(), '_trash');
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
    const base = path.basename(src);
    const dest = path.join(trashDir, `${base}_${Date.now()}`);
    fs.renameSync(src, dest);
    return { success: true };
}

// 세션 저장 (JSON + 이미지) — sessionName은 relPath (그룹/세션명 또는 세션명)
ipcMain.handle('session:save', async (event, sessionName, data, images) => {
    try {
        const relClean = safeRel(sessionName);
        const sessionDir = path.join(getSessionsPath(), relClean);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

        // 세션 JSON (파일명 = 세션 폴더 basename + .json)
        const baseName = path.basename(relClean);
        const filePath = path.join(sessionDir, baseName + '.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

        // images === null 이면 이미지 파일 영역은 건드리지 않음 (메타만 저장)
        if (images === null || images === undefined) {
            return { success: true, path: filePath };
        }

        // 이미지 저장
        if (images && images.length > 0) {
            const imgDir = path.join(sessionDir, 'images');
            if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

            // 새 저장에 포함될 파일명 집합
            const keepSet = new Set(
                images
                    .filter(i => i && i.filename)
                    .map(i => i.filename.replace(/[\\/:*?"<>|]/g, '_'))
            );

            // 이전에 있던 파일 중 이번 저장에 없는 것은 삭제 (렌이밍/삭제 반영)
            try {
                fs.readdirSync(imgDir).forEach(f => {
                    if (!keepSet.has(f)) {
                        try { fs.unlinkSync(path.join(imgDir, f)); } catch (_) {}
                    }
                });
            } catch (_) {}

            images.forEach(img => {
                if (img.dataUrl && img.filename) {
                    // base64 → 파일
                    const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
                    const filename = img.filename.replace(/[\\/:*?"<>|]/g, '_');
                    fs.writeFileSync(path.join(imgDir, filename), Buffer.from(base64, 'base64'));
                }
            });
        }

        return { success: true, path: filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 세션 로드 (JSON + 이미지 목록) — relPath 지원
ipcMain.handle('session:load', async (event, sessionName) => {
    try {
        const relClean = safeRel(sessionName);
        const sessionDir = path.join(getSessionsPath(), relClean);
        const baseName = path.basename(relClean);
        // {세션명}.json 우선, 없으면 session.json (하위호환)
        let filePath = path.join(sessionDir, baseName + '.json');
        if (!fs.existsSync(filePath)) filePath = path.join(sessionDir, 'session.json');
        if (!fs.existsSync(filePath)) return { success: false, error: '파일 없음' };

        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);

        // 이미지 파일 목록 로드
        const imgDir = path.join(sessionDir, 'images');
        let imageFiles = [];
        if (fs.existsSync(imgDir)) {
            imageFiles = fs.readdirSync(imgDir)
                .filter(f => /\.(jpg|jpeg|png|bmp|gif|webp)$/i.test(f))
                .map(f => ({
                    filename: f,
                    path: path.join(imgDir, f),
                    // file:// URL로 변환 (렌더러에서 로드 가능)
                    url: 'file:///' + path.join(imgDir, f).replace(/\\/g, '/')
                }));
        }

        return { success: true, data, imageFiles };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 세션 목록 (최상위의 실제 세션만, 그룹 폴더 제외)
ipcMain.handle('session:list', async () => {
    try {
        const sessionsDir = getSessionsPath();
        const dirs = fs.readdirSync(sessionsDir).filter(d => {
            if (d.startsWith('_') || d === '.group') return false;
            const abs = path.join(sessionsDir, d);
            return fs.statSync(abs).isDirectory();
        });
        const sessions = [];
        dirs.forEach(d => {
            let jsonPath = path.join(sessionsDir, d, d + '.json');
            if (!fs.existsSync(jsonPath)) jsonPath = path.join(sessionsDir, d, 'session.json');
            // 세션 JSON이 없으면 그룹 폴더로 간주 → 제외
            if (!fs.existsSync(jsonPath)) return;
            const meta = { name: d };
            try {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                meta.lastUsedAt = data.savedAt || '';
                meta.subjectCount = (data.subjects || []).length;
                meta.studentCount = (data.students || []).length;
                meta.imageCount = data.imageCount || 0;
            } catch (e) {}
            sessions.push(meta);
        });
        return sessions;
    } catch (e) { return []; }
});

// 세션 삭제 (휴지통으로 이동) — relPath 지원
ipcMain.handle('session:delete', async (event, sessionName) => {
    try {
        const clean = safeRel(sessionName);
        return await trashImpl(getSessionsPath(), clean);
    } catch (e) { return { success: false, error: e.message }; }
});

// 분석 로그 파일 저장
ipcMain.handle('app:saveLog', async (_e, text) => {
    try {
        const { dialog } = require('electron');
        const result = await dialog.showSaveDialog(mainWindow, {
            title: '분석 로그 저장',
            defaultPath: `분석로그_${new Date().toISOString().slice(0, 10)}.txt`,
            filters: [{ name: 'Text', extensions: ['txt'] }],
        });
        if (result.canceled || !result.filePath) return { success: false };
        fs.writeFileSync(result.filePath, text, 'utf-8');
        return { success: true, path: result.filePath };
    } catch (e) { return { success: false, error: e.message }; }
});

// 앱 데이터 경로 조회
ipcMain.handle('app:getDataPath', async () => {
    return getAppDataPath();
});

// ==========================================
// 세션: 그룹 / 이동 / 이름변경 / 트리
// ==========================================
ipcMain.handle('session:tree', async () => {
    try { return { success: true, tree: buildTree(getSessionsPath(), 'session') }; }
    catch (e) { return { success: false, error: e.message, tree: [] }; }
});

ipcMain.handle('session:createGroup', async (_e, rel) => {
    try { return await createGroupImpl(getSessionsPath(), rel, true); }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('session:move', async (_e, srcRel, destRel) => {
    try { return await moveImpl(getSessionsPath(), srcRel, destRel); }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('session:rename', async (_e, oldRel, newRel) => {
    try {
        const root = getSessionsPath();
        const src = path.join(root, safeRel(oldRel));
        const dest = path.join(root, safeRel(newRel));
        if (!fs.existsSync(src)) throw new Error('원본 없음');
        if (fs.existsSync(dest)) throw new Error('대상이 이미 존재합니다');

        // 세션 폴더 rename: 내부 {oldName}.json → {newName}.json 도 갱신
        const oldBase = path.basename(src);
        const newBase = path.basename(dest);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(src, dest);

        const oldJson = path.join(dest, oldBase + '.json');
        const newJson = path.join(dest, newBase + '.json');
        if (fs.existsSync(oldJson) && oldBase !== newBase) {
            fs.renameSync(oldJson, newJson);
            try {
                const d = JSON.parse(fs.readFileSync(newJson, 'utf-8'));
                d.sessionName = newBase;
                fs.writeFileSync(newJson, JSON.stringify(d, null, 2), 'utf-8');
            } catch {}
        }
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

// ==========================================
// 양식(Template): 저장 / 로드 / 트리 / 그룹 / 이동 / 이름변경 / 삭제
// ==========================================
ipcMain.handle('template:save', async (_e, rel, data) => {
    try {
        const root = getTemplatesPath();
        const clean = safeRel(rel.endsWith('.json') ? rel : rel + '.json');
        const abs = path.join(root, clean);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true, path: clean };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('template:load', async (_e, rel) => {
    try {
        const root = getTemplatesPath();
        const clean = safeRel(rel.endsWith('.json') ? rel : rel + '.json');
        const abs = path.join(root, clean);
        if (!fs.existsSync(abs)) return { success: false, error: '파일 없음' };
        const data = JSON.parse(fs.readFileSync(abs, 'utf-8'));
        return { success: true, data };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('template:tree', async () => {
    try { return { success: true, tree: buildTree(getTemplatesPath(), 'template') }; }
    catch (e) { return { success: false, error: e.message, tree: [] }; }
});

ipcMain.handle('template:createGroup', async (_e, rel) => {
    try { return await createGroupImpl(getTemplatesPath(), rel, false); }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('template:move', async (_e, srcRel, destRel) => {
    try {
        const root = getTemplatesPath();
        // 양식 파일은 .json 확장자 — src가 파일이면 dest도 .json 붙여줌
        const s = safeRel(srcRel.endsWith('.json') ? srcRel : srcRel + '.json');
        let d = safeRel(destRel);
        const srcAbs = path.join(root, s);
        if (!fs.existsSync(srcAbs)) throw new Error('원본 없음');
        if (fs.statSync(srcAbs).isFile() && !d.endsWith('.json')) d += '.json';
        return await moveImpl(root, s, d);
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('template:rename', async (_e, oldRel, newRel) => {
    try {
        const root = getTemplatesPath();
        const o = safeRel(oldRel.endsWith('.json') ? oldRel : oldRel + '.json');
        let n = safeRel(newRel);
        const srcAbs = path.join(root, o);
        if (!fs.existsSync(srcAbs)) throw new Error('원본 없음');
        if (fs.statSync(srcAbs).isFile() && !n.endsWith('.json')) n += '.json';
        return await moveImpl(root, o, n);
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('template:delete', async (_e, rel) => {
    try {
        const clean = safeRel(rel.endsWith('.json') ? rel : rel + '.json');
        return await trashImpl(getTemplatesPath(), clean);
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('template:deleteGroup', async (_e, rel) => {
    try { return await trashImpl(getTemplatesPath(), rel); }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('session:deleteGroup', async (_e, rel) => {
    try { return await trashImpl(getSessionsPath(), rel); }
    catch (e) { return { success: false, error: e.message }; }
});
