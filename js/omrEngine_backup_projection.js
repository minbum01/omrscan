// ============================================
// omrEngine.js - OMR 판독 엔진 (투영 기반)
// BFS 대신 수평/수직 투영으로 그리드 감지 후 각 셀 독립 판독
// ============================================

const OmrEngine = {

    // ==========================================
    // 전처리: 채도 보정 + 밝기 정규화 + 대비 강화
    // ==========================================
    preprocess(imageData) {
        const data = imageData.data;
        const len = data.length / 4;

        const gray = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
            let val = minC;
            if (saturation > 0.15) {
                val = Math.max(0, val - Math.round(saturation * 120));
            }
            gray[i] = val;
        }

        const histogram = new Uint32Array(256);
        for (let i = 0; i < len; i++) histogram[gray[i]]++;
        const cutoff = Math.floor(len * 0.01);
        let darkVal = 0, lightVal = 255, count = 0;
        for (let v = 0; v < 256; v++) { count += histogram[v]; if (count >= cutoff) { darkVal = v; break; } }
        count = 0;
        for (let v = 255; v >= 0; v--) { count += histogram[v]; if (count >= cutoff) { lightVal = v; break; } }
        const range = Math.max(lightVal - darkVal, 1);
        for (let i = 0; i < len; i++) {
            gray[i] = Math.max(0, Math.min(255, Math.round(((gray[i] - darkVal) / range) * 255)));
        }

        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            const x = i / 255;
            lut[i] = Math.round(255 / (1 + Math.exp(-10 * (x - 0.5))));
        }
        for (let i = 0; i < len; i++) gray[i] = lut[gray[i]];

        return gray;
    },

    // ==========================================
    // 투영 기반 그리드 감지
    // ==========================================
    detectGrid(grayData, width, height) {
        const DARK_THRESHOLD = 128;

        // 수평 투영: 각 y줄의 어두운 픽셀 비율
        const hProj = new Float32Array(height);
        for (let y = 0; y < height; y++) {
            let darkCount = 0;
            for (let x = 0; x < width; x++) {
                if (grayData[y * width + x] < DARK_THRESHOLD) darkCount++;
            }
            hProj[y] = darkCount / width;
        }

        // 수직 투영: 각 x줄의 어두운 픽셀 비율
        const vProj = new Float32Array(width);
        for (let x = 0; x < width; x++) {
            let darkCount = 0;
            for (let y = 0; y < height; y++) {
                if (grayData[y * width + x] < DARK_THRESHOLD) darkCount++;
            }
            vProj[x] = darkCount / height;
        }

        // 피크 감지 (로컬 최대값)
        const rowPositions = this.findPeaks(hProj, height);
        const colPositions = this.findPeaks(vProj, width);

        console.log(`[그리드] 행 피크: ${rowPositions.length}개, 열 피크: ${colPositions.length}개`);

        return { rowPositions, colPositions };
    },

    // 피크 감지: 투영 데이터에서 규칙적인 피크 위치 찾기
    findPeaks(proj, len) {
        // 1. 투영 데이터 스무딩 (노이즈 제거)
        const smoothed = new Float32Array(len);
        const kernel = 3;
        for (let i = 0; i < len; i++) {
            let sum = 0, cnt = 0;
            for (let k = -kernel; k <= kernel; k++) {
                const idx = i + k;
                if (idx >= 0 && idx < len) { sum += proj[idx]; cnt++; }
            }
            smoothed[i] = sum / cnt;
        }

        // 2. 평균보다 높은 구간의 중심점 찾기
        const avg = smoothed.reduce((a, b) => a + b, 0) / len;
        const threshold = avg * 1.2; // 평균의 120% 이상이면 피크 구간

        const peaks = [];
        let inPeak = false;
        let peakStart = 0;

        for (let i = 0; i < len; i++) {
            if (smoothed[i] > threshold && !inPeak) {
                inPeak = true;
                peakStart = i;
            } else if ((smoothed[i] <= threshold || i === len - 1) && inPeak) {
                inPeak = false;
                const center = Math.round((peakStart + i) / 2);
                peaks.push(center);
            }
        }

        // 3. 피크 간격이 너무 가까운 것 병합
        if (peaks.length < 2) return peaks;

        const gaps = [];
        for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
        const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        const minGap = medianGap * 0.4;

        const merged = [peaks[0]];
        for (let i = 1; i < peaks.length; i++) {
            if (peaks[i] - merged[merged.length - 1] < minGap) {
                // 너무 가까우면 평균으로 병합
                merged[merged.length - 1] = Math.round((merged[merged.length - 1] + peaks[i]) / 2);
            } else {
                merged.push(peaks[i]);
            }
        }

        return merged;
    },

    // ==========================================
    // 각 셀 독립 판독
    // ==========================================
    analyzeCells(grayData, width, height, rowPositions, colPositions, offsetX, offsetY) {
        if (rowPositions.length === 0 || colPositions.length === 0) {
            return { rows: [], maxCols: 0 };
        }

        // 셀 크기 추정 (피크 간격의 절반)
        const rowGaps = [];
        for (let i = 1; i < rowPositions.length; i++) rowGaps.push(rowPositions[i] - rowPositions[i - 1]);
        const colGaps = [];
        for (let i = 1; i < colPositions.length; i++) colGaps.push(colPositions[i] - colPositions[i - 1]);

        const cellH = rowGaps.length > 0 ? rowGaps.sort((a, b) => a - b)[Math.floor(rowGaps.length / 2)] : 20;
        const cellW = colGaps.length > 0 ? colGaps.sort((a, b) => a - b)[Math.floor(colGaps.length / 2)] : 20;

        // 샘플링 영역: 피크 중심에서 셀 크기의 60%
        const sampleW = Math.round(cellW * 0.6);
        const sampleH = Math.round(cellH * 0.6);

        const DARK_THRESHOLD = 128;
        const structuredRows = [];

        rowPositions.forEach((rowY, rowIdx) => {
            const blobs = [];

            colPositions.forEach((colX, colIdx) => {
                // 샘플링 영역 좌표
                const sx = Math.round(colX - sampleW / 2);
                const sy = Math.round(rowY - sampleH / 2);

                let darkCount = 0;
                let totalPx = 0;
                let brightnessSum = 0;

                // 중심부 (샘플의 내부 50%)
                const cMarginX = Math.round(sampleW * 0.25);
                const cMarginY = Math.round(sampleH * 0.25);
                let centerDark = 0;
                let centerTotal = 0;

                for (let yy = 0; yy < sampleH; yy++) {
                    for (let xx = 0; xx < sampleW; xx++) {
                        const px = sx + xx;
                        const py = sy + yy;
                        if (px >= 0 && px < width && py >= 0 && py < height) {
                            const val = grayData[py * width + px];
                            brightnessSum += val;
                            totalPx++;
                            if (val < DARK_THRESHOLD) darkCount++;

                            if (xx >= cMarginX && xx < sampleW - cMarginX &&
                                yy >= cMarginY && yy < sampleH - cMarginY) {
                                centerTotal++;
                                if (val < DARK_THRESHOLD) centerDark++;
                            }
                        }
                    }
                }

                const avgBrightness = totalPx > 0 ? brightnessSum / totalPx : 255;
                const inkRatio = totalPx > 0 ? darkCount / totalPx : 0;
                const centerFillRatio = centerTotal > 0 ? centerDark / centerTotal : 0;

                blobs.push({
                    x: sx + offsetX, y: sy + offsetY,
                    w: sampleW, h: sampleH,
                    cx: colX + offsetX, cy: rowY + offsetY,
                    r: Math.min(sampleW, sampleH) / 2,
                    boxBrightness: avgBrightness,
                    inkRatio,
                    centerFillRatio,
                    isMarked: false
                });
            });

            // 행 내 마킹 판별 (기존 상대 비교)
            let markedIndex = -1;
            let maxScore = -999;
            let brightnessSum = 0;
            let inkSum = 0;
            let fillSum = 0;

            const scores = [];
            blobs.forEach((b, idx) => {
                brightnessSum += b.boxBrightness;
                inkSum += b.inkRatio;
                fillSum += b.centerFillRatio;
                const score = (b.inkRatio * 300) + (255 - b.boxBrightness) + (b.centerFillRatio * 800);
                scores.push({ idx: idx + 1, score: Math.round(score), bright: Math.round(b.boxBrightness), ink: b.inkRatio.toFixed(3), fill: b.centerFillRatio.toFixed(3) });
                if (score > maxScore) { maxScore = score; markedIndex = idx; }
            });

            const avgBright = brightnessSum / blobs.length;
            const avgInk = inkSum / blobs.length;
            const avgFill = fillSum / blobs.length;

            console.log(`  행${rowIdx + 1} (${blobs.length}셀):`, scores.map(s => `[${s.idx}] score=${s.score} bright=${s.bright} ink=${s.ink} fill=${s.fill}`).join(' | '));

            // 마킹 확정
            let primaryMarked = -1;
            if (markedIndex !== -1 && blobs.length > 1) {
                const sel = blobs[markedIndex];
                const diff = avgBright - sel.boxBrightness;
                const inkDiff = sel.inkRatio - avgInk;
                const fillDiff = sel.centerFillRatio - avgFill;
                if (diff > 8 || inkDiff > 0.03 || fillDiff > 0.05) {
                    primaryMarked = markedIndex;
                }
            } else if (blobs.length === 1) {
                primaryMarked = 0;
            }

            // 중복 마킹 감지
            const markedIndices = [];
            if (primaryMarked !== -1 && blobs.length > 1) {
                const pb = blobs[primaryMarked];
                const pScore = (pb.inkRatio * 300) + (255 - pb.boxBrightness) + (pb.centerFillRatio * 800);
                blobs.forEach((b, idx) => {
                    const score = (b.inkRatio * 300) + (255 - b.boxBrightness) + (b.centerFillRatio * 800);
                    const fillDiff = b.centerFillRatio - avgFill;
                    const inkDiff = b.inkRatio - avgInk;
                    if (score > pScore * 0.8 && (fillDiff > 0.08 || inkDiff > 0.06)) {
                        markedIndices.push(idx);
                    }
                });
                if (!markedIndices.includes(primaryMarked)) markedIndices.unshift(primaryMarked);
            } else if (primaryMarked !== -1) {
                markedIndices.push(primaryMarked);
            }

            const isMultiMarked = markedIndices.length > 1;
            if (isMultiMarked) {
                markedIndices.forEach(idx => { blobs[idx].isMarked = true; });
            } else if (primaryMarked !== -1) {
                blobs[primaryMarked].isMarked = true;
            }

            let finalMarked = null;
            if (!isMultiMarked && primaryMarked !== -1) {
                finalMarked = primaryMarked + 1;
            }

            console.log(`    → 행${rowIdx + 1}: answer=${finalMarked} multi=${isMultiMarked}`);

            structuredRows.push({
                questionNumber: rowIdx + 1,
                numChoices: blobs.length,
                markedAnswer: finalMarked,
                multiMarked: isMultiMarked,
                markedIndices: markedIndices.map(i => i + 1),
                blobs
            });
        });

        return { rows: structuredRows, maxCols: colPositions.length };
    },

    // ==========================================
    // 메인 분석 (외부 호출용)
    // ==========================================
    analyzeStructure(blobs, orientation = 'vertical') {
        // 투영 기반에서는 이 함수는 하위 호환용
        // 실제 분석은 analyzeROI에서 수행
        return { rows: [], maxCols: 0 };
    },

    // ROI 전체 분석 (전처리 → 그리드 감지 → 셀 판독)
    analyzeROI(imageData, offsetX, offsetY, orientation = 'vertical') {
        const width = imageData.width;
        const height = imageData.height;
        const grayData = this.preprocess(imageData);

        const { rowPositions, colPositions } = this.detectGrid(grayData, width, height);

        let result;
        if (orientation === 'horizontal') {
            // 가로: 행과 열을 뒤집어서 분석
            result = this.analyzeCells(grayData, width, height, colPositions, rowPositions, offsetX, offsetY);
        } else {
            result = this.analyzeCells(grayData, width, height, rowPositions, colPositions, offsetX, offsetY);
        }

        return result;
    },

    // ==========================================
    // 자동 감지 (ROI에서 문항수/지선다/방향 추정)
    // ==========================================
    autoDetect(imageData, offsetX, offsetY) {
        const width = imageData.width;
        const height = imageData.height;
        const grayData = this.preprocess(imageData);

        const { rowPositions, colPositions } = this.detectGrid(grayData, width, height);

        if (rowPositions.length < 1 || colPositions.length < 1) return null;

        const numRows = rowPositions.length;
        const numCols = colPositions.length;

        let orientation, numQuestions, numChoices;
        if (numCols > 5) {
            orientation = 'horizontal';
            numQuestions = numCols;
            numChoices = numRows;
        } else {
            orientation = 'vertical';
            numQuestions = numRows;
            numChoices = numCols;
        }

        console.log(`[자동감지] 행=${numRows} 열=${numCols} → 방향=${orientation} 문항=${numQuestions} 지선다=${numChoices}`);
        return { orientation, numQuestions, numChoices };
    },

    // BFS용 하위 호환 (autoDetect에서 사용하지 않지만 다른 곳에서 참조 시 에러 방지)
    findBlobs(imageData, offsetX, offsetY) {
        return { blobs: [], pixelCtx: null };
    },
    filterBlobs(blobs) {
        return blobs;
    }
};
