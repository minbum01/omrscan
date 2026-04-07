// ============================================
// testGenerator.js - 테스트용 가상 OMR 양식 생성
// ============================================

const TestGenerator = {
    init() {
        App.els.btnGenerate.addEventListener('click', () => this.generate());
    },

    generate() {
        const tc = document.createElement('canvas');
        tc.width = 1000; tc.height = 1000;
        const t = tc.getContext('2d');

        // 바탕
        t.fillStyle = '#e8e8e8';
        t.fillRect(0, 0, 1000, 1000);

        // 그림자
        const g = t.createLinearGradient(0, 0, 1000, 1000);
        g.addColorStop(0, 'rgba(0,0,0,0.08)');
        g.addColorStop(1, 'rgba(255,255,255,0.3)');
        t.fillStyle = g;
        t.fillRect(0, 0, 1000, 1000);

        t.fillStyle = '#333';
        t.font = 'bold 32px sans-serif';
        t.fillText('OMR 테스트 양식', 120, 70);

        this.drawGrid(t, 150, 140, 20, 5);

        const img = new Image();
        img.onload = () => {
            const thumb = ImageManager.createThumbnail(img);
            App.state.images.push({
                name: `테스트_${App.state.images.length + 1}.jpg`,
                imgElement: img, thumb,
                rois: [], results: null, gradeResult: null
            });

            if (App.state.images.length === 1) {
                ImageManager.select(0);
            } else {
                ImageManager.updateList();
            }
            App.updateStatusBar();
            Toast.success('테스트 양식 생성 완료');
        };
        img.src = tc.toDataURL('image/jpeg');
    },

    drawGrid(t, sx, sy, questions, choices) {
        const r = 13, gx = 38, gy = 40;

        for (let q = 0; q < questions; q++) {
            t.fillStyle = '#555';
            t.font = 'bold 15px Arial';
            t.fillText(`${q + 1}.`, sx - 38, sy + q * gy + 5);

            const ans = Math.floor(Math.random() * choices);

            for (let c = 0; c < choices; c++) {
                const cx = sx + c * gx, cy = sy + q * gy;

                t.beginPath();
                t.arc(cx, cy, r, 0, Math.PI * 2);
                t.strokeStyle = '#aaa';
                t.lineWidth = 1.5;
                t.stroke();

                if (c === ans && Math.random() > 0.08) {
                    t.strokeStyle = '#ef4444';
                    t.lineWidth = 3.5;
                    t.beginPath();
                    t.moveTo(cx - 9, cy + 9);
                    t.lineTo(cx + 9, cy - 9);
                    t.stroke();
                }
            }
        }
    }
};
