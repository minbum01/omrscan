// ============================================
// omrEngine.js - OMR 판독 엔진 (4단계 파이프라인)
// Stage 1: 빈 버블 위치 찾기 (그리드 구조)
// Stage 2: 각 셀 샘플링 → 마킹 판별
// Stage 3: 노이즈 필터링 (열 위치 일관성)
// Stage 4: 후처리 일관성 검증 + 누락 열 복원
// ============================================

const OmrEngine = {

    debugLog: false,
    _log(...args) { if (this.debugLog) console.log(...args); },

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
        if (total === 0) return { brightness: 255, darkRatio: 0, centerFill: 0, erodedFill: 0, erodedQuadrants: [0, 0, 0, 0] };
        const localMean = brightSum / total;
        // 절대 최소 기준 30 — 완전히 까맣게 칠한 영역이 상대 기준으로는 감지 안 되는 버그 방지
        const localThreshold = Math.max(localMean * 0.75, 30);
        let darkCount = 0, centerDark = 0, centerTotal = 0;
        const cmx = Math.round(sw * 0.25), cmy = Math.round(sh * 0.25);
        // 이진화 마스크 (1=어두움) — 침식 계산을 위해 박스 전체 보관
        const mask = new Uint8Array(sw * sh);
        for (let yy = 0; yy < sh; yy++) {
            for (let xx = 0; xx < sw; xx++) {
                const px = sx + xx, py = sy + yy;
                if (px >= 0 && px < imgW && py >= 0 && py < imgH) {
                    const val = gray[py * imgW + px];
                    if (val < localThreshold) { darkCount++; mask[yy * sw + xx] = 1; }
                    if (xx >= cmx && xx < sw - cmx && yy >= cmy && yy < sh - cmy) { centerTotal++; if (val < localThreshold) centerDark++; }
                }
            }
        }
        // 침식(4-neighbor erosion): 어두운 픽셀이 4방향 모두 어두울 때만 살아남음
        // → 얇은 선(테두리·숫자)은 사라지고, 두꺼운 마킹 덩어리만 남음
        // 중앙 영역에서만 침식 결과 카운트 (기존 centerFill과 동일 영역)
        // + 사분면(TL/TR/BL/BR)별 erodedFill 분리 계산 → 균일성 판정용
        let erodedDark = 0;
        const qDark = [0, 0, 0, 0];    // TL, TR, BL, BR
        const qTotal = [0, 0, 0, 0];
        const midX = sw / 2, midY = sh / 2;
        for (let yy = cmy; yy < sh - cmy; yy++) {
            for (let xx = cmx; xx < sw - cmx; xx++) {
                // 사분면 인덱스 결정
                const qi = (xx < midX ? 0 : 1) + (yy < midY ? 0 : 2);
                qTotal[qi]++;
                const i = yy * sw + xx;
                if (!mask[i]) continue;
                const up    = yy > 0       ? mask[(yy - 1) * sw + xx] : 0;
                const down  = yy < sh - 1  ? mask[(yy + 1) * sw + xx] : 0;
                const left  = xx > 0       ? mask[yy * sw + (xx - 1)] : 0;
                const right = xx < sw - 1  ? mask[yy * sw + (xx + 1)] : 0;
                if (up && down && left && right) { erodedDark++; qDark[qi]++; }
            }
        }
        const erodedQuadrants = [0, 1, 2, 3].map(q => qTotal[q] > 0 ? qDark[q] / qTotal[q] : 0);
        return {
            brightness: localMean,
            darkRatio: darkCount / total,
            centerFill: centerTotal > 0 ? centerDark / centerTotal : 0,
            erodedFill: centerTotal > 0 ? erodedDark / centerTotal : 0,
            erodedQuadrants,  // [TL, TR, BL, BR]
        };
    },

    // ==========================================
    // Stage 1: BFS 블롭 감지 → 빈 버블 위치 찾기
    // ==========================================
    _stage1_findBubbles(grayData, width, height, bubbleSize) {
        const THRESHOLD = (() => {
            let t = 0; for (let i = 0; i < grayData.length; i++) t += grayData[i];
            return (t / grayData.length) * 0.75;
        })();

        // BFS
        const visited = new Uint8Array(width * height);
        const blobs = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (grayData[idx] < THRESHOLD && !visited[idx]) {
                    const queue = [{ x, y }]; visited[idx] = 1;
                    let mnX = x, mxX = x, mnY = y, mxY = y, cnt = 0;
                    while (queue.length > 0) {
                        const p = queue.shift(); cnt++;
                        if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x;
                        if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y;
                        for (const n of [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}]) {
                            if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
                                const ni = n.y * width + n.x;
                                if (grayData[ni] < THRESHOLD && !visited[ni]) { visited[ni] = 1; queue.push(n); }
                            }
                        }
                    }
                    const bw = mxX - mnX, bh = mxY - mnY;
                    if (bw > 3 && bh > 3 && cnt > 5) blobs.push({ cx: mnX + bw/2, cy: mnY + bh/2, w: bw, h: bh, area: cnt });
                }
            }
        }

        if (blobs.length < 2) return null;

        // 빈 버블 필터: 크기 + 원형 + 채움률 상한 (까맣게 칠한 건 제외)
        const targetSize = bubbleSize || 0;
        let filtered;

        if (targetSize > 0) {
            const minS = targetSize * 0.85;
            const maxS = targetSize * 1.15;
            filtered = blobs.filter(b => {
                const sz = Math.max(b.w, b.h);
                const ratio = b.w / b.h;
                const fill = b.area / (b.w * b.h);
                return sz >= minS && sz <= maxS && ratio > 0.7 && ratio < 1.4 && fill > 0.3 && fill < 0.85;
            });
            // 빈 버블이 너무 적으면 채움률 상한 제거하고 재시도
            if (filtered.length < 4) {
                filtered = blobs.filter(b => {
                    const sz = Math.max(b.w, b.h);
                    const ratio = b.w / b.h;
                    const fill = b.area / (b.w * b.h);
                    return sz >= minS && sz <= maxS && ratio > 0.7 && ratio < 1.4 && fill > 0.3;
                });
            }
        } else {
            const areas = blobs.map(b => b.w * b.h).sort((a, b) => a - b);
            const medArea = areas[Math.floor(areas.length / 2)];
            filtered = blobs.filter(b => {
                const a = b.w * b.h, ratio = b.w / b.h;
                const fill = b.area / (b.w * b.h);
                return a >= medArea * 0.3 && a <= medArea * 1.8 && ratio > 0.7 && ratio < 1.4 && fill > 0.3;
            });
        }

        this._log(`[Stage1] BFS: ${blobs.length}블롭 → 빈버블필터(${targetSize || 'auto'}): ${filtered.length}블롭`);
        if (this.debugLog) {
            // 필터 통과 (빈 버블)
            filtered.forEach((b, i) => {
                this._log(`  ✓ 블롭${i+1}: cx=${Math.round(b.cx)} cy=${Math.round(b.cy)} ${b.w}x${b.h} fill=${(b.area/(b.w*b.h)).toFixed(2)}`);
            });
            // 필터 탈락 (칠한 버블, 노이즈 등) — 크기 범위 내 but 탈락 이유 표시
            const rejected = blobs.filter(b => !filtered.includes(b));
            rejected.forEach(b => {
                const sz = Math.max(b.w, b.h);
                const ratio = b.w / b.h;
                const fill = b.area / (b.w * b.h);
                let reason = '';
                if (targetSize > 0) {
                    if (sz < targetSize * 0.85 || sz > targetSize * 1.15) reason += '크기 ';
                }
                if (ratio <= 0.7 || ratio >= 1.4) reason += '종횡비 ';
                if (fill <= 0.3) reason += '채움률↓ ';
                if (fill >= 0.85) reason += '칠해짐 ';
                if (!reason) reason = '기타';
                this._log(`  ✗ 탈락: cx=${Math.round(b.cx)} cy=${Math.round(b.cy)} ${b.w}x${b.h} fill=${fill.toFixed(2)} (${reason.trim()})`);
            });
        }
        if (filtered.length < 2) return null;

        // 디버그 저장
        this._debugBlobs = { all: blobs, filtered, threshold: THRESHOLD };

        // 행/열 그룹핑
        const sortedY = [...filtered].sort((a, b) => a.cy - b.cy);
        const medH = sortedY.map(b => b.h).sort((a, b) => a - b)[Math.floor(sortedY.length / 2)];
        const rowGroups = this._groupByAxis(sortedY, 'cy', medH);

        const sortedX = [...filtered].sort((a, b) => a.cx - b.cx);
        const medW = sortedX.map(b => b.w).sort((a, b) => a - b)[Math.floor(sortedX.length / 2)];
        const colGroups = this._groupByAxis(sortedX, 'cx', medW);

        // 노이즈 그룹 제거 (행/열 대칭 적용)
        const rowBlobCounts = rowGroups.map(r => r.length).sort((a, b) => a - b);
        const medRowBlobs = rowBlobCounts[Math.floor(rowBlobCounts.length / 2)];
        const minRowBlobs = Math.max(2, Math.round(medRowBlobs * 0.4));
        const goodRows = rowGroups.filter(r => r.length >= minRowBlobs);

        const colBlobCounts = colGroups.map(c => c.length).sort((a, b) => a - b);
        const medColBlobs = colBlobCounts[Math.floor(colBlobCounts.length / 2)];
        const minColBlobs = Math.max(2, Math.round(medColBlobs * 0.4));
        const goodCols = colGroups.filter(c => c.length >= minColBlobs);

        const finalRows = goodRows.length >= 2 ? goodRows : rowGroups;
        const finalCols = goodCols.length >= 2 ? goodCols : colGroups;

        this._log(`[Stage1] 행=${finalRows.length} 열=${finalCols.length}`);

        return { rowGroups: finalRows, colGroups: finalCols, numRows: finalRows.length, numCols: finalCols.length };
    },

    // ==========================================
    // Stage 1 (길쭉 버블 전용): BFS + h/w >= 2 필터
    // 기존 _stage1_findBubbles의 복사본 + 필터 조건만 변경
    // ==========================================
    _stage1_findBubbles_elongated(grayData, width, height, bubbleSize, thresholds) {
        // thresholds: { minHW, maxHW, minFill, maxFill } — 사용자 조정 가능
        const minHW = (thresholds && thresholds.minHW != null) ? thresholds.minHW : 1.4;
        const maxHW = (thresholds && thresholds.maxHW != null) ? thresholds.maxHW : 5.0;
        const minFill = (thresholds && thresholds.minFill != null) ? thresholds.minFill : 0.15;
        const maxFill = (thresholds && thresholds.maxFill != null) ? thresholds.maxFill : 0.95;
        const THRESHOLD = (() => {
            let t = 0; for (let i = 0; i < grayData.length; i++) t += grayData[i];
            return (t / grayData.length) * 0.75;
        })();

        // BFS
        const visited = new Uint8Array(width * height);
        const blobs = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (grayData[idx] < THRESHOLD && !visited[idx]) {
                    const queue = [{ x, y }]; visited[idx] = 1;
                    let mnX = x, mxX = x, mnY = y, mxY = y, cnt = 0;
                    while (queue.length > 0) {
                        const p = queue.shift(); cnt++;
                        if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x;
                        if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y;
                        for (const n of [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}]) {
                            if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
                                const ni = n.y * width + n.x;
                                if (grayData[ni] < THRESHOLD && !visited[ni]) { visited[ni] = 1; queue.push(n); }
                            }
                        }
                    }
                    const bw = mxX - mnX, bh = mxY - mnY;
                    if (bw > 2 && bh > 4 && cnt > 5) blobs.push({ cx: mnX + bw/2, cy: mnY + bh/2, w: bw, h: bh, area: cnt });
                }
            }
        }

        if (blobs.length < 2) return null;

        // 길쭉 버블 필터: h/w >= 2 (세로가 가로의 2배 이상)
        // 채움률 하한은 유지, 상한만 길쭉 버블용으로 완화
        const targetSize = bubbleSize || 0;
        let filtered;

        if (targetSize > 0) {
            // targetSize는 긴 축(h) 기준
            const minS = targetSize * 0.85;
            const maxS = targetSize * 1.15;
            filtered = blobs.filter(b => {
                const hw = b.h / b.w; // 길쭉 비율
                const fill = b.area / (b.w * b.h);
                return b.h >= minS && b.h <= maxS && hw >= minHW && hw <= maxHW && fill >= minFill && fill <= maxFill;
            });
            if (filtered.length < 4) {
                filtered = blobs.filter(b => {
                    const hw = b.h / b.w;
                    const fill = b.area / (b.w * b.h);
                    return b.h >= minS && b.h <= maxS && hw >= minHW && hw <= maxHW && fill >= minFill;
                });
            }
        } else {
            // 자동 모드: 먼저 h/w 조건 충족 블롭만 후보로
            const candidates = blobs.filter(b => {
                const hw = b.h / b.w;
                return hw >= minHW && hw <= maxHW && b.w >= 2;
            });
            if (candidates.length < 2) {
                this._log(`[Stage1-길쭉] 후보 부족: ${candidates.length}`);
                return null;
            }
            // 후보 중 높이 중앙값 기준 필터링
            const heights = candidates.map(b => b.h).sort((a, b) => a - b);
            const medH = heights[Math.floor(heights.length / 2)];
            filtered = candidates.filter(b => {
                const fill = b.area / (b.w * b.h);
                return b.h >= medH * 0.6 && b.h <= medH * 1.6 && fill >= minFill && fill <= maxFill;
            });
        }

        this._log(`[Stage1-길쭉] BFS: ${blobs.length}블롭 → 길쭉필터: ${filtered.length}블롭`);
        if (this.debugLog) {
            filtered.forEach((b, i) => {
                this._log(`  ✓ 블롭${i+1}: cx=${Math.round(b.cx)} cy=${Math.round(b.cy)} ${b.w}x${b.h} h/w=${(b.h/b.w).toFixed(2)} fill=${(b.area/(b.w*b.h)).toFixed(2)}`);
            });
            const rejected = blobs.filter(b => !filtered.includes(b));
            rejected.forEach(b => {
                const hw = b.h / b.w;
                const fill = b.area / (b.w * b.h);
                let reason = '';
                if (hw < minHW) reason += '종횡비(길쭉아님) ';
                if (hw > maxHW) reason += '너무김 ';
                if (fill < minFill) reason += '채움률↓ ';
                if (fill > maxFill) reason += '꽉참 ';
                if (!reason) reason = '기타';
                this._log(`  ✗ 탈락: cx=${Math.round(b.cx)} cy=${Math.round(b.cy)} ${b.w}x${b.h} h/w=${hw.toFixed(2)} fill=${fill.toFixed(2)} (${reason.trim()})`);
            });
        }
        if (filtered.length < 2) return null;

        this._debugBlobs = { all: blobs, filtered, threshold: THRESHOLD };

        // 행/열 그룹핑 — 길쭉 버블은 h가 크므로 행 그룹핑은 medW 사용
        const sortedY = [...filtered].sort((a, b) => a.cy - b.cy);
        const medH = sortedY.map(b => b.h).sort((a, b) => a - b)[Math.floor(sortedY.length / 2)];

        const sortedX = [...filtered].sort((a, b) => a.cx - b.cx);
        const medW = sortedX.map(b => b.w).sort((a, b) => a - b)[Math.floor(sortedX.length / 2)];

        // 행 그룹핑: medH 대신 medW * 1.5를 사용 (medH가 커서 행이 병합되는 문제 방지)
        const rowThreshold = medW * 1.5;
        const rowGroups = this._groupByAxis(sortedY, 'cy', rowThreshold);

        // 열 그룹핑: medW 사용 (기존과 동일)
        const colGroups = this._groupByAxis(sortedX, 'cx', medW);

        // 노이즈 그룹 제거
        const rowBlobCounts = rowGroups.map(r => r.length).sort((a, b) => a - b);
        const medRowBlobs = rowBlobCounts[Math.floor(rowBlobCounts.length / 2)];
        const minRowBlobs = Math.max(2, Math.round(medRowBlobs * 0.4));
        const goodRows = rowGroups.filter(r => r.length >= minRowBlobs);

        const colBlobCounts = colGroups.map(c => c.length).sort((a, b) => a - b);
        const medColBlobs = colBlobCounts[Math.floor(colBlobCounts.length / 2)];
        const minColBlobs = Math.max(2, Math.round(medColBlobs * 0.4));
        const goodCols = colGroups.filter(c => c.length >= minColBlobs);

        const finalRows = goodRows.length >= 2 ? goodRows : rowGroups;
        const finalCols = goodCols.length >= 2 ? goodCols : colGroups;

        this._log(`[Stage1-길쭉] 행=${finalRows.length} 열=${finalCols.length} (medW=${medW} rowThreshold=${Math.round(rowThreshold)})`);

        return { rowGroups: finalRows, colGroups: finalCols, numRows: finalRows.length, numCols: finalCols.length };
    },

    // ==========================================
    // Stage 3: 열 위치 일관성으로 노이즈 필터링
    // ==========================================
    _stage3_filterByColumnConsistency(rowGroups, numC, sortProp) {
        // 양식 좌표 우선 사용 로직 제거 — 양식은 Stage 1.5 gap-validation에서만 개입
        // (자동 감지가 더 정확할 수 있으므로 양식은 누락/중복 판정의 기준으로만 활용)

        // 정상 행(numC개 블롭)에서 열 평균 계산
        const normalRows = rowGroups.filter(r => r.length === numC);
        if (normalRows.length < 2) return { filtered: rowGroups, colAvg: null };

        let colAvgX = Array.from({ length: numC }, (_, c) => {
            const vals = normalRows.map(r => {
                const sorted = [...r].sort((a, b) => a[sortProp] - b[sortProp]);
                return sorted[c] ? sorted[c][sortProp] : null;
            }).filter(v => v !== null);
            return vals.reduce((s, v) => s + v, 0) / vals.length;
        });

        let colGap = numC > 1 ? (colAvgX[numC - 1] - colAvgX[0]) / (numC - 1) : 20;
        let tolerance = colGap * 0.35;

        // Stage3 열 평균 재정렬 — 감지된 열 간격의 중앙값이 기대값과 다르면 그 중앙값 사용
        // 절대 좌표 비교가 아닌, 감지된 간격 자체를 신뢰
        const patternHint = this._currentPatternHint;
        if (patternHint && numC >= 3) {
            const expectedGap = sortProp === 'cx' ? patternHint.expectedColGap : patternHint.expectedRowGap;
            if (expectedGap >= 5) {
                // 감지된 열 간격들
                const detectedGaps = [];
                for (let c = 1; c < numC; c++) detectedGaps.push(colAvgX[c] - colAvgX[c - 1]);
                const sortedGaps = [...detectedGaps].sort((a, b) => a - b);
                const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

                // 개별 간격이 중앙값 대비 30% 이상 편차면, 그 열만 재배치
                let anyFixed = false;
                const before = [...colAvgX];
                for (let c = 1; c < numC; c++) {
                    const gap = colAvgX[c] - colAvgX[c - 1];
                    if (Math.abs(gap - medianGap) > medianGap * 0.3) {
                        // 이상한 간격 → 이전 열 위치 + 중앙값으로 재계산
                        colAvgX[c] = colAvgX[c - 1] + medianGap;
                        anyFixed = true;
                    }
                }
                if (anyFixed) {
                    colGap = medianGap;
                    tolerance = colGap * 0.35;
                    this._log(`[Stage3+재정렬] medianGap=${medianGap.toFixed(1)}: [${before.map(Math.round).join(',')}] → [${colAvgX.map(Math.round).join(',')}]`);
                }
            }
        }

        this._log(`[Stage3] 열평균=[${colAvgX.map(Math.round).join(',')}] tolerance=${Math.round(tolerance)}`);

        // 각 행의 블롭을 열 평균에 매칭
        const filtered = rowGroups.map(row => {
            const sorted = [...row].sort((a, b) => a[sortProp] - b[sortProp]);
            return sorted.filter(b => {
                return colAvgX.some(avg => Math.abs(b[sortProp] - avg) < tolerance);
            });
        }).filter(r => r.length > 0);

        return { filtered, colAvg: colAvgX };
    },

    // ==========================================
    // Stage 4: 후처리 — 누락 열 복원 + 위치 교정
    // ==========================================
    _stage4_postProcess(structuredRows, grayData, width, height, numC, sampleW, sampleH, isVert, offsetX, offsetY, patternHint, numQ, elongatedMode) {
        // 4-1. 정상 행(numC개 블롭)에서 열 평균 계산
        const normalRows = structuredRows.filter(r => r.blobs.length === numC);
        const prop = isVert ? 'cx' : 'cy';

        let colAvgX, colGap, tolerance;

        if (normalRows.length >= 2) {
            // 정상 행으로부터 열 평균 계산 (기존 방식)
            colAvgX = Array.from({ length: numC }, (_, c) => {
                const vals = normalRows.map(r => r.blobs[c][prop]);
                return vals.reduce((s, v) => s + v, 0) / vals.length;
            });
            colGap = numC > 1 ? (colAvgX[numC - 1] - colAvgX[0]) / (numC - 1) : 20;
            tolerance = colGap * 0.4;
            this._log(`[Stage4] 열평균=[${colAvgX.map(Math.round).join(',')}] 정상행=${normalRows.length}/${structuredRows.length}`);
        } else if (patternHint) {
            // 정상 행 부족 → 패턴 힌트로 열 평균 추정
            // 감지된 블롭 중 하나를 기준으로 삼고, 기대 간격으로 나머지 열 위치 계산
            const expectedGap = isVert ? patternHint.expectedColGap : patternHint.expectedRowGap;
            // 가장 블롭이 많은 행에서 기준 찾기
            const bestRow = structuredRows.reduce((best, r) => r.blobs.length > (best ? best.blobs.length : 0) ? r : best, null);
            if (!bestRow || bestRow.blobs.length === 0) {
                this._log(`[Stage4+패턴] 기준 블롭 없음 - 스킵`);
                return;
            }
            // bestRow 블롭들을 정렬 → 각 블롭의 col 인덱스를 기대 간격으로 역추정
            const sortedBlobs = [...bestRow.blobs].sort((a, b) => a[prop] - b[prop]);
            const firstBlobPos = sortedBlobs[0][prop];
            // firstBlob이 어떤 열인지 추정: 0열로 가정 (가장 왼쪽/위)
            colAvgX = Array.from({ length: numC }, (_, c) => firstBlobPos + c * expectedGap);
            colGap = expectedGap;
            tolerance = expectedGap * 0.4;
            this._log(`[Stage4+패턴] 열 평균 추정(간격=${expectedGap.toFixed(1)})=[${colAvgX.map(Math.round).join(',')}]`);
        } else {
            // 기준 부족, 패턴도 없음 → 스킵
            return;
        }

        structuredRows.forEach((row, q) => {
            // 4-2. 블롭 부족 행: 열 평균에 매칭 → 누락 열 복원
            if (row.blobs.length < numC) {
                const blobVals = row.blobs.map(b => b[prop]);
                const matched = new Array(numC).fill(null);
                const usedBlobs = new Set();

                // 각 열 평균에 가장 가까운 블롭 매칭
                for (let c = 0; c < numC; c++) {
                    let bestIdx = -1, bestDist = Infinity;
                    for (let i = 0; i < blobVals.length; i++) {
                        if (usedBlobs.has(i)) continue;
                        const dist = Math.abs(blobVals[i] - colAvgX[c]);
                        if (dist < bestDist && dist < tolerance) { bestDist = dist; bestIdx = i; }
                    }
                    if (bestIdx !== -1) {
                        matched[c] = row.blobs[bestIdx];
                        usedBlobs.add(bestIdx);
                    }
                }

                // 누락된 열에 보간 블롭 삽입
                const avgY = row.blobs.reduce((s, b) => s + (isVert ? b.cy : b.cx), 0) / row.blobs.length;
                const newBlobs = [];
                let needResample = false;

                for (let c = 0; c < numC; c++) {
                    if (matched[c]) {
                        newBlobs.push(matched[c]);
                    } else {
                        // 보간: 열 평균 위치 + 현재 행 Y (colAvgX에 이미 offset 포함)
                        const interpCx = isVert ? colAvgX[c] : avgY;
                        const interpCy = isVert ? avgY : colAvgX[c];
                        newBlobs.push({
                            x: Math.round(interpCx - sampleW / 2),
                            y: Math.round(interpCy - sampleH / 2),
                            w: Math.round(sampleW), h: Math.round(sampleH),
                            cx: interpCx, cy: interpCy,
                            r: Math.min(sampleW, sampleH) / 2,
                            _interpolated: true, isMarked: false,
                            boxBrightness: 255, inkRatio: 0, centerFillRatio: 0,
                            erodedFill: 0, erodedQuadrants: [0,0,0,0]
                        });
                        needResample = true;
                    }
                }

                if (needResample) {
                    row.blobs = newBlobs;
                    row._autoCorrected = true;
                    this._resampleRow(row, grayData, width, height, sampleW, sampleH, numC, offsetX, offsetY, isVert, elongatedMode);
                }
            }

            // 4-3. 정상 행에서도 위치 이상치 검증
            if (row.blobs.length === numC && !row._autoCorrected) {
                let needResample = false;
                row.blobs.forEach((blob, c) => {
                    const blobX = blob[prop];
                    if (Math.abs(blobX - colAvgX[c]) > tolerance) {
                        // colAvgX에 이미 offset 포함 → 직접 대입
                        if (isVert) blob.cx = colAvgX[c];
                        else blob.cy = colAvgX[c];
                        blob._corrected = true;
                        needResample = true;
                    }
                });
                if (needResample) {
                    row._autoCorrected = true;
                    this._resampleRow(row, grayData, width, height, sampleW, sampleH, numC, offsetX, offsetY, isVert, elongatedMode);
                }
            }
        });

        // 4-4. 누락 행 복원 — 사용자 지정 numQ vs 감지 행 수 차이만큼 보간
        // 양식 의존 없음. 감지된 행 간격 중앙값을 truth로 사용.
        if (numQ && structuredRows.length > 0 && structuredRows.length < numQ) {
            const rowProp = isVert ? 'cy' : 'cx';

            // 각 행의 대표 Y 계산
            const indexed = structuredRows
                .map((r, i) => {
                    if (!r.blobs || r.blobs.length === 0) return null;
                    const ys = r.blobs.map(b => b[rowProp]).filter(v => isFinite(v));
                    if (ys.length === 0) return null;
                    return { y: ys.reduce((s, v) => s + v, 0) / ys.length, row: r };
                })
                .filter(x => x !== null)
                .sort((a, b) => a.y - b.y);

            if (indexed.length === 0) {
                this._log(`[Stage4-누락행] 스킵: 유효한 기존 행 없음`);
                return;
            }

            // ⚠ 좌표계 주의: blob의 cx/cy는 절대 좌표 (offset 포함).
            // ROI 경계도 절대 좌표로 계산해야 비교 가능.
            const roiDim = isVert ? height : width;
            const roiOffset = isVert ? offsetY : offsetX;
            const roiTop = roiOffset;                // 절대 상단
            const roiBottom = roiOffset + roiDim;    // 절대 하단
            const MAX_MARGIN = 5;
            const missingYs = [];

            // 감지된 행 간격 중앙값 = 이 OMR의 실제 간격
            const ys = indexed.map(d => d.y); // 절대 Y
            const gaps = [];
            for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
            if (gaps.length === 0) {
                this._log(`[Stage4-누락행] 스킵: 감지 행 1개뿐`);
                return;
            }
            const sortedGaps = [...gaps].sort((a, b) => a - b);
            const detectedGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
            if (detectedGap < 5) {
                this._log(`[Stage4-누락행] 스킵: gap(${detectedGap}) 너무 작음`);
                return;
            }

            const totalMissing = numQ - indexed.length;
            let addedFromMiddle = 0;

            // 1) 중간 gap이 detectedGap의 2배 이상이면 사이에 누락 행 있음
            for (let i = 1; i < ys.length && addedFromMiddle < totalMissing; i++) {
                const gap = ys[i] - ys[i - 1];
                const missingCount = Math.round(gap / detectedGap) - 1;
                for (let k = 1; k <= missingCount && addedFromMiddle < totalMissing; k++) {
                    const y = ys[i - 1] + detectedGap * k;
                    if (y > roiTop + MAX_MARGIN && y < roiBottom - MAX_MARGIN) {
                        missingYs.push(y);
                        addedFromMiddle++;
                    }
                }
            }

            // 2) 앞/뒤 extrapolation
            let remaining = totalMissing - addedFromMiddle;
            if (remaining > 0) {
                const firstY = ys[0];
                const lastY = ys[ys.length - 1];
                const frontMargin = firstY - roiTop;       // 절대 좌표 기반
                const backMargin  = roiBottom - lastY;     // 절대 좌표 기반

                const canAddFront = frontMargin >= detectedGap * 0.7;
                const canAddBack  = backMargin  >= detectedGap * 0.7;

                let addFront = 0, addBack = 0;
                if (!canAddFront && !canAddBack) {
                    this._log(`[Stage4-누락행] 양쪽 여유 없음(front=${frontMargin.toFixed(0)}, back=${backMargin.toFixed(0)}, gap=${detectedGap.toFixed(0)}) → ROI 확장 필요`);
                    remaining = 0;
                } else if (!canAddFront) {
                    addBack = remaining; // 첫 감지가 1번 슬롯 확정 → 전부 뒤
                } else if (!canAddBack) {
                    addFront = remaining; // 마지막 감지가 마지막 슬롯 확정 → 전부 앞
                } else if (frontMargin > backMargin * 1.5) {
                    addFront = remaining;
                } else if (backMargin > frontMargin * 1.5) {
                    addBack = remaining;
                } else {
                    addBack = Math.ceil(remaining / 2);
                    addFront = remaining - addBack;
                }

                for (let k = 1; k <= addFront; k++) {
                    const y = firstY - detectedGap * k;
                    if (y > roiTop + MAX_MARGIN) missingYs.unshift(y);
                    else break;
                }
                for (let k = 1; k <= addBack; k++) {
                    const y = lastY + detectedGap * k;
                    if (y < roiBottom - MAX_MARGIN) missingYs.push(y);
                    else break;
                }

                this._log(`[Stage4-누락행] front여유=${frontMargin.toFixed(0)} back여유=${backMargin.toFixed(0)} gap=${detectedGap.toFixed(0)} → 앞+${addFront}, 뒤+${addBack}`);
            }

            // 최종 안전장치: ROI 밖 Y 필터링 (절대 좌표 기준)
            for (let i = missingYs.length - 1; i >= 0; i--) {
                if (missingYs[i] < roiTop + MAX_MARGIN || missingYs[i] > roiBottom - MAX_MARGIN) {
                    this._log(`[Stage4-누락행] 범위밖 Y=${missingYs[i].toFixed(0)} 제외 (ROI=${roiTop.toFixed(0)}~${roiBottom.toFixed(0)})`);
                    missingYs.splice(i, 1);
                }
            }

            this._log(`[Stage4-누락행] 감지=${indexed.length}, 기대=${numQ}, detectedGap=${detectedGap.toFixed(1)}, 중간 ${addedFromMiddle}개, 총 ${missingYs.length}개 추가`);

            if (missingYs.length > 0) {
                this._log(`[Stage4-누락행] 기존 ${structuredRows.length}행 → ${missingYs.length}행 추가 (목표 ${numQ})`);
                // 각 누락 Y에 대해 새 행 생성 (blob 보간)
                missingYs.forEach(y => {
                    const newBlobs = [];
                    for (let c = 0; c < numC; c++) {
                        const cx = isVert ? colAvgX[c] : y;
                        const cy = isVert ? y : colAvgX[c];
                        // sampleCell로 실제 값 측정
                        const sample = this.sampleCell(grayData, width, height, cx - offsetX, cy - offsetY, sampleW, sampleH);
                        newBlobs.push({
                            x: Math.round(cx - sampleW / 2),
                            y: Math.round(cy - sampleH / 2),
                            w: Math.round(sampleW), h: Math.round(sampleH),
                            cx, cy, r: Math.min(sampleW, sampleH) / 2,
                            boxBrightness: sample.brightness,
                            inkRatio: sample.darkRatio,
                            centerFillRatio: sample.centerFill,
                            _interpolated: true, _patternRestored: true, isMarked: false,
                            erodedFill: sample.erodedFill, erodedQuadrants: sample.erodedQuadrants,
                        });
                    }
                    const newRow = {
                        questionNumber: 0, // 아래에서 재번호
                        numChoices: numC,
                        markedAnswer: null, multiMarked: false, markedIndices: [],
                        blobs: newBlobs,
                        _patternRestored: true,
                    };
                    // 마킹 판별 (resampleRow와 동일 로직으로 간단히)
                    this._resampleRow(newRow, grayData, width, height, sampleW, sampleH, numC, offsetX, offsetY, isVert, elongatedMode);
                    structuredRows.push(newRow);
                });

                // Y 기준으로 전체 행 재정렬 + 번호 재부여
                structuredRows.sort((a, b) => {
                    const ay = a.blobs[0] ? a.blobs[0][rowProp] : 0;
                    const by = b.blobs[0] ? b.blobs[0][rowProp] : 0;
                    return ay - by;
                });
                structuredRows.forEach((r, i) => { r.questionNumber = i + 1; });
            }
        }

        // ──────────────────────────────────────
        // 4-5. 최종 점검 — 사용자 지정 numQ/numC 일치 확인
        // ──────────────────────────────────────
        const finalQ = structuredRows.length;
        const finalC_mismatch = structuredRows.filter(r => r.blobs && r.blobs.length !== numC).length;
        const issues = [];
        if (numQ && finalQ !== numQ) {
            issues.push(`문항수 불일치: 양식=${numQ}, 현재=${finalQ}`);
        }
        if (finalC_mismatch > 0) {
            issues.push(`선택지 수 불일치: ${finalC_mismatch}개 행의 블롭≠${numC}`);
        }
        if (issues.length === 0) {
            this._log(`[Stage4-점검] ✓ 일치 (문항 ${finalQ}/${numQ}, 모든 행 ${numC}지선다)`);
        } else {
            this._log(`[Stage4-점검] ⚠ ${issues.join(' | ')}`);
            // 각 행에 점검 플래그 추가 (UI에서 경고 표시 가능)
            structuredRows.forEach(r => {
                if (r.blobs && r.blobs.length !== numC) r._choiceMismatch = true;
            });
        }
    },

    // 행 재샘플링 + 마킹 재판별 (복합스코어)
    _resampleRow(row, grayData, width, height, sampleW, sampleH, numC, offsetX, offsetY, isVert, _isElong) {
        const cellScores = [];
        row.blobs.forEach((blob, c) => {
            const cx = blob.cx - offsetX;
            const cy = blob.cy - offsetY;
            const sample = this.sampleCell(grayData, width, height, cx, cy, sampleW, sampleH);
            const _eq = Array.isArray(sample.erodedQuadrants) ? sample.erodedQuadrants : [0, 0, 0, 0];
            const qMin = _eq.length > 0 ? Math.min(..._eq) : 0;
            const comp = _isElong
                ? sample.centerFill * 0.55 + sample.erodedFill * 0.45
                : sample.centerFill * 0.4 + sample.erodedFill * 0.35 + qMin * 0.25;
            blob.boxBrightness = sample.brightness;
            blob.inkRatio = sample.darkRatio;
            blob.centerFillRatio = sample.centerFill;
            blob.erodedFill = sample.erodedFill;
            blob.erodedQuadrants = sample.erodedQuadrants;
            blob.isMarked = false;
            cellScores.push({ col: c, comp, f: sample.centerFill, e: sample.erodedFill, qMin, brightness: sample.brightness, darkRatio: sample.darkRatio, centerFill: sample.centerFill, erodedFill: sample.erodedFill, erodedQuadrants: sample.erodedQuadrants });
        });

        if (cellScores.length < 2) return;

        // 복합스코어 정렬
        const sorted = [...cellScores].sort((a, b) => b.comp - a.comp);
        const gap = sorted[0].comp - sorted[1].comp;

        // 백지 판별
        const maxFill = Math.max(...cellScores.map(c => c.f));
        const minFill = Math.min(...cellScores.map(c => c.f));
        const isBlank = _isElong
            ? maxFill < 0.35 && (maxFill - minFill) < 0.10
            : maxFill < 0.5 && (maxFill - minFill) < 0.15;

        let primaryMarked = -1;
        if (!isBlank) {
            if (_isElong) {
                const passBase = gap >= 0.10 || sorted[0].f >= 0.95;
                const passEroded = sorted[0].e >= 0.25;
                if (passBase && passEroded) primaryMarked = sorted[0].col;
            } else {
                if (gap >= 0.10 || sorted[0].f >= 0.95) primaryMarked = sorted[0].col;
            }
        }

        // 갱신
        row.blobs.forEach(b => b.isMarked = false);
        if (primaryMarked !== -1) row.blobs[primaryMarked].isMarked = true;
        row.markedAnswer = primaryMarked !== -1 ? primaryMarked + 1 : null;
        row.multiMarked = false;
        row.markedIndices = primaryMarked !== -1 ? [primaryMarked + 1] : [];
        row.numChoices = numC;
    },

    // ==========================================
    // 축 기반 그룹핑 (공용)
    // ==========================================
    // ==========================================
    // 양식 기반 gap 검증 + 보간 (x축·y축 공통)
    // positions: 감지된 위치 배열 (정렬 필수 아님 — 내부에서 정렬)
    // expectedGap: 양식이 알려주는 기대 간격 (px)
    // tolerance: 허용 편차 (0.15 = 15%)
    // logTag: 디버그 로그 접두사
    // return: 보정된 위치 배열 (오름차순 정렬됨)
    // ==========================================
    _validateAndFillGaps(positions, expectedGap, tolerance, logTag) {
        if (!positions || positions.length < 2 || !expectedGap || expectedGap <= 0) return positions;

        const sorted = [...positions].sort((a, b) => a - b);
        const tol = expectedGap * tolerance; // 예: 40 * 0.15 = 6
        const result = [sorted[0]];
        let mergedCnt = 0, insertedCnt = 0, oddCnt = 0;

        for (let i = 1; i < sorted.length; i++) {
            const prev = result[result.length - 1];
            const cur = sorted[i];
            const gap = cur - prev;
            const ratio = gap / expectedGap;

            if (Math.abs(gap - expectedGap) <= tol) {
                // 정상 간격
                result.push(cur);
            } else if (ratio < 0.5) {
                // 중복 — 평균으로 병합
                result[result.length - 1] = (prev + cur) / 2;
                mergedCnt++;
            } else if (ratio >= 1.5 && ratio < 2.5) {
                // 1개 누락 → 중간 삽입
                result.push(prev + gap / 2);
                result.push(cur);
                insertedCnt++;
            } else if (ratio >= 2.5 && ratio < 3.5) {
                // 2개 누락 → 1/3, 2/3 위치에 삽입
                result.push(prev + gap / 3);
                result.push(prev + (gap * 2) / 3);
                result.push(cur);
                insertedCnt += 2;
            } else if (ratio >= 3.5 && ratio < 4.5) {
                // 3개 누락 (드물지만 대비)
                for (let k = 1; k <= 3; k++) result.push(prev + (gap * k) / 4);
                result.push(cur);
                insertedCnt += 3;
            } else {
                // 이상값 (0.5~1-tol 사이, 또는 4.5 이상 등) — 유지, 로그만
                result.push(cur);
                oddCnt++;
            }
        }

        if (mergedCnt > 0 || insertedCnt > 0 || oddCnt > 0) {
            this._log(`${logTag} 기대gap=${expectedGap.toFixed(1)}(±${(tolerance*100).toFixed(0)}%) | 병합=${mergedCnt} 삽입=${insertedCnt} 이상=${oddCnt} | [${sorted.map(Math.round).join(',')}] → [${result.map(Math.round).join(',')}]`);
        }
        return result;
    },

    _groupByAxis(sorted, prop, threshold) {
        const raw = [];
        let cur = [sorted[0]], curVal = sorted[0][prop];
        for (let i = 1; i < sorted.length; i++) {
            if (Math.abs(sorted[i][prop] - curVal) < threshold) {
                cur.push(sorted[i]);
                curVal = cur.reduce((s, b) => s + b[prop], 0) / cur.length;
            } else {
                raw.push(cur);
                cur = [sorted[i]];
                curVal = sorted[i][prop];
            }
        }
        raw.push(cur);

        if (raw.length <= 1) return raw;
        const centers = raw.map(g => g.reduce((s, b) => s + b[prop], 0) / g.length);
        const gaps = [];
        for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
        const medGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        const mergeThresh = medGap * 0.4;

        const merged = [raw[0]];
        for (let i = 1; i < raw.length; i++) {
            const prevC = merged[merged.length - 1].reduce((s, b) => s + b[prop], 0) / merged[merged.length - 1].length;
            const curC = raw[i].reduce((s, b) => s + b[prop], 0) / raw[i].length;
            if (curC - prevC < mergeThresh) {
                raw[i].forEach(b => merged[merged.length - 1].push(b));
            } else {
                merged.push(raw[i]);
            }
        }
        return merged;
    },

    // ==========================================
    // 메인 분석 (4단계 파이프라인)
    // ==========================================
    analyzeROI(imageData, offsetX, offsetY, orientation = 'vertical', numQ = 0, numC = 0, _unused = null, bubbleSize = 0, elongatedMode = false, elongatedThresholds = null, blobPattern = null) {
        const width = imageData.width, height = imageData.height;
        const grayData = this.preprocess(imageData);
        let isVert = orientation === 'vertical';

        // 양식 블롭 패턴 → 기대 규격
        // 절대 픽셀값(bubbleW, colSpacing 등) 우선 사용 (동일 OMR은 버블 크기 고정)
        // 절대값 없으면(구버전 양식) 비율 × 현재 ROI 크기로 fallback
        const patternHint = blobPattern ? {
            expectedBubbleW: blobPattern.bubbleW    || (width  * (blobPattern.bubbleWRatio    || 0)),
            expectedBubbleH: blobPattern.bubbleH    || (height * (blobPattern.bubbleHRatio    || 0)),
            expectedColGap:  blobPattern.colSpacing || (width  * (blobPattern.colSpacingRatio || 0)),
            expectedRowGap:  blobPattern.rowSpacing || (height * (blobPattern.rowSpacingRatio || 0)),
            numRows: blobPattern.numRows,
            numCols: blobPattern.numCols,
            rowYRatios: Array.isArray(blobPattern.rowYRatios) ? blobPattern.rowYRatios : null,
            colXRatios: Array.isArray(blobPattern.colXRatios) ? blobPattern.colXRatios : null,
            // 절대 좌표 (동일 크기 OMR에선 비율보다 정확)
            colXAbsolute: Array.isArray(blobPattern.colXAbsolute) ? blobPattern.colXAbsolute : null,
        } : null;
        if (patternHint) {
            this._log(`[Pattern] 기대 규격: 버블 ${patternHint.expectedBubbleW.toFixed(1)}×${patternHint.expectedBubbleH.toFixed(1)}, 간격 열=${patternHint.expectedColGap.toFixed(1)} 행=${patternHint.expectedRowGap.toFixed(1)}`);
        }
        // Stage3에서 접근 가능하도록 임시 저장
        this._currentPatternHint = patternHint;
        this._currentRoiWidth = width;
        this._currentRoiHeight = height;

        // ──────────────────────────────────────
        // Stage 1: 빈 버블 위치 찾기
        // 길쭉 모드 → 별도 함수, 일반 → 기존 함수
        // ──────────────────────────────────────
        const grid = elongatedMode
            ? this._stage1_findBubbles_elongated(grayData, width, height, bubbleSize, elongatedThresholds)
            : this._stage1_findBubbles(grayData, width, height, bubbleSize);
        if (!grid) return { rows: [], maxCols: 0 };

        if (!orientation || orientation === '') {
            isVert = grid.numCols > grid.numRows ? false : true;
        }

        let rowGroups = isVert ? grid.rowGroups : grid.colGroups;
        const sortProp = isVert ? 'cx' : 'cy';

        // 행별 블롭 수 최빈값
        const rowBlobCounts = rowGroups.map(r => r.length);
        const freq = {};
        rowBlobCounts.forEach(c => { if (c > 0) freq[c] = (freq[c] || 0) + 1; });
        const detectedNumC = Object.keys(freq).length > 0
            ? parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]) : 0;

        numQ = numQ > 0 ? numQ : rowGroups.length;
        numC = numC > 0 ? numC : detectedNumC;

        // ──────────────────────────────────────
        // Stage 3: 열 위치 일관성 필터링 → 열 평균도 함께 반환
        // ──────────────────────────────────────
        let colAvgPositions = null;
        const sampleSize = bubbleSize > 0 ? bubbleSize * 0.9 : null;

        if (numC > 0) {
            const stage3Result = this._stage3_filterByColumnConsistency(rowGroups, numC, sortProp);
            rowGroups = stage3Result.filtered;
            colAvgPositions = stage3Result.colAvg; // Stage 3에서 계산한 정확한 열평균
        }

        // Stage 3에서 열평균을 못 구한 경우 → fallback
        if (!colAvgPositions) {
            // [신규 분기] Stage 1의 colGroups(x축 클러스터)를 활용한 fallback
            // Stage 3가 실패하는 케이스(중복 블롭으로 '정상 행' 없음)에서도
            // _groupByAxis가 이미 올바르게 만든 컬럼 클러스터를 재활용
            const colSrc = isVert ? grid.colGroups : grid.rowGroups;
            if (colSrc && colSrc.length === numC) {
                const means = colSrc
                    .map(g => g.reduce((s, b) => s + b[sortProp], 0) / g.length)
                    .sort((a, b) => a - b);
                colAvgPositions = means;
                this._log(`[Stage1.5-fallback] colGroups 평균 사용 = [${means.map(Math.round).join(',')}]`);
            }

            // 위 신규 분기가 실패했을 때만 기존 fallback 실행 (기존 로직 그대로)
            if (!colAvgPositions) {
                if (rowGroups.length > 0) {
                    const bestRow = [...rowGroups].sort((a, b) => b.length - a.length)[0];
                    const sorted = [...bestRow].sort((a, b) => a[sortProp] - b[sortProp]);
                    colAvgPositions = sorted.slice(0, numC).map(b => b[sortProp]);
                } else {
                    return { rows: [], maxCols: 0 };
                }
            }
        }

        // Stage 1.5: 양식 기반 gap-validation (열)
        // 감지된 열 간격을 양식의 expectedColGap과 비교하여:
        //   - ±15% 이내: 정상
        //   - × 0.5 미만: 중복 → 병합 (평균 위치)
        //   - × 1.5~2.5 (≈2×): 1개 누락 → 중간에 삽입
        //   - × 2.5~3.5 (≈3×): 2개 누락 → 균등 간격으로 2개 삽입
        //   - 그 외: 이상값 → 유지 (로그만)
        // 양식이 없거나 colAvgPositions가 부족하면 스킵 (자동 결과 유지)
        if (colAvgPositions && colAvgPositions.length >= 2 && patternHint) {
            const expectedGap = sortProp === 'cx' ? patternHint.expectedColGap : patternHint.expectedRowGap;
            if (expectedGap > 0) {
                colAvgPositions = this._validateAndFillGaps(
                    colAvgPositions,
                    expectedGap,
                    0.15,
                    '[Stage1.5-colGap]'
                );
            }
        }

        // 평균 버블 크기
        const allFilteredBlobs = rowGroups.flat();
        const avgBlobW = allFilteredBlobs.length > 0 ? allFilteredBlobs.reduce((s, b) => s + b.w, 0) / allFilteredBlobs.length : 18;
        const avgBlobH = allFilteredBlobs.length > 0 ? allFilteredBlobs.reduce((s, b) => s + b.h, 0) / allFilteredBlobs.length : 18;
        const sw = sampleSize || avgBlobW * 0.9;
        const sh = sampleSize || avgBlobH * 0.9;

        // ──────────────────────────────────────
        // Stage 1.6: 양식 기반 gap-validation (행 y축)
        // rowGroups의 대표 y를 추출 → 양식 expectedRowGap과 비교 → 보정
        // 누락 행은 synthetic rowGroup(dummy blob 1개)으로 삽입
        // ──────────────────────────────────────
        if (rowGroups.length >= 2 && patternHint) {
            const rowYProp = isVert ? 'cy' : 'cx';
            const expectedRowGap = isVert ? patternHint.expectedRowGap : patternHint.expectedColGap;
            if (expectedRowGap > 0) {
                // 각 행의 대표 좌표 계산
                const rowReps = rowGroups.map(g => ({
                    y: g.reduce((s, b) => s + b[rowYProp], 0) / g.length,
                    group: g,
                })).sort((a, b) => a.y - b.y);
                const originalYs = rowReps.map(r => r.y);
                const validatedYs = this._validateAndFillGaps(
                    originalYs,
                    expectedRowGap,
                    0.15,
                    '[Stage1.6-rowGap]'
                );

                // validatedYs 기준으로 rowGroups 재구성
                // 각 y에 대해 원본 rowReps에서 가장 가까운 항목 매칭 (tol 내)
                const matchTol = expectedRowGap * 0.3;
                const newRowGroups = [];
                const usedReps = new Set();
                validatedYs.forEach(y => {
                    let bestIdx = -1, bestDist = Infinity;
                    rowReps.forEach((r, i) => {
                        if (usedReps.has(i)) return;
                        const d = Math.abs(r.y - y);
                        if (d < bestDist && d < matchTol) { bestDist = d; bestIdx = i; }
                    });
                    if (bestIdx >= 0) {
                        usedReps.add(bestIdx);
                        newRowGroups.push(rowReps[bestIdx].group);
                    } else {
                        // 삽입된 행 — synthetic rowGroup (dummy blob 1개)
                        newRowGroups.push([{
                            cx: isVert ? 0 : y,
                            cy: isVert ? y : 0,
                            w: avgBlobW, h: avgBlobH,
                            _synthetic: true,
                        }]);
                    }
                });
                if (newRowGroups.length !== rowGroups.length) {
                    this._log(`[Stage1.6] rowGroups ${rowGroups.length}행 → ${newRowGroups.length}행`);
                }
                rowGroups = newRowGroups;
            }
        }

        this._log(`[Stage1.5] 열평균=[${colAvgPositions.map(Math.round).join(',')}] sampleSize=${Math.round(sw)}x${Math.round(sh)}`);

        // ──────────────────────────────────────
        // Stage 2: 모든 그리드 셀에서 샘플링 + 마킹 판별
        // ──────────────────────────────────────
        const structuredRows = [];

        this._log(`[Stage2] ${Math.min(numQ, rowGroups.length)}문항 × ${numC}지선다`);

        for (let q = 0; q < Math.min(numQ, rowGroups.length); q++) {
            const rowBlobs = [...rowGroups[q]].sort((a, b) => a[sortProp] - b[sortProp]);
            // 이 행의 Y좌표 (행 내 블롭들의 평균)
            const rowY = isVert
                ? rowBlobs.reduce((s, b) => s + b.cy, 0) / rowBlobs.length
                : rowBlobs.reduce((s, b) => s + b.cx, 0) / rowBlobs.length;

            const blobs = [], cellScores = [];

            // 모든 열 위치에서 샘플링 (빈 버블이든 칠해진 버블이든)
            for (let c = 0; c < numC; c++) {
                const cx = isVert ? colAvgPositions[c] : rowY;
                const cy = isVert ? rowY : colAvgPositions[c];

                const sample = this.sampleCell(grayData, width, height, cx, cy, sw, sh);
                const score = (sample.darkRatio * 300) + (255 - sample.brightness) + (sample.centerFill * 800);

                cellScores.push({ col: c, score, brightness: sample.brightness, darkRatio: sample.darkRatio, centerFill: sample.centerFill, erodedFill: sample.erodedFill, erodedQuadrants: sample.erodedQuadrants });
                blobs.push({
                    x: Math.round(cx - sw / 2) + offsetX, y: Math.round(cy - sh / 2) + offsetY,
                    w: Math.round(sw), h: Math.round(sh),
                    cx: cx + offsetX, cy: cy + offsetY, r: Math.min(sw, sh) / 2,
                    boxBrightness: sample.brightness, inkRatio: sample.darkRatio, centerFillRatio: sample.centerFill,
                    erodedFill: sample.erodedFill, erodedQuadrants: sample.erodedQuadrants,
                    isMarked: false
                });
            }

            if (cellScores.length === 0) continue;

            // ─────────────────────────────────────────────────
            // 복합스코어 마킹 판별
            // 동그란 버블(공식E): comp = f×0.4 + e×0.35 + qMin×0.25, gap≥0.06|f≥0.82
            // 세로길쭉 버블(E-v4): comp = f×0.55 + e×0.45 (qMin 제거), gap≥0.04|f≥0.75
            // ─────────────────────────────────────────────────
            const _isElong = elongatedMode;
            const compScores = cellScores.map((c, i) => {
                const _eq = Array.isArray(c.erodedQuadrants) ? c.erodedQuadrants : [0, 0, 0, 0];
                const qMin = _eq.length > 0 ? Math.min(..._eq) : 0;
                const comp = _isElong
                    ? c.centerFill * 0.55 + c.erodedFill * 0.45
                    : c.centerFill * 0.4 + c.erodedFill * 0.35 + qMin * 0.25;
                return { col: i, comp, f: c.centerFill, e: c.erodedFill };
            }).sort((a, b) => b.comp - a.comp);
            const compGap = compScores.length > 1 ? compScores[0].comp - compScores[1].comp : compScores[0].comp;

            // 백지 판별
            const maxFill = Math.max(...cellScores.map(c => c.centerFill));
            const minFill = Math.min(...cellScores.map(c => c.centerFill));
            const isBlank = _isElong
                ? maxFill < 0.35 && (maxFill - minFill) < 0.10
                : maxFill < 0.5 && (maxFill - minFill) < 0.15;

            let primaryMarked = -1;
            // 1배가 "약한 후보"라도 봤는지 기록 (ring 비교용)
            const top = compScores[0];
            const hadWeakCandidate = !isBlank && (compGap >= 0.06 || top.f >= 0.82);
            const weakCandidateCol = hadWeakCandidate ? top.col : -1;

            if (numC === 1) {
                primaryMarked = 0;
            } else if (!isBlank) {
                // 엄격 판정: gap≥0.12 OR f≥0.95 (f 단독은 거의 꽉 참 수준)
                if (_isElong) {
                    const passBase = compGap >= 0.12 || top.f >= 0.95;
                    const passEroded = top.e >= 0.25;
                    if (passBase && passEroded) primaryMarked = top.col;
                } else {
                    if (compGap >= 0.12 || top.f >= 0.95) primaryMarked = top.col;
                }
            }

            this._log(`  Q${q + 1}: ${cellScores.map((c, ci) => {
                const _eq = Array.isArray(c.erodedQuadrants) ? c.erodedQuadrants : [0, 0, 0, 0];
                const qMin = _eq.length > 0 ? Math.min(..._eq) : 0;
                const comp = _isElong
                    ? c.centerFill * 0.55 + c.erodedFill * 0.45
                    : c.centerFill * 0.4 + c.erodedFill * 0.35 + qMin * 0.25;
                return `[${ci + 1}] s=${Math.round(c.score)} f=${c.centerFill.toFixed(3)} e=${c.erodedFill.toFixed(3)} qMin=${qMin.toFixed(3)} comp=${comp.toFixed(3)}`;
            }).join(' | ')} gap=${compGap.toFixed(3)} → ${primaryMarked !== -1 ? primaryMarked + 1 : 'null'}`);

            // 1등을 답으로 채택 (중복 판별은 최종 Stage6에서 gap 기반으로 수행)
            if (primaryMarked !== -1) blobs[primaryMarked].isMarked = true;

            structuredRows.push({
                questionNumber: q + 1, numChoices: numC,
                markedAnswer: primaryMarked !== -1 ? primaryMarked + 1 : null,
                multiMarked: false,
                markedIndices: primaryMarked !== -1 ? [primaryMarked + 1] : [],
                blobs,
                _weakCandidate: weakCandidateCol >= 0 ? weakCandidateCol + 1 : null,
            });
        }

        // ──────────────────────────────────────
        // Stage 4: 후처리 — 누락 열 복원 + 위치 교정
        // ──────────────────────────────────────
        const avgSampleW = sampleSize || 18;
        const avgSampleH = sampleSize || 18;
        this._stage4_postProcess(structuredRows, grayData, width, height, numC, avgSampleW, avgSampleH, isVert, offsetX, offsetY, patternHint, numQ, elongatedMode);

        // 디버그 블롭
        const debugBlobs = this._debugBlobs ? {
            all: this._debugBlobs.all.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
            filtered: this._debugBlobs.filtered.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
        } : null;

        // ──────────────────────────────────────
        // Stage 5: 1.5배 확장 교차 검증
        // 기존 버블 위치에서 1.5배 넓힌 영역으로 재샘플링 → 원본과 비교
        // ──────────────────────────────────────
        this._expandedVerify(grayData, width, height, numC, isVert, structuredRows, offsetX, offsetY, elongatedMode);

        // ──────────────────────────────────────
        // Stage 6: 중복의심 — 2등 comp ≥ 0.85 절대값 기준
        // ──────────────────────────────────────
        let multiCount = 0;
        structuredRows.forEach(row => {
            if (row.corrected || row._userCorrected || row._xvAutoCorrected) return;
            if (!row.blobs || row.blobs.length < 2) return;
            if (row.markedAnswer === null) return;

            const scores = row.blobs.map((b, i) => {
                const f = b.centerFillRatio || 0;
                const e = b.erodedFill || 0;
                const eq = Array.isArray(b.erodedQuadrants) ? b.erodedQuadrants : [0, 0, 0, 0];
                const qm = eq.length > 0 ? Math.min(...eq) : 0;
                const comp = elongatedMode
                    ? f * 0.55 + e * 0.45
                    : f * 0.4 + e * 0.35 + qm * 0.25;
                return { choice: i + 1, comp, f, e, qm };
            });
            const sorted6 = [...scores].sort((a, b) => b.comp - a.comp);
            if (sorted6.length < 2) return;

            // 2등의 comp가 0.85 이상이면 중복의심
            if (sorted6[1].comp >= 0.85) {
                const idx1 = sorted6[0].choice - 1;
                const idx2 = sorted6[1].choice - 1;
                row.multiMarked = true;
                row.markedAnswer = null;
                row.markedIndices = [idx1 + 1, idx2 + 1];
                row.blobs.forEach(b => b.isMarked = false);
                row.blobs[idx1].isMarked = true;
                row.blobs[idx2].isMarked = true;
                multiCount++;
                this._log(`[Stage6-중복] Q${row.questionNumber}: 2등 comp=${sorted6[1].comp.toFixed(3)} ≥ 0.85 (1등=[${sorted6[0].choice}]${sorted6[0].comp.toFixed(3)}, 2등=[${sorted6[1].choice}]${sorted6[1].comp.toFixed(3)})`);
            }
        });
        this._log(`[Stage6-중복] 중복의심 ${multiCount}건 (2등 comp≥0.85)`);

        // 최종 점검 결과 요약
        const validation = {
            expectedQ: numQ,
            actualQ: structuredRows.length,
            expectedC: numC,
            choiceMismatchRows: structuredRows.filter(r => r._choiceMismatch).map(r => r.questionNumber),
            passed: (numQ ? structuredRows.length === numQ : true)
                 && structuredRows.every(r => !r.blobs || r.blobs.length === numC),
        };

        return { rows: structuredRows, maxCols: numC, debugBlobs, validation };
    },

    // ==========================================
    // Stage 5: 링(1.5배 - 1배) 교차 검증
    // 1배 바깥 둘레(링)만 샘플링 → 진짜 마킹(번짐 있음) vs 인쇄 노이즈(번짐 없음) 판별
    // ==========================================
    _expandedVerify(grayData, width, height, numC, isVert, rows, offsetX, offsetY, elongatedMode) {
        if (rows.length === 0 || numC < 2) return;
        const EXPAND = 1.5;

        // 전체 평균 밝기 기반 임계값
        let totalBright = 0;
        for (let i = 0; i < grayData.length; i++) totalBright += grayData[i];
        const globalMean = grayData.length > 0 ? totalBright / grayData.length : 200;
        const threshold = Math.max(globalMean * 0.75, 30);

        // 링 영역 4분면 darkRatio 계산 (상/하/좌/우 독립)
        // 한쪽만 마킹이 번져도 잡아내기 위함
        const ringDarkQuadrants = (cx, cy, iw, ih, ow, oh) => {
            const innerSx = Math.round(cx - iw/2), innerSy = Math.round(cy - ih/2);
            const innerEx = innerSx + Math.round(iw), innerEy = innerSy + Math.round(ih);
            const outerSx = Math.round(cx - ow/2), outerSy = Math.round(cy - oh/2);
            const outerEx = outerSx + Math.round(ow), outerEy = outerSy + Math.round(oh);

            // 영역 계산 헬퍼
            const calc = (sx, sy, ex, ey) => {
                let dark = 0, total = 0;
                for (let yy = Math.max(0, sy); yy < Math.min(height, ey); yy++) {
                    for (let xx = Math.max(0, sx); xx < Math.min(width, ex); xx++) {
                        total++;
                        if (grayData[yy * width + xx] < threshold) dark++;
                    }
                }
                return total > 0 ? dark / total : 0;
            };

            // 4분면 (링만)
            const top    = calc(outerSx, outerSy, outerEx, innerSy);         // 위쪽 줄
            const bottom = calc(outerSx, innerEy, outerEx, outerEy);          // 아래쪽 줄
            const left   = calc(outerSx, innerSy, innerSx, innerEy);          // 왼쪽 줄 (1배 위아래 제외)
            const right  = calc(innerEx, innerSy, outerEx, innerEy);          // 오른쪽 줄
            return { top, bottom, left, right };
        };

        rows.forEach(row => {
            if (!row.blobs || row.blobs.length < 2) {
                row._xvMatch = 'no_data';
                return;
            }

            // 각 블롭의 링 4분면 darkRatio 계산 → MAX값 채택
            const xvScores = [];
            row.blobs.forEach((blob, c) => {
                const bw = blob.w || 16, bh = blob.h || 16;
                const cx = blob.cx - offsetX;
                const cy = blob.cy - offsetY;
                const ew = bw * EXPAND, eh = bh * EXPAND;

                const ringQuad = ringDarkQuadrants(cx, cy, bw, bh, ew, eh);
                // 4분면 중 최대값 (한쪽만 번져도 포착)
                const ringMax = Math.max(ringQuad.top, ringQuad.bottom, ringQuad.left, ringQuad.right);
                const ringAvg = (ringQuad.top + ringQuad.bottom + ringQuad.left + ringQuad.right) / 4;

                // 1.5배 전체(참고용 시각화)
                const full = this.sampleCell(grayData, width, height, cx, cy, Math.round(ew), Math.round(eh));

                xvScores.push({
                    col: c,
                    comp: ringMax,            // 판별 지표 = 4분면 MAX
                    ringMax, ringAvg,
                    ringQuad,                  // {top, bottom, left, right}
                    f: full.centerFill, e: full.erodedFill, qMin: 0,
                    origRect: { x: blob.cx - bw/2, y: blob.cy - bh/2, w: bw, h: bh },
                    expandRect: { x: blob.cx - ew/2, y: blob.cy - eh/2, w: ew, h: eh },
                });
            });

            // 링 MAX 기준 정렬
            const sorted = [...xvScores].sort((a, b) => b.ringMax - a.ringMax);
            const gap = sorted.length > 1 ? sorted[0].ringMax - sorted[1].ringMax : sorted[0].ringMax;

            // 링 판정:
            //   링 MAX ≥ 0.30 AND gap ≥ 0.10 → 감지
            //   (한 방향만이라도 0.30 이상 진하면 인정)
            const RING_TH = 0.30;
            const GAP_TH = 0.10;
            const xvAnswer = (sorted[0].ringMax >= RING_TH && gap >= GAP_TH)
                ? sorted[0].col + 1 : null;

            // 교차 비교
            const bubbleAnswer = row.markedAnswer;
            row._xvAnswer = xvAnswer;
            row._xvScores = xvScores;
            row._xvGap = gap;

            // ─────────────────────────────────────────
            // 최종 결정 매트릭스 (단순 규칙):
            //   1배 null + 링 null   → null
            //   1배 null + 링 Y      → Y (자동교정 🟢)
            //   1배 X    + 링 X      → X (일치, 확정)
            //   1배 X    + 링 Y (≠)  → X (1배 신뢰)
            //   1배 X    + 링 null   → X (1배 신뢰, 깔끔한 마킹)
            // → 결론: 1배가 뭐라도 감지했으면 무조건 1배
            //         링은 1배가 null일 때만 보완 (자동교정)
            // ─────────────────────────────────────────
            if (bubbleAnswer === null && xvAnswer === null) {
                row._xvMatch = 'both_null';
            } else if (bubbleAnswer === null && xvAnswer !== null) {
                // 1배 null + 링만 감지
                // 1배가 "약한 후보"라도 봤는데, 링이 다른 걸 가리키면 → ambiguous → null 유지
                // (둘 다 약한 신호인데 서로 다른 답이면 믿을 수 없음)
                if (row._weakCandidate !== null && row._weakCandidate !== xvAnswer) {
                    row._xvMatch = 'ambiguous';
                    // row.markedAnswer는 그대로 null
                } else {
                    // 1배가 아무 후보도 안 봤거나, 약한 후보 = 링 답 → 링 채택
                    row._xvMatch = 'xv_only';
                    row.markedAnswer = xvAnswer;
                    row.markedIndices = [xvAnswer];
                    row.multiMarked = false;
                    row.undetected = false;
                    row.corrected = true;
                    row._xvAutoCorrected = true;
                    if (row.blobs) {
                        row.blobs.forEach((b, bi) => { b.isMarked = (bi + 1 === xvAnswer); });
                    }
                }
            } else if (bubbleAnswer === xvAnswer) {
                row._xvMatch = 'match';
            } else if (xvAnswer === null) {
                row._xvMatch = 'bubble_only';
                // 1배 값 그대로 유지
            } else {
                row._xvMatch = 'conflict';
                // 1배 값 그대로 유지 (참고용으로 링 결과만 기록)
            }

            // 로그: 링 4분면 값 출력
            const xvStr = xvScores.map((xv, i) => {
                const q = xv.ringQuad;
                return `[${i+1}]max=${xv.ringMax.toFixed(2)}(T${q.top.toFixed(2)} B${q.bottom.toFixed(2)} L${q.left.toFixed(2)} R${q.right.toFixed(2)})`;
            }).join(' | ');
            this._log(`    └링4분면: ${xvStr} gap=${gap.toFixed(3)} → ${xvAnswer || 'null'} [${row._xvMatch}]`);
        });
    },

    // ==========================================
    // 자동 감지
    // ==========================================
    autoDetect(imageData, offsetX, offsetY, bubbleSize, elongatedMode = false) {
        const grayData = this.preprocess(imageData);
        const grid = elongatedMode
            ? this._stage1_findBubbles_elongated(grayData, imageData.width, imageData.height, bubbleSize || 0)
            : this._stage1_findBubbles(grayData, imageData.width, imageData.height, bubbleSize || 0);
        if (!grid) return null;

        const orientation = (grid.numCols > grid.numRows) ? 'horizontal' : 'vertical';
        let numQuestions, numChoices;
        if (orientation === 'vertical') { numQuestions = grid.numRows; numChoices = grid.numCols; }
        else { numQuestions = grid.numCols; numChoices = grid.numRows; }

        this._log(`[자동감지] → 방향=${orientation} 문항=${numQuestions} 지선다=${numChoices}`);
        return { orientation, numQuestions, numChoices };
    },

    // 하위 호환
    findBlobs() { return { blobs: [], pixelCtx: null }; },
    filterBlobs(b) { return b; },
    analyzeStructure() { return { rows: [], maxCols: 0 }; }
};
