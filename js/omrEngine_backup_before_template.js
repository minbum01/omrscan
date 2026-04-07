// ============================================
// omrEngine.js - OMR 판독 엔진 (투영 프로파일 기반)
// ============================================

const OmrEngine = {

    // ==========================================
    // 전처리
    // ==========================================
    preprocess(imageData) {
        const data = imageData.data;
        const len = data.length / 4;
        const gray = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
            const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
            const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
            let val = minC;
            if (sat > 0.15) val = Math.max(0, val - Math.round(sat * 120));
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
        for (let i = 0; i < len; i++) gray[i] = Math.max(0, Math.min(255, Math.round(((gray[i] - darkVal) / range) * 255)));
        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) { const x = i / 255; lut[i] = Math.round(255 / (1 + Math.exp(-10 * (x - 0.5)))); }
        for (let i = 0; i < len; i++) gray[i] = lut[gray[i]];
        return gray;
    },

    // ==========================================
    // 셀 샘플링 (로컬 적응형 임계값)
    // ==========================================
    sampleCell(gray, imgW, imgH, cx, cy, sampleW, sampleH) {
        const sx = Math.round(cx - sampleW / 2), sy = Math.round(cy - sampleH / 2);
        const sw = Math.round(sampleW), sh = Math.round(sampleH);
        let brightSum = 0, total = 0;
        for (let yy = 0; yy < sh; yy++) {
            for (let xx = 0; xx < sw; xx++) {
                const px = sx + xx, py = sy + yy;
                if (px >= 0 && px < imgW && py >= 0 && py < imgH) { brightSum += gray[py * imgW + px]; total++; }
            }
        }
        if (total === 0) return { brightness: 255, darkRatio: 0, centerFill: 0 };
        const localMean = brightSum / total;
        const localThreshold = localMean * 0.75;
        let darkCount = 0, centerDark = 0, centerTotal = 0;
        const cmx = Math.round(sw * 0.25), cmy = Math.round(sh * 0.25);
        for (let yy = 0; yy < sh; yy++) {
            for (let xx = 0; xx < sw; xx++) {
                const px = sx + xx, py = sy + yy;
                if (px >= 0 && px < imgW && py >= 0 && py < imgH) {
                    const val = gray[py * imgW + px];
                    if (val < localThreshold) darkCount++;
                    if (xx >= cmx && xx < sw - cmx && yy >= cmy && yy < sh - cmy) { centerTotal++; if (val < localThreshold) centerDark++; }
                }
            }
        }
        return { brightness: localMean, darkRatio: darkCount / total, centerFill: centerTotal > 0 ? centerDark / centerTotal : 0 };
    },

    // ==========================================
    // 투영 프로파일 기반 그리드 감지
    // ==========================================
    findGrid(grayData, width, height) {
        // 1. 어두움 투영 프로파일 계산
        const xProj = new Float64Array(width);   // 각 x열의 어두움 합
        const yProj = new Float64Array(height);  // 각 y행의 어두움 합

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const d = 255 - grayData[y * width + x];
                xProj[x] += d;
                yProj[y] += d;
            }
        }

        // 2. 피크 찾기
        const colPeaks = this._findPeaks(xProj, width);
        const rowPeaks = this._findPeaks(yProj, height);

        console.log(`[투영감지] X피크=${colPeaks.length}개 [${colPeaks.map(p=>Math.round(p.pos)).join(',')}]`);
        console.log(`[투영감지] Y피크=${rowPeaks.length}개 [${rowPeaks.map(p=>Math.round(p.pos)).join(',')}]`);

        if (colPeaks.length < 2 || rowPeaks.length < 1) return null;

        const colXs = colPeaks.map(p => p.pos);
        const rowYs = rowPeaks.map(p => p.pos);

        // 디버그 저장
        this._debugBlobs = { all: [], filtered: [] };
        this._debugProjection = {
            xProj: Array.from(xProj),
            yProj: Array.from(yProj),
            colPeaks, rowPeaks
        };

        return {
            rowYs, colXs,
            numRows: rowPeaks.length,
            numCols: colPeaks.length,
            modeColCount: colPeaks.length
        };
    },

    // ==========================================
    // 1D 피크 감지
    // ==========================================
    _findPeaks(profile, len) {
        if (len < 3) return [];

        // 1. 스무딩 (이동 평균)
        const win = Math.max(2, Math.round(len * 0.012));
        const sm = new Float64Array(len);
        for (let i = 0; i < len; i++) {
            let s = 0, c = 0;
            for (let j = Math.max(0, i - win); j <= Math.min(len - 1, i + win); j++) { s += profile[j]; c++; }
            sm[i] = s / c;
        }

        // 2. 로컬 최대값 찾기
        const raw = [];
        for (let i = 1; i < len - 1; i++) {
            if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1]) {
                raw.push({ pos: i, val: sm[i] });
            }
        }
        if (raw.length < 1) return [];

        // 3. 높이 필터 (최대 피크의 15% 이상)
        const maxV = Math.max(...raw.map(p => p.val));
        let peaks = raw.filter(p => p.val >= maxV * 0.15);
        peaks.sort((a, b) => a.pos - b.pos);

        if (peaks.length < 2) return peaks;

        // 4. 가까운 피크 병합 (간격 중간값의 40% 이내)
        const gaps = [];
        for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i].pos - peaks[i - 1].pos);
        const medGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        const minDist = medGap * 0.4;

        const merged = [peaks[0]];
        for (let i = 1; i < peaks.length; i++) {
            if (peaks[i].pos - merged[merged.length - 1].pos < minDist) {
                if (peaks[i].val > merged[merged.length - 1].val) merged[merged.length - 1] = peaks[i];
            } else {
                merged.push(peaks[i]);
            }
        }

        // 5. 규칙성 필터: 너무 먼 고립 피크 제거
        if (merged.length >= 3) {
            const mGaps = [];
            for (let i = 1; i < merged.length; i++) mGaps.push(merged[i].pos - merged[i - 1].pos);
            const mMedGap = [...mGaps].sort((a, b) => a - b)[Math.floor(mGaps.length / 2)];

            const good = [merged[0]];
            for (let i = 1; i < merged.length; i++) {
                const gap = merged[i].pos - good[good.length - 1].pos;
                if (gap < mMedGap * 2.5) {
                    good.push(merged[i]);
                } else {
                    // 고립 피크 → 새 그룹 시작 가능성 체크
                    // 뒤에 비슷한 간격의 피크가 있으면 유지
                    if (i + 1 < merged.length && merged[i + 1].pos - merged[i].pos < mMedGap * 1.8) {
                        good.push(merged[i]);
                    }
                }
            }
            return good;
        }

        return merged;
    },

    // ==========================================
    // 위치 조정 (초과/부족 시 균등분할 포함)
    // ==========================================
    adjustPositions(positions, expected) {
        if (positions.length === expected) return positions;

        if (positions.length === 0) {
            // 위치 정보 없음 → 균등 분할 불가 (외부에서 ROI 크기로 처리)
            return [];
        }

        if (positions.length > expected) {
            // 초과: 가장 균등한 간격의 N개 선택
            let bestStart = 0, bestVar = Infinity;
            for (let s = 0; s <= positions.length - expected; s++) {
                const sub = positions.slice(s, s + expected);
                const gaps = [];
                for (let i = 1; i < sub.length; i++) gaps.push(sub[i] - sub[i - 1]);
                if (gaps.length === 0) continue;
                const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
                const v = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
                if (v < bestVar) { bestVar = v; bestStart = s; }
            }
            return positions.slice(bestStart, bestStart + expected);
        }

        // 부족: 기존 피크 간격 기반으로 보간
        const gaps = [];
        for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i - 1]);
        const medGap = gaps.length > 0 ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 20;

        const result = [...positions];
        // 끝에 추가
        while (result.length < expected) result.push(result[result.length - 1] + medGap);
        return result.slice(0, expected);
    },

    // ==========================================
    // 메인 분석
    // ==========================================
    analyzeROI(imageData, offsetX, offsetY, orientation = 'vertical', numQ = 0, numC = 0) {
        const width = imageData.width, height = imageData.height;
        const grayData = this.preprocess(imageData);

        // 1. 투영 프로파일로 그리드 감지
        const grid = this.findGrid(grayData, width, height);

        // 2. 방향 결정
        if (!orientation || orientation === '') {
            if (grid) {
                orientation = (grid.numCols > grid.numRows) ? 'horizontal' : 'vertical';
            } else {
                orientation = 'vertical';
            }
        }
        const isVert = orientation === 'vertical';

        // 3. 위치 결정: 투영 감지 → 사용자 설정 → 균등 분할
        let qPositions, cPositions;

        if (grid) {
            const gridNumQ = isVert ? grid.numRows : grid.numCols;
            const gridNumC = isVert ? grid.numCols : grid.numRows;
            if (numQ <= 0) numQ = gridNumQ;
            if (numC <= 0) numC = gridNumC;

            qPositions = isVert ? [...grid.rowYs] : [...grid.colXs];
            cPositions = isVert ? [...grid.colXs] : [...grid.rowYs];

            // 사용자가 다른 수를 지정하면 조정
            if (numQ !== qPositions.length) qPositions = this.adjustPositions(qPositions, numQ);
            if (numC !== cPositions.length) cPositions = this.adjustPositions(cPositions, numC);
        } else {
            // 투영 감지 실패 → ROI 균등 분할
            if (numQ <= 0) numQ = 5;
            if (numC <= 0) numC = 4;
            const qSize = isVert ? height : width;
            const cSize = isVert ? width : height;
            qPositions = Array.from({ length: numQ }, (_, i) => (i + 0.5) * qSize / numQ);
            cPositions = Array.from({ length: numC }, (_, i) => (i + 0.5) * cSize / numC);
            console.log(`[균등분할] 투영 감지 실패 → ${numQ}×${numC} 균등 분할`);
        }

        // 4. 샘플 크기
        const qGap = qPositions.length > 1 ? Math.abs(qPositions[1] - qPositions[0]) : 20;
        const cGap = cPositions.length > 1 ? Math.abs(cPositions[1] - cPositions[0]) : 20;

        // ROI 클램핑
        const halfW = cGap * 0.35, halfH = qGap * 0.35;
        qPositions = qPositions.filter(p => p >= halfH && p <= (isVert ? height : width) - halfH);
        cPositions = cPositions.filter(p => p >= halfW && p <= (isVert ? width : height) - halfW);
        numQ = qPositions.length;
        numC = cPositions.length;

        if (numQ === 0 || numC === 0) return { rows: [], maxCols: 0 };

        const sampleW = cGap * 0.7;
        const sampleH = qGap * 0.7;

        console.log(`[그리드분석] ${numQ}문항 × ${numC}지선다, ${isVert ? '세로' : '가로'}, Q위치=[${qPositions.map(p => Math.round(p)).join(',')}], C위치=[${cPositions.map(p => Math.round(p)).join(',')}]`);

        // 5. 각 셀 샘플링 + 마킹 판별
        const structuredRows = [];

        for (let q = 0; q < numQ; q++) {
            const blobs = [], cellScores = [];

            for (let c = 0; c < numC; c++) {
                const cx = isVert ? cPositions[c] : qPositions[q];
                const cy = isVert ? qPositions[q] : cPositions[c];

                const sample = this.sampleCell(grayData, width, height, cx, cy, sampleW, sampleH);
                const score = (sample.darkRatio * 300) + (255 - sample.brightness) + (sample.centerFill * 800);

                cellScores.push({ col: c, score, brightness: sample.brightness, darkRatio: sample.darkRatio, centerFill: sample.centerFill });
                blobs.push({
                    x: Math.round(cx - sampleW / 2) + offsetX, y: Math.round(cy - sampleH / 2) + offsetY,
                    w: Math.round(sampleW), h: Math.round(sampleH),
                    cx: cx + offsetX, cy: cy + offsetY, r: Math.min(sampleW, sampleH) / 2,
                    boxBrightness: sample.brightness, inkRatio: sample.darkRatio, centerFillRatio: sample.centerFill, isMarked: false
                });
            }

            if (cellScores.length === 0) continue;

            // 돌출도 계산
            const prominences = cellScores.map((c, i) => {
                const others = cellScores.filter((_, j) => j !== i);
                const oAvg = others.length > 0 ? others.reduce((s, o) => s + o.score, 0) / others.length : 0;
                return { idx: i, prom: c.score - oAvg };
            }).sort((a, b) => b.prom - a.prom);
            const bestProm = prominences[0].prom;
            const secondProm = prominences.length > 1 ? prominences[1].prom : 0;
            const promRatio = secondProm > 0 ? bestProm / secondProm : (bestProm > 30 ? 999 : 0);

            // 최고 점수
            let bestIdx = -1, bestScore = -999;
            const avgBright = cellScores.reduce((s, c) => s + c.brightness, 0) / cellScores.length;
            const avgInk = cellScores.reduce((s, c) => s + c.darkRatio, 0) / cellScores.length;
            const avgFill = cellScores.reduce((s, c) => s + c.centerFill, 0) / cellScores.length;
            cellScores.forEach((c, i) => { if (c.score > bestScore) { bestScore = c.score; bestIdx = i; } });

            // 마킹 판별
            let primaryMarked = -1;
            if (bestIdx !== -1 && numC > 1) {
                const best = cellScores[bestIdx];
                const dB = avgBright - best.brightness, dI = best.darkRatio - avgInk, dF = best.centerFill - avgFill;

                if ((dB > 8 || dI > 0.03 || dF > 0.05) && promRatio > 1.5) {
                    primaryMarked = bestIdx;
                }

                // 1차가 불확실할 때만 2차 검증
                const bestFill = cellScores[bestIdx].centerFill;
                if (promRatio < 3 && bestFill < 0.9) {
                    const narrowW = sampleW * 0.5, narrowH = sampleH * 0.5;
                    const narrowScores = [];
                    for (let c2 = 0; c2 < numC; c2++) {
                        const cx2 = isVert ? cPositions[c2] : qPositions[q];
                        const cy2 = isVert ? qPositions[q] : cPositions[c2];
                        const s2 = this.sampleCell(grayData, width, height, cx2, cy2, narrowW, narrowH);
                        narrowScores.push({ col: c2, score: (s2.darkRatio * 300) + (255 - s2.brightness) + (s2.centerFill * 800) });
                    }

                    const nProms = narrowScores.map((c, i) => {
                        const others = narrowScores.filter((_, j) => j !== i);
                        const oA = others.length > 0 ? others.reduce((s, o) => s + o.score, 0) / others.length : 0;
                        return { idx: i, prom: c.score - oA };
                    }).sort((a, b) => b.prom - a.prom);
                    const nBestProm = nProms[0].prom;
                    const nSecondProm = nProms.length > 1 ? nProms[1].prom : 0;
                    const nPromRatio = nSecondProm > 0 ? nBestProm / nSecondProm : (nBestProm > 30 ? 999 : 0);
                    const nBestIdx = nProms[0].idx;

                    const nScoreLog = narrowScores.map((c, i) => `[${i + 1}]=${Math.round(c.score)}`).join(' ');
                    console.log(`    → Q${q + 1} 2차검증: ${nScoreLog} prom=${nPromRatio.toFixed(2)} (1차: ${primaryMarked !== -1 ? primaryMarked + 1 : 'null'})`);

                    if (nPromRatio > 1.5) {
                        if (primaryMarked === -1 || nBestIdx !== primaryMarked) {
                            primaryMarked = nBestIdx;
                            console.log(`    → Q${q + 1} 2차 채택: answer=${primaryMarked + 1}`);
                        }
                    } else if (primaryMarked !== -1) {
                        console.log(`    → Q${q + 1} 2차 불확실: 미기입 처리`);
                        primaryMarked = -1;
                    }
                }
            } else if (numC === 1) primaryMarked = 0;

            // 메인 로그
            console.log(`  Q${q + 1}: ${cellScores.map(c => `[${c.col + 1}] s=${Math.round(c.score)} b=${Math.round(c.brightness)} f=${c.centerFill.toFixed(3)}`).join(' | ')} prom=${promRatio.toFixed(2)}`);

            // 중복 감지
            const markedIndices = [];
            if (primaryMarked !== -1 && numC > 1) {
                const pS = cellScores[primaryMarked].score;
                const pF = cellScores[primaryMarked].centerFill;
                cellScores.forEach((c, i) => {
                    if (i === primaryMarked) return;
                    if (c.score > pS * 0.95 && c.centerFill > pF * 0.9 && c.centerFill > 0.8) markedIndices.push(i);
                });
                if (markedIndices.length > 0) markedIndices.unshift(primaryMarked);
            }
            if (markedIndices.length === 0 && primaryMarked !== -1) markedIndices.push(primaryMarked);

            const isMulti = markedIndices.length > 1;
            if (isMulti) markedIndices.forEach(i => { blobs[i].isMarked = true; });
            else if (primaryMarked !== -1) blobs[primaryMarked].isMarked = true;

            const finalMarked = !isMulti && primaryMarked !== -1 ? primaryMarked + 1 : null;
            console.log(`    → answer=${finalMarked}${isMulti ? ' (중복)' : ''}`);

            structuredRows.push({ questionNumber: q + 1, numChoices: numC, markedAnswer: finalMarked, multiMarked: isMulti, markedIndices: markedIndices.map(i => i + 1), blobs });
        }

        // 디버그 블롭
        const debugBlobs = this._debugBlobs ? {
            all: this._debugBlobs.all.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
            filtered: this._debugBlobs.filtered.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
        } : null;

        return { rows: structuredRows, maxCols: numC, debugBlobs };
    },

    // ==========================================
    // 자동 감지
    // ==========================================
    autoDetect(imageData, offsetX, offsetY) {
        const grayData = this.preprocess(imageData);
        const grid = this.findGrid(grayData, imageData.width, imageData.height);
        if (!grid) return null;

        const orientation = (grid.numCols > grid.numRows) ? 'horizontal' : 'vertical';
        let numQuestions, numChoices;
        if (orientation === 'vertical') {
            numQuestions = grid.numRows;
            numChoices = grid.numCols;
        } else {
            numQuestions = grid.numCols;
            numChoices = grid.numRows;
        }

        console.log(`[자동감지] 투영 → 방향=${orientation} 문항=${numQuestions} 지선다=${numChoices}`);
        return { orientation, numQuestions, numChoices };
    },

    // 하위 호환
    findBlobs() { return { blobs: [], pixelCtx: null }; },
    filterBlobs(b) { return b; },
    analyzeStructure() { return { rows: [], maxCols: 0 }; }
};
