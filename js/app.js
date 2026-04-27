// ============================================
// app.js - 전역 상태 관리 및 앱 초기화
// ============================================

const App = {
    STEPS: {
        UPLOAD: 1,
        REGION: 2,
        ANALYZE: 3,
        GRADE: 4
    },

    state: {
        currentStep: 1,
        images: [],
        currentIndex: -1,
        isDrawingMode: true,  // BUG12 fix: HTML과 일치
        isDrawing: false,
        startX: 0, startY: 0, currentX: 0, currentY: 0,
        zoom: 1,
        minZoom: 0.2,
        maxZoom: 5,
        answerKey: null,
        rightTab: 'settings', // 'settings' | 'results'

        // ── 교시(Period) 관련 ──────────────────────────
        // 한 세션 = 여러 교시. 각 교시는 고유 이미지/ROI/정답키를 가짐.
        // periods[i].images 와 App.state.images 는 같은 배열 참조 (currentPeriod 기준)
        periods: [],           // [{ id, name, images[], answerKey, subjects[] }]
        currentPeriodId: null, // 현재 편집/분석 중인 교시 id

        // 과목 합치기 — 학생별 마킹 영역이 다른 경우 통합 채점
        // [{ target: 'B', sources: ['A','C'] }, ...]
        subjectMerges: [],
    },

    els: {},

    init() {
        this.els = {
            canvas: document.getElementById('main-canvas'),
            canvasContainer: document.getElementById('canvas-container'),
            canvasEmpty: document.getElementById('canvas-empty'),
            fileUpload: document.getElementById('file-upload'),
            imageList: document.getElementById('image-list'),
            btnAnalyze: document.getElementById('btn-analyze'),
            btnModePan: document.getElementById('mode-pan'),
            btnModeDraw: document.getElementById('mode-draw'),
            btnClearRois: document.getElementById('btn-clear-rois'),
            btnUndo: document.getElementById('btn-undo'),
            btnZoomIn: document.getElementById('btn-zoom-in'),
            btnZoomOut: document.getElementById('btn-zoom-out'),
            btnZoomFit: document.getElementById('btn-zoom-fit'),
            zoomLevel: document.getElementById('zoom-level'),
            btnAnswerKey: document.getElementById('btn-answer-key'),
            btnBatchGrade: document.getElementById('btn-batch-grade'),
            btnGenerate: document.getElementById('btn-generate'),
            rightPanel: document.getElementById('right-panel-content'),
            rightPanelTitle: document.getElementById('right-panel-title'),
            steps: document.querySelectorAll('.step'),
            statusImages: document.getElementById('status-images'),
            statusAnswer: document.getElementById('status-answer'),
            statusZoom: document.getElementById('status-zoom'),
            statusAnswerDot: document.getElementById('status-answer-dot'),
        };

        this.els.ctx = this.els.canvas.getContext('2d', { willReadFrequently: true });

        ImageManager.init();
        CanvasManager.init();
        Grading.init();
        BatchProcess.init();
        Shortcuts.init();
        TestGenerator.init();
        TemplateManager.init();
        SessionManager.init();
        SubjectManager.init();
        Toast.init();

        this.updateStep(this.STEPS.UPLOAD);
        this.updateStatusBar();
    },

    getCurrentImage() {
        if (this.state.currentIndex === -1) return null;
        return this.state.images[this.state.currentIndex];
    },

    updateStep(step) {
        this.state.currentStep = step;
        this.els.steps.forEach(el => {
            const s = parseInt(el.dataset.step);
            el.classList.remove('active', 'done');
            if (s === step) el.classList.add('active');
            else if (s < step) el.classList.add('done');
        });
        UI.updateRightPanel();
    },

    // ──────────────────────────────────────────
    // 교시(Period) 헬퍼
    // ──────────────────────────────────────────

    // 현재 교시 객체 반환
    getCurrentPeriod() {
        if (!this.state.periods || !this.state.periods.length) return null;
        return this.state.periods.find(p => p.id === this.state.currentPeriodId)
            || this.state.periods[0];
    },

    // 현재 교시의 이미지 배열 반환 (하위호환: periods 없으면 state.images)
    getImages() {
        const p = this.getCurrentPeriod();
        return (p && p.images) ? p.images : this.state.images;
    },

    // 세션 초기화/로드 직후 호출 — 현재 App.state.images 를 p1 에 묶음
    // 반드시 App.state.images = [] 대입 직후에 호출해야 같은 참조가 유지됨
    _initPeriods(savedPeriods) {
        const firstImages = this.state.images; // 이미 [] 로 초기화된 상태

        // p1: 저장된 교시 메타가 있으면 복원, 없으면 현재 state 값 사용 (하위호환)
        const sp0 = savedPeriods && savedPeriods[0];
        const p1 = {
            id:        (sp0 && sp0.id)   || 'p1',
            name:      (sp0 && sp0.name) || '1교시',
            images:    firstImages,
            answerKey: (sp0 && sp0.answerKey !== undefined) ? sp0.answerKey : (this.state.answerKey || null),
            // subjects 는 세션 전역(App.state.subjects) 을 사용 — 교시 구분 없음
        };

        // answerKey 만 p1 값으로 동기화 (subjects 는 세션 전역)
        this.state.answerKey = p1.answerKey;

        // 저장된 추가 교시가 있으면 복원 (이미지는 Step 6에서 periodId 기반으로 분배됨)
        const extraPeriods = (savedPeriods || []).slice(1).map(sp => ({
            id:        sp.id,
            name:      sp.name,
            images:    [],
            answerKey: sp.answerKey || null,
        }));

        this.state.periods = [p1, ...extraPeriods];
        this.state.currentPeriodId = p1.id;

        // App.state.images 도 p1.images 와 동일한 참조로 유지
        this.state.images = p1.images;

        // 교시 탭 렌더링
        if (typeof PeriodManager !== 'undefined') PeriodManager.render();
    },

    // 교시 전환: 현재 교시 상태를 period 에 저장하고 새 교시로 전환
    setCurrentPeriod(periodId) {
        const p = this.state.periods.find(p => p.id === periodId);
        if (!p) return;

        // 현재 교시 상태 보존 (answerKey만; subjects는 세션 전역)
        const cur = this.getCurrentPeriod();
        if (cur) {
            cur.images    = this.state.images;
            cur.answerKey = this.state.answerKey;
        }

        // 새 교시로 전환 (answerKey만 교시별 전환; subjects는 그대로)
        this.state.currentPeriodId = periodId;
        this.state.images    = p.images;
        this.state.answerKey = p.answerKey || null;
        this.state.currentIndex = -1;

        // 교시 전환으로 images 참조가 바뀜 → 캐시 무효화
        if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
    },

    // App.state.answerKey 변경 시 현재 period 에 즉시 반영
    syncAnswerKey() {
        const p = this.getCurrentPeriod();
        if (p) p.answerKey = this.state.answerKey;
    },

    // subjects 는 세션 전역 — syncSubjects 는 no-op (하위호환 유지)
    syncSubjects() { /* subjects는 세션 전역으로 관리 (교시 구분 없음) */ },

    updateStatusBar() {
        const s = this.state;
        this.els.statusImages.textContent = `이미지 ${s.images.length}장`;
        const zoomPct = `${Math.round(s.zoom * 100)}%`;
        this.els.statusZoom.textContent = zoomPct;
        this.els.zoomLevel.textContent = zoomPct; // BUG11 fix

        if (s.answerKey) {
            this.els.statusAnswer.textContent = `정답 ${s.answerKey.numQuestions}문항 입력됨`;
            this.els.statusAnswerDot.className = 'status-dot';
        } else {
            this.els.statusAnswer.textContent = '정답 미입력';
            this.els.statusAnswerDot.className = 'status-dot inactive';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
