// ============================================
// shortcuts.js - 키보드 단축키
// ============================================

const Shortcuts = {
    init() {
        document.addEventListener('keydown', (e) => this.handle(e));
    },

    handle(e) {
        // ESC: 열린 ROI 설정 팝업이 있으면 닫기 (인풋 포커스 상관없이)
        if (e.key === 'Escape') {
            const roiPopup = document.getElementById('roi-settings-popup');
            if (roiPopup) {
                e.preventDefault();
                UI.closeRoiSettingsPopup();
                return;
            }
        }

        const tag = e.target.tagName;
        const isInputFocus = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

        // 채점 탭에서는 분석 탭 단축키 무시
        const scoringView = document.getElementById('scoring-view');
        if (scoringView && scoringView.style.display !== 'none') return;

        // Delete: 영역 선택되어 있으면 input 포커스와 무관하게 삭제 가능 (단, 텍스트 입력 중이 아닐 때)
        if (e.key === 'Delete' && !isInputFocus && CanvasManager.selectedRoiIdx >= 0) {
            e.preventDefault();
            CanvasManager.deleteRoi(CanvasManager.selectedRoiIdx);
            CanvasManager.selectedRoiIdx = -1;
            UI.updateRightPanel();
            return;
        }

        if (isInputFocus) return;
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
            // 선택된 이미지 삭제 (ROI가 없을 때만)
            if (App.state.currentIndex >= 0) {
                ImageManager.deleteImage(App.state.currentIndex);
            }
        }
    }
};
