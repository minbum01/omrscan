// ============================================
// session.js - 세션 관리
// Electron: 파일 시스템 (userData/OMR_Data/sessions/)
// 웹: localStorage 폴백
// ============================================

const SessionManager = {
    STORAGE_PREFIX: 'omr_session_',
    LIST_KEY: 'omr_session_list',
    CURRENT_KEY: 'omr_current_session',

    currentSessionName: null,
    _hasUnsavedChanges: false,

    // Electron 환경 여부
    get isElectron() {
        return typeof window !== 'undefined' && window.electronAPI && window.electronAPI.isElectron;
    },

    init() {
        // 기존 버튼 이벤트 (있으면)
        const btnSave = document.getElementById('btn-save-session');
        const btnLoad = document.getElementById('btn-load-session');
        if (btnSave) btnSave.addEventListener('click', () => this.saveCurrentSession());
        if (btnLoad) btnLoad.addEventListener('click', () => this.showStartScreen());

        // 프로그램 시작 시 세션 선택 화면
        this.showStartScreen();
    },

    markDirty() { this._hasUnsavedChanges = true; },

    // ==========================================
    // 시작 화면
    // ==========================================
    async showStartScreen() {
        const sessions = await this._getSessionList();

        const overlay = document.createElement('div');
        overlay.id = 'session-start-screen';
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '10000';
        overlay.innerHTML = `
            <div class="modal" style="width:480px;">
                <div class="modal-header">
                    <h2>OMR 채점 시스템</h2>
                    <p>시험 세션을 선택하거나 새로 만드세요.</p>
                </div>
                <div class="modal-body" style="max-height:50vh; overflow-y:auto;">
                    <div style="margin-bottom:12px;">
                        <button class="btn btn-primary" style="width:100%; padding:10px; font-size:14px;"
                            onclick="SessionManager.createNewSession()">+ 새 세션 만들기</button>
                    </div>
                    ${sessions.length > 0 ? sessions.map(s => `
                        <div style="display:flex; align-items:center; gap:8px; padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:4px; cursor:pointer;"
                            onclick="SessionManager.loadSession('${s.name.replace(/'/g, "\\'")}')">
                            <div style="flex:1;">
                                <div style="font-size:13px; font-weight:600;">${s.name}</div>
                                <div style="font-size:10px; color:var(--text-muted);">
                                    ${s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString('ko-KR') : ''}
                                    ${s.subjectCount ? ' · 과목 ' + s.subjectCount + '개' : ''}
                                    ${s.imageCount ? ' · 이미지 ' + s.imageCount + '장' : ''}
                                </div>
                            </div>
                            <button class="roi-delete-btn" title="삭제" style="font-size:10px;"
                                onclick="event.stopPropagation(); SessionManager.deleteSession('${s.name.replace(/'/g, "\\'")}')">✕</button>
                        </div>
                    `).join('') : '<div style="text-align:center; padding:20px; color:var(--text-muted);">저장된 세션이 없습니다.</div>'}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    },

    // ==========================================
    // 세션 생성
    // ==========================================
    createNewSession() {
        // Electron에서 prompt() 안 되므로 커스텀 입력
        const startScreen = document.getElementById('session-start-screen');
        const modalBody = startScreen ? startScreen.querySelector('.modal-body') : null;
        if (!modalBody) return;

        // 입력 UI 삽입
        const existing = document.getElementById('new-session-input-area');
        if (existing) { existing.querySelector('input').focus(); return; }

        const div = document.createElement('div');
        div.id = 'new-session-input-area';
        div.style.cssText = 'padding:12px; border:2px solid var(--blue); border-radius:8px; margin-bottom:12px; background:var(--blue-light);';
        div.innerHTML = `
            <div style="font-size:12px; font-weight:600; margin-bottom:6px;">세션 이름 입력</div>
            <div style="display:flex; gap:6px;">
                <input type="text" id="new-session-name" placeholder="예: 2026년 1회 모의고사"
                    style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:14px;">
                <button class="btn btn-primary btn-sm" onclick="SessionManager._confirmNewSession()">생성</button>
                <button class="btn btn-sm" onclick="document.getElementById('new-session-input-area').remove()">취소</button>
            </div>
        `;
        modalBody.insertBefore(div, modalBody.firstChild.nextSibling);

        const input = document.getElementById('new-session-name');
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') SessionManager._confirmNewSession();
            if (e.key === 'Escape') div.remove();
        });
    },

    _confirmNewSession() {
        const input = document.getElementById('new-session-name');
        if (!input) return;
        const name = input.value.trim();
        if (!name) { Toast.error('세션 이름을 입력하세요'); input.focus(); return; }

        this._closeStartScreen();
        this.currentSessionName = name;
        this._hasUnsavedChanges = false;

        // 상태 초기화
        App.state.subjects = [];
        App.state.students = [];
        App.state.matchFields = { name: true, birth: false, examNo: false, phone: false };
        App.state.images = [];
        App.state.currentIndex = -1;
        App.state.answerKey = null;

        if (!this.isElectron) {
            localStorage.setItem(this.CURRENT_KEY, name);
            this._updateSessionMeta(name, {
                createdAt: new Date().toISOString(),
                lastUsedAt: new Date().toISOString(),
            });
        }

        this._updateHeader();
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof UI !== 'undefined') UI.updateRightPanel();
        Toast.success(`세션 "${name}" 생성됨`);
    },

    // ==========================================
    // 세션 로드
    // ==========================================
    async loadSession(name) {
        if (this._hasUnsavedChanges) {
            if (!confirm('저장하지 않은 변경사항이 있습니다.\n세션을 전환하시겠습니까?')) return;
        }
        this._closeStartScreen();

        try {
            let data = null;

            let imageFiles = [];
            if (this.isElectron) {
                const result = await window.electronAPI.loadSession(name);
                if (result.success) {
                    data = result.data;
                    imageFiles = result.imageFiles || [];
                }
            } else {
                const raw = localStorage.getItem(this.STORAGE_PREFIX + name);
                if (raw) data = JSON.parse(raw);
            }

            if (!data) {
                this.currentSessionName = name;
                App.state.subjects = [];
                App.state.students = [];
                App.state.images = [];
                App.state.currentIndex = -1;
                this._hasUnsavedChanges = false;
                this._updateHeader();
                Toast.info(`세션 "${name}" (새 세션)`);
                return;
            }

            App.state.subjects = data.subjects || [];
            App.state.students = data.students || [];
            App.state.matchFields = data.matchFields || { name: true, birth: false, examNo: false, phone: false };
            App.state.answerKey = data.answerKey || null;
            App.state.images = [];
            App.state.currentIndex = -1;

            this.currentSessionName = name;
            this._hasUnsavedChanges = false;
            this._updateHeader();

            // 이미지 자동 로드 (Electron)
            if (imageFiles.length > 0) {
                Toast.info(`이미지 ${imageFiles.length}장 로딩 중...`);
                let loaded = 0;
                imageFiles.forEach((imgFile, idx) => {
                    const img = new Image();
                    img.onload = () => {
                        const thumb = typeof ImageManager !== 'undefined' ? ImageManager.createThumbnail(img) : null;
                        // ROI 설정 복원 (저장된 imageResults에서)
                        const savedResult = data.imageResults && data.imageResults[idx] ? data.imageResults[idx] : null;
                        App.state.images.push({
                            name: imgFile.filename,
                            _originalName: imgFile.filename,
                            imgElement: img,
                            thumb,
                            rois: savedResult ? savedResult.rois.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, settings: r.settings ? { ...r.settings } : null })) : [],
                            results: null,
                            gradeResult: savedResult ? savedResult.gradeResult : null,
                        });
                        loaded++;
                        if (loaded === imageFiles.length) {
                            if (typeof ImageManager !== 'undefined') {
                                ImageManager.updateList();
                                if (App.state.images.length > 0) ImageManager.select(0);
                            }
                            if (typeof UI !== 'undefined') UI.updateRightPanel();
                            Toast.success(`세션 "${name}" 로드 완료 (${loaded}장)`);
                        }
                    };
                    img.onerror = () => {
                        loaded++;
                        console.warn(`이미지 로드 실패: ${imgFile.filename}`);
                    };
                    img.src = imgFile.url;
                });
            } else {
                if (typeof ImageManager !== 'undefined') ImageManager.updateList();
                if (typeof UI !== 'undefined') UI.updateRightPanel();
                const imgCount = data.imageCount || 0;
                Toast.success(`세션 "${name}" 로드됨${imgCount > 0 ? ` (이미지 재업로드 필요)` : ''}`);
            }
        } catch (e) {
            console.error('세션 로드 실패:', e);
            Toast.error('세션 로드 실패: ' + e.message);
        }
    },

    // ==========================================
    // 세션 저장
    // ==========================================
    async saveCurrentSession() {
        if (!this.currentSessionName) {
            Toast.error('세션을 먼저 생성하세요');
            return;
        }

        const name = this.currentSessionName;
        const data = {
            sessionName: name,
            version: 1,
            savedAt: new Date().toISOString(),
            subjects: App.state.subjects || [],
            students: App.state.students || [],
            matchFields: App.state.matchFields || {},
            answerKey: App.state.answerKey || null,
            imageCount: (App.state.images || []).length,
            imageResults: (App.state.images || []).map(img => ({
                filename: img.name || '',
                rois: (img.rois || []).map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, settings: r.settings })),
                gradeResult: img.gradeResult || null,
            })),
        };

        try {
            if (this.isElectron) {
                // 이미지 데이터 추출 (base64)
                const imageDataArr = (App.state.images || []).map(img => {
                    try {
                        const c = document.createElement('canvas');
                        c.width = img.imgElement.naturalWidth || img.imgElement.width;
                        c.height = img.imgElement.naturalHeight || img.imgElement.height;
                        c.getContext('2d').drawImage(img.imgElement, 0, 0);
                        return {
                            filename: img._originalName || img.name || `image_${Date.now()}.jpg`,
                            dataUrl: c.toDataURL('image/jpeg', 0.9)
                        };
                    } catch (e) { return null; }
                }).filter(Boolean);

                const result = await window.electronAPI.saveSession(name, data, imageDataArr);
                if (!result.success) throw new Error(result.error);
                console.log(`[세션] 파일 저장: ${result.path} (이미지 ${imageDataArr.length}장)`);
            } else {
                localStorage.setItem(this.STORAGE_PREFIX + name, JSON.stringify(data));
                this._updateSessionMeta(name, {
                    lastUsedAt: new Date().toISOString(),
                    subjectCount: (data.subjects || []).length,
                    studentCount: (data.students || []).length,
                    imageCount: data.imageCount,
                });
            }
            this._hasUnsavedChanges = false;
            this._updateHeader();
            Toast.success(`세션 "${name}" 저장 완료`);
        } catch (e) {
            Toast.error('세션 저장 실패: ' + e.message);
        }
    },

    // ==========================================
    // 세션 삭제 (소프트 — 목록에서만 숨김, 데이터 보존)
    // ==========================================
    async deleteSession(name) {
        if (!confirm(`"${name}" 세션을 삭제하시겠습니까?`)) return;

        if (this.isElectron) {
            await window.electronAPI.deleteSession(name);
        } else {
            this._updateSessionMeta(name, { deleted: true, deletedAt: new Date().toISOString() });
        }

        if (this.currentSessionName === name) {
            this.currentSessionName = null;
            this._hasUnsavedChanges = false;
        }
        this._closeStartScreen();
        this.showStartScreen();
        Toast.info(`"${name}" 삭제됨`);
    },

    // ==========================================
    // 세션 목록
    // ==========================================
    async _getSessionList() {
        if (this.isElectron) {
            return await window.electronAPI.listSessions();
        }
        return this.getSessionList().filter(s => !s.deleted);
    },

    getSessionList() {
        try {
            const raw = localStorage.getItem(this.LIST_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    },

    _updateSessionMeta(name, updates) {
        const list = this.getSessionList();
        let entry = list.find(s => s.name === name);
        if (!entry) { entry = { name }; list.push(entry); }
        Object.assign(entry, updates);
        localStorage.setItem(this.LIST_KEY, JSON.stringify(list));
    },

    // ==========================================
    // UI 헬퍼
    // ==========================================
    _closeStartScreen() {
        const el = document.getElementById('session-start-screen');
        if (el) el.remove();
    },

    _updateHeader() {
        let el = document.getElementById('session-header-name');
        if (!el) {
            const toolbar = document.querySelector('.toolbar-left');
            if (toolbar) {
                const span = document.createElement('span');
                span.id = 'session-header-name';
                span.style.cssText = 'font-size:12px; color:var(--text-secondary); margin-left:8px; font-weight:600; cursor:pointer;';
                span.onclick = () => this.showStartScreen();
                toolbar.appendChild(span);
            }
            el = document.getElementById('session-header-name');
        }
        if (el) {
            el.textContent = this.currentSessionName
                ? `— ${this.currentSessionName}${this._hasUnsavedChanges ? ' *' : ''}`
                : '';
        }
    }
};
