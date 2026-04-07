// ============================================
// shortcuts.js - 키보드 단축키
// ============================================

const Shortcuts = {
    init() {
        document.addEventListener('keydown', (e) => this.handle(e));
    },

    handle(e) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.querySelector('.modal-overlay')) return;

        const ctrl = e.ctrlKey || e.metaKey;

        if (!ctrl && (e.key === 'v' || e.key === 'V')) {
            e.preventDefault();
            CanvasManager.setMode('pan');
        } else if (!ctrl && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            CanvasManager.setMode('draw');
        } else if (ctrl && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            CanvasManager.undoLastRoi();
        } else if (ctrl && e.shiftKey && e.key === 'Z') {
            e.preventDefault();
            CanvasManager.clearAllRois();
        } else if (e.key === 'Enter' && !ctrl) {
            e.preventDefault();
            CanvasManager.runAnalysis();
        } else if (ctrl && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            CanvasManager.zoomBy(0.15);
        } else if (ctrl && e.key === '-') {
            e.preventDefault();
            CanvasManager.zoomBy(-0.15);
        } else if (ctrl && e.key === '0') {
            e.preventDefault();
            CanvasManager.zoomFit();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            // 선택된 ROI 삭제
            if (CanvasManager.selectedRoiIdx >= 0) {
                CanvasManager.deleteRoi(CanvasManager.selectedRoiIdx);
                CanvasManager.selectedRoiIdx = -1;
                UI.updateRightPanel();
                return;
            }
            // 선택된 이미지 삭제
            if (App.state.currentIndex >= 0) {
                ImageManager.deleteImage(App.state.currentIndex);
            }
        }
    }
};
