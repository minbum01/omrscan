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
