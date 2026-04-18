// ============================================
// toast.js - 토스트 알림 (alert 대체)
// ============================================

const Toast = {
    container: null,

    init() {
        this.container = document.getElementById('toast-container');
    },

    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        let icon = '';
        if (type === 'success') icon = '✓';
        else if (type === 'error') icon = '✗';
        else icon = 'ℹ';

        toast.innerHTML = `<span style="font-weight:700">${icon}</span> ${message}`;
        this.container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            toast.style.transition = 'all 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error'); },
    info(msg) { this.show(msg, 'info'); },

    // 캔버스 오버레이 우측 상단 — 과목코드용 큰 토스트
    _canvasOverlay: null,
    canvasGuide(msg) {
        this.canvasGuideClear();
        const canvasContainer = document.getElementById('canvas-container') || document.querySelector('.canvas-container');
        if (!canvasContainer) { this.info(msg); return; }

        const el = document.createElement('div');
        el.id = 'toast-canvas-guide';
        el.style.cssText = `
            position:absolute; top:12px; right:12px; z-index:100;
            padding:14px 22px; border-radius:10px;
            background:linear-gradient(135deg, #1e1b4b, #312e81); color:#fff;
            font-size:15px; font-weight:700; letter-spacing:0.02em;
            box-shadow:0 6px 24px rgba(30,27,75,0.5);
            display:flex; align-items:center; gap:10px;
            animation: toast-guide-in 0.3s ease-out;
            pointer-events:none;
        `;
        el.innerHTML = `<span style="font-size:22px;">📋</span><span>${msg}</span>`;
        // 부모가 relative여야 absolute 위치 잡힘
        if (getComputedStyle(canvasContainer).position === 'static') {
            canvasContainer.style.position = 'relative';
        }
        canvasContainer.appendChild(el);
        this._canvasOverlay = el;
    },

    canvasGuideClear() {
        const el = document.getElementById('toast-canvas-guide');
        if (el) el.remove();
        this._canvasOverlay = null;
    }
};
