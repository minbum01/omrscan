// ============================================
// examHub.js — Exam/Session 활성 상태 + UI 통합 진입점 (Phase 2-A)
// ============================================
// 책임:
//   1) 현재 활성 Exam/Session 상태 보관
//   2) Exam+Session 데이터를 App.state 로 펼치기 / 거두기
//   3) 새 시험/회차 생성 / 회차 전환 / 저장
//   4) 기존 SessionManager 와 평행 운영 (점진적 출시)
// 설계: 참고자료/md/세션병합_데이터모델_설계.md

const ExamHub = {
    currentExamId: null,
    currentSessionId: null,
    currentExam: null,       // 로드된 exam.json
    currentSession: null,    // 로드된 session.json

    _hasUnsaved: false,

    // ---------- 상태 ----------
    isActive() { return !!(this.currentExamId && this.currentSessionId); },

    deactivate() {
        this.currentExamId = null;
        this.currentSessionId = null;
        this.currentExam = null;
        this.currentSession = null;
        this._hasUnsaved = false;
    },

    markDirty() { this._hasUnsaved = true; },

    // ---------- 새 시험 ----------
    async createNewExam({ name, date } = {}) {
        const res = await ExamStore.createExam({ name, date });
        if (res.error) {
            Toast.error('시험 생성 실패: ' + res.error);
            return null;
        }
        // 첫 회차 자동 생성
        const sessRes = await ExamStore.createSession(res.examId, { name: '1회차' });
        if (sessRes.error) {
            Toast.error('첫 회차 생성 실패: ' + sessRes.error);
            return null;
        }
        await this.openExam(res.examId, sessRes.sessionId);
        Toast.success(`시험 "${res.data.name}" 생성됨 (1회차 자동 추가)`);
        return { examId: res.examId, sessionId: sessRes.sessionId };
    },

    // ---------- 시험/회차 활성화 ----------
    async openExam(examId, sessionId) {
        // 레거시 세션이 떠 있으면 안전 종료
        if (typeof SessionManager !== 'undefined' && SessionManager.currentSessionName) {
            SessionManager._hasUnsavedChanges = false;
            SessionManager.currentSessionName = null;
            SessionManager.currentExamName = null;
            SessionManager.currentExamDate = null;
        }

        const exam = await ExamStore.loadExam(examId, { forceRefresh: true });
        if (!exam) { Toast.error('시험 로드 실패'); return false; }

        // sessionId가 없으면 첫 세션 사용
        let useSessionId = sessionId;
        if (!useSessionId) {
            const list = await ExamStore.listSessions(examId, { forceRefresh: true });
            if (list.length === 0) {
                Toast.error('이 시험에 회차가 없습니다');
                return false;
            }
            useSessionId = list[0].id;
        }

        const sessRes = await ExamStore.loadSession(examId, useSessionId);
        if (!sessRes || !sessRes.success) { Toast.error('회차 로드 실패'); return false; }

        this.currentExamId = examId;
        this.currentSessionId = useSessionId;
        this.currentExam = exam;
        this.currentSession = sessRes.data;
        this._hasUnsaved = false;

        this._applyToAppState(exam, sessRes.data, sessRes.imageFiles || []);
        this._updateHeader();
        Toast.success(`"${exam.name}" / ${sessRes.data.name} 활성화`);
        return true;
    },

    async switchSession(sessionId) {
        if (!this.currentExamId) { Toast.error('활성 시험이 없습니다'); return false; }
        if (sessionId === this.currentSessionId) return true;
        if (this._hasUnsaved) {
            const ok = await UIDialog.confirm('현재 회차에 저장하지 않은 변경사항이 있습니다.\n저장하고 전환할까요?', { okLabel: '저장 후 전환' });
            if (ok) await this.saveCurrent();
        }
        return await this.openExam(this.currentExamId, sessionId);
    },

    // ---------- 새 회차 추가 ----------
    async createNewSessionInCurrent({ name, copyAttendanceFromCurrent } = {}) {
        if (!this.currentExamId) { Toast.error('활성 시험이 없습니다'); return null; }
        const list = await ExamStore.listSessions(this.currentExamId, { forceRefresh: true });
        const defaultName = name || `${list.length + 1}회차`;

        const opts = { name: defaultName };
        if (copyAttendanceFromCurrent && this.currentSession) {
            opts.students = (this.currentSession.students || []).map(s => ({ ...s }));
            opts.matchFields = { ...(this.currentSession.matchFields || {}) };
            opts.attendanceBookId = this.currentSession.attendanceBookId || null;
        }

        const res = await ExamStore.createSession(this.currentExamId, opts);
        if (res.error) { Toast.error('회차 생성 실패: ' + res.error); return null; }
        await this.openExam(this.currentExamId, res.sessionId);
        Toast.success(`"${res.data.name}" 회차 생성됨`);
        return res.sessionId;
    },

    // ---------- 저장 ----------
    async saveCurrent({ metadataOnly } = {}) {
        if (!this.isActive()) { Toast.error('활성 시험/회차가 없습니다'); return false; }
        const { examData, sessionData, images } = this._collectFromAppState();

        // 시험지 메타 갱신 (양식 부분은 별도 흐름에서)
        const examPayload = { ...this.currentExam, ...examData, id: this.currentExamId };
        const examRes = await ExamStore.saveExam(this.currentExamId, examPayload);
        if (!examRes || !examRes.success) { Toast.error('시험 저장 실패'); return false; }
        this.currentExam = examPayload;

        // 회차 저장
        const sessionPayload = {
            ...this.currentSession,
            ...sessionData,
            id: this.currentSessionId,
            examId: this.currentExamId,
        };
        const sessRes = await ExamStore.saveSession(
            this.currentExamId, this.currentSessionId, sessionPayload,
            metadataOnly ? null : images
        );
        if (!sessRes || !sessRes.success) { Toast.error('회차 저장 실패'); return false; }
        this.currentSession = sessionPayload;
        this._hasUnsaved = false;
        if (!metadataOnly) Toast.success(`시험/회차 저장 완료`);
        return true;
    },

    async deleteCurrentSession() {
        if (!this.isActive()) return false;
        const list = await ExamStore.listSessions(this.currentExamId, { forceRefresh: true });
        if (list.length <= 1) {
            Toast.error('마지막 회차는 삭제할 수 없습니다 (시험을 삭제하세요)');
            return false;
        }
        const ok = await UIDialog.confirm(
            `"${this.currentSession.name}" 회차를 삭제합니다. 되돌릴 수 없습니다.`,
            { okLabel: '삭제', danger: true }
        );
        if (!ok) return false;
        const res = await ExamStore.deleteSession(this.currentExamId, this.currentSessionId);
        if (!res || !res.success) { Toast.error('삭제 실패'); return false; }
        // 남은 회차 중 첫 번째로 전환
        const remaining = list.filter(s => s.id !== this.currentSessionId);
        await this.openExam(this.currentExamId, remaining[0].id);
        return true;
    },

    // ---------- App.state 동기화 ----------
    _applyToAppState(exam, session, imageFiles) {
        // 시험지 메타 (Exam)
        App.state.subjects = exam.subjects || [];
        App.state.answerKey = exam.answerKey || null;
        App.state.subjectMerges = exam.subjectMerges || [];
        // 표점 스케일 — Exam 단위 고정 (모든 회차 공통)
        if (typeof Scoring !== 'undefined') {
            const ss = exam.scoreScale || { center: 100, unit: 20 };
            Scoring._scoreScale = {
                center: isFinite(ss.center) ? Number(ss.center) : 100,
                unit: isFinite(ss.unit) && ss.unit > 0 ? Number(ss.unit) : 20,
            };
        }

        // 응시 데이터 (Session)
        App.state.students = (session.students || []).map(s => ({ ...s }));
        App.state.matchFields = session.matchFields || { name: true, birth: false, examNo: false, phone: false };

        // 교시 복원
        if (typeof App._initPeriods === 'function') App._initPeriods(exam.periods || null);

        // 이미지 — Phase 2 에서는 메타만 적용 (실제 이미지 객체 복원은 SessionManager.loadSession 의 로직과 유사하게 필요)
        // Phase 1-D 의 변환 함수는 이미지 복사를 안 했으니, 빈 상태로 시작 가능
        // TODO Phase 2-D 마무리 시 이미지 복원 통합
        App.state.images = [];
        App.state.deletedImages = [];
        App.state.currentIndex = -1;

        if (typeof PeriodManager !== 'undefined') PeriodManager.render();
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof UI !== 'undefined') UI.updateRightPanel();
        if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
    },

    _collectFromAppState() {
        const examData = {
            name: this.currentExam ? this.currentExam.name : '시험',
            date: this.currentExam ? this.currentExam.date : '',
            subjects: App.state.subjects || [],
            answerKey: App.state.answerKey || null,
            subjectMerges: App.state.subjectMerges || [],
            periods: (App.state.periods || []).map(p => ({
                id: p.id, name: p.name, answerKey: p.answerKey || null,
            })),
            scoreScale: (typeof Scoring !== 'undefined' && Scoring.getScoreScale)
                ? Scoring.getScoreScale() : { center: 100, unit: 20 },
            // 양식 부분(rois/intensity/referenceImage)은 별도 흐름에서 갱신
        };

        const sessionData = {
            name: this.currentSession ? this.currentSession.name : '회차',
            students: App.state.students || [],
            matchFields: App.state.matchFields || { name: true, birth: false, examNo: false, phone: false },
            attendanceBookId: this.currentSession ? this.currentSession.attendanceBookId : null,
            imageCount: (App.state.periods || []).reduce((s, p) => s + (p.images ? p.images.length : 0), 0),
            // imageResults 직렬화는 SessionManager 의 기존 로직을 재사용해야 함 — Phase 2-D 에서 통합
            imageResults: this.currentSession ? this.currentSession.imageResults : [],
            deletedImageResults: this.currentSession ? this.currentSession.deletedImageResults : [],
        };

        return { examData, sessionData, images: null };
    },

    // ============================================
    // 병합 뷰 (Phase 3)
    // ============================================
    // 활성 병합 상태
    _mergeMode: false,
    _mergeSessionIds: [],
    _mergeSnapshotId: null,
    // 단독 모드 백업 (병합 종료 시 복원)
    _singleModeBackup: null,

    isMergeMode() { return !!this._mergeMode; },

    // 여러 세션을 로드해서 students + imageResults 를 합친다
    // dupePolicy: 'separate' (별개 응시), 'merge_latest' (동일인 묶음 - 최신), 'merge_best' (동일인 묶음 - 최고)
    async collectMergedSessionData(sessionIds, dupePolicy = 'separate') {
        if (!this.currentExamId) throw new Error('활성 시험 없음');
        if (!sessionIds || sessionIds.length === 0) throw new Error('병합할 세션 없음');

        // 1) 모든 세션 데이터 로드
        const loaded = [];
        for (const sid of sessionIds) {
            const res = await ExamStore.loadSession(this.currentExamId, sid);
            if (res && res.success) loaded.push({ sessionId: sid, data: res.data });
        }
        if (loaded.length === 0) throw new Error('로드된 세션 없음');

        // 2) imageResults 합치기 — 각 항목에 sessionId/sessionName 메타 부여
        const mergedImages = [];
        loaded.forEach(({ sessionId, data }) => {
            const sessName = data.name || sessionId;
            (data.imageResults || []).forEach(ir => {
                mergedImages.push({
                    ...ir,
                    name: ir.filename,
                    _originalName: ir.filename,
                    _mergedFromSessionId: sessionId,
                    _mergedFromSessionName: sessName,
                    // collectData 가 imgElement 를 안 보므로 생략 (이미지 화면 표시는 안 함)
                });
            });
        });

        // 3) students 합치기 + 중복 처리
        const mergedStudents = this._mergeStudents(loaded, dupePolicy);

        // 4) matchFields — 첫 세션 기준 (대부분 같음)
        const matchFields = (loaded[0].data && loaded[0].data.matchFields)
            || { name: true, birth: false, examNo: false, phone: false };

        return {
            sessionIds: loaded.map(x => x.sessionId),
            sessionNames: loaded.map(x => (x.data.name || x.sessionId)),
            students: mergedStudents,
            images: mergedImages,
            matchFields,
            totalStudentCount: mergedStudents.length,
            totalImageCount: mergedImages.length,
        };
    },

    _mergeStudents(loaded, dupePolicy) {
        // key: 이름+수험번호 (matchFields 와 무관하게 두 값 묶음)
        const key = s => `${(s.name || '').trim()}__${(s.examNo || '').trim()}__${(s.birth || '').trim()}`;
        if (dupePolicy === 'separate') {
            // 각 세션의 학생을 그대로 합침 (중복 허용) — 세션 이름 prefix
            const out = [];
            loaded.forEach(({ data }) => {
                const sessName = data.name || '';
                (data.students || []).forEach(s => {
                    out.push({
                        ...s,
                        _mergedFromSessionName: sessName,
                        // 동일 이름 충돌 시 사용자가 인지하도록 표시는 _mergedFromSessionName 으로
                    });
                });
            });
            return out;
        }
        // 동일인 묶음 — 정책별
        const map = new Map();
        loaded.forEach(({ data }) => {
            const sessName = data.name || '';
            (data.students || []).forEach(s => {
                const k = key(s);
                if (!map.has(k)) {
                    map.set(k, { ...s, _mergedFromSessionName: sessName, _mergedSessions: [sessName] });
                } else {
                    const existing = map.get(k);
                    existing._mergedSessions = existing._mergedSessions || [];
                    if (!existing._mergedSessions.includes(sessName)) existing._mergedSessions.push(sessName);
                    // 정책에 따라 어느 학생 정보를 우선할지 — 단순화: 마지막 세션 데이터로 갱신
                    if (dupePolicy === 'merge_latest') {
                        Object.assign(existing, s, {
                            _mergedSessions: existing._mergedSessions,
                            _mergedFromSessionName: existing._mergedFromSessionName + ',' + sessName,
                        });
                    }
                    // merge_best 는 점수 비교가 필요한데 students 메타에는 점수가 없음 (imageResults 에 있음)
                    // → 학생 매핑까지는 이름/번호로만 묶고, 최고점 선택은 collectData 단계에서 처리해야 함
                    // 일단은 첫 항목 유지 (TODO: 점수 매칭 후 선택)
                }
            });
        });
        return [...map.values()];
    },

    // 병합 뷰 활성화 — App.state 임시 교체 + 자동 스냅샷 저장
    async activateMergeView(sessionIds, { dupePolicy = 'separate', skipSnapshot = false } = {}) {
        if (!this.currentExamId) { Toast.error('활성 시험 없음'); return false; }
        try {
            const merged = await this.collectMergedSessionData(sessionIds, dupePolicy);

            // 단독 모드 백업 (활성 단일 세션 상태)
            this._singleModeBackup = {
                sessionId: this.currentSessionId,
                students: App.state.students,
                images: App.state.images,
                periods: App.state.periods,
            };

            // App.state 임시 교체 — 가상 단일 교시
            App.state.students = merged.students;
            App.state.matchFields = merged.matchFields;
            App.state.periods = [{
                id: 'merged', name: '병합', images: merged.images,
                answerKey: this.currentExam ? this.currentExam.answerKey : null,
            }];
            App.state.images = merged.images;
            App.state.currentIndex = -1;

            this._mergeMode = true;
            this._mergeSessionIds = merged.sessionIds;

            // 자동 스냅샷 저장 (결정 사항 #3)
            if (!skipSnapshot) {
                const snapName = `${merged.sessionNames.join(' + ')} (${new Date().toISOString().slice(0,10)})`;
                const snapRes = await ExamStore.saveSnapshot(this.currentExamId, {
                    name: snapName,
                    sessionIds: merged.sessionIds,
                    sessionNames: merged.sessionNames,
                    dupePolicy,
                    studentCount: merged.totalStudentCount,
                    imageCount: merged.totalImageCount,
                    capturedAt: new Date().toISOString(),
                });
                if (snapRes && snapRes.success) this._mergeSnapshotId = snapRes.snapshotId;
            }

            if (typeof Scoring !== 'undefined') Scoring.invalidate();
            if (typeof PeriodManager !== 'undefined') PeriodManager.render();
            if (typeof ImageManager !== 'undefined') ImageManager.updateList();
            this._updateHeader();
            Toast.success(`병합 뷰 활성화 — ${merged.sessionNames.length}개 회차, 총 ${merged.totalStudentCount}명`);
            return true;
        } catch (e) {
            Toast.error('병합 실패: ' + e.message);
            return false;
        }
    },

    // 단독 회차 모드로 복귀
    deactivateMergeView() {
        if (!this._mergeMode || !this._singleModeBackup) return;
        App.state.students = this._singleModeBackup.students;
        App.state.images = this._singleModeBackup.images;
        App.state.periods = this._singleModeBackup.periods;
        this._singleModeBackup = null;
        this._mergeMode = false;
        this._mergeSessionIds = [];
        this._mergeSnapshotId = null;
        if (typeof Scoring !== 'undefined') Scoring.invalidate();
        if (typeof PeriodManager !== 'undefined') PeriodManager.render();
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        this._updateHeader();
        Toast.success('단독 회차 모드로 복귀');
    },

    // ---------- 헤더 표시 ----------
    _updateHeader() {
        const el = document.getElementById('current-session-name');
        if (!el) return;
        if (this.isActive()) {
            const examName = this.currentExam ? this.currentExam.name : '시험';
            const sessName = this.currentSession ? this.currentSession.name : '회차';
            el.textContent = `${examName} / ${sessName}`;
            el.title = `examId: ${this.currentExamId} · sessionId: ${this.currentSessionId}`;
        }
    },
};

