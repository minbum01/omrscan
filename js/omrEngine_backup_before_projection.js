// ============================================
// omrEngine.js - OMR 판독 엔진 (그리드 샘플링)
// 전체 정리 버전
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
    // BFS 블롭 탐지 + 필터 + 그룹핑 (공용)
    // ==========================================
    findGrid(grayData, width, height) {
        const THRESHOLD = (() => {
            let t = 0; for (let i = 0; i < grayData.length; i++) t += grayData[i];
            return (t / grayData.length) * 0.75;
        })();

        // BFS (blurred 데이터 사용)
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
                    if (bw > 5 && bh > 5 && cnt > 10) blobs.push({ cx: mnX + bw/2, cy: mnY + bh/2, w: bw, h: bh });
                }
            }
        }

        if (blobs.length < 2) return null;

        // 크기 필터
        const areas = blobs.map(b => b.w * b.h).sort((a,b) => a-b);
        const medArea = areas[Math.floor(areas.length / 2)];
        const filtered = blobs.filter(b => {
            const a = b.w * b.h, r = b.w / b.h;
            return a >= medArea * 0.3 && a <= medArea * 1.8 && b.w < 40 && b.h < 40 && r > 0.4 && r < 2.5;
        });
        if (filtered.length < 2) return null;

        // Y기준 행 그룹핑 (2단계: 느슨하게 나눈 후 가까운 그룹 병합)
        const sortedY = [...filtered].sort((a,b) => a.cy - b.cy);
        const medH = sortedY.map(b => b.h).sort((a,b) => a-b)[Math.floor(sortedY.length/2)];

        const rawRowGroups = [];
        let cr = [sortedY[0]], crY = sortedY[0].cy;
        for (let i = 1; i < sortedY.length; i++) {
            if (Math.abs(sortedY[i].cy - crY) < medH) {
                cr.push(sortedY[i]); crY = cr.reduce((s,b) => s+b.cy, 0) / cr.length;
            } else { rawRowGroups.push(cr); cr = [sortedY[i]]; crY = sortedY[i].cy; }
        }
        rawRowGroups.push(cr);

        const rowGroups = [rawRowGroups[0]];
        if (rawRowGroups.length > 1) {
            const rCenters = rawRowGroups.map(g => g.reduce((s,b) => s+b.cy, 0) / g.length);
            const rGaps = [];
            for (let i = 1; i < rCenters.length; i++) rGaps.push(rCenters[i] - rCenters[i-1]);
            const medRowGap = rGaps.length > 0 ? [...rGaps].sort((a,b) => a-b)[Math.floor(rGaps.length/2)] : medH * 3;
            const rMergeThreshold = medRowGap * 0.4;

            for (let i = 1; i < rawRowGroups.length; i++) {
                const prevC = rowGroups[rowGroups.length-1].reduce((s,b) => s+b.cy, 0) / rowGroups[rowGroups.length-1].length;
                const curC = rawRowGroups[i].reduce((s,b) => s+b.cy, 0) / rawRowGroups[i].length;
                if (curC - prevC < rMergeThreshold) {
                    rawRowGroups[i].forEach(b => rowGroups[rowGroups.length-1].push(b));
                } else {
                    rowGroups.push(rawRowGroups[i]);
                }
            }
        }

        // X기준 열 그룹핑 (2단계: 느슨하게 나눈 후 가까운 그룹 병합)
        const sortedX = [...filtered].sort((a,b) => a.cx - b.cx);
        const medW = sortedX.map(b => b.w).sort((a,b) => a-b)[Math.floor(sortedX.length/2)];

        // 1단계: 느슨한 초기 그룹핑 (medW * 1.0)
        const rawColGroups = [];
        let cc = [sortedX[0]], ccX = sortedX[0].cx;
        for (let i = 1; i < sortedX.length; i++) {
            if (Math.abs(sortedX[i].cx - ccX) < medW) {
                cc.push(sortedX[i]); ccX = cc.reduce((s,b) => s+b.cx, 0) / cc.length;
            } else { rawColGroups.push(cc); cc = [sortedX[i]]; ccX = sortedX[i].cx; }
        }
        rawColGroups.push(cc);

        // 2단계: 가까운 그룹 병합 (그룹 간 간격이 중간값의 40% 미만이면 병합)
        const colGroups = [rawColGroups[0]];
        if (rawColGroups.length > 1) {
            const groupCenters = rawColGroups.map(g => g.reduce((s,b) => s+b.cx, 0) / g.length);
            const groupGaps = [];
            for (let i = 1; i < groupCenters.length; i++) groupGaps.push(groupCenters[i] - groupCenters[i-1]);
            const medColGap = groupGaps.length > 0 ? [...groupGaps].sort((a,b) => a-b)[Math.floor(groupGaps.length/2)] : medW * 3;
            const mergeThreshold = medColGap * 0.4;

            for (let i = 1; i < rawColGroups.length; i++) {
                const prevCenter = colGroups[colGroups.length-1].reduce((s,b) => s+b.cx, 0) / colGroups[colGroups.length-1].length;
                const curCenter = rawColGroups[i].reduce((s,b) => s+b.cx, 0) / rawColGroups[i].length;
                if (curCenter - prevCenter < mergeThreshold) {
                    // 가까움 → 병합
                    rawColGroups[i].forEach(b => colGroups[colGroups.length-1].push(b));
                } else {
                    colGroups.push(rawColGroups[i]);
                }
            }
        }

        // 노이즈 그룹 제거
        // 열: 열 블롭 수의 중간값의 50% 미만이면 제거 (문제번호=6 vs 버블=20 → 6/20=30% → 제거)
        const colBlobCounts = colGroups.map(c => c.length).sort((a,b) => a-b);
        const medColBlobs = colBlobCounts[Math.floor(colBlobCounts.length / 2)];
        const minColBlobs = Math.max(3, Math.round(medColBlobs * 0.5));
        const goodCols = colGroups.filter(c => c.length >= minColBlobs);

        const minRowBlobs = 2;
        const goodRows = rowGroups.filter(r => r.length >= minRowBlobs);

        const finalRows = goodRows.length >= 2 ? goodRows : rowGroups;
        const finalCols = goodCols.length >= 2 ? goodCols : colGroups;

        const rowYs = finalRows.map(g => g.reduce((s,b) => s+b.cy, 0) / g.length);
        const colXs = finalCols.map(g => g.reduce((s,b) => s+b.cx, 0) / g.length);

        // 행별 최빈 블롭 수 (노이즈 제거된 열 범위 내의 블롭만 카운트)
        const colMinX = colXs.length > 0 ? colXs[0] - 15 : 0;
        const colMaxX = colXs.length > 0 ? colXs[colXs.length-1] + 15 : width;
        const colCounts = finalRows.map(r => {
            return r.filter(b => b.cx >= colMinX && b.cx <= colMaxX).length;
        });
        const freq = {}; colCounts.forEach(c => { if (c > 0) freq[c] = (freq[c]||0)+1; });
        const modeColCount = Object.keys(freq).length > 0 ?
            parseInt(Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0]) : finalCols.length;

        // 원본 블롭 X분포 (그룹핑 전)
        const rawXs = [...filtered].sort((a,b) => a.cx - b.cx).map(b => Math.round(b.cx));
        console.log(`[findGrid] BFS: ${blobs.length}블롭 → 필터: ${filtered.length}`);
        console.log(`  원본 X분포: [${rawXs.join(',')}]`);
        console.log(`  medW=${Math.round(medW)} 열그룹초기=${rawColGroups.length}→병합후=${colGroups.length}`);
        console.log(`  그룹핑 전 열그룹: ${colGroups.length}개 [${colGroups.map(c => `(${c.length}블롭,X=${Math.round(c.reduce((s,b)=>s+b.cx,0)/c.length)})`).join(', ')}]`);
        console.log(`  노이즈 제거후: 행=${finalRows.length} 열=${finalCols.length}`);
        console.log(`  열별 블롭수: [${finalCols.map(c => c.length).join(',')}]`);
        console.log(`  열X: [${colXs.map(x => Math.round(x)).join(',')}]`);
        // 열별 블롭 상세: 각 열에 속한 블롭의 Y좌표와 크기
        finalCols.forEach((col, ci) => {
            const sorted = [...col].sort((a,b) => a.cy - b.cy);
            const details = sorted.map(b => `Y=${Math.round(b.cy)}(${b.w}x${b.h})`);
            console.log(`  열${ci+1}(X=${Math.round(colXs[ci])}): ${col.length}블롭 → [${details.join(', ')}]`);
        });
        // 행별 블롭 상세: 각 행에 속한 블롭의 X좌표
        finalRows.forEach((row, ri) => {
            const sorted = [...row].sort((a,b) => a.cx - b.cx);
            const details = sorted.map(b => `X=${Math.round(b.cx)}`);
            console.log(`  행${ri+1}(Y=${Math.round(rowYs[ri])}): ${row.length}블롭 → [${details.join(', ')}]`);
        });
        console.log(`  modeColCount=${modeColCount}`);

        // 디버그: BFS가 찾은 모든 블롭과 필터 통과 블롭 저장
        this._debugBlobs = { all: blobs, filtered, threshold: THRESHOLD };

        return { rowYs, colXs, numRows: finalRows.length, numCols: finalCols.length, modeColCount, medArea, rowGroups: finalRows, colGroups: finalCols };
    },

    // ==========================================
    // 위치 조정 (초과/부족)
    // ==========================================
    adjustPositions(positions, expected, isColumnAxis, groups) {
        if (positions.length === expected) return positions;

        if (positions.length > expected) {
            if (isColumnAxis && groups && groups.length === positions.length) {
                // 열 초과: 블롭 수가 가장 많은 N개 선택
                const indexed = groups.map((g, i) => ({ pos: positions[i], count: g.length, idx: i }));
                const removed = [...indexed].sort((a, b) => b.count - a.count).slice(expected);
                console.log(`  [adjustPositions] 열 ${positions.length}→${expected}: 제거=[${removed.map(r => `X=${Math.round(r.pos)}(${r.count}블롭)`).join(', ')}]`);
                indexed.sort((a, b) => b.count - a.count);
                const selected = indexed.slice(0, expected);
                selected.sort((a, b) => a.pos - b.pos);
                return selected.map(s => s.pos);
            } else {
                // 행 초과: 가장 균등한 간격의 N개 연속 부분집합
                let bestStart = 0, bestVar = Infinity;
                for (let s = 0; s <= positions.length - expected; s++) {
                    const sub = positions.slice(s, s + expected);
                    const gaps = [];
                    for (let i = 1; i < sub.length; i++) gaps.push(sub[i] - sub[i-1]);
                    if (gaps.length === 0) continue;
                    const mean = gaps.reduce((a,b) => a+b, 0) / gaps.length;
                    const v = gaps.reduce((s,g) => s + (g-mean)**2, 0) / gaps.length;
                    if (v < bestVar) { bestVar = v; bestStart = s; }
                }
                return positions.slice(bestStart, bestStart + expected);
            }
        }

        // 부족: 그룹 패턴 기반 보간
        if (positions.length < 2) {
            const start = positions[0] || 10;
            return Array.from({ length: expected }, (_, i) => start + i * 20);
        }

        // 간격 분석
        const allGaps = [];
        for (let i = 1; i < positions.length; i++) allGaps.push(positions[i] - positions[i-1]);
        const sortedGaps = [...allGaps].sort((a,b) => a-b);
        const medGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
        const gapThreshold = medGap * 1.6;

        // 큰 간격으로 그룹 분할
        const largeGapCount = allGaps.filter(g => g > gapThreshold).length;
        if (largeGapCount === 0) {
            // 큰 간격 없음 → 끝에 보간
            const result = [...positions];
            while (result.length < expected) result.push(result[result.length-1] + medGap);
            return result.slice(0, expected);
        }

        const posGroups = [];
        let groupStart = 0;
        for (let i = 0; i < allGaps.length; i++) {
            if (allGaps[i] > gapThreshold) {
                posGroups.push(positions.slice(groupStart, i + 1));
                groupStart = i + 1;
            }
        }
        posGroups.push(positions.slice(groupStart));

        // 최빈 그룹 크기 (가장 많이 나타나는 크기, 동률이면 큰 쪽)
        const groupSizes = posGroups.map(g => g.length);
        const sizeFreq = {};
        groupSizes.forEach(s => { if (s > 0) sizeFreq[s] = (sizeFreq[s]||0)+1; });
        const modeGroupSize = parseInt(Object.entries(sizeFreq)
            .sort((a,b) => b[1]-a[1] || parseInt(b[0])-parseInt(a[0]))[0][0]);

        console.log(`  [adjustPositions] 그룹분할: [${groupSizes}] mode=${modeGroupSize} deficit=${expected - positions.length}`);

        // 작은 그룹 병합 후 내부 보간
        const finalGroups = [];
        let gi = 0;
        while (gi < posGroups.length) {
            if (posGroups[gi].length >= modeGroupSize) {
                finalGroups.push([...posGroups[gi]]);
                gi++;
                continue;
            }
            // 작은 그룹 → 인접 작은 그룹과 병합 시도
            let merged = [...posGroups[gi]];
            let gj = gi + 1;
            while (gj < posGroups.length && merged.length + posGroups[gj].length <= modeGroupSize) {
                merged.push(...posGroups[gj]);
                gj++;
            }

            // 병합 후에도 부족하면 내부 큰 간격에 보간
            if (merged.length < modeGroupSize && merged.length >= 2) {
                const mGaps = [];
                for (let k = 1; k < merged.length; k++) {
                    mGaps.push({ idx: k, gap: merged[k] - merged[k-1] });
                }
                mGaps.sort((a,b) => b.gap - a.gap);

                let deficit = modeGroupSize - merged.length;
                const insertMap = new Map();
                for (const g of mGaps) {
                    if (deficit <= 0) break;
                    const canInsert = Math.max(1, Math.round(g.gap / medGap) - 1);
                    const toInsert = Math.min(canInsert, deficit);
                    if (toInsert > 0) { insertMap.set(g.idx, toInsert); deficit -= toInsert; }
                }

                const filled = [merged[0]];
                for (let k = 1; k < merged.length; k++) {
                    const ins = insertMap.get(k) || 0;
                    if (ins > 0) {
                        const step = (merged[k] - merged[k-1]) / (ins + 1);
                        for (let l = 1; l <= ins; l++) filled.push(merged[k-1] + step * l);
                    }
                    filled.push(merged[k]);
                }
                while (filled.length < modeGroupSize) filled.push(filled[filled.length-1] + medGap);
                merged = filled.slice(0, modeGroupSize);
                console.log(`  [adjustPositions] 그룹보간: [${merged.map(p=>Math.round(p))}]`);
            }

            finalGroups.push(merged);
            gi = gj;
        }

        const result = finalGroups.flat();
        while (result.length < expected) result.push(result[result.length-1] + medGap);
        return result.slice(0, expected);
    },

    // ==========================================
    // 메인 분석
    // ==========================================
    analyzeROI(imageData, offsetX, offsetY, orientation = 'vertical', numQ = 0, numC = 0) {
        const width = imageData.width, height = imageData.height;
        const grayData = this.preprocess(imageData);

        // 1. 그리드 찾기 (한 번만)
        const grid = this.findGrid(grayData, width, height);
        if (!grid) return { rows: [], maxCols: 0 };

        // 2. 방향 결정 (사용자 설정 우선)
        if (!orientation || orientation === '') {
            orientation = (grid.modeColCount > 5 || grid.numCols > grid.numRows) ? 'horizontal' : 'vertical';
        }
        const isVert = orientation === 'vertical';

        // 3. 문항수/지선다
        // 사용자 설정이 없으면(0) findGrid 결과 사용, 있으면 사용자 설정 우선
        const gridNumQ = isVert ? grid.numRows : grid.numCols;
        const gridNumC = isVert ? grid.numCols : grid.numRows;

        if (numQ <= 0) numQ = gridNumQ;
        if (numC <= 0) numC = gridNumC;

        // 4. 위치 매핑 (블롭 수 기반으로 노이즈 열 제거)
        let qPositions, cPositions;
        if (isVert) {
            qPositions = this.adjustPositions(grid.rowYs, numQ, false, grid.rowGroups);
            cPositions = this.adjustPositions(grid.colXs, numC, true, grid.colGroups);
        } else {
            qPositions = this.adjustPositions(grid.colXs, numQ, false, grid.colGroups);
            cPositions = this.adjustPositions(grid.rowYs, numC, true, grid.rowGroups);
        }

        // 5. 샘플 크기
        const qGap = qPositions.length > 1 ? Math.abs(qPositions[1] - qPositions[0]) : 20;
        const cGap = cPositions.length > 1 ? Math.abs(cPositions[1] - cPositions[0]) : 20;

        // ROI 범위 클램핑 (샘플 영역이 박스를 벗어나지 않도록)
        const halfW = cGap * 0.35, halfH = qGap * 0.35;
        const qMin = isVert ? halfH : halfW;
        const qMax = isVert ? height - halfH : width - halfW;
        const cMin = isVert ? halfW : halfH;
        const cMax = isVert ? width - halfW : height - halfH;
        qPositions = qPositions.filter(p => p >= qMin && p <= qMax);
        cPositions = cPositions.filter(p => p >= cMin && p <= cMax);
        numQ = qPositions.length;
        numC = cPositions.length;
        const sampleW = cGap * 0.7;
        const sampleH = qGap * 0.7;

        console.log(`[그리드분석] ${numQ}문항 × ${numC}지선다, ${isVert ? '세로' : '가로'}, Q위치=[${qPositions.map(p=>Math.round(p)).join(',')}], C위치=[${cPositions.map(p=>Math.round(p)).join(',')}]`);

        // 6. 각 셀 샘플링 + 마킹 판별
        const structuredRows = [];

        for (let q = 0; q < numQ; q++) {
            const blobs = [], cellScores = [];

            for (let c = 0; c < numC; c++) {
                const cx = isVert ? cPositions[c] : qPositions[q];
                const cy = isVert ? qPositions[q] : cPositions[c];
                if (cx === undefined || cy === undefined) continue;

                const sample = this.sampleCell(grayData, width, height, cx, cy, sampleW, sampleH);
                const score = (sample.darkRatio * 300) + (255 - sample.brightness) + (sample.centerFill * 800);

                cellScores.push({ col: c, score, brightness: sample.brightness, darkRatio: sample.darkRatio, centerFill: sample.centerFill });
                blobs.push({
                    x: Math.round(cx - sampleW/2) + offsetX, y: Math.round(cy - sampleH/2) + offsetY,
                    w: Math.round(sampleW), h: Math.round(sampleH),
                    cx: cx + offsetX, cy: cy + offsetY, r: Math.min(sampleW, sampleH) / 2,
                    boxBrightness: sample.brightness, inkRatio: sample.darkRatio, centerFillRatio: sample.centerFill, isMarked: false
                });
            }

            if (cellScores.length === 0) continue;

            // 돌출도 계산
            const prominences = cellScores.map((c, i) => {
                const others = cellScores.filter((_,j) => j !== i);
                const oAvg = others.length > 0 ? others.reduce((s,o) => s+o.score, 0) / others.length : 0;
                return { idx: i, prom: c.score - oAvg };
            }).sort((a,b) => b.prom - a.prom);
            const bestProm = prominences[0].prom;
            const secondProm = prominences.length > 1 ? prominences[1].prom : 0;
            const promRatio = secondProm > 0 ? bestProm / secondProm : (bestProm > 30 ? 999 : 0);

            // 최고 점수
            let bestIdx = -1, bestScore = -999;
            const avgBright = cellScores.reduce((s,c) => s+c.brightness, 0) / cellScores.length;
            const avgInk = cellScores.reduce((s,c) => s+c.darkRatio, 0) / cellScores.length;
            const avgFill = cellScores.reduce((s,c) => s+c.centerFill, 0) / cellScores.length;
            cellScores.forEach((c,i) => { if (c.score > bestScore) { bestScore = c.score; bestIdx = i; } });

            // 마킹 판별
            let primaryMarked = -1;
            if (bestIdx !== -1 && numC > 1) {
                const best = cellScores[bestIdx];
                const dB = avgBright - best.brightness, dI = best.darkRatio - avgInk, dF = best.centerFill - avgFill;

                if ((dB > 8 || dI > 0.03 || dF > 0.05) && promRatio > 1.5) {
                    primaryMarked = bestIdx;
                }

                // 1차가 불확실할 때만 2차 검증
                // promRatio >= 3 이거나 centerFill >= 0.9이면 1차 확정 (확실한 마킹)
                const bestFill = cellScores[bestIdx].centerFill;
                if (promRatio < 3 && bestFill < 0.9) {
                    const narrowW = sampleW * 0.5, narrowH = sampleH * 0.5;
                    const narrowScores = [];
                    for (let c2 = 0; c2 < numC; c2++) {
                        const cx2 = isVert ? cPositions[c2] : qPositions[q];
                        const cy2 = isVert ? qPositions[q] : cPositions[c2];
                        if (cx2 === undefined || cy2 === undefined) { narrowScores.push({ col: c2, score: 0 }); continue; }
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
                    const nScoreLog = narrowScores.map((c, i) => `[${i+1}]=${Math.round(c.score)}`).join(' ');
                    console.log(`    → Q${q+1} 2차검증: ${nScoreLog} prom=${nPromRatio.toFixed(2)} (1차: ${primaryMarked !== -1 ? primaryMarked+1 : 'null'})`);

                    if (nPromRatio > 1.5) {
                        // 2차 결과가 1차와 다르면 2차를 채택
                        if (primaryMarked === -1 || nBestIdx !== primaryMarked) {
                            primaryMarked = nBestIdx;
                            console.log(`    → Q${q+1} 2차 채택: answer=${primaryMarked + 1}`);
                        }
                    } else {
                        // 2차에서도 불확실하면 미기입
                        if (primaryMarked !== -1) {
                            console.log(`    → Q${q+1} 2차 불확실: 미기입 처리`);
                            primaryMarked = -1;
                        }
                    }
                }
            } else if (numC === 1) primaryMarked = 0;

            // 메인 로그 (2차 검증보다 먼저 표시)
            console.log(`  Q${q+1}: ${cellScores.map(c => `[${c.col+1}] s=${Math.round(c.score)} b=${Math.round(c.brightness)} f=${c.centerFill.toFixed(3)}`).join(' | ')} prom=${promRatio.toFixed(2)}`);

            // 중복 감지 (둘 다 확실히 칠해진 경우만)
            const markedIndices = [];
            if (primaryMarked !== -1 && numC > 1) {
                const pS = cellScores[primaryMarked].score;
                const pF = cellScores[primaryMarked].centerFill;
                cellScores.forEach((c,i) => {
                    if (i === primaryMarked) return;
                    // 진짜 중복: 점수 95%이상 + fill 90%이상 + 후보도 확실히 칠해짐(fill>0.8)
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

            structuredRows.push({ questionNumber: q+1, numChoices: numC, markedAnswer: finalMarked, multiMarked: isMulti, markedIndices: markedIndices.map(i=>i+1), blobs });
        }

        // 디버그 블롭 위치를 오프셋 적용하여 반환
        const debugBlobs = this._debugBlobs ? {
            all: this._debugBlobs.all.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
            filtered: this._debugBlobs.filtered.map(b => ({ cx: b.cx + offsetX, cy: b.cy + offsetY, w: b.w, h: b.h })),
            threshold: this._debugBlobs.threshold
        } : null;

        return { rows: structuredRows, maxCols: numC, debugBlobs };
    },

    // ==========================================
    // 자동 감지 (analyzeROI와 동일한 findGrid 사용)
    // ==========================================
    autoDetect(imageData, offsetX, offsetY) {
        const grayData = this.preprocess(imageData);
        const grid = this.findGrid(grayData, imageData.width, imageData.height);
        if (!grid) return null;

        // 방향 판정: 행당 블롭 수 > 5이면 가로 (선택지가 좌우로 많음)
        // 아니면 행/열 수 비교
        const orientation = (grid.modeColCount > 5 || grid.numCols > grid.numRows) ? 'horizontal' : 'vertical';
        let numQuestions, numChoices;
        if (orientation === 'vertical') {
            numQuestions = grid.numRows;
            numChoices = grid.numCols;
        } else {
            numQuestions = grid.numCols;
            numChoices = grid.numRows;
        }

        // 그룹 패턴 보정: 누락된 행 감지
        const qPositions = orientation === 'vertical' ? grid.rowYs : grid.colXs;
        if (qPositions.length >= 4) {
            const aGaps = [];
            for (let i = 1; i < qPositions.length; i++) aGaps.push(qPositions[i] - qPositions[i-1]);
            const aSorted = [...aGaps].sort((a,b) => a-b);
            const aMedGap = aSorted[Math.floor(aSorted.length / 2)];
            const aThreshold = aMedGap * 1.6;

            // 큰 간격으로 그룹 분할
            const gSizes = [];
            let curSz = 1;
            for (const g of aGaps) {
                if (g > aThreshold) { gSizes.push(curSz); curSz = 1; }
                else curSz++;
            }
            gSizes.push(curSz);

            if (gSizes.length >= 2) {
                const sf = {};
                gSizes.forEach(s => { if (s > 0) sf[s] = (sf[s]||0)+1; });
                const modeS = parseInt(Object.entries(sf)
                    .sort((a,b) => b[1]-a[1] || parseInt(b[0])-parseInt(a[0]))[0][0]);

                // 작은 그룹 병합 후 보정된 총 문항수 계산
                const mSizes = [];
                let mi = 0;
                while (mi < gSizes.length) {
                    if (gSizes[mi] >= modeS) { mSizes.push(gSizes[mi]); mi++; }
                    else {
                        let mg = gSizes[mi], mj = mi + 1;
                        while (mj < gSizes.length && mg + gSizes[mj] <= modeS) { mg += gSizes[mj]; mj++; }
                        mSizes.push(mg < modeS ? modeS : mg);
                        mi = mj;
                    }
                }
                const correctedQ = mSizes.reduce((s,v) => s+v, 0);
                if (correctedQ > numQuestions) {
                    console.log(`[자동감지 보정] 그룹=[${gSizes}] mode=${modeS} → 병합=[${mSizes}] 문항=${numQuestions}→${correctedQ}`);
                    numQuestions = correctedQ;
                }
            }
        }

        console.log(`[자동감지] 행=${grid.numRows} 열=${grid.numCols} → 방향=${orientation} 문항=${numQuestions} 지선다=${numChoices}`);
        return { orientation, numQuestions, numChoices };
    },

    // 하위 호환
    findBlobs() { return { blobs: [], pixelCtx: null }; },
    filterBlobs(b) { return b; },
    analyzeStructure() { return { rows: [], maxCols: 0 }; }
};
