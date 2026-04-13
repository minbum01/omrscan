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
            btnExportCsv: document.getElementById('btn-export-csv'),
            btnExportExcel: document.getElementById('btn-export-excel'),
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
        ExportManager.init();
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
        const p1 = {
            id: 'p1',
            name: (savedPeriods && savedPeriods[0] && savedPeriods[0].name) || '1교시',
            images: firstImages,   // App.state.images 와 같은 참조
        };

        // 저장된 추가 교시가 있으면 빈 이미지 배열로 복원
        // (실제 이미지는 Step 6에서 periodId 기반으로 분배됨)
        const extraPeriods = (savedPeriods || []).slice(1).map(sp => ({
            id: sp.id,
            name: sp.name,
            images: [],
        }));

        this.state.periods = [p1, ...extraPeriods];
        this.state.currentPeriodId = (savedPeriods && savedPeriods[0] && savedPeriods[0].id) || 'p1';

        // App.state.images 도 p1.images 와 동일한 참조로 유지
        this.state.images = p1.images;
    },

    // 교시 전환 (Step 2에서 본격 사용 — 지금은 내부 준비만)
    setCurrentPeriod(periodId) {
        const p = this.state.periods.find(p => p.id === periodId);
        if (!p) return;
        // 현재 교시 images 를 해당 period 에 보존 후 교체
        const cur = this.getCurrentPeriod();
        if (cur) cur.images = this.state.images;
        this.state.currentPeriodId = periodId;
        this.state.images = p.images;
        this.state.currentIndex = -1;
    },

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