// ============================================
// ExamHub_UI — 시험/회차 관리 UI (Phase 2-C)
// ============================================
const ExamHub_UI = {
    _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

    // ---------- 새 시험 생성 다이얼로그 ----------
    async promptCreateExam() {
        const today = new Date().toISOString().slice(0, 10);
        const overlay = this._buildModal('새 시험 만들기 (신규 모델)', `
            <div style="display:flex; flex-direction:column; gap:10px; padding:4px;">
                <label style="display:flex; flex-direction:column; gap:4px;">
                    <span style="font-size:11px; font-weight:600; color:var(--text-muted);">시험 이름</span>
                    <input type="text" id="eh-new-name" placeholder="예: 2026 6월 모의고사"
                        style="padding:8px 10px; font-size:14px; border:1px solid var(--border); border-radius:6px;">
                </label>
                <label style="display:flex; flex-direction:column; gap:4px;">
                    <span style="font-size:11px; font-weight:600; color:var(--text-muted);">시험일</span>
                    <input type="date" id="eh-new-date" value="${today}"
                        style="padding:8px 10px; font-size:14px; border:1px solid var(--border); border-radius:6px;">
                </label>
                <div style="font-size:11px; color:var(--text-muted); padding:6px 8px; background:#f8fafc; border-radius:6px;">
                    💡 시험 생성 시 "1회차"가 자동으로 함께 만들어집니다.
                    추가 회차는 "시험/회차 관리"에서 만들 수 있습니다.
                </div>
            </div>
        `, [
            { label: '취소', onClick: () => overlay.remove() },
            { label: '생성', primary: true, onClick: async () => {
                const name = (document.getElementById('eh-new-name') || {}).value || '';
                const date = (document.getElementById('eh-new-date') || {}).value || today;
                if (!name.trim()) { Toast.error('시험 이름을 입력하세요'); return; }
                overlay.remove();
                if (typeof SessionManager !== 'undefined') SessionManager._closeStartScreen();
                await ExamHub.createNewExam({ name: name.trim(), date });
            }},
        ]);
        setTimeout(() => { const i = document.getElementById('eh-new-name'); if (i) i.focus(); }, 50);
    },

    // ---------- 시험 목록 모달 ----------
    async openExamList() {
        const exams = await ExamStore.listExams({ forceRefresh: true });
        const overlay = this._buildModal('시험/회차 관리 (신규 모델)', `
            <div id="eh-exam-list" style="max-height:50vh; overflow-y:auto;"></div>
            <div style="margin-top:10px; display:flex; gap:6px;">
                <button class="btn btn-primary btn-sm" onclick="ExamHub_UI.promptCreateExam();
                    document.getElementById('eh-modal').remove();">+ 새 시험</button>
            </div>
        `, [
            { label: '닫기', onClick: () => overlay.remove() },
        ]);
        this._renderExamList(exams);
    },

    _renderExamList(exams) {
        const body = document.getElementById('eh-exam-list');
        if (!body) return;
        if (!exams || exams.length === 0) {
            body.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">
                저장된 시험이 없습니다. "+ 새 시험"으로 만드세요.
            </div>`;
            return;
        }
        let html = `<table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead><tr style="background:var(--bg-input); border-bottom:1px solid var(--border);">
                <th style="padding:8px 10px; text-align:left;">이름</th>
                <th style="padding:8px 10px; text-align:center; width:70px;">회차</th>
                <th style="padding:8px 10px; text-align:center; width:100px;">시험일</th>
                <th style="padding:8px 10px; text-align:right; width:180px;">작업</th>
            </tr></thead><tbody>`;
        exams.forEach(e => {
            html += `<tr style="border-bottom:1px solid var(--border-light);">
                <td style="padding:8px 10px; font-weight:600;">${this._esc(e.name)}</td>
                <td style="padding:8px 10px; text-align:center; color:var(--text-muted);">${e.sessionCount || 0}</td>
                <td style="padding:8px 10px; text-align:center; color:var(--text-muted); font-size:11px;">${this._esc(e.date)}</td>
                <td style="padding:8px 10px; text-align:right;">
                    <button class="btn btn-sm btn-primary" onclick="ExamHub_UI.openExamSessions('${e.id}')">회차 →</button>
                    <button class="btn btn-sm" onclick="ExamHub_UI.deleteExam('${e.id}')" style="color:#dc2626;" title="시험 삭제">✕</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>';
        body.innerHTML = html;
    },

    // ---------- 회차 목록 모달 ----------
    async openExamSessions(examId) {
        const exam = await ExamStore.loadExam(examId, { forceRefresh: true });
        const sessions = await ExamStore.listSessions(examId, { forceRefresh: true });
        const existing = document.getElementById('eh-modal');
        if (existing) existing.remove();

        const overlay = this._buildModal(`회차 관리 — ${exam ? exam.name : examId}`, `
            <div id="eh-session-list" style="max-height:50vh; overflow-y:auto;"></div>
            <div style="margin-top:10px; display:flex; gap:6px; align-items:center;">
                <input type="text" id="eh-new-sess-name" placeholder="새 회차 이름 (예: 강남 주중반)"
                    style="flex:1; padding:6px 10px; font-size:13px; border:1px solid var(--border); border-radius:6px;">
                <button class="btn btn-primary btn-sm" onclick="ExamHub_UI._addSession('${examId}')">+ 회차 추가</button>
            </div>
        `, [
            { label: '← 시험 목록', onClick: () => { overlay.remove(); this.openExamList(); } },
            { label: '닫기', onClick: () => overlay.remove() },
        ]);
        this._renderSessionList(examId, sessions);
    },

    _renderSessionList(examId, sessions) {
        const body = document.getElementById('eh-session-list');
        if (!body) return;
        if (!sessions || sessions.length === 0) {
            body.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">
                회차가 없습니다.
            </div>`;
            return;
        }
        let html = `<table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead><tr style="background:var(--bg-input); border-bottom:1px solid var(--border);">
                <th style="padding:8px 10px; text-align:left;">회차 이름</th>
                <th style="padding:8px 10px; text-align:center; width:70px;">인원</th>
                <th style="padding:8px 10px; text-align:center; width:70px;">이미지</th>
                <th style="padding:8px 10px; text-align:center; width:110px;">응시일</th>
                <th style="padding:8px 10px; text-align:right; width:160px;">작업</th>
            </tr></thead><tbody>`;
        sessions.forEach(s => {
            const isCurrent = ExamHub.isActive() && ExamHub.currentExamId === examId && ExamHub.currentSessionId === s.id;
            const dateStr = s.takenAt ? s.takenAt.slice(0, 10) : '-';
            html += `<tr style="border-bottom:1px solid var(--border-light); ${isCurrent ? 'background:#dcfce7;' : ''}">
                <td style="padding:8px 10px; font-weight:600;">${this._esc(s.name)}${isCurrent ? ' <span style="font-size:9px; color:#16a34a;">● 활성</span>' : ''}</td>
                <td style="padding:8px 10px; text-align:center; color:var(--text-muted);">${s.studentCount || 0}</td>
                <td style="padding:8px 10px; text-align:center; color:var(--text-muted);">${s.imageCount || 0}</td>
                <td style="padding:8px 10px; text-align:center; color:var(--text-muted); font-size:11px;">${dateStr}</td>
                <td style="padding:8px 10px; text-align:right;">
                    <button class="btn btn-sm btn-primary" onclick="ExamHub_UI._openSession('${examId}','${s.id}')">열기</button>
                    <button class="btn btn-sm" onclick="ExamHub_UI._deleteSession('${examId}','${s.id}')" style="color:#dc2626;" title="회차 삭제">✕</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>';
        body.innerHTML = html;
    },

    // ---------- 액션 ----------
    async _addSession(examId) {
        const input = document.getElementById('eh-new-sess-name');
        const name = input ? input.value.trim() : '';
        if (!name) { Toast.error('회차 이름을 입력하세요'); if (input) input.focus(); return; }
        const res = await ExamStore.createSession(examId, { name });
        if (res.error) { Toast.error(res.error); return; }
        if (input) input.value = '';
        const fresh = await ExamStore.listSessions(examId, { forceRefresh: true });
        this._renderSessionList(examId, fresh);
        Toast.success(`회차 "${name}" 추가됨`);
    },

    async _openSession(examId, sessionId) {
        const ok = await ExamHub.openExam(examId, sessionId);
        if (ok) {
            const m = document.getElementById('eh-modal');
            if (m) m.remove();
        }
    },

    async _deleteSession(examId, sessionId) {
        const list = await ExamStore.listSessions(examId, { forceRefresh: true });
        if (list.length <= 1) {
            Toast.error('마지막 회차는 삭제할 수 없습니다 (시험을 삭제하세요)');
            return;
        }
        const s = list.find(x => x.id === sessionId);
        const ok = await UIDialog.confirm(
            `회차 "${s ? s.name : sessionId}" 을 삭제합니다. 되돌릴 수 없습니다.`,
            { okLabel: '삭제', danger: true }
        );
        if (!ok) return;
        const res = await ExamStore.deleteSession(examId, sessionId);
        if (!res || !res.success) { Toast.error('삭제 실패'); return; }
        if (ExamHub.currentSessionId === sessionId) {
            // 활성 회차였으면 다른 회차로 전환
            const remaining = list.filter(x => x.id !== sessionId);
            if (remaining.length > 0) await ExamHub.openExam(examId, remaining[0].id);
            else ExamHub.deactivate();
        }
        const fresh = await ExamStore.listSessions(examId, { forceRefresh: true });
        this._renderSessionList(examId, fresh);
        Toast.success('회차 삭제됨');
    },

    // ---------- 병합 뷰 모달 (Phase 3-B) ----------
    async openMergeDialog(examId) {
        const useExamId = examId || ExamHub.currentExamId;
        if (!useExamId) { Toast.error('활성 시험이 없습니다'); return; }
        const exam = await ExamStore.loadExam(useExamId);
        const sessions = await ExamStore.listSessions(useExamId, { forceRefresh: true });
        if (sessions.length < 2) {
            Toast.info('병합하려면 최소 2개 회차가 필요합니다');
            return;
        }
        const snapshots = await ExamStore.listSnapshots(useExamId);

        const items = sessions.map(s => `
            <label style="display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:6px; margin-bottom:4px; cursor:pointer;">
                <input type="checkbox" class="merge-sess-chk" data-id="${s.id}"
                    ${ExamHub.isActive() && ExamHub.currentSessionId === s.id ? 'checked' : ''}>
                <div style="flex:1;">
                    <div style="font-size:13px; font-weight:600;">${this._esc(s.name)}</div>
                    <div style="font-size:10px; color:var(--text-muted);">
                        인원 ${s.studentCount || 0}명 · 이미지 ${s.imageCount || 0}장 · ${this._esc((s.takenAt || '').slice(0, 10))}
                    </div>
                </div>
            </label>
        `).join('');

        const snapList = snapshots.length === 0 ? '<div style="font-size:11px; color:var(--text-muted); padding:8px;">저장된 스냅샷 없음</div>'
            : snapshots.slice(0, 5).map(sn => `
                <div style="display:flex; align-items:center; gap:6px; padding:6px 8px; font-size:11px; border:1px solid var(--border-light); border-radius:4px; margin-bottom:3px;">
                    <span style="flex:1;">${this._esc(sn.name)}</span>
                    <span style="color:var(--text-muted); font-size:10px;">${this._esc((sn.savedAt || '').slice(0, 10))}</span>
                    <button class="btn btn-sm" style="font-size:10px; padding:2px 8px;" onclick="ExamHub_UI._restoreSnapshot('${useExamId}','${sn.id}')">복원</button>
                </div>
            `).join('');

        const overlay = this._buildModal(`병합 뷰 — ${exam ? exam.name : useExamId}`, `
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">
                💡 선택한 회차들의 응시자/답안을 합쳐서 통계 산출 → 합쳐진 모집단 기준 표점/석차/백분위 재계산
            </div>
            <div style="max-height:35vh; overflow-y:auto;" id="eh-merge-list">${items}</div>

            <div style="margin-top:12px; padding:10px 12px; background:#f8fafc; border:1px solid var(--border); border-radius:6px;">
                <div style="font-size:11px; font-weight:700; color:#475569; margin-bottom:6px;">중복 학생 처리 (이름/수험번호 같은 학생이 여러 회차에 있을 때)</div>
                <label style="display:flex; align-items:center; gap:6px; padding:3px 0; font-size:12px; cursor:pointer;">
                    <input type="radio" name="dupe-policy" value="separate" checked> <strong>별개 응시로 취급</strong>
                    <span style="font-size:10px; color:var(--text-muted);">— 같은 사람이 2회 응시한 것으로 카운트 (모집단 N 증가)</span>
                </label>
                <label style="display:flex; align-items:center; gap:6px; padding:3px 0; font-size:12px; cursor:pointer;">
                    <input type="radio" name="dupe-policy" value="merge_latest"> <strong>동일인 묶음 — 최신 회차</strong>
                    <span style="font-size:10px; color:var(--text-muted);">— 가장 최근 응시 데이터만 사용</span>
                </label>
            </div>

            ${snapshots.length > 0 ? `<div style="margin-top:12px;">
                <div style="font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">최근 스냅샷 (자동 저장됨)</div>
                ${snapList}
            </div>` : ''}
        `, [
            { label: '취소', onClick: () => overlay.remove() },
            { label: '병합 뷰 열기', primary: true, onClick: async () => {
                const ids = Array.from(overlay.querySelectorAll('.merge-sess-chk:checked')).map(c => c.dataset.id);
                if (ids.length < 2) { Toast.error('최소 2개 회차를 선택하세요'); return; }
                const policyInput = overlay.querySelector('input[name="dupe-policy"]:checked');
                const policy = policyInput ? policyInput.value : 'separate';
                overlay.remove();
                const ok = await ExamHub.activateMergeView(ids, { dupePolicy: policy });
                if (ok && typeof Scoring !== 'undefined') {
                    Scoring.renderScoringPanel(document.getElementById('scoring-content'));
                }
            }},
        ]);
    },

    async _restoreSnapshot(examId, snapshotId) {
        const snap = await ExamStore.loadSnapshot(examId, snapshotId);
        if (!snap) { Toast.error('스냅샷 로드 실패'); return; }
        const m = document.getElementById('eh-modal');
        if (m) m.remove();
        const ok = await ExamHub.activateMergeView(snap.sessionIds, {
            dupePolicy: snap.dupePolicy || 'separate',
            skipSnapshot: true,
        });
        if (ok && typeof Scoring !== 'undefined') {
            Scoring.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    // ---------- 레거시 변환 ----------
    async convertLegacy(legacyName) {
        const ok = await UIDialog.confirm(
            `레거시 세션 "${legacyName}" 을 신규 모델(시험-회차 분리)로 변환합니다.\n\n` +
            `※ 변환 후에도 기존 세션은 유지됩니다 (안전).\n` +
            `※ 이미지 파일은 이번 단계에서는 복사되지 않습니다 (메타만 변환). 이미지는 Phase 2 추가 작업에서 통합 예정.\n\n` +
            `계속하시겠습니까?`,
            { okLabel: '변환 시작' }
        );
        if (!ok) return;
        Toast.info('변환 중... 잠시만 기다려주세요');
        const res = await ExamStore.convertLegacySession(legacyName);
        if (res.error) {
            Toast.error('변환 실패: ' + res.error);
            return;
        }
        Toast.success(`변환 완료 — examId: ${res.examId}`);
        if (typeof SessionManager !== 'undefined') SessionManager._closeStartScreen();
        await ExamHub.openExam(res.examId, res.sessionId);
    },

    async deleteExam(examId) {
        const exam = await ExamStore.loadExam(examId);
        const ok = await UIDialog.confirm(
            `시험 "${exam ? exam.name : examId}" 을 삭제합니다.\n모든 회차와 데이터가 함께 사라집니다. 되돌릴 수 없습니다.`,
            { okLabel: '삭제', danger: true }
        );
        if (!ok) return;
        const res = await ExamStore.deleteExam(examId);
        if (!res || !res.success) { Toast.error('삭제 실패'); return; }
        if (ExamHub.currentExamId === examId) ExamHub.deactivate();
        const fresh = await ExamStore.listExams({ forceRefresh: true });
        this._renderExamList(fresh);
        Toast.success('시험 삭제됨');
    },

    // ---------- 공용 모달 빌더 ----------
    _buildModal(title, bodyHtml, footerBtns) {
        const existing = document.getElementById('eh-modal');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'eh-modal';
        overlay.className = 'modal-overlay';
        const footerHtml = (footerBtns || []).map((b, i) => `
            <button class="btn ${b.primary ? 'btn-primary' : ''}" data-fb="${i}">${b.label}</button>
        `).join('');
        overlay.innerHTML = `
            <div class="modal" style="width:640px; max-height:80vh;">
                <div class="modal-header"><h2>${this._esc(title)}</h2></div>
                <div class="modal-body" style="overflow-y:auto;">${bodyHtml}</div>
                <div class="modal-footer">${footerHtml}</div>
            </div>
        `;
        document.body.appendChild(overlay);
        (footerBtns || []).forEach((b, i) => {
            const btn = overlay.querySelector(`[data-fb="${i}"]`);
            if (btn) btn.addEventListener('click', b.onClick);
        });
        return overlay;
    },
};

