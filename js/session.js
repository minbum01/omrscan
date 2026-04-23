// ============================================
// session.js - 세션 관리
// Electron: 파일 시스템 (userData/OMR_Data/sessions/)
// 웹: localStorage 폴백
// ============================================

const SessionManager = {
    STORAGE_PREFIX: 'omr_session_',
    LIST_KEY: 'omr_session_list',
    CURRENT_KEY: 'omr_current_session',

    currentSessionName: null,    // 세션 키 (= examName_examDate)
    currentExamName: null,       // 시험 이름
    currentExamDate: null,       // 시험 일자 (YYYY-MM-DD)
    _hasUnsavedChanges: false,

    _todayStr() {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    },

    // 세션 키가 "시험이름_YYYY-MM-DD" 형식일 경우 파싱
    _parseExamName(sessionName) {
        if (!sessionName) return null;
        const m = sessionName.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
        return m ? m[1] : sessionName;
    },
    _parseExamDate(sessionName) {
        if (!sessionName) return null;
        const m = sessionName.match(/_(\d{4}-\d{2}-\d{2})$/);
        return m ? m[1] : null;
    },

    // Electron 환경 여부
    get isElectron() {
        return typeof window !== 'undefined' && window.electronAPI && window.electronAPI.isElectron;
    },

    init() {
        // 기존 버튼 이벤트 (있으면)
        const btnSave = document.getElementById('btn-save-session');
        const btnSaveAs = document.getElementById('btn-save-session-as');
        const btnLoad = document.getElementById('btn-load-session');
        if (btnSave) btnSave.addEventListener('click', () => this.saveCurrentSession());
        if (btnSaveAs) btnSaveAs.addEventListener('click', () => this.saveCurrentSessionAs());
        if (btnLoad) btnLoad.addEventListener('click', () => this.openLoadBrowser());

        // 양식 다른이름 저장
        const btnTplAs = document.getElementById('btn-save-template-as');
        if (btnTplAs) btnTplAs.addEventListener('click', () => {
            if (typeof TemplateManager !== 'undefined') TemplateManager.saveAs();
        });

        // Electron: 창 닫기 전 저장 확인 리스너
        if (this.isElectron && window.electronAPI.onBeforeClose) {
            window.electronAPI.onBeforeClose(async () => {
                const canClose = await this.checkUnsavedBeforeClose();
                if (canClose) {
                    window.electronAPI.confirmClose();
                } else {
                    window.electronAPI.cancelClose();
                }
            });
        }

        // 웹: 브라우저 탭 닫기 전 경고
        if (!this.isElectron) {
            window.addEventListener('beforeunload', (e) => {
                if (this._hasUnsavedChanges) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        }

        // Electron 모드: 웹 폴백용 localStorage 세션 키 정리 (중복/혼동 방지)
        if (this.isElectron) {
            try {
                const keys = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && (k.startsWith(this.STORAGE_PREFIX) || k === this.LIST_KEY || k === this.CURRENT_KEY)) {
                        keys.push(k);
                    }
                }
                keys.forEach(k => localStorage.removeItem(k));
            } catch (_) {}
        }

        // 프로그램 시작 시 세션 선택 화면
        this.showStartScreen();
    },

    // Electron: FileBrowser로 시험(세션) 불러오기 · fromStart=true면 뒤로가기 활성화
    openLoadBrowser(fromStart) {
        if (this.isElectron && typeof FileBrowser !== 'undefined') {
            FileBrowser.open({
                kind: 'session',
                title: '시험(세션) 불러오기',
                onPick: (relPath) => this.loadSession(relPath),
                onBack: fromStart ? () => this.showStartScreen() : null,
            });
        } else {
            this.showStartScreen();
        }
    },

    // Electron: 양식 불러오기 (편집 모드 — 참조 이미지까지 복원)
    openLoadTemplateBrowser(fromStart) {
        if (!(this.isElectron && typeof FileBrowser !== 'undefined')) {
            this.showStartScreen();
            return;
        }
        FileBrowser.open({
            kind: 'template',
            title: '양식 불러오기 (수정 모드)',
            onPick: async (relPath) => {
                const res = await window.electronAPI.loadTemplate(relPath);
                if (!res.success) { Toast.error('불러오기 실패: ' + (res.error || '')); return; }
                if (typeof TemplateManager !== 'undefined') {
                    TemplateManager._applyTemplateForEdit(res.data, relPath);
                }
            },
            onBack: fromStart ? () => this.showStartScreen() : null,
        });
    },

    markDirty() {
        this._hasUnsavedChanges = true;
        this._updateHeader();
        // 데이터 mutation이 있었으므로 탭 렌더링 캐시 무효화
        if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
    },

    // 메타데이터만 저장 (이미지 base64 직렬화 생략) — CSV 불러오기 등 가벼운 변경용
    // 내부적으로 saveCurrentSession({ metadataOnly: true })을 호출
    async saveMetadataOnly() {
        return this.saveCurrentSession({ metadataOnly: true });
    },

    // 디바운스 저장 — 짧은 시간에 여러 mutation이 겹쳐도 마지막 1번만 저장
    _debouncedSaveTimer: null,
    scheduleMetadataSave(delayMs = 1500) {
        if (this._debouncedSaveTimer) clearTimeout(this._debouncedSaveTimer);
        this._debouncedSaveTimer = setTimeout(() => {
            this._debouncedSaveTimer = null;
            this.saveMetadataOnly();
        }, delayMs);
    },

    // 프로그램 종료 전 저장 확인 — true면 종료 진행, false면 취소
    async checkUnsavedBeforeClose() {
        if (!this._hasUnsavedChanges) return true;
        const choice = await UIDialog.confirmSave('저장하지 않은 변경사항이 있습니다.\n프로그램을 종료하기 전에 저장하시겠습니까?');
        if (choice === 'cancel') return false;
        if (choice === 'save') {
            await this.saveCurrentSession();
        }
        return true;
    },

    // ==========================================
    // 시작 화면
    // ==========================================
    async showStartScreen() {
        const allSessions = await this._getSessionList();
        // 양식은 제외 (양식은 양식끼리만 관리)
        const sessions = allSessions.filter(s => !s.isTemplateMode && !(s.name && s.name.startsWith('[양식]')));

        const overlay = document.createElement('div');
        overlay.id = 'session-start-screen';
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '10000';
        overlay.innerHTML = `
            <div class="modal" style="width:480px;">
                <div class="modal-header">
                    <h2>OMR 채점 시스템</h2>
                    <p>시험(세션)을 선택하거나 새로 만드세요.</p>
                </div>
                <div class="modal-body" style="max-height:50vh; overflow-y:auto;">
                    <div id="session-action-buttons" style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
                        <button class="btn btn-primary" style="padding:10px; font-size:14px;"
                            onclick="SessionManager.createNewSession()">+ 새 시험(세션) 만들기</button>
                        <button class="btn btn-primary" style="padding:10px; font-size:14px;"
                            onclick="SessionManager.createNewTemplate()">+ 양식 만들기</button>
                        <button class="btn" style="padding:9px; font-size:13px;"
                            onclick="SessionManager._closeStartScreen(); SessionManager.openLoadBrowser(true);">
                            📘 시험(세션) 불러오기
                        </button>
                        <button class="btn" style="padding:9px; font-size:13px;"
                            onclick="SessionManager._closeStartScreen(); SessionManager.openLoadTemplateBrowser(true);">
                            📄 양식 불러오기
                        </button>
                    </div>
                    ${sessions.length > 0 ? `<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">최근 세션</div>` : ''}
                    ${sessions.length > 0 ? sessions.slice(0, 3).map(s => `
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
    // 시험(세션) 생성
    // ==========================================
    // 시작 화면의 액션 버튼 행을 입력 영역으로 교체 (취소 시 복원)
    _replaceActionButtons(inputHtml, onEnter) {
        const row = document.getElementById('session-action-buttons');
        if (!row) return null;
        const originalHtml = row.innerHTML;
        const originalStyle = row.getAttribute('style') || '';
        row.setAttribute('data-original-html', originalHtml);
        row.setAttribute('data-original-style', originalStyle);
        row.style.cssText = 'padding:12px; border:2px solid var(--blue); border-radius:8px; margin-bottom:12px; background:var(--blue-light);';
        row.innerHTML = inputHtml;

        const firstInput = row.querySelector('input[type="text"]');
        if (firstInput) {
            firstInput.focus();
            firstInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && typeof onEnter === 'function') onEnter();
                if (e.key === 'Escape') SessionManager._restoreActionButtons();
            });
        }
        return row;
    },

    _restoreActionButtons() {
        const row = document.getElementById('session-action-buttons');
        if (!row) return;
        const html = row.getAttribute('data-original-html');
        const style = row.getAttribute('data-original-style') || '';
        if (html !== null) {
            row.innerHTML = html;
            row.setAttribute('style', style);
            row.removeAttribute('data-original-html');
            row.removeAttribute('data-original-style');
        }
    },

    async createNewSession() {
        // 저장하지 않은 변경사항 확인
        if (this._hasUnsavedChanges) {
            const choice = await UIDialog.confirmSave('저장하지 않은 변경사항이 있습니다.\n새 세션을 만들기 전에 현재 세션을 저장하시겠습니까?');
            if (choice === 'cancel') return;
            if (choice === 'save') {
                await this.saveCurrentSession();
            }
        }

        const today = this._todayStr();

        // Electron: FileBrowser 저장 모드로 경로 선택 + 이름 입력 동시 처리
        if (this.isElectron && typeof FileBrowser !== 'undefined') {
            this._closeStartScreen();
            const nameInputHtml = `
                <div style="margin:12px 16px; padding:14px 16px; display:flex; gap:8px; align-items:flex-end; background:var(--blue-light); border:2px solid var(--blue); border-radius:8px;">
                    <div style="flex:1;">
                        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:3px;">세션명</div>
                        <input type="text" id="fb-session-name" placeholder="예: 2026년 1회 모의고사"
                            style="width:100%; padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; box-sizing:border-box;">
                    </div>
                    <div>
                        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:3px;">시험일자</div>
                        <input type="date" id="fb-session-date" value="${today}"
                            style="padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                    </div>
                    <div>
                        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:3px;">생성일자</div>
                        <input type="date" value="${today}" disabled
                            style="padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; background:var(--bg-input); color:var(--text-muted);">
                    </div>
                    <div style="align-self:flex-end;">
                        <button class="btn btn-primary" onclick="FileBrowser._onSaveClick()" style="padding:7px 16px; font-size:14px; font-weight:700;">저장</button>
                    </div>
                </div>`;
            FileBrowser.openSave({
                kind: 'session',
                title: '새 시험(세션) 만들기 — 저장 위치 선택',
                defaultName: '',
                keepOpenAfterSave: true, // 저장 후 닫지 않음
                onSave: async (relPath) => {
                    const nameEl = document.getElementById('fb-session-name');
                    const dateEl = document.getElementById('fb-session-date');
                    const examName = (nameEl && nameEl.value.trim()) || relPath.split('/').pop().replace(/\.json$/i, '');
                    const examDate = (dateEl && dateEl.value) || today;
                    this._doCreateSession(examName, examDate, relPath);

                    // 파란 입력칸 → 생성 완료 + 시험관리 유도로 교체
                    const extraTop = document.querySelector('#fb-modal .fb-extra-top');
                    if (extraTop) {
                        extraTop.innerHTML = `
                            <div style="margin:12px 16px; padding:14px 16px; background:#f0fdf4; border:2px solid #22c55e; border-radius:8px; display:flex; align-items:center; gap:12px;">
                                <span style="font-size:24px;">✅</span>
                                <div style="flex:1;">
                                    <div style="font-size:14px; font-weight:700; color:#16a34a;">세션 "${examName}" 생성 완료</div>
                                    <div style="font-size:11px; color:var(--text-muted);">시험관리에서 과목/정답/시험인원을 설정하세요.</div>
                                </div>
                                <button class="btn btn-primary" style="padding:8px 16px; font-size:13px; font-weight:700;"
                                    onclick="FileBrowser.close(); setTimeout(()=>{ if(typeof SubjectManager!=='undefined') SubjectManager.openModal(); }, 200);">
                                    📋 시험관리 열기
                                </button>
                                <button class="btn btn-sm" style="padding:8px 12px; font-size:12px;"
                                    onclick="FileBrowser.close();">
                                    나중에 하기
                                </button>
                            </div>
                        `;
                    }
                    // 폴더 목록 새로고침 (방금 만든 세션 표시)
                    if (typeof FileBrowser !== 'undefined' && FileBrowser._state) {
                        FileBrowser._state._tree = null;
                        FileBrowser._loadTree().then(() => {
                            const node = FileBrowser._getNodeAt(FileBrowser._state._tree, FileBrowser._state.currentPath);
                            FileBrowser._renderList(FileBrowser._sortItems((node && node.children) || []));
                        });
                    }
                },
                onBack: () => this.showStartScreen(),
                backLabel: '← 시작 화면',
                extraTopHtml: nameInputHtml,
            });
            setTimeout(() => {
                const nameInput = document.getElementById('fb-session-name');
                if (nameInput) nameInput.focus();
            }, 100);
            return;
        }

        // 웹 폴백: 기존 인라인 입력
        const html = `
            <div style="font-size:12px; font-weight:600; margin-bottom:6px;">시험 이름 · 시험 일자 입력</div>
            <div style="display:flex; gap:6px; align-items:center;">
                <input type="text" id="new-session-name" placeholder="예: 2026년 1회 모의고사"
                    style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:14px;">
                <input type="date" id="new-session-date" value="${today}"
                    style="padding:8px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                <button class="btn btn-primary btn-sm" onclick="SessionManager._confirmNewSession()">생성</button>
                <button class="btn btn-sm" onclick="SessionManager._restoreActionButtons()">취소</button>
            </div>
        `;
        this._replaceActionButtons(html, () => SessionManager._confirmNewSession());
    },

    createNewTemplate() {
        // Electron: FileBrowser 저장 모드로 경로 선택 + 이름 입력 동시 처리
        if (this.isElectron && typeof FileBrowser !== 'undefined') {
            this._closeStartScreen();
            const nameInputHtml = `
                <div style="margin:12px 16px; padding:14px 16px; display:flex; gap:8px; align-items:flex-end; background:var(--blue-light); border:2px solid var(--blue); border-radius:8px;">
                    <div style="flex:1;">
                        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:3px;">양식명</div>
                        <input type="text" id="fb-template-name" placeholder="예: 20문항 5지선다"
                            style="width:100%; padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; box-sizing:border-box;">
                    </div>
                    <div style="align-self:flex-end;">
                        <button class="btn btn-primary" onclick="FileBrowser._onSaveClick()" style="padding:7px 16px; font-size:14px; font-weight:700;">저장</button>
                    </div>
                </div>`;
            FileBrowser.openSave({
                kind: 'template',
                title: '양식 만들기 — 저장 위치 선택',
                defaultName: '',
                keepOpenAfterSave: true,
                onSave: async (relPath) => {
                    const nameEl = document.getElementById('fb-template-name');
                    const tplName = (nameEl && nameEl.value.trim()) || relPath.split('/').pop().replace(/\.json$/i, '');
                    if (typeof TemplateManager !== 'undefined') TemplateManager._lastSavePath = relPath;
                    this._doCreateTemplate(tplName);

                    // 입력칸 → 생성 완료 메시지로 교체
                    const extraTop = document.querySelector('#fb-modal .fb-extra-top');
                    if (extraTop) {
                        extraTop.innerHTML = `
                            <div style="margin:12px 16px; padding:14px 16px; background:#f0fdf4; border:2px solid #22c55e; border-radius:8px; display:flex; align-items:center; gap:12px;">
                                <span style="font-size:24px;">✅</span>
                                <div style="flex:1;">
                                    <div style="font-size:14px; font-weight:700; color:#16a34a;">양식 "${tplName}" 생성 완료</div>
                                    <div style="font-size:11px; color:var(--text-muted);">이미지 업로드 후 영역을 설정하고 "양식 저장"을 누르세요.</div>
                                </div>
                                <button class="btn btn-primary" style="padding:8px 16px; font-size:13px; font-weight:700;"
                                    onclick="FileBrowser.close();">
                                    시작하기
                                </button>
                            </div>
                        `;
                    }
                    // 목록 새로고침
                    if (typeof FileBrowser !== 'undefined' && FileBrowser._state) {
                        FileBrowser._state._tree = null;
                        FileBrowser._loadTree().then(() => {
                            const node = FileBrowser._getNodeAt(FileBrowser._state._tree, FileBrowser._state.currentPath);
                            FileBrowser._renderList(FileBrowser._sortItems((node && node.children) || []));
                        });
                    }
                },
                onBack: () => this.showStartScreen(),
                backLabel: '← 시작 화면',
                extraTopHtml: nameInputHtml,
            });
            setTimeout(() => {
                const nameInput = document.getElementById('fb-template-name');
                if (nameInput) nameInput.focus();
            }, 100);
            return;
        }

        // 웹 폴백: 기존 인라인 입력
        const html = `
            <div style="font-size:12px; font-weight:600; margin-bottom:6px;">양식 이름 입력</div>
            <div style="display:flex; gap:6px; align-items:center;">
                <input type="text" id="new-template-name" placeholder="예: 20문항 5지선다"
                    style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:14px;">
                <button class="btn btn-primary btn-sm" onclick="SessionManager._confirmNewTemplate()">생성</button>
                <button class="btn btn-sm" onclick="SessionManager._restoreActionButtons()">취소</button>
            </div>
        `;
        this._replaceActionButtons(html, () => SessionManager._confirmNewTemplate());
    },

    _confirmNewTemplate() {
        const input = document.getElementById('new-template-name');
        if (!input) return;
        const tplName = input.value.trim();
        if (!tplName) { Toast.error('양식 이름을 입력하세요'); input.focus(); return; }
        this._closeStartScreen();
        this._doCreateTemplate(tplName);
    },

    _doCreateTemplate(tplName) {
        if (!tplName) { Toast.error('양식 이름이 비어있습니다'); return; }
        const today = this._todayStr();
        const name = `[양식]${tplName}_${today}`;

        this.currentSessionName = name;
        this.currentExamName = `[양식] ${tplName}`;
        this.currentExamDate = today;
        this.isTemplateMode = true;
        this._hasUnsavedChanges = false;

        if (typeof ImageManager !== 'undefined') {
            ImageManager.releaseImageResources(App.state.images);
            ImageManager.releaseImageResources(App.state.deletedImages);
        }
        App.state.subjects = [];
        App.state.students = [];
        App.state.matchFields = { name: true, birth: false, examNo: false, phone: false };
        App.state.images = [];
        App.state.deletedImages = [];
        App.state.currentIndex = -1;
        App.state.answerKey = null;

        if (typeof App._initPeriods === 'function') App._initPeriods();
        else App.state.periods = [{ id: 'p1', name: '1교시', images: App.state.images, answerKey: null }];

        this._updateHeader();
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof UI !== 'undefined') UI.updateRightPanel();

        // 즉시 빈 세션 파일 저장
        this.saveCurrentSession().then(() => {
            Toast.success(`양식 "${tplName}" 생성 및 저장됨`);
        }).catch(() => {
            Toast.success(`양식 "${tplName}" 생성됨`);
        });
    },

    _confirmNewSession() {
        const input = document.getElementById('new-session-name');
        const dateInput = document.getElementById('new-session-date');
        if (!input) return;
        const examName = input.value.trim();
        const examDate = (dateInput && dateInput.value) || this._todayStr();
        if (!examName) { Toast.error('시험 이름을 입력하세요'); input.focus(); return; }
        this._closeStartScreen();
        this._doCreateSession(examName, examDate);
    },

    _doCreateSession(examName, examDate, relPath) {
        if (!examName) { Toast.error('시험 이름이 비어있습니다'); return; }
        if (!examDate) examDate = this._todayStr();
        const name = relPath || `${examName}_${examDate}`;

        this.currentSessionName = name;
        this.currentExamName = examName;
        this.currentExamDate = examDate;
        this.isTemplateMode = false;
        this._hasUnsavedChanges = false;

        if (typeof ImageManager !== 'undefined') {
            ImageManager.releaseImageResources(App.state.images);
            ImageManager.releaseImageResources(App.state.deletedImages);
        }
        App.state.subjects = [];
        App.state.students = [];
        App.state.matchFields = { name: true, birth: false, examNo: false, phone: false };
        App.state.images = [];
        App.state.deletedImages = [];
        App.state.currentIndex = -1;
        App.state.answerKey = null;

        if (typeof App._initPeriods === 'function') App._initPeriods();
        else App.state.periods = [{ id: 'p1', name: '1교시', images: App.state.images, answerKey: null }];

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

        // 즉시 빈 세션 파일 저장 (폴더 안에 실제 파일 생성)
        this.saveCurrentSession().then(() => {
            Toast.success(`세션 "${examName}" 생성 및 저장됨`);
        }).catch(() => {
            Toast.success(`세션 "${examName}" 생성됨`);
        });
    },

    // ==========================================
    // 세션 로드
    // ==========================================
    async loadSession(name) {
        if (this._hasUnsavedChanges) {
            const choice = await UIDialog.confirmSave('저장하지 않은 변경사항이 있습니다.\n다른 세션을 불러오기 전에 현재 세션을 저장하시겠습니까?');
            if (choice === 'cancel') return;
            if (choice === 'save') {
                await this.saveCurrentSession();
            }
        }
        this._closeStartScreen();
        this._showProgressOverlay(`세션 "${name}" 불러오는 중...`);

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
                if (typeof ImageManager !== 'undefined') {
                    ImageManager.releaseImageResources(App.state.images);
                    ImageManager.releaseImageResources(App.state.deletedImages);
                }
                this.currentSessionName = name;
                App.state.subjects = [];
                App.state.students = [];
                App.state.images = [];
                App.state.currentIndex = -1;
                this._hasUnsavedChanges = false;
                this._updateHeader();
                this._hideProgressOverlay();
                Toast.info(`세션 "${name}" (새 세션)`);
                return;
            }

            if (typeof ImageManager !== 'undefined') {
                ImageManager.releaseImageResources(App.state.images);
                ImageManager.releaseImageResources(App.state.deletedImages);
            }
            App.state.subjects = data.subjects || [];
            App.state.students = data.students || [];
            App.state.matchFields = data.matchFields || { name: true, birth: false, examNo: false, phone: false };
            App.state.answerKey = data.answerKey || null;
            App.state.images = [];
            App.state.deletedImages = [];
            App.state.currentIndex = -1;

            // 교시 복원 — 반드시 App.state.images = [] 직후에 호출
            // 저장된 periods 배열이 있으면 교시 이름 복원, 없으면 자동 1교시 생성
            if (typeof App._initPeriods === 'function') App._initPeriods(data.periods || null);
            else App.state.periods = [{ id: 'p1', name: '1교시', images: App.state.images, answerKey: null }];

            // 마지막 사용 교시 복원
            if (data.currentPeriodId) App.state.currentPeriodId = data.currentPeriodId;

            this.currentSessionName = name;
            // 시험 이름/일자 복원 (없으면 세션 키에서 파싱 시도)
            this.currentExamName = data.examName || this._parseExamName(name);
            this.currentExamDate = data.examDate || this._parseExamDate(name);
            this.isTemplateMode = !!(data.isTemplateMode || (name && name.startsWith('[양식]')));
            this._hasUnsavedChanges = false;
            this._updateHeader();

            // 활성/삭제 이미지 분류용 맵 (파일명 기준)
            const activeMap = new Map();
            (data.imageResults || []).forEach(r => { if (r.filename) activeMap.set(r.filename, r); });
            const deletedMap = new Map();
            (data.deletedImageResults || []).forEach(r => { if (r.filename) deletedMap.set(r.filename, r); });

            // 이미지 자동 로드 (Electron)
            if (imageFiles.length > 0) {
                this._updateProgressOverlay(`이미지 로드 중... (0/${imageFiles.length})`);
                let loaded = 0;
                imageFiles.forEach((imgFile, idx) => {
                    const img = new Image();
                    img.onload = () => {
                        const isDeleted = deletedMap.has(imgFile.filename);
                        const savedResult = isDeleted
                            ? deletedMap.get(imgFile.filename)
                            : (activeMap.get(imgFile.filename) || (data.imageResults && data.imageResults[idx]) || null);

                        const periodId = (savedResult && savedResult.periodId) || 'p1';
                        const pristine = (savedResult && savedResult.pristineFilename) || imgFile.filename;
                        const imgObj = {
                            name:          imgFile.filename,
                            _originalName: imgFile.filename,
                            _pristineName: pristine,
                            imgElement:    img,
                            _imgSrc:       imgFile.url, // Lazy Loading 복원용 file:// URL
                            periodId,
                            intensity: savedResult && savedResult.intensity != null ? savedResult.intensity : undefined,
                            rois: savedResult
                                ? savedResult.rois.map(r => ({
                                    x: r.x, y: r.y, w: r.w, h: r.h,
                                    _id: r._id || ('roi_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
                                    settings: r.settings ? { ...r.settings } : null,
                                    blobPattern: r.blobPattern || null,
                                }))
                                : [],
                            results:     savedResult && savedResult.results ? savedResult.results : null,
                            gradeResult: savedResult ? savedResult.gradeResult : null,
                            _correctionConfirmed: savedResult ? (savedResult._correctionConfirmed || false) : false,
                        };

                        if (isDeleted) {
                            App.state.deletedImages.push(imgObj);
                        } else {
                            // periodId 기반으로 정확한 교시 배열에 push
                            const targetPeriod = (App.state.periods || []).find(p => p.id === periodId)
                                || App.state.periods[0];
                            if (targetPeriod) {
                                targetPeriod.images.push(imgObj);
                            } else {
                                App.state.images.push(imgObj); // fallback
                            }
                        }

                        loaded++;
                        this._updateProgressOverlay(`이미지 로드 중... (${loaded}/${imageFiles.length})`);
                        if (loaded === imageFiles.length) {
                            // 현재 교시의 images 를 App.state.images 로 동기화
                            const cp = App.getCurrentPeriod();
                            if (cp) App.state.images = cp.images;

                            if (typeof PeriodManager !== 'undefined') PeriodManager.render();
                            if (typeof ImageManager !== 'undefined') {
                                ImageManager.updateList();
                                if (App.state.images.length > 0) ImageManager.select(0);
                            }
                            if (typeof UI !== 'undefined') UI.updateRightPanel();
                            if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
                            if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
                            this._hideProgressOverlay();

                            const totalActive  = (App.state.periods || []).reduce((s, p) => s + p.images.length, 0);
                            const deletedCount = App.state.deletedImages.length;
                            const periodCount  = (App.state.periods || []).length;
                            const pLabel = periodCount > 1 ? ` (${periodCount}교시)` : '';
                            Toast.success(`세션 "${name}" 로드 완료 (활성 ${totalActive}장${pLabel}${deletedCount > 0 ? `, 삭제됨 ${deletedCount}장` : ''})`);
                        }
                    };
                    img.onerror = () => {
                        loaded++;
                        this._updateProgressOverlay(`이미지 로드 중... (${loaded}/${imageFiles.length})`);
                        console.warn(`이미지 로드 실패: ${imgFile.filename}`);
                        if (loaded === imageFiles.length) {
                            const cp = App.getCurrentPeriod();
                            if (cp) App.state.images = cp.images;
                            if (typeof PeriodManager !== 'undefined') PeriodManager.render();
                            if (typeof ImageManager !== 'undefined') ImageManager.updateList();
                            this._hideProgressOverlay();
                        }
                    };
                    img.src = imgFile.url;
                });
            } else {
                if (typeof ImageManager !== 'undefined') ImageManager.updateList();
                if (typeof UI !== 'undefined') UI.updateRightPanel();
                this._hideProgressOverlay();
                const imgCount = data.imageCount || 0;
                Toast.success(`세션 "${name}" 로드됨${imgCount > 0 ? ` (이미지 재업로드 필요)` : ''}`);
            }
        } catch (e) {
            console.error('세션 로드 실패:', e);
            Toast.error('세션 로드 실패: ' + e.message);
            this._hideProgressOverlay();
        }
    },

    // ==========================================
    // 시험(세션) 저장
    // ==========================================
    // 다른이름으로 시험(세션) 저장 — FileBrowser로 경로 선택
    saveCurrentSessionAs() {
        if (this.isElectron && typeof FileBrowser !== 'undefined') {
            FileBrowser.openSave({
                kind: 'session',
                title: '다른이름으로 시험(세션) 저장',
                defaultName: this.currentSessionName || 'session',
                onSave: async (relPath) => {
                    const prevName = this.currentSessionName;
                    this.currentSessionName = relPath;
                    await this.saveCurrentSession();
                    Toast.success(`시험(세션) 저장됨: ${relPath}`);
                },
            });
        } else {
            this.saveCurrentSession(); // 웹 폴백: 일반 저장
        }
    },

    // 저장/불러오기 중 로딩 오버레이 제어
    _showProgressOverlay(text) {
        let overlay = document.getElementById('session-progress-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'session-progress-overlay';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-box">
                    <div class="loading-spinner"></div>
                    <p class="loading-text"></p>
                </div>`;
            document.body.appendChild(overlay);
        }
        overlay.querySelector('.loading-text').textContent = text;
        overlay.style.display = 'flex';
    },
    _updateProgressOverlay(text) {
        const overlay = document.getElementById('session-progress-overlay');
        if (overlay) overlay.querySelector('.loading-text').textContent = text;
    },
    _hideProgressOverlay() {
        const overlay = document.getElementById('session-progress-overlay');
        if (overlay) overlay.style.display = 'none';
    },

    async saveCurrentSession(opts) {
        const metadataOnly = !!(opts && opts.metadataOnly);
        if (!this.currentSessionName) {
            Toast.error('세션을 먼저 생성하세요');
            return;
        }

        const name = this.currentSessionName;

        // 저장 전: 현재 교시의 최신 값을 period 에 동기화
        App.syncAnswerKey();
        App.syncSubjects();
        const curPeriod = App.getCurrentPeriod();
        if (curPeriod) curPeriod.images = App.state.images;

        // ── 매칭된 행 수집 (파일명 renaming용) — metadataOnly면 생략 ──
        const rowByRef = new Map();
        if (!metadataOnly) {
            try {
                if (typeof Scoring !== 'undefined') {
                    const rows = Scoring.collectData() || [];
                    rows.forEach(r => {
                        if (r._periodRows) {
                            r._periodRows.forEach(pr => {
                                rowByRef.set(`${pr.periodId}:${pr._localIdx}`, r);
                            });
                        } else if (r.periodId !== undefined && r._localIdx !== undefined) {
                            rowByRef.set(`${r.periodId}:${r._localIdx}`, r);
                        } else if (typeof r.imgIdx === 'number' && r.imgIdx >= 0) {
                            rowByRef.set(`${App.state.currentPeriodId || 'p1'}:${r.imgIdx}`, r);
                        }
                    });
                }
            } catch (_) { /* 매칭 실패해도 저장은 진행 */ }
        }

        const sanitize   = (s) => String(s || '').replace(/[\\/:*?"<>|.]/g, '').trim();
        const getPristine = (img) => img._pristineName || img._originalName || img.name || '';

        const buildFilenameByRef = (img, periodId, localIdx) => {
            const pristine = getPristine(img);
            // 다교시 세션에서 파일명 충돌 방지 — 교시 라벨 접두사
            const periods = App.state.periods || [];
            const labels = (typeof PeriodManager !== 'undefined') ? PeriodManager.getDisplayLabels() : {};
            const periodLabel = labels[periodId] || `${periods.findIndex(p => p.id === periodId) + 1}교시`;
            const periodPrefix = periods.length > 1 ? `${periodLabel}_` : '';

            const r = rowByRef.get(`${periodId}:${localIdx}`);
            if (!r || r._noOmr) return periodPrefix + pristine;
            const parts = [];
            if (r.name)     parts.push(`(이름)${sanitize(r.name)}`);
            if (r.examNo)   parts.push(`(수험)${sanitize(r.examNo)}`);
            if (r.phone)    parts.push(`(전화)${sanitize(r.phone)}`);
            if (r.birthday) parts.push(`(생년)${sanitize(r.birthday)}`);
            const prefix = parts.filter(Boolean).join('_');
            return periodPrefix + (prefix ? `${prefix}_${pristine}` : pristine);
        };

        // 이미지 1개 → 저장용 메타로 변환
        const serializeImage = (img, overrideFilename, periodId) => ({
            filename:        overrideFilename || getPristine(img),
            pristineFilename: getPristine(img),
            periodId:        periodId || img.periodId || 'p1',  // 교시 분배용
            intensity:       img.intensity != null ? img.intensity : (typeof CanvasManager !== 'undefined' ? CanvasManager.intensity : 100),
            _correctionConfirmed: img._correctionConfirmed || false,
            rois: (img.rois || []).map(r => ({
                x: r.x, y: r.y, w: r.w, h: r.h,
                _id: r._id || null,
                settings: r.settings,
                blobPattern: r.blobPattern || null,
            })),
            gradeResult: img.gradeResult || null,
            results: (img.results || []).map(res => ({
                roiIndex:     res.roiIndex,
                numQuestions: res.numQuestions,
                numChoices:   res.numChoices,
                rows: (res.rows || []).map(row => ({
                    questionNumber: row.questionNumber,
                    markedAnswer:   row.markedAnswer,
                    markedIndices:  row.markedIndices,
                    multiMarked:    row.multiMarked,
                    numChoices:     row.numChoices,
                    corrected:           row.corrected           || false,
                    _userCorrected:      row._userCorrected      || false,
                    _xvAutoCorrected:    row._xvAutoCorrected    || false,
                    _correctionInitial:  row._correctionInitial  || undefined,
                    _multiGap:           row._multiGap           || undefined,
                    _multiFormula:       row._multiFormula       || undefined,
                    _multiAllScores:     row._multiAllScores     || undefined,
                    undetected:          row.undetected          || false,
                    // 오버레이 렌더링용 blob 위치 저장
                    blobs: (row.blobs || []).map(b => ({
                        x: b.x, y: b.y, cx: b.cx, cy: b.cy, w: b.w, h: b.h,
                        r: b.r || 0,
                        isMarked: b.isMarked || false,
                        centerFillRatio: b.centerFillRatio || 0,
                        erodedFill: b.erodedFill || 0,
                        erodedQuadrants: b.erodedQuadrants || null,
                    })),
                })),
            })),
        });

        // ── 모든 교시의 활성 이미지 수집 ──
        const allPeriodEntries = [];
        (App.state.periods || []).forEach(period => {
            (period.images || []).forEach((img, localIdx) => {
                allPeriodEntries.push({ img, periodId: period.id, localIdx });
            });
        });

        // 삭제 이미지는 별도 (periodId 그대로 유지)
        const deletedImages = App.state.deletedImages || [];

        // 교시 메타데이터 (id, name, answerKey 저장 — subjects 는 세션 전역)
        const periodsMetadata = (App.state.periods || []).map(p => ({
            id:        p.id,
            name:      p.name,
            answerKey: p.answerKey || null,
        }));

        const data = {
            sessionName: name,
            examName:    this.currentExamName || null,
            examDate:    this.currentExamDate || null,
            isTemplateMode: !!this.isTemplateMode,
            version: 1,
            savedAt: new Date().toISOString(),
            subjects:    App.state.subjects  || [],
            students:    App.state.students  || [],
            matchFields: App.state.matchFields || {},
            answerKey:   App.state.answerKey  || null,
            imageCount:  allPeriodEntries.length,
            // 모든 교시 이미지 (periodId 포함)
            imageResults: allPeriodEntries.map(({ img, periodId, localIdx }) =>
                serializeImage(img, buildFilenameByRef(img, periodId, localIdx), periodId)
            ),
            // 삭제된 이미지도 세션에 보존 (복원 가능)
            deletedImageResults: deletedImages.map(img =>
                serializeImage(img, getPristine(img), img.periodId || 'p1')
            ),
            // 교시 구성 저장
            periods:        periodsMetadata,
            currentPeriodId: App.state.currentPeriodId || 'p1',
        };

        // metadataOnly가 아니면 로딩 오버레이 표시 (이미지 직렬화가 무거운 작업이므로)
        if (!metadataOnly) {
            this._showProgressOverlay(`세션 저장 중... (${allPeriodEntries.length}장 이미지)`);
        }

        try {
            if (this.isElectron) {
                let imageDataArr = null; // null이면 main.js IPC가 이미지 디렉터리를 건드리지 않음
                if (!metadataOnly) {
                    // 이미지 → base64 순차 변환 (진행률 + 남은 시간 표시)
                    const allItems = [
                        ...allPeriodEntries.map(({ img, periodId, localIdx }) => ({ imgObj: img, filename: buildFilenameByRef(img, periodId, localIdx) })),
                        ...deletedImages.map(img => ({ imgObj: img, filename: getPristine(img) })),
                    ];
                    const total = allItems.length;
                    const saveStart = Date.now();
                    imageDataArr = [];

                    for (let i = 0; i < total; i++) {
                        const { imgObj: saveImg, filename: saveName } = allItems[i];
                        try {
                            if (typeof ImageManager !== 'undefined' && (!saveImg.imgElement || !saveImg.imgElement.complete || saveImg.imgElement.width === 0)) {
                                await ImageManager.ensureLoaded(saveImg);
                            }
                            if (!saveImg.imgElement || saveImg.imgElement.width === 0) continue;
                            const c = document.createElement('canvas');
                            c.width = saveImg.imgElement.naturalWidth || saveImg.imgElement.width;
                            c.height = saveImg.imgElement.naturalHeight || saveImg.imgElement.height;
                            c.getContext('2d').drawImage(saveImg.imgElement, 0, 0);
                            imageDataArr.push({ filename: saveName || `image_${Date.now()}.jpg`, dataUrl: c.toDataURL('image/jpeg', 0.9) });
                        } catch (_) {}

                        // 10장마다 UI 갱신 (남은 시간 포함)
                        if ((i + 1) % 10 === 0 || i === total - 1) {
                            let timeInfo = '';
                            if (i > 5) {
                                const elapsed = (Date.now() - saveStart) / 1000;
                                const remaining = (elapsed / (i + 1)) * (total - i - 1);
                                if (remaining > 60) timeInfo = ` (약 ${Math.ceil(remaining / 60)}분 남음)`;
                                else if (remaining > 5) timeInfo = ` (약 ${Math.round(remaining)}초 남음)`;
                            }
                            this._updateProgressOverlay(`세션 저장 중... (${i + 1}/${total})${timeInfo}`);
                            await new Promise(r => setTimeout(r, 0)); // UI 갱신 기회
                        }
                    }
                    this._updateProgressOverlay(`디스크에 저장 중... (${imageDataArr.length}장)`);
                }

                const result = await window.electronAPI.saveSession(name, data, imageDataArr);
                if (!result.success) throw new Error(result.error);
                if (metadataOnly) {
                    console.log(`[세션] 메타만 저장: ${result.path}`);
                } else {
                    console.log(`[세션] 파일 저장: ${result.path} (이미지 ${imageDataArr.length}장)`);
                }
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
            if (!metadataOnly) Toast.success(`세션 "${name}" 저장 완료`);
        } catch (e) {
            Toast.error('시험(세션) 저장 실패: ' + e.message);
        } finally {
            if (!metadataOnly) this._hideProgressOverlay();
        }
    },

    // ==========================================
    // 세션 삭제 (소프트 — 목록에서만 숨김, 데이터 보존)
    // ==========================================
    async deleteSession(name) {
        const ok = await UIDialog.confirm(`"${name}" 세션을 삭제하시겠습니까?`, { danger: true, okLabel: '삭제' });
        if (!ok) return;

        if (this.isElectron) {
            await window.electronAPI.deleteSession(name);
        } else {
            this._updateSessionMeta(name, { deleted: true, deletedAt: new Date().toISOString() });
        }

        if (this.currentSessionName === name) {
            this.currentSessionName = null;
            this.currentExamName = null;
            this.currentExamDate = null;
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
        // 메인 헤더 가운데 시험 정보 바
        const bar = document.getElementById('exam-info-bar');
        const nameEl = document.getElementById('exam-info-name');
        const sepEl = document.getElementById('exam-info-sep');
        const dateEl = document.getElementById('exam-info-date');
        const dirtyEl = document.getElementById('exam-info-dirty');
        if (bar && nameEl && dateEl) {
            if (this.currentExamName || this.currentSessionName) {
                const displayName = this.currentExamName || this.currentSessionName;
                const displayDate = this.currentExamDate || '';
                nameEl.textContent = displayName;
                dateEl.textContent = displayDate;
                sepEl.textContent = displayDate ? '·' : '';
                bar.style.display = '';
                if (dirtyEl) dirtyEl.style.display = this._hasUnsavedChanges ? 'inline' : 'none';
            } else {
                bar.style.display = 'none';
            }
        }

        // 레거시: toolbar 옆 세션명 (기존 코드 호환 유지, 선택적 표시)
        let el = document.getElementById('session-header-name');
        if (el) {
            // 이제 가운데 바로 옮겨졌으므로 숨김
            el.textContent = '';
        }
    },

    // 시험 정보 편집 (헤더 클릭 시 호출)
    async editExamInfo() {
        if (!this.currentSessionName) return;
        const curName = this.currentExamName || this.currentSessionName;
        const curDate = this.currentExamDate || this._todayStr();
        const newName = await UIDialog.prompt('시험 이름', curName);
        if (newName === null) return;
        const newDate = await UIDialog.prompt('시험 일자 (YYYY-MM-DD)', curDate);
        if (newDate === null) return;
        const trimmedName = newName.trim();
        if (!trimmedName) { Toast.error('시험 이름을 입력하세요'); return; }
        this.currentExamName = trimmedName;
        this.currentExamDate = newDate.trim() || this._todayStr();
        this._hasUnsavedChanges = true;
        this._updateHeader();
    }
};
