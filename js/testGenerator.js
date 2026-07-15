// ============================================
// testGenerator.js - 테스트용 가상 OMR 양식 생성
// 개발용 전용 도구 (버튼은 UI에서 숨겨져 있음, DevTools 콘솔에서 TestGenerator.generate({...})로 호출)
// ============================================

const TestGenerator = {
    // 타이밍마크 규격 — omrEngine.js의 타이밍마크 검출 로직과 반드시 동일한 좌표 규칙을 따라야 함
    // (문항번호 텍스트보다 더 왼쪽에, 행마다 하나씩, 버블 영역과 무관하게 항상 인쇄됨)
    TIMING_MARK: { gapFromLabel: 30, width: 10, height: 14 },

    init() {
        App.els.btnGenerate.addEventListener('click', () => this.generate());
    },

    // opts:
    //   withTimingMarks: 타이밍마크 띠 포함 여부 (기본 true)
    //   eraseRowIndex:   0-based 문항 인덱스 — 해당 행을 수정테이프로 지운 것처럼 시뮬레이션 (버블만 하얗게 덮음, 타이밍마크는 유지)
    //   bleedRowIndex:   0-based 문항 인덱스 — 해당 행의 정답 버블을 옆 칸까지 번지도록 과도하게 크게 칠함
    generate(opts = {}) {
        const {
            withTimingMarks = true,
            eraseRowIndex = null,
            bleedRowIndex = null,
        } = opts;

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

        this.drawGrid(t, 150, 140, 20, 5, { withTimingMarks, eraseRowIndex, bleedRowIndex });

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
            Toast.success('테스트 양식 생성 완료' + (withTimingMarks ? ' (타이밍마크 포함)' : ''));
        };
        img.src = tc.toDataURL('image/jpeg');
    },

    drawGrid(t, sx, sy, questions, choices, opts = {}) {
        const { withTimingMarks = false, eraseRowIndex = null, bleedRowIndex = null } = opts;
        const r = 13, gx = 38, gy = 40;
        const tm = this.TIMING_MARK;
        const labelX = sx - 38;
        const markX = labelX - tm.gapFromLabel - tm.width / 2;

        for (let q = 0; q < questions; q++) {
            const rowY = sy + q * gy;

            // 타이밍마크 — 버블 마킹/훼손과 무관하게 항상 인쇄됨 (지운 행이라도 살아있어야 함)
            if (withTimingMarks) {
                t.fillStyle = '#000';
                t.fillRect(markX, rowY - tm.height / 2, tm.width, tm.height);
            }

            t.fillStyle = '#555';
            t.font = 'bold 15px Arial';
            t.fillText(`${q + 1}.`, labelX, rowY + 5);

            const ans = Math.floor(Math.random() * choices);

            for (let c = 0; c < choices; c++) {
                const cx = sx + c * gx, cy = rowY;

                t.beginPath();
                t.arc(cx, cy, r, 0, Math.PI * 2);
                t.strokeStyle = '#aaa';
                t.lineWidth = 1.5;
                t.stroke();

                if (c === ans && Math.random() > 0.08) {
                    if (q === bleedRowIndex) {
                        // 번짐 시뮬레이션 — 버블 경계를 넘어 옆 칸 쪽으로 과도하게 칠함
                        t.fillStyle = '#333';
                        t.beginPath();
                        t.ellipse(cx + gx * 0.35, cy, r * 1.9, r * 1.3, 0, 0, Math.PI * 2);
                        t.fill();
                    } else {
                        t.strokeStyle = '#ef4444';
                        t.lineWidth = 3.5;
                        t.beginPath();
                        t.moveTo(cx - 9, cy + 9);
                        t.lineTo(cx + 9, cy - 9);
                        t.stroke();
                    }
                }
            }

            // 지운 행 시뮬레이션 — 수정테이프로 버블 영역만 하얗게 덮음 (타이밍마크 영역은 침범하지 않음)
            if (q === eraseRowIndex) {
                const left = sx - r - 6;
                const right = sx + (choices - 1) * gx + r + 6;
                t.fillStyle = '#fff';
                t.fillRect(left, rowY - r - 6, right - left, (r + 6) * 2);
            }
        }
    }
};
