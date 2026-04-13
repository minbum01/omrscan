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
        const name = prompt('세션 이름을 입력하세요 (예: 2026년 1회 모의고사)');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();

        const sessions = this.getSessionList();
        if (sessions.find(s => s.name === trimmed && !s.deleted)) {
            Toast.error('이미 존재하는 세션 이름입니다.');
            return;
        }

        this._closeStartScreen();
        this.currentSessionName = trimmed;
        this._hasUnsavedChanges = false;

        // 상태 초기화
        App.state.subjects = [];
        App.state.students = [];
        App.state.matchFields = { name: true, birth: false, examNo: false, phone: false };
        App.state.images = [];
        App.state.currentIndex = -1;
        App.state.answerKey = null;

        localStorage.setItem(this.CURRENT_KEY, trimmed);
        this._updateSessionMeta(trimmed, {
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
        });

        this._updateHeader();
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof UI !== 'undefined') UI.updateRightPanel();
        Toast.success(`세션 "${trimmed}" 생성됨`);
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

            if (this.isElectron) {
                const result = await window.electronAPI.loadSession(name);
                if (result.success) data = result.data;
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
            if (typeof ImageManager !== 'undefined') ImageManager.updateList();
            if (typeof UI !== 'undefined') UI.updateRightPanel();

            const imgCount = data.imageCount || 0;
            Toast.success(`세션 "${name}" 로드됨${imgCount > 0 ? ` (이미지 ${imgCount}장 재업로드 필요)` : ''}`);
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
            const name = prompt('세션 이름을 입력하세요');
            if (!name || !name.trim()) return;
            this.currentSessionName = name.trim();
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
                const result = await window.electronAPI.saveSession(name, data);
                if (!result.success) throw new Error(result.error);
                console.log(`[세션] 파일 저장: ${result.path}`);
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
