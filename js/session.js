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

        const today = this._todayStr();
        const div = document.createElement('div');
        div.id = 'new-session-input-area';
        div.style.cssText = 'padding:12px; border:2px solid var(--blue); border-radius:8px; margin-bottom:12px; background:var(--blue-light);';
        div.innerHTML = `
            <div style="font-size:12px; font-weight:600; margin-bottom:6px;">시험 이름 · 시험 일자 입력</div>
            <div style="display:flex; gap:6px; align-items:center;">
                <input type="text" id="new-session-name" placeholder="예: 2026년 1회 모의고사"
                    style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:14px;">
                <input type="date" id="new-session-date" value="${today}"
                    style="padding:8px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
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
        const dateInput = document.getElementById('new-session-date');
        if (!input) return;
        const examName = input.value.trim();
        const examDate = (dateInput && dateInput.value) || this._todayStr();
        if (!examName) { Toast.error('시험 이름을 입력하세요'); input.focus(); return; }

        const name = `${examName}_${examDate}`;

        this._closeStartScreen();
        this.currentSessionName = name;
        this.currentExamName = examName;
        this.currentExamDate = examDate;
        this._hasUnsavedChanges = false;

        // 상태 초기화
        App.state.subjects = [];
        App.state.students = [];
        App.state.matchFields = { name: true, birth: false, examNo: false, phone: false };
        App.state.images = [];
        App.state.deletedImages = [];
        App.state.currentIndex = -1;
        App.state.answerKey = null;

        // 교시 초기화 — 반드시 App.state.images = [] 직후에 호출
        App._initPeriods();

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
            App.state.deletedImages = [];
            App.state.currentIndex = -1;

            // 교시 복원 — 반드시 App.state.images = [] 직후에 호출
            // 저장된 periods 배열이 있으면 교시 이름 복원, 없으면 자동 1교시 생성
            App._initPeriods(data.periods || null);

            this.currentSessionName = name;
            // 시험 이름/일자 복원 (없으면 세션 키에서 파싱 시도)
            this.currentExamName = data.examName || this._parseExamName(name);
            this.currentExamDate = data.examDate || this._parseExamDate(name);
            this._hasUnsavedChanges = false;
            this._updateHeader();

            // 활성/삭제 이미지 분류용 맵 (파일명 기준)
            const activeMap = new Map();
            (data.imageResults || []).forEach(r => { if (r.filename) activeMap.set(r.filename, r); });
            const deletedMap = new Map();
            (data.deletedImageResults || []).forEach(r => { if (r.filename) deletedMap.set(r.filename, r); });

            // 이미지 자동 로드 (Electron)
            if (imageFiles.length > 0) {
                Toast.info(`이미지 ${imageFiles.length}장 로딩 중...`);
                let loaded = 0;
                imageFiles.forEach((imgFile, idx) => {
                    const img = new Image();
                    img.onload = () => {
                        const thumb = typeof ImageManager !== 'undefined' ? ImageManager.createThumbnail(img) : null;
                        // 저장된 결과 복원 (파일명 매칭 → fallback: idx 기반)
                        const isDeleted = deletedMap.has(imgFile.filename);
                        const savedResult = isDeleted
                            ? deletedMap.get(imgFile.filename)
                            : (activeMap.get(imgFile.filename) || (data.imageResults && data.imageResults[idx]) || null);

                        // 교시 분배: savedResult.periodId → 해당 period.images 에 push
                        const periodId = (savedResult && savedResult.periodId) || 'p1';

                        const imgObj = {
                            name:          imgFile.filename,
                            _originalName: imgFile.filename,
                            _pristineName: (savedResult && savedResult.pristineFilename) || imgFile.filename,
                            imgElement:    img,
                            thumb,
                            periodId,
                            rois: savedResult
                                ? savedResult.rois.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, settings: r.settings ? { ...r.settings } : null }))
                                : [],
                            results:     savedResult && savedResult.results ? savedResult.results : null,
                            gradeResult: savedResult ? savedResult.gradeResult : null,
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

                            const totalActive  = (App.state.periods || []).reduce((s, p) => s + p.images.length, 0);
                            const deletedCount = App.state.deletedImages.length;
                            const periodCount  = (App.state.periods || []).length;
                            const pLabel = periodCount > 1 ? ` (${periodCount}교시)` : '';
                            Toast.success(`세션 "${name}" 로드 완료 (활성 ${totalActive}장${pLabel}${deletedCount > 0 ? `, 삭제됨 ${deletedCount}장` : ''})`);
                        }
                    };
                    img.onerror = () => {
                        loaded++;
                        console.warn(`이미지 로드 실패: ${imgFile.filename}`);
                        if (loaded === imageFiles.length) {
                            const cp = App.getCurrentPeriod();
                            if (cp) App.state.images = cp.images;
                            if (typeof PeriodManager !== 'undefined') PeriodManager.render();
                            if (typeof ImageManager !== 'undefined') ImageManager.updateList();
                        }
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

        // 저장 전: 현재 교시의 최신 값을 period 에 동기화
        App.syncAnswerKey();
        App.syncSubjects();
        const curPeriod = App.getCurrentPeriod();
        if (curPeriod) curPeriod.images = App.state.images;

        // ── 매칭된 행 수집 (파일명 renaming용) ──
        // "periodId:localIdx" → { name, examNo, phone, birthday }
        const rowByRef = new Map();
        try {
            if (typeof Scoring !== 'undefined') {
                const rows = Scoring.collectData() || [];
                rows.forEach(r => {
                    if (r._periodRows) {
                        // 다교시 merged row
                        r._periodRows.forEach(pr => {
                            rowByRef.set(`${pr.periodId}:${pr._localIdx}`, r);
                        });
                    } else if (r.periodId !== undefined && r._localIdx !== undefined) {
                        rowByRef.set(`${r.periodId}:${r._localIdx}`, r);
                    } else if (typeof r.imgIdx === 'number' && r.imgIdx >= 0) {
                        // 단일 교시 하위호환
                        rowByRef.set(`${App.state.currentPeriodId || 'p1'}:${r.imgIdx}`, r);
                    }
                });
            }
        } catch (_) { /* 매칭 실패해도 저장은 진행 */ }

        const sanitize   = (s) => String(s || '').replace(/[\\/:*?"<>|.]/g, '').trim();
        const getPristine = (img) => img._pristineName || img._originalName || img.name || '';

        const buildFilenameByRef = (img, periodId, localIdx) => {
            const pristine = getPristine(img);
            const r = rowByRef.get(`${periodId}:${localIdx}`);
            if (!r || r._noOmr) return pristine;
            const parts = [];
            if (r.name)     parts.push(sanitize(r.name));
            if (r.phone)    parts.push(sanitize(r.phone));
            if (r.examNo)   parts.push(sanitize(r.examNo));
            if (r.birthday) parts.push(sanitize(r.birthday));
            const prefix = parts.filter(Boolean).join('_');
            return prefix ? `${prefix}_${pristine}` : pristine;
        };

        // 이미지 1개 → 저장용 메타로 변환
        const serializeImage = (img, overrideFilename, periodId) => ({
            filename:        overrideFilename || getPristine(img),
            pristineFilename: getPristine(img),
            periodId:        periodId || img.periodId || 'p1',  // 교시 분배용
            rois: (img.rois || []).map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, settings: r.settings })),
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
                    corrected:      row.corrected      || false,
                    _userCorrected: row._userCorrected || false,
                    undetected:     row.undetected     || false,
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

        // 교시 메타데이터 (id, name, answerKey, subjects 저장)
        const periodsMetadata = (App.state.periods || []).map(p => ({
            id:        p.id,
            name:      p.name,
            answerKey: p.answerKey || null,
            subjects:  p.subjects  || [],
        }));

        const data = {
            sessionName: name,
            examName:    this.currentExamName || null,
            examDate:    this.currentExamDate || null,
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

        try {
            if (this.isElectron) {
                // 이미지 → base64 변환 (모든 교시 활성 + 삭제 모두 저장)
                const imgToData = (img, filename) => {
                    try {
                        const c = document.createElement('canvas');
                        c.width  = img.imgElement.naturalWidth  || img.imgElement.width;
                        c.height = img.imgElement.naturalHeight || img.imgElement.height;
                        c.getContext('2d').drawImage(img.imgElement, 0, 0);
                        return { filename: filename || `image_${Date.now()}.jpg`, dataUrl: c.toDataURL('image/jpeg', 0.9) };
                    } catch (e) { return null; }
                };
                const activeArr  = allPeriodEntries.map(({ img, periodId, localIdx }) =>
                    imgToData(img, buildFilenameByRef(img, periodId, localIdx))
                ).filter(Boolean);
                const deletedArr = deletedImages.map(img =>
                    imgToData(img, getPristine(img))
                ).filter(Boolean);
                const imageDataArr = [...activeArr, ...deletedArr];

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
        if (bar && nameEl && dateEl) {
            if (this.currentExamName || this.currentSessionName) {
                const displayName = this.currentExamName || this.currentSessionName;
                const displayDate = this.currentExamDate || '';
                nameEl.textContent = displayName + (this._hasUnsavedChanges ? ' *' : '');
                dateEl.textContent = displayDate;
                sepEl.textContent = displayDate ? '·' : '';
                bar.style.display = '';
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
    editExamInfo() {
        if (!this.currentSessionName) return;
        const curName = this.currentExamName || this.currentSessionName;
        const curDate = this.currentExamDate || this._todayStr();
        const newName = prompt('시험 이름', curName);
        if (newName === null) return;
        const newDate = prompt('시험 일자 (YYYY-MM-DD)', curDate);
        if (newDate === null) return;
        const trimmedName = newName.trim();
        if (!trimmedName) { Toast.error('시험 이름을 입력하세요'); return; }
        this.currentExamName = trimmedName;
        this.currentExamDate = newDate.trim() || this._todayStr();
        this._hasUnsavedChanges = true;
        this._updateHeader();
    }
};
