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
        if (total === 0) return { brightness: 255, darkRatio: 0, centerFill: 0 };
        const localMean = brightSum / total;
        // 절대 최소 기준 30 — 완전히 까맣게 칠한 영역이 상대 기준으로는 감지 안 되는 버그 방지
        const localThreshold = Math.max(localMean * 0.75, 30);
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
        // 정상 행(numC개 블롭)에서 열 평균 계산
        const normalRows = rowGroups.filter(r => r.length === numC);
        if (normalRows.length < 2) return { filtered: rowGroups, colAvg: null };

        const colAvgX = Array.from({ length: numC }, (_, c) => {
            const vals = normalRows.map(r => {
                const sorted = [...r].sort((a, b) => a[sortProp] - b[sortProp]);
                return sorted[c] ? sorted[c][sortProp] : null;
            }).filter(v => v !== null);
            return vals.reduce((s, v) => s + v, 0) / vals.length;
        });

        const colGap = numC > 1 ? (colAvgX[numC - 1] - colAvgX[0]) / (numC - 1) : 20;
        const tolerance = colGap * 0.35;

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
    _stage4_postProcess(structuredRows, grayData, width, height, numC, sampleW, sampleH, isVert, offsetX, offsetY) {
        // 4-1. 정상 행(numC개 블롭)에서 열 평균 계산
        const normalRows = structuredRows.filter(r => r.blobs.length === numC);
        if (normalRows.length < 2) return; // 기준 부족

        const prop = isVert ? 'cx' : 'cy';
        const colAvgX = Array.from({ length: numC }, (_, c) => {
            const vals = normalRows.map(r => r.blobs[c][prop]);
            return vals.reduce((s, v) => s + v, 0) / vals.length;
        });
        const colGap = numC > 1 ? (colAvgX[numC - 1] - colAvgX[0]) / (numC - 1) : 20;
        const tolerance = colGap * 0.4;

        this._log(`[Stage4] 열평균=[${colAvgX.map(Math.round).join(',')}] 정상행=${normalRows.length}/${structuredRows.length}`);

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
                            boxBrightness: 255, inkRatio: 0, centerFillRatio: 0
                        });
                        needResample = true;
                    }
                }

                if (needResample) {
                    row.blobs = newBlobs;
                    row._autoCorrected = true;
                    this._resampleRow(row, grayData, width, height, sampleW, sampleH, numC, offsetX, offsetY, isVert);
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
                    this._resampleRow(row, grayData, width, height, sampleW, sampleH, numC, offsetX, offsetY, isVert);
                }
            }
        });
    },

    // 행 재샘플링 + 마킹 재판별
    _resampleRow(row, grayData, width, height, sampleW, sampleH, numC, offsetX, offsetY, isVert) {
        const cellScores = [];
        row.blobs.forEach((blob, c) => {
            // blob.cx/cy는 절대좌표(offset 포함) → sampleCell은 ROI 내부 상대좌표 필요
            const cx = blob.cx - offsetX;
            const cy = blob.cy - offsetY;
            const sample = this.sampleCell(grayData, width, height, cx, cy, sampleW, sampleH);
            const score = (sample.darkRatio * 300) + (255 - sample.brightness) + (sample.centerFill * 800);
            blob.boxBrightness = sample.brightness;
            blob.inkRatio = sample.darkRatio;
            blob.centerFillRatio = sample.centerFill;
            blob.isMarked = false;
            cellScores.push({ col: c, score, brightness: sample.brightness, darkRatio: sample.darkRatio, centerFill: sample.centerFill });
        });

        // 마킹 재판별
        if (cellScores.length < 2) return;
        const prominences = cellScores.map((c, i) => {
            const others = cellScores.filter((_, j) => j !== i);
            const oAvg = others.length > 0 ? others.reduce((s, o) => s + o.score, 0) / others.length : 0;
            return { idx: i, prom: c.score - oAvg };
        }).sort((a, b) => b.prom - a.prom);
        const bestProm = prominences[0].prom;
        const secondProm = prominences.length > 1 ? prominences[1].prom : 0;
        const promRatio = secondProm > 0 ? bestProm / secondProm : (bestProm > 30 ? 999 : 0);

        let bestIdx = -1, bestScore = -999;
        const avgBright = cellScores.reduce((s, c) => s + c.brightness, 0) / cellScores.length;
        const avgInk = cellScores.reduce((s, c) => s + c.darkRatio, 0) / cellScores.length;
        const avgFill = cellScores.reduce((s, c) => s + c.centerFill, 0) / cellScores.length;
        cellScores.forEach((c, i) => { if (c.score > bestScore) { bestScore = c.score; bestIdx = i; } });

        let primaryMarked = -1;
        if (bestIdx !== -1 && numC > 1) {
            const best = cellScores[bestIdx];
            const dB = avgBright - best.brightness, dI = best.darkRatio - avgInk, dF = best.centerFill - avgFill;
            if ((dB > 8 || dI > 0.03 || dF > 0.05) && promRatio > 1.5) primaryMarked = bestIdx;

            const maxFill = Math.max(...cellScores.map(c => c.centerFill));
            const minFill = Math.min(...cellScores.map(c => c.centerFill));
            if (maxFill < 0.5 && (maxFill - minFill) < 0.15) primaryMarked = -1; // 백지
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
    analyzeROI(imageData, offsetX, offsetY, orientation = 'vertical', numQ = 0, numC = 0, _unused = null, bubbleSize = 0, elongatedMode = false, elongatedThresholds = null) {
        const width = imageData.width, height = imageData.height;
        const grayData = this.preprocess(imageData);
        let isVert = orientation === 'vertical';

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
            if (rowGroups.length > 0) {
                const bestRow = [...rowGroups].sort((a, b) => b.length - a.length)[0];
                const sorted = [...bestRow].sort((a, b) => a[sortProp] - b[sortProp]);
                colAvgPositions = sorted.slice(0, numC).map(b => b[sortProp]);
            } else {
                return { rows: [], maxCols: 0 };
            }
        }

        // 평균 버블 크기
        const allFilteredBlobs = rowGroups.flat();
        const avgBlobW = allFilteredBlobs.length > 0 ? allFilteredBlobs.reduce((s, b) => s + b.w, 0) / allFilteredBlobs.length : 18;
        const avgBlobH = allFilteredBlobs.length > 0 ? allFilteredBlobs.reduce((s, b) => s + b.h, 0) / allFilteredBlobs.length : 18;
        const sw = sampleSize || avgBlobW * 0.9;
        const sh = sampleSize || avgBlobH * 0.9;

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

                cellScores.push({ col: c, score, brightness: sample.brightness, darkRatio: sample.darkRatio, centerFill: sample.centerFill });
                blobs.push({
                    x: Math.round(cx - sw / 2) + offsetX, y: Math.round(cy - sh / 2) + offsetY,
                    w: Math.round(sw), h: Math.round(sh),
                    cx: cx + offsetX, cy: cy + offsetY, r: Math.min(sw, sh) / 2,
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

            let bestIdx = -1, bestScore = -999;
            cellScores.forEach((c, i) => { if (c.score > bestScore) { bestScore = c.score; bestIdx = i; } });
            const avgBright = cellScores.reduce((s, c) => s + c.brightness, 0) / cellScores.length;
            const avgInk = cellScores.reduce((s, c) => s + c.darkRatio, 0) / cellScores.length;
            const avgFill = cellScores.reduce((s, c) => s + c.centerFill, 0) / cellScores.length;

            // 마킹 판별
            let primaryMarked = -1;
            if (bestIdx !== -1 && numC > 1) {
                const best = cellScores[bestIdx];
                const dB = avgBright - best.brightness, dI = best.darkRatio - avgInk, dF = best.centerFill - avgFill;
                if ((dB > 8 || dI > 0.03 || dF > 0.05) && promRatio > 1.5) primaryMarked = bestIdx;

                // 백지 판별
                const maxFill = Math.max(...cellScores.map(c => c.centerFill));
                const minFill = Math.min(...cellScores.map(c => c.centerFill));
                const isBlank = maxFill < 0.5 && (maxFill - minFill) < 0.15;

                // 2차 검증
                const bestFill = cellScores[bestIdx].centerFill;
                if (!isBlank && promRatio < 3 && bestFill < 0.9) {
                    const narrowScores = [];
                    for (let c2 = 0; c2 < numC; c2++) {
                        const ncx = isVert ? colAvgPositions[c2] : rowY;
                        const ncy = isVert ? rowY : colAvgPositions[c2];
                        const nw = sw * 0.5, nh = sh * 0.5;
                        const s2 = this.sampleCell(grayData, width, height, ncx, ncy, nw, nh);
                        narrowScores.push({ col: c2, score: (s2.darkRatio * 300) + (255 - s2.brightness) + (s2.centerFill * 800) });
                    }
                    const nProms = narrowScores.map((c, i) => {
                        const others = narrowScores.filter((_, j) => j !== i);
                        const oA = others.length > 0 ? others.reduce((s, o) => s + o.score, 0) / others.length : 0;
                        return { idx: i, prom: c.score - oA };
                    }).sort((a, b) => b.prom - a.prom);
                    const nPromRatio = nProms.length > 1 && nProms[1].prom > 0 ? nProms[0].prom / nProms[1].prom : (nProms[0].prom > 30 ? 999 : 0);
                    if (nPromRatio > 1.5) { if (primaryMarked === -1 || nProms[0].idx !== primaryMarked) primaryMarked = nProms[0].idx; }
                    else if (primaryMarked !== -1) primaryMarked = -1;
                }
            } else if (numC === 1) primaryMarked = 0;

            this._log(`  Q${q + 1}: ${cellScores.map(c => `[${c.col + 1}] s=${Math.round(c.score)} f=${c.centerFill.toFixed(3)}`).join(' | ')} prom=${promRatio.toFixed(2)} → ${primaryMarked !== -1 ? primaryMarked + 1 : 'null'}`);

            // 중복 감지
            const markedIndices = [];
            if (primaryMarked !== -1 && numC > 1) {
                const pS = cellScores[primaryMarked].score, pF = cellScores[primaryMarked].centerFill;
                cellScores.forEach((c, i) => {
                    if (i !== primaryMarked && c.score > pS * 0.95 && c.centerFill > pF * 0.9 && c.centerFill > 0.8) markedIndices.push(i);
                });
                if (markedIndices.length > 0) markedIndices.unshift(primaryMarked);
            }
            if (markedIndices.length === 0 && primaryMarked !== -1) markedIndices.push(primaryMarked);

            const isMulti = markedIndices.length > 1;
            if (isMulti) markedIndices.forEach(i => { blobs[i].isMarked = true; });
            else if (primaryMarked !== -1) blobs[primaryMarked].isMarked = true;
            const finalMarked = !isMulti && primaryMarked !== -1 ? primaryMarked + 1 : null;

            structuredRows.push({ questionNumber: q + 1, numChoices: numC, markedAnswer: finalMarked, multiMarked: isMulti, markedIndices: markedIndices.map(i => i + 1), blobs });
        }

        // ──────────────────────────────────────
        // Stage 4: 후처리 — 누락 열 복원 + 위치 교정
        // ──────────────────────────────────────
        const avgSampleW = sampleSize || 18;
        const avgSampleH = sampleSize || 18;
        this._stage4_postProcess(structuredRows, grayData, width, height, numC, avgSampleW, avgSampleH, isVert, offsetX, offsetY);

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
