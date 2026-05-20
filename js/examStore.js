// ============================================
// examStore.js — Exam/Session 데이터 추상화 레이어 (Phase 1-A)
// ============================================
// 새 데이터 모델: Exam (시험지 정의) → Session (회차 응시 데이터)
// 자세한 설계: 참고자료/md/세션병합_데이터모델_설계.md
//
// 이 모듈은 IPC 호출을 래핑하고 메모리 캐시를 제공한다.
// 실제 파일 시스템 작업은 main.js의 IPC 핸들러가 수행한다.

const ExamStore = {
    isElectron: typeof window !== 'undefined' && !!(window.electronAPI && window.electronAPI.isElectron),

    // 단순 메모리 캐시 (트리/리스트 조회 빈도 높을 수 있음)
    _cache: {
        examList: null,        // listExams() 결과
        examData: new Map(),   // examId → exam.json 내용
        sessionList: new Map(),// examId → [{sessionId, name, ...}]
    },

    invalidate(scope) {
        if (!scope || scope === 'all') {
            this._cache.examList = null;
            this._cache.examData.clear();
            this._cache.sessionList.clear();
        } else if (scope === 'list') {
            this._cache.examList = null;
        } else if (scope && scope.exam) {
            this._cache.examData.delete(scope.exam);
            this._cache.sessionList.delete(scope.exam);
        }
    },

    _newExamId() {
        return 'exam_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    },
    _newSessionId() {
        return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    },
    _newSnapshotId() {
        return 'snap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    },

    // ===== Exam =====
    async listExams({ forceRefresh } = {}) {
        if (!this.isElectron) return [];
        if (!forceRefresh && this._cache.examList) return this._cache.examList;
        const res = await window.electronAPI.listExams();
        if (!res || !res.success) {
            console.warn('listExams 실패:', res && res.error);
            return [];
        }
        this._cache.examList = res.exams || [];
        return this._cache.examList;
    },

    async loadExam(examId, { forceRefresh } = {}) {
        if (!this.isElectron || !examId) return null;
        if (!forceRefresh && this._cache.examData.has(examId)) return this._cache.examData.get(examId);
        const res = await window.electronAPI.loadExam(examId);
        if (!res || !res.success) {
            console.warn('loadExam 실패:', res && res.error);
            return null;
        }
        this._cache.examData.set(examId, res.data);
        return res.data;
    },

    // examData: 양식 + 시험지 메타. 부분 업데이트도 OK (merge는 호출자가)
    async saveExam(examId, examData) {
        if (!this.isElectron || !examId || !examData) {
            return { success: false, error: 'Electron 환경 또는 데이터 누락' };
        }
        const now = new Date().toISOString();
        const payload = {
            ...examData,
            id: examId,
            version: 2,
            updatedAt: now,
            createdAt: examData.createdAt || now,
        };
        const res = await window.electronAPI.saveExam(examId, payload);
        if (res && res.success) {
            this._cache.examData.set(examId, payload);
            this._cache.examList = null; // 목록 메타 변경 가능성
        }
        return res;
    },

    async createExam({ name, date } = {}) {
        const examId = this._newExamId();
        const now = new Date().toISOString();
        const blank = {
            id: examId,
            name: name || '새 시험',
            date: date || now.slice(0, 10),
            createdAt: now,
            updatedAt: now,
            version: 2,
            // 양식
            rois: [],
            intensity: 115,
            referenceImage: null,
            // 시험지 메타
            subjects: [],
            periods: [{ id: 'p1', name: '1교시', answerKey: null }],
            answerKey: null,
            subjectMerges: [],
            scoreScale: { center: 100, unit: 20 },
        };
        const res = await this.saveExam(examId, blank);
        if (res && res.success) return { examId, data: blank };
        return { error: (res && res.error) || '시험 생성 실패' };
    },

    async deleteExam(examId) {
        if (!this.isElectron || !examId) return { success: false };
        const res = await window.electronAPI.deleteExam(examId);
        if (res && res.success) {
            this._cache.examData.delete(examId);
            this._cache.sessionList.delete(examId);
            this._cache.examList = null;
        }
        return res;
    },

    // ===== Session (Exam 하위) =====
    async listSessions(examId, { forceRefresh } = {}) {
        if (!this.isElectron || !examId) return [];
        if (!forceRefresh && this._cache.sessionList.has(examId)) return this._cache.sessionList.get(examId);
        const res = await window.electronAPI.listExamSessions(examId);
        if (!res || !res.success) {
            console.warn('listSessions 실패:', res && res.error);
            return [];
        }
        const list = res.sessions || [];
        this._cache.sessionList.set(examId, list);
        return list;
    },

    async loadSession(examId, sessionId) {
        if (!this.isElectron || !examId || !sessionId) return null;
        const res = await window.electronAPI.loadExamSession(examId, sessionId);
        if (!res || !res.success) {
            console.warn('loadSession 실패:', res && res.error);
            return null;
        }
        return res; // { success, data, imageFiles }
    },

    async saveSession(examId, sessionId, sessionData, imageDataArr) {
        if (!this.isElectron || !examId || !sessionId || !sessionData) {
            return { success: false, error: '인자 누락' };
        }
        const now = new Date().toISOString();
        const payload = {
            ...sessionData,
            id: sessionId,
            examId,
            savedAt: now,
        };
        const res = await window.electronAPI.saveExamSession(examId, sessionId, payload, imageDataArr || null);
        if (res && res.success) this._cache.sessionList.delete(examId); // 목록 갱신 필요
        return res;
    },

    async createSession(examId, { name, attendanceBookId, students, matchFields } = {}) {
        if (!examId) return { error: 'examId 누락' };
        const sessionId = this._newSessionId();
        const now = new Date().toISOString();
        const blank = {
            id: sessionId,
            examId,
            name: name || '새 회차',
            takenAt: now,
            attendanceBookId: attendanceBookId || null,
            students: students || [],
            matchFields: matchFields || { name: true, birth: false, examNo: false, phone: false },
            imageResults: [],
            deletedImageResults: [],
            imageCount: 0,
            createdAt: now,
        };
        const res = await this.saveSession(examId, sessionId, blank, null);
        if (res && res.success) return { sessionId, data: blank };
        return { error: (res && res.error) || '세션 생성 실패' };
    },

    async deleteSession(examId, sessionId) {
        if (!this.isElectron || !examId || !sessionId) return { success: false };
        const res = await window.electronAPI.deleteExamSession(examId, sessionId);
        if (res && res.success) this._cache.sessionList.delete(examId);
        return res;
    },

    // ===== Merge Snapshot =====
    async listSnapshots(examId) {
        if (!this.isElectron || !examId) return [];
        const res = await window.electronAPI.listMergeSnapshots(examId);
        if (!res || !res.success) return [];
        return res.snapshots || [];
    },

    async saveSnapshot(examId, snapshotData) {
        if (!this.isElectron || !examId || !snapshotData) return { success: false };
        const snapshotId = snapshotData.id || this._newSnapshotId();
        const payload = {
            ...snapshotData,
            id: snapshotId,
            savedAt: new Date().toISOString(),
        };
        const res = await window.electronAPI.saveMergeSnapshot(examId, snapshotId, payload);
        return res && res.success ? { ...res, snapshotId, data: payload } : res;
    },

    async loadSnapshot(examId, snapshotId) {
        if (!this.isElectron) return null;
        const res = await window.electronAPI.loadMergeSnapshot(examId, snapshotId);
        return (res && res.success) ? res.data : null;
    },

    async deleteSnapshot(examId, snapshotId) {
        if (!this.isElectron) return { success: false };
        return await window.electronAPI.deleteMergeSnapshot(examId, snapshotId);
    },

    // ===== 레거시 변환 (Phase 1-D) =====
    // 기존 session.json → exam 부분 + session 부분으로 분리
    // 호출자가 적절한 examId/sessionId를 부여하고 saveExam/saveSession 호출
    splitLegacyData(legacyData) {
        if (!legacyData) return null;
        const examPart = {
            name: legacyData.examName || legacyData.sessionName || '변환된 시험',
            date: legacyData.examDate || (legacyData.savedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
            // 양식 부분: 레거시는 ROI가 imageResults 안에 있어서 그대로 옮기지 못함
            // → Phase 1에서는 양식 추출 안 함, sessions 안에 그대로 두고 양식은 비워둠 (참조 이미지 추출은 Phase 2)
            rois: [],
            intensity: legacyData.intensity || 115,
            referenceImage: null,
            // 시험지 메타
            subjects: legacyData.subjects || [],
            periods: (legacyData.periods || []).map(p => ({
                id: p.id, name: p.name, answerKey: p.answerKey || null,
            })),
            answerKey: legacyData.answerKey || null,
            subjectMerges: legacyData.subjectMerges || [],
            scoreScale: legacyData.scoreScale || { center: 100, unit: 20 },
        };
        const sessionPart = {
            name: legacyData.examName || legacyData.sessionName || '회차 1',
            takenAt: legacyData.savedAt || new Date().toISOString(),
            attendanceBookId: null,
            students: legacyData.students || [],
            matchFields: legacyData.matchFields || { name: true, birth: false, examNo: false, phone: false },
            imageResults: legacyData.imageResults || [],
            deletedImageResults: legacyData.deletedImageResults || [],
            imageCount: legacyData.imageCount || 0,
        };
        return { examPart, sessionPart };
    },

    // 레거시 세션 한 개를 Exam+Session으로 변환 (수동 트리거용, Phase 2에서 UI 연결)
    async convertLegacySession(legacyName) {
        if (!this.isElectron) return { error: 'Electron 환경 필요' };
        const res = await window.electronAPI.loadSession(legacyName);
        if (!res || !res.success || !res.data) {
            return { error: '레거시 세션 로드 실패' };
        }
        const split = this.splitLegacyData(res.data);
        if (!split) return { error: '변환 데이터 생성 실패' };

        // 1) Exam 생성
        const created = await this.createExam({ name: split.examPart.name, date: split.examPart.date });
        if (created.error) return { error: 'Exam 생성 실패: ' + created.error };
        const examId = created.examId;

        // examPart 의 시험지 메타로 덮어쓰기
        const fullExam = { ...created.data, ...split.examPart };
        await this.saveExam(examId, fullExam);

        // 2) Session 생성 + 응시 데이터 저장
        const sessCreated = await this.createSession(examId, {
            name: split.sessionPart.name,
            students: split.sessionPart.students,
            matchFields: split.sessionPart.matchFields,
        });
        if (sessCreated.error) {
            return { error: '세션 생성 실패: ' + sessCreated.error };
        }
        const sessionId = sessCreated.sessionId;
        const fullSess = { ...sessCreated.data, ...split.sessionPart };

        // 이미지는 main.js IPC 가 별도 처리. 일단 메타만 저장하고
        // Phase 2 에서 이미지 복사 IPC 호출 추가
        await this.saveSession(examId, sessionId, fullSess, null);

        return {
            success: true,
            examId, sessionId,
            note: '메타만 변환됨. 이미지 파일은 Phase 2 에서 복사 예정',
        };
    },
};
