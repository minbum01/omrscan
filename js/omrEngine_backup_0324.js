// ============================================
// omrEngine.js - OMR 판독 엔진 (버블 크기 기반 BFS)
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
    // BFS 블롭 감지 (버블 크기 기반 필터)
    // ==========================================
    findGrid(grayData, width, height, bubbleSize) {
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

        // 크기 + 모양 필터
        const targetSize = bubbleSize || 0;
        let filtered;

        if (targetSize > 0) {
            // 사용자 지정: ±15% + 원형 검증
            const minS = targetSize * 0.85;
            const maxS = targetSize * 1.15;
            filtered = blobs.filter(b => {
                const sz = Math.max(b.w, b.h);
                const ratio = b.w / b.h;           // 가로세로 비율 (원형이면 ~1.0)
                const fill = b.area / (b.w * b.h);  // 채움률 (원형이면 ~0.78)
                return sz >= minS && sz <= maxS && ratio > 0.7 && ratio < 1.4 && fill > 0.3;
            });
        } else {
            // 자동: 중간값 기반 + 원형 검증
            const areas = blobs.map(b => b.w * b.h).sort((a, b) => a - b);
            const medArea = areas[Math.floor(areas.length / 2)];
            filtered = blobs.filter(b => {
                const a = b.w * b.h, ratio = b.w / b.h;
                const fill = b.area / (b.w * b.h);
                return a >= medArea * 0.3 && a <= medArea * 1.8 && ratio > 0.7 && ratio < 1.4 && fill > 0.3;
            });
        }

        this._log(`[BFS] 전체: ${blobs.length}블롭 → 크기필터(${targetSize || 'auto'}): ${filtered.length}블롭`);

        if (filtered.length < 2) return null;

        // 디버그 저장
        this._debugBlobs = { all: blobs, filtered, threshold: THRESHOLD };

        // Y기준 행 그룹핑
        const sortedY = [...filtered].sort((a, b) => a.cy - b.cy);
        const medH = sortedY.map(b => b.h).sort((a, b) => a - b)[Math.floor(sortedY.length / 2)];
        const rowGroups = this._groupByAxis(sortedY, 'cy', medH);

        // X기준 열 그룹핑
        const sortedX = [...filtered].sort((a, b) => a.cx - b.cx);
        const medW = sortedX.map(b => b.w).sort((a, b) => a - b)[Math.floor(sortedX.length / 2)];
        const colGroups = this._groupByAxis(sortedX, 'cx', medW);

        // 노이즈 그룹 제거
        const colBlobCounts = colGroups.map(c => c.length).sort((a, b) => a - b);
        const medColBlobs = colBlobCounts[Math.floor(colBlobCounts.length / 2)];
        const minColBlobs = Math.max(2, Math.round(medColBlobs * 0.4));
        const goodCols = colGroups.filter(c => c.length >= minColBlobs);
        const goodRows = rowGroups.filter(r => r.length >= 2);

        const finalRows = goodRows.length >= 2 ? goodRows : rowGroups;
        const finalCols = goodCols.length >= 2 ? goodCols : colGroups;

        const rowYs = finalRows.map(g => g.reduce((s, b) => s + b.cy, 0) / g.length);
        const colXs = finalCols.map(g => g.reduce((s, b) => s + b.cx, 0) / g.length);

        this._log(`[BFS] 행=${finalRows.length} 열=${finalCols.length} colXs=[${colXs.map(Math.round).join(',')}]`);

        return {
            rowYs, colXs,
            numRows: finalRows.length,
            numCols: finalCols.length,
            modeColCount: finalCols.length,
            rowGroups: finalRows,
            colGroups: finalCols
        };
    },

    // 행 내 블롭 수 조정: numC에 맞춤
    _adjustRowBlobs(rowBlobs, numC, sortProp) {
        if (rowBlobs.length === numC) return rowBlobs;

        if (rowBlobs.length > numC) {
            // 초과: 가장 균등한 간격의 numC개 선택
            let bestCombo = rowBlobs.slice(0, numC);
            let bestVar = Infinity;
            // 조합이 많으면 비효율적이므로 연속 부분집합만 검사
            for (let s = 0; s <= rowBlobs.length - numC; s++) {
                const sub = rowBlobs.slice(s, s + numC);
                const gaps = [];
                for (let i = 1; i < sub.length; i++) gaps.push(sub[i][sortProp] - sub[i - 1][sortProp]);
                if (gaps.length === 0) continue;
                const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
                const v = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
                if (v < bestVar) { bestVar = v; bestCombo = sub; }
            }
            return bestCombo;
        }

        if (rowBlobs.length === numC - 1 && rowBlobs.length >= 2) {
            // 1개 부족: 간격 패턴으로 빠진 위치 추정
            const gaps = [];
            for (let i = 1; i < rowBlobs.length; i++) {
                gaps.push({ idx: i, gap: rowBlobs[i][sortProp] - rowBlobs[i - 1][sortProp] });
            }
            const medGap = [...gaps].sort((a, b) => a.gap - b.gap)[Math.floor(gaps.length / 2)].gap;

            // 가장 큰 간격 찾기 → 그 사이에 빠진 버블
            const biggest = [...gaps].sort((a, b) => b.gap - a.gap)[0];
            const avgW = rowBlobs.reduce((s, b) => s + b.w, 0) / rowBlobs.length;
            const avgH = rowBlobs.reduce((s, b) => s + b.h, 0) / rowBlobs.length;

            if (biggest.gap > medGap * 1.5) {
                // 큰 간격 사이에 보간
                const insertPos = rowBlobs[biggest.idx - 1][sortProp] + biggest.gap / 2;
                const insertBlob = {
                    cx: sortProp === 'cx' ? insertPos : rowBlobs[0].cx,
                    cy: sortProp === 'cy' ? insertPos : rowBlobs[0].cy,
                    w: avgW, h: avgH, area: avgW * avgH * 0.7, _interpolated: true
                };
                const result = [...rowBlobs];
                result.splice(biggest.idx, 0, insertBlob);
                return result;
            }

            // 간격 균일 → 앞이나 뒤에 추가
            const firstGap = rowBlobs[0][sortProp];
            const lastGap = rowBlobs.length > 1 ? rowBlobs[1][sortProp] - rowBlobs[0][sortProp] : medGap;
            if (firstGap > medGap * 0.8) {
                // 앞에 빠짐
                const insertBlob = {
                    cx: sortProp === 'cx' ? rowBlobs[0].cx - medGap : rowBlobs[0].cx,
                    cy: sortProp === 'cy' ? rowBlobs[0].cy - medGap : rowBlobs[0].cy,
                    w: avgW, h: avgH, area: avgW * avgH * 0.7, _interpolated: true
                };
                return [insertBlob, ...rowBlobs];
            } else {
                // 뒤에 빠짐
                const last = rowBlobs[rowBlobs.length - 1];
                const insertBlob = {
                    cx: sortProp === 'cx' ? last.cx + medGap : last.cx,
                    cy: sortProp === 'cy' ? last.cy + medGap : last.cy,
                    w: avgW, h: avgH, area: avgW * avgH * 0.7, _interpolated: true
                };
                return [...rowBlobs, insertBlob];
            }
        }

        // 2개 이상 부족 → 있는 것만 사용
        return rowBlobs;
    },

    // 축 기반 그룹핑 (공용)
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

        // 가까운 그룹 병합
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
    // 메인 분석
    // ==========================================
    analyzeROI(imageData, offsetX, offsetY, orientation = 'vertical', numQ = 0, numC = 0, _unused = null, bubbleSize = 0) {
        const width = imageData.width, height = imageData.height;
        const grayData = this.preprocess(imageData);

        let isVert = orientation === 'vertical';

        // BFS로 블롭 찾기 → 실제 블롭 위치에서 직접 샘플링
        const grid = this.findGrid(grayData, width, height, bubbleSize);
        if (!grid) return { rows: [], maxCols: 0 };

        if (!orientation || orientation === '') {
            isVert = grid.numCols > grid.numRows ? false : true;
        }

        // 행 그룹 = 문항, 행 내 블롭들 = 선택지 (X순 정렬)
        const rowGroups = isVert ? grid.rowGroups : grid.colGroups;
        const sortProp = isVert ? 'cx' : 'cy';

        // 행별 블롭 수 최빈값 = 지선다
        const rowBlobCounts = rowGroups.map(r => r.length);
        const freq = {};
        rowBlobCounts.forEach(c => { if (c > 0) freq[c] = (freq[c] || 0) + 1; });
        const detectedNumC = Object.keys(freq).length > 0
            ? parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]) : 0;

        numQ = numQ > 0 ? numQ : rowGroups.length;
        numC = numC > 0 ? numC : detectedNumC;

        const sampleSize = bubbleSize > 0 ? bubbleSize * 0.9 : null;

        this._log(`[블롭분석] ${rowGroups.length}행 감지, 최빈열수=${detectedNumC}, 설정: ${numQ}문항×${numC}지선다`);

        const structuredRows = [];

        for (let q = 0; q < Math.min(numQ, rowGroups.length); q++) {
            let rowBlobs = [...rowGroups[q]].sort((a, b) => a[sortProp] - b[sortProp]);

            // 행당 블롭 수 제한/보간
            if (numC > 0) {
                rowBlobs = this._adjustRowBlobs(rowBlobs, numC, sortProp);
            }

            const blobs = [], cellScores = [];

            for (let c = 0; c < rowBlobs.length; c++) {
                const b = rowBlobs[c];
                const cx = b.cx;
                const cy = b.cy;
                const sw = sampleSize || b.w * 0.9;
                const sh = sampleSize || b.h * 0.9;

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
            const avgFill = cellScores.reduce((s, c) => s + c.centerFill, 0) / cellScores.length;
            const avgBright = cellScores.reduce((s, c) => s + c.brightness, 0) / cellScores.length;
            const avgInk = cellScores.reduce((s, c) => s + c.darkRatio, 0) / cellScores.length;

            // 마킹 판별
            let primaryMarked = -1;
            if (bestIdx !== -1 && numC > 1) {
                const best = cellScores[bestIdx];
                const dB = avgBright - best.brightness, dI = best.darkRatio - avgInk, dF = best.centerFill - avgFill;

                if ((dB > 8 || dI > 0.03 || dF > 0.05) && promRatio > 1.5) {
                    primaryMarked = bestIdx;
                }

                // 백지 판별
                const maxFill = Math.max(...cellScores.map(c => c.centerFill));
                const minFill = Math.min(...cellScores.map(c => c.centerFill));
                const isBlank = maxFill < 0.5 && (maxFill - minFill) < 0.15;

                // 1차 불확실 + 백지 아님 → 2차 검증 (실제 블롭 위치에서 좁은 샘플링)
                const bestFill = cellScores[bestIdx].centerFill;
                if (!isBlank && promRatio < 3 && bestFill < 0.9) {
                    const narrowScores = [];
                    for (let c2 = 0; c2 < rowBlobs.length; c2++) {
                        const rb = rowBlobs[c2];
                        const nw = (sampleSize || rb.w * 0.9) * 0.5;
                        const nh = (sampleSize || rb.h * 0.9) * 0.5;
                        const s2 = this.sampleCell(grayData, width, height, rb.cx, rb.cy, nw, nh);
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

                    if (nPromRatio > 1.5) {
                        if (primaryMarked === -1 || nBestIdx !== primaryMarked) {
                            primaryMarked = nBestIdx;
                        }
                    } else if (primaryMarked !== -1) {
                        primaryMarked = -1;
                    }
                }
            } else if (numC === 1) primaryMarked = 0;

            // 로그
            this._log(`  Q${q + 1}: ${cellScores.map(c => `[${c.col + 1}] s=${Math.round(c.score)} b=${Math.round(c.brightness)} f=${c.centerFill.toFixed(3)}`).join(' | ')} prom=${promRatio.toFixed(2)}`);

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
            this._log(`    → answer=${finalMarked}${isMulti ? ' (중복)' : ''}`);

            structuredRows.push({ questionNumber: q + 1, numChoices: numC, markedAnswer: finalMarked, multiMarked: isMulti, markedIndices: markedIndices.map(i => i + 1), blobs });
        }

        // 디버그 블롭
        const debugBlobs = this._debugBlobs ? {
            all: this._debugBlobs.all.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
            filtered: this._debugBlobs.filtered.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
        } : null;

        // 양식 저장용: 각 행의 블롭 실제 좌표
        const rowYs = rowGroups.slice(0, numQ).map(g => g.reduce((s, b) => s + b.cy, 0) / g.length);
        const colXs = rowGroups.length > 0
            ? [...rowGroups[0]].sort((a, b) => a.cx - b.cx).map(b => b.cx)
            : [];
        const avgBlobSize = this._debugBlobs && this._debugBlobs.filtered.length > 0
            ? this._debugBlobs.filtered.reduce((s, b) => s + Math.max(b.w, b.h), 0) / this._debugBlobs.filtered.length
            : 20;
        const gridData = {
            qPositions: rowYs,
            cPositions: colXs,
            sampleW: sampleSize || avgBlobSize * 0.9,
            sampleH: sampleSize || avgBlobSize * 0.9
        };

        return { rows: structuredRows, maxCols: rowGroups.length > 0 ? Math.max(...rowGroups.map(r => r.length)) : 0, debugBlobs, gridData };
    },

    // ==========================================
    // 양식 모드: 고정 좌표로 분석
    // ==========================================
    _analyzeWithGrid(grayData, width, height, offsetX, offsetY, isVert, savedGrid, bubbleSize) {
        const qPositions = savedGrid.qPositions;
        const cPositions = savedGrid.cPositions;
        const numQ = qPositions.length;
        const numC = cPositions.length;
        const sampleW = savedGrid.sampleW || (bubbleSize > 0 ? bubbleSize * 0.9 : 20);
        const sampleH = savedGrid.sampleH || sampleW;

        this._log(`[양식분석] ${numQ}문항 × ${numC}지선다`);
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

            // 동일한 마킹 판별 로직
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

            let primaryMarked = -1;
            if (bestIdx !== -1 && numC > 1) {
                const best = cellScores[bestIdx];
                const dB = avgBright - best.brightness, dI = best.darkRatio - avgInk, dF = best.centerFill - avgFill;
                if ((dB > 8 || dI > 0.03 || dF > 0.05) && promRatio > 1.5) primaryMarked = bestIdx;

                const maxFill = Math.max(...cellScores.map(c => c.centerFill));
                const minFill = Math.min(...cellScores.map(c => c.centerFill));
                const isBlank = maxFill < 0.5 && (maxFill - minFill) < 0.15;
                const bestFill = cellScores[bestIdx].centerFill;

                if (!isBlank && promRatio < 3 && bestFill < 0.9) {
                    const narrowScores = [];
                    for (let c2 = 0; c2 < numC; c2++) {
                        const cx2 = isVert ? cPositions[c2] : qPositions[q];
                        const cy2 = isVert ? qPositions[q] : cPositions[c2];
                        const s2 = this.sampleCell(grayData, width, height, cx2, cy2, sampleW * 0.5, sampleH * 0.5);
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

            const markedIndices = [];
            if (primaryMarked !== -1 && numC > 1) {
                const pS = cellScores[primaryMarked].score, pF = cellScores[primaryMarked].centerFill;
                cellScores.forEach((c, i) => { if (i !== primaryMarked && c.score > pS * 0.95 && c.centerFill > pF * 0.9 && c.centerFill > 0.8) markedIndices.push(i); });
                if (markedIndices.length > 0) markedIndices.unshift(primaryMarked);
            }
            if (markedIndices.length === 0 && primaryMarked !== -1) markedIndices.push(primaryMarked);

            const isMulti = markedIndices.length > 1;
            if (isMulti) markedIndices.forEach(i => { blobs[i].isMarked = true; });
            else if (primaryMarked !== -1) blobs[primaryMarked].isMarked = true;
            const finalMarked = !isMulti && primaryMarked !== -1 ? primaryMarked + 1 : null;

            structuredRows.push({ questionNumber: q + 1, numChoices: numC, markedAnswer: finalMarked, multiMarked: isMulti, markedIndices: markedIndices.map(i => i + 1), blobs });
        }

        const gridData = { qPositions: [...qPositions], cPositions: [...cPositions], sampleW, sampleH };
        return { rows: structuredRows, maxCols: numC, debugBlobs: null, gridData };
    },

    // ==========================================
    // 자동 감지
    // ==========================================
    autoDetect(imageData, offsetX, offsetY, bubbleSize) {
        const grayData = this.preprocess(imageData);
        const grid = this.findGrid(grayData, imageData.width, imageData.height, bubbleSize || 0);
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

        this._log(`[자동감지] BFS → 방향=${orientation} 문항=${numQuestions} 지선다=${numChoices}`);
        return { orientation, numQuestions, numChoices };
    },

    // 하위 호환
    findBlobs() { return { blobs: [], pixelCtx: null }; },
    filterBlobs(b) { return b; },
    analyzeStructure() { return { rows: [], maxCols: 0 }; }
};
