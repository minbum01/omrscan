// ============================================
// omrEngine.js - OMR 판독 엔진 (컴퓨터 비전)
// ============================================

const OmrEngine = {

    // ==========================================
    // 전처리: 채도 보정 + 밝기 정규화 + 대비 강화
    // ==========================================
    preprocess(imageData) {
        const data = imageData.data;
        const len = data.length / 4;

        // 1단계: 색잉크 감지 + 그레이 변환
        // 인쇄 테두리(흑색): R≈G≈B → 채도 낮음
        // 파란/빨간 잉크 마킹: R,G,B 차이 큼 → 채도 높음
        // 채도가 높은 픽셀은 "잉크로 칠한 것"이므로 더 어둡게 보정
        const gray = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];

            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const saturation = maxC > 0 ? (maxC - minC) / maxC : 0; // 0~1

            // 기본: Min(R,G,B)
            let val = minC;

            // 채도 보정: 색잉크(채도 > 0.15)는 추가로 어둡게
            // 채도가 높을수록 더 강하게 감산 → 파란펜 마킹이 확실히 검정으로
            if (saturation > 0.15) {
                const bonus = Math.round(saturation * 120);
                val = Math.max(0, val - bonus);
            }

            gray[i] = val;
        }

        // 2단계: 밝기 범위 파악 (상하위 1% 제외)
        const histogram = new Uint32Array(256);
        for (let i = 0; i < len; i++) histogram[gray[i]]++;

        const cutoff = Math.floor(len * 0.01);
        let darkVal = 0, lightVal = 255;
        let count = 0;
        for (let v = 0; v < 256; v++) {
            count += histogram[v];
            if (count >= cutoff) { darkVal = v; break; }
        }
        count = 0;
        for (let v = 255; v >= 0; v--) {
            count += histogram[v];
            if (count >= cutoff) { lightVal = v; break; }
        }

        // 3단계: 밝기 정규화
        const range = Math.max(lightVal - darkVal, 1);
        for (let i = 0; i < len; i++) {
            let v = Math.round(((gray[i] - darkVal) / range) * 255);
            gray[i] = Math.max(0, Math.min(255, v));
        }

        // 4단계: S-curve 대비 강화
        const contrastLUT = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            const x = i / 255;
            const k = 10; // 강도
            const s = 1 / (1 + Math.exp(-k * (x - 0.5)));
            contrastLUT[i] = Math.round(s * 255);
        }
        for (let i = 0; i < len; i++) {
            gray[i] = contrastLUT[gray[i]];
        }

        return gray;
    },

    // ==========================================
    // 블롭 탐지 (전처리된 데이터 사용)
    // ==========================================
    findBlobs(imageData, offsetX, offsetY) {
        const width = imageData.width;
        const height = imageData.height;

        // 전처리 적용
        const grayData = this.preprocess(imageData);

        // 평균 밝기 계산
        let totalIntensity = 0;
        for (let i = 0; i < width * height; i++) {
            totalIntensity += grayData[i];
        }

        // 동적 임계값 (전처리 후 평균의 75% — 대비가 강해졌으므로 더 공격적)
        const avgBrightness = totalIntensity / (width * height);
        const THRESHOLD = avgBrightness * 0.75;

        const visited = new Uint8Array(width * height);
        const blobs = [];

        // BFS 크기 제한: 블롭이 이 크기를 넘으면 확장 중단
        // (인접 행 마킹이 합쳐지는 것 방지)
        const MAX_BLOB_DIM = 50;

        // 3단계: BFS 군집화 (크기 제한 적용)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                if (grayData[idx] < THRESHOLD && !visited[idx]) {
                    const queue = [{ x, y }];
                    visited[idx] = 1;

                    let minX = x, maxX = x, minY = y, maxY = y;
                    let pixelCount = 0;

                    while (queue.length > 0) {
                        const p = queue.shift();
                        pixelCount++;

                        if (p.x < minX) minX = p.x;
                        if (p.x > maxX) maxX = p.x;
                        if (p.y < minY) minY = p.y;
                        if (p.y > maxY) maxY = p.y;

                        const neighbors = [
                            { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y },
                            { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }
                        ];

                        for (const n of neighbors) {
                            if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
                                const nIdx = n.y * width + n.x;
                                if (grayData[nIdx] < THRESHOLD && !visited[nIdx]) {
                                    // 크기 제한: 현재 블롭이 MAX_BLOB_DIM을 넘으면 확장 중단
                                    const newW = Math.max(maxX, n.x) - Math.min(minX, n.x);
                                    const newH = Math.max(maxY, n.y) - Math.min(minY, n.y);
                                    if (newW > MAX_BLOB_DIM || newH > MAX_BLOB_DIM) {
                                        continue; // 이 픽셀은 건너뜀 (다른 블롭으로 잡힐 수 있음)
                                    }
                                    visited[nIdx] = 1;
                                    queue.push(n);
                                }
                            }
                        }
                    }

                    const w = maxX - minX;
                    const h = maxY - minY;

                    if (w > 5 && h > 5 && pixelCount > 10) {
                        let boxDarknessSum = 0;
                        let boxPixelCount = 0;
                        let darkPixelCount = 0;
                        let localMin = 255;

                        // 중심부 채움률 계산 (버블 중심 50% 영역)
                        const centerMarginX = Math.round(w * 0.25);
                        const centerMarginY = Math.round(h * 0.25);
                        let centerDarkCount = 0;
                        let centerTotal = 0;

                        for (let yy = minY; yy <= maxY; yy++) {
                            for (let xx = minX; xx <= maxX; xx++) {
                                const val = grayData[yy * width + xx];
                                boxDarknessSum += val;
                                boxPixelCount++;
                                if (val < localMin) localMin = val;
                                if (val < THRESHOLD * 0.6) darkPixelCount++;

                                // 중심부 판별
                                const inCenterX = (xx - minX) >= centerMarginX && (xx - minX) <= (w - centerMarginX);
                                const inCenterY = (yy - minY) >= centerMarginY && (yy - minY) <= (h - centerMarginY);
                                if (inCenterX && inCenterY) {
                                    centerTotal++;
                                    if (val < THRESHOLD * 0.6) centerDarkCount++;
                                }
                            }
                        }

                        const avgBoxBrightness = boxDarknessSum / boxPixelCount;
                        const inkRatio = darkPixelCount / boxPixelCount;
                        const centerFillRatio = centerTotal > 0 ? centerDarkCount / centerTotal : 0;

                        blobs.push({
                            x: minX + offsetX, y: minY + offsetY,
                            w, h,
                            cx: minX + offsetX + w / 2,
                            cy: minY + offsetY + h / 2,
                            r: Math.max(w, h) / 2,
                            boxBrightness: avgBoxBrightness,
                            minBrightness: localMin,
                            inkRatio,
                            centerFillRatio  // 마킹은 높음, 빈 테두리는 낮음
                        });
                    }
                }
            }
        }
        return { blobs, pixelCtx: { grayData, width, height, offsetX, offsetY, THRESHOLD } };
    },

    // ==========================================
    // 자동 감지: ROI 영역에서 문항수, 지선다, 방향 추정
    // ==========================================
    autoDetect(imageData, offsetX, offsetY) {
        const detected = this.findBlobs(imageData, offsetX, offsetY);
        const blobs = this.filterBlobs(detected.blobs);

        if (blobs.length < 2) return null;

        // Y기준 행 그룹핑 시도
        blobs.sort((a, b) => a.cy - b.cy);
        const heights = blobs.map(b => b.h).sort((a, b) => a - b);
        const medianH = heights[Math.floor(heights.length / 2)];

        const rows = [];
        let curRow = [blobs[0]];
        let rowAvgY = blobs[0].cy;
        for (let i = 1; i < blobs.length; i++) {
            if (Math.abs(blobs[i].cy - rowAvgY) < medianH * 0.75) {
                curRow.push(blobs[i]);
                rowAvgY = curRow.reduce((s, b) => s + b.cy, 0) / curRow.length;
            } else {
                rows.push(curRow);
                curRow = [blobs[i]];
                rowAvgY = blobs[i].cy;
            }
        }
        rows.push(curRow);

        // X기준 열 그룹핑 시도
        blobs.sort((a, b) => a.cx - b.cx);
        const widths = blobs.map(b => b.w).sort((a, b) => a - b);
        const medianW = widths[Math.floor(widths.length / 2)];

        const cols = [];
        let curCol = [blobs[0]];
        let colAvgX = blobs[0].cx;
        for (let i = 1; i < blobs.length; i++) {
            if (Math.abs(blobs[i].cx - colAvgX) < medianW * 0.75) {
                curCol.push(blobs[i]);
                colAvgX = curCol.reduce((s, b) => s + b.cx, 0) / curCol.length;
            } else {
                cols.push(curCol);
                curCol = [blobs[i]];
                colAvgX = blobs[i].cx;
            }
        }
        cols.push(curCol);

        const numRows = rows.length;
        const numCols = cols.length;

        // 최빈 열 수 (행별 블롭 수의 최빈값)
        const colCounts = rows.map(r => r.length);
        const freq = {};
        colCounts.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
        const modeColCount = parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);

        // 최빈 행 수 (열별 블롭 수의 최빈값)
        const rowCounts = cols.map(c => c.length);
        const freq2 = {};
        rowCounts.forEach(c => { freq2[c] = (freq2[c] || 0) + 1; });
        const modeRowCount = parseInt(Object.entries(freq2).sort((a, b) => b[1] - a[1])[0][0]);

        // 방향 판단: 지선다가 5 초과면 가로
        let orientation, numQuestions, numChoices;

        if (modeColCount > 5) {
            // 지선다가 5 초과 → 가로 (문항이 좌→우, 선택지가 위→아래)
            orientation = 'horizontal';
            numQuestions = numCols;
            numChoices = modeRowCount;
        } else {
            // 세로 (기본)
            orientation = 'vertical';
            numQuestions = numRows;
            numChoices = modeColCount;
        }

        console.log(`[자동감지] 행=${numRows} 열=${numCols} 행당블롭=${modeColCount} 열당블롭=${modeRowCount} → 방향=${orientation} 문항=${numQuestions} 지선다=${numChoices}`);

        return { orientation, numQuestions, numChoices };
    },

    // 형태/크기 필터링
    filterBlobs(blobs) {
        const beforeCount = blobs.length;

        // 1차: 기본 크기/형태 필터
        let candidates = blobs.filter(b => {
            const isSizeOk = b.w > 8 && b.h > 8 && b.w < 80 && b.h < 80;
            const ratio = b.w / b.h;
            const isShapeOk = ratio > 0.4 && ratio < 2.5;
            return isSizeOk && isShapeOk;
        });

        if (candidates.length === 0) return [];

        const areas = candidates.map(b => b.w * b.h).sort((a, b) => a - b);
        const medianArea = areas[Math.floor(areas.length / 2)];

        // 2차: 면적 필터
        const passed = candidates.filter(b => {
            const area = b.w * b.h;
            return area >= medianArea * 0.5 && area <= medianArea * 1.5;
        });

        // 3차: 전체 원본 블롭에서 마킹된 것 복구
        const passedSet = new Set(passed);
        const medianW = Math.round(Math.sqrt(medianArea));
        const rescued = blobs.filter(b => {
            if (passedSet.has(b)) return false;

            // 최소 크기: 정상 버블의 절반 이상이어야 함 (작은 노이즈 차단)
            if (b.w < medianW * 0.5 || b.h < medianW * 0.5) return false;

            // 확실한 마킹 증거
            const isDefinitelyMarked = (b.centerFillRatio || 0) > 0.6 && b.inkRatio > 0.5;
            if (!isDefinitelyMarked) return false;

            // 면적: 정상 버블의 0.4~3배
            const area = b.w * b.h;
            if (area < medianArea * 0.4 || area > medianArea * 3.0) return false;

            return true;
        });

        const result = [...passed, ...rescued];
        console.log(`[필터] BFS: ${beforeCount} → 1차: ${candidates.length} → 2차: ${passed.length} + 복구: ${rescued.length} = ${result.length} (중간값: ${medianArea})`);
        if (rescued.length > 0) {
            rescued.forEach(b => console.log(`  [복구] ${b.w}x${b.h} area=${b.w*b.h} ink=${b.inkRatio.toFixed(3)} fill=${(b.centerFillRatio||0).toFixed(3)}`));
        }

        return result;
    },

    // 구조화 (행/열) 및 마킹 판별
    // orientation: 'vertical' (기본, 문항 위→아래) / 'horizontal' (문항 좌→우)
    analyzeStructure(blobs, orientation = 'vertical') {
        if (blobs.length === 0) return { rows: [], maxCols: 0 };

        // pixelCtx: { grayData, width, height, offsetX, offsetY, THRESHOLD }
        if (orientation === 'horizontal') {
            return this.analyzeHorizontal(blobs);
        }

        // === 세로 방향 (기본): 문항이 위→아래, 선택지가 좌→우 ===
        blobs.sort((a, b) => a.cy - b.cy);

        const heights = blobs.map(b => b.h).sort((a, b) => a - b);
        const medianH = heights[Math.floor(heights.length / 2)];
        const ROW_TOLERANCE = medianH * 0.75;

        // 행 그룹핑: 행의 평균 Y를 기준으로 비교 (누적 오차 방지)
        const rows = [];
        let currentRow = [blobs[0]];
        let rowAvgY = blobs[0].cy;

        for (let i = 1; i < blobs.length; i++) {
            // 현재 행의 평균 Y와 비교 (이전 블롭이 아닌 행 평균)
            if (Math.abs(blobs[i].cy - rowAvgY) < ROW_TOLERANCE) {
                currentRow.push(blobs[i]);
                // 평균 Y 갱신
                rowAvgY = currentRow.reduce((sum, b) => sum + b.cy, 0) / currentRow.length;
            } else {
                rows.push(currentRow);
                currentRow = [blobs[i]];
                rowAvgY = blobs[i].cy;
            }
        }
        rows.push(currentRow);

        // 진단: 행 그룹핑 결과
        console.log(`[행그룹핑] ${rows.length}행 감지, 행별 블롭수: [${rows.map(r => r.length).join(', ')}]`);

        // ── 열 수 정규화: 초과 블롭만 정리 (부족한 건 건드리지 않음) ──
        rows.forEach(row => row.sort((a, b) => a.cx - b.cx));

        const colCounts = rows.map(r => r.length);
        const countFreq = {};
        colCounts.forEach(c => { countFreq[c] = (countFreq[c] || 0) + 1; });
        const expectedCols = parseInt(Object.entries(countFreq).sort((a, b) => b[1] - a[1])[0][0]);

        const normalRows = rows.filter(r => r.length === expectedCols);
        if (normalRows.length > 0 && expectedCols > 1) {
            // 정상 블롭 크기 통계
            const allNormalBlobs = normalRows.flat();
            const normalAreas = allNormalBlobs.map(b => b.w * b.h);
            const medianNormalArea = normalAreas.sort((a, b) => a - b)[Math.floor(normalAreas.length / 2)];

            // 초과 행에서 크기가 비정상인 블롭 제거
            rows.forEach((row, rowIdx) => {
                if (row.length <= expectedCols) return;

                // 정상 크기 범위(40%~200%)에서 벗어난 블롭을 제거 후보로
                const normal = [];
                const outliers = [];
                row.forEach(b => {
                    const area = b.w * b.h;
                    if (area >= medianNormalArea * 0.4 && area <= medianNormalArea * 2.0) {
                        normal.push(b);
                    } else {
                        outliers.push(b);
                    }
                });

                // 비정상 크기만 제거해서 expectedCols에 맞으면 그렇게
                if (normal.length === expectedCols) {
                    console.log(`  [정리] 행${rowIdx+1}: ${row.length} → ${normal.length} (크기 이상 ${outliers.length}개 제거)`);
                    rows[rowIdx] = normal;
                } else if (normal.length > expectedCols) {
                    // 정상 크기인데도 초과 → 가장 밝은(마킹 안 된) 것부터 제거
                    normal.sort((a, b) => b.boxBrightness - a.boxBrightness);
                    const removed = normal.splice(expectedCols);
                    console.log(`  [정리] 행${rowIdx+1}: 밝기 기준 ${removed.length}개 제거`);
                    rows[rowIdx] = normal;
                }
                // normal.length < expectedCols이면 건드리지 않음 (부족한 건 그대로 둠)
            });
        }

        let maxCols = 0;
        const structuredRows = rows.map((rowBlobs, rowIndex) => {
            rowBlobs.sort((a, b) => a.cx - b.cx);
            maxCols = Math.max(maxCols, rowBlobs.length);

            let markedIndex = -1;
            let maxScore = -999;
            let brightnessSum = 0;
            let inkSum = 0;
            let fillSum = 0;

            const scores = [];
            rowBlobs.forEach((b, idx) => {
                b.isMarked = false;
                brightnessSum += b.boxBrightness;
                inkSum += b.inkRatio;
                fillSum += (b.centerFillRatio || 0);
                const score = (b.inkRatio * 300) + (255 - b.boxBrightness) + ((b.centerFillRatio || 0) * 800);
                scores.push({ idx: idx+1, score: Math.round(score), bright: Math.round(b.boxBrightness), ink: b.inkRatio.toFixed(3), fill: (b.centerFillRatio||0).toFixed(3), w: b.w, h: b.h });
                if (score > maxScore) {
                    maxScore = score;
                    markedIndex = idx;
                }
            });

            console.log(`  행${rowIndex+1} (${rowBlobs.length}블롭):`, scores.map(s => `[${s.idx}] score=${s.score} bright=${s.bright} ink=${s.ink} fill=${s.fill} ${s.w}x${s.h}`).join(' | '));

            const avgRowBrightness = brightnessSum / rowBlobs.length;
            const avgRowInk = inkSum / rowBlobs.length;
            const avgRowFill = fillSum / rowBlobs.length;
            const selectedBlob = rowBlobs[markedIndex];

            // 1단계: 가장 점수 높은 1개 선정 (중심부 채움률 조건 추가)
            let primaryMarked = -1;
            if (markedIndex !== -1 && rowBlobs.length > 1) {
                const diff = avgRowBrightness - selectedBlob.boxBrightness;
                const inkDiff = selectedBlob.inkRatio - avgRowInk;
                const fillDiff = (selectedBlob.centerFillRatio || 0) - avgRowFill;
                // 기존 조건 OR 중심부 채움률이 평균보다 확실히 높으면 마킹
                if (diff > 8 || inkDiff > 0.03 || fillDiff > 0.05) {
                    primaryMarked = markedIndex;
                }
            } else if (rowBlobs.length === 1) {
                primaryMarked = 0;
            }

            // 2단계: 중복 마킹 감지 (높은 임계값 + 중심부 채움률)
            const markedIndices = [];
            if (primaryMarked !== -1 && rowBlobs.length > 1) {
                const pb = rowBlobs[primaryMarked];
                const primaryScore = (pb.inkRatio * 300) + (255 - pb.boxBrightness) + ((pb.centerFillRatio || 0) * 800);
                rowBlobs.forEach((b, idx) => {
                    const score = (b.inkRatio * 300) + (255 - b.boxBrightness) + ((b.centerFillRatio || 0) * 800);
                    const fillDiff = (b.centerFillRatio || 0) - avgRowFill;
                    const inkDiff = b.inkRatio - avgRowInk;
                    // 중복: 점수가 1차의 80% 이상이면서 중심부 채움이 평균보다 확실히 높음
                    if (score > primaryScore * 0.8 && (fillDiff > 0.08 || inkDiff > 0.06)) {
                        markedIndices.push(idx);
                    }
                });
                // 1차 마킹이 포함 안 됐으면 추가
                if (!markedIndices.includes(primaryMarked)) {
                    markedIndices.unshift(primaryMarked);
                }
            } else if (primaryMarked !== -1) {
                markedIndices.push(primaryMarked);
            }

            const isMultiMarked = markedIndices.length > 1;

            // 마킹 표시
            if (isMultiMarked) {
                markedIndices.forEach(idx => { rowBlobs[idx].isMarked = true; });
            } else if (primaryMarked !== -1) {
                rowBlobs[primaryMarked].isMarked = true;
            }

            // 단일 마킹이면 정답, 중복이면 null (수기 교정 필요)
            let finalMarked = null;
            if (!isMultiMarked && primaryMarked !== -1) {
                finalMarked = primaryMarked + 1;
            }

            console.log(`    → 행${rowIndex+1}: primary=${primaryMarked}(0-based) indices=[${markedIndices}] multi=${isMultiMarked} answer=${finalMarked}`);

            return {
                questionNumber: rowIndex + 1,
                numChoices: rowBlobs.length,
                markedAnswer: finalMarked,
                multiMarked: isMultiMarked,
                markedIndices: markedIndices.map(i => i + 1),
                blobs: rowBlobs
            };
        });

        return { rows: structuredRows, maxCols };
    },

    // === 가로 방향: 문항이 좌→우, 선택지가 위→아래 ===
    analyzeHorizontal(blobs) {
        blobs.sort((a, b) => a.cx - b.cx);

        const widths = blobs.map(b => b.w).sort((a, b) => a - b);
        const medianW = widths[Math.floor(widths.length / 2)];
        const COL_TOLERANCE = medianW * 0.75;

        // 열 그룹핑 (평균 X 기준)
        const cols = [];
        let currentCol = [blobs[0]];
        let colAvgX = blobs[0].cx;

        for (let i = 1; i < blobs.length; i++) {
            if (Math.abs(blobs[i].cx - colAvgX) < COL_TOLERANCE) {
                currentCol.push(blobs[i]);
                colAvgX = currentCol.reduce((s, b) => s + b.cx, 0) / currentCol.length;
            } else {
                cols.push(currentCol);
                currentCol = [blobs[i]];
                colAvgX = blobs[i].cx;
            }
        }
        cols.push(currentCol);

        console.log(`[가로-열그룹핑] ${cols.length}열 감지, 열별 블롭수: [${cols.map(c => c.length).join(', ')}]`);

        let maxCols = 0;
        const structuredRows = cols.map((colBlobs, colIndex) => {
            colBlobs.sort((a, b) => a.cy - b.cy);
            maxCols = Math.max(maxCols, colBlobs.length);

            let markedIndex = -1;
            let maxScore = -999;
            let brightnessSum = 0;
            let inkSum = 0;
            let fillSum = 0;

            const scores = [];
            colBlobs.forEach((b, idx) => {
                b.isMarked = false;
                brightnessSum += b.boxBrightness;
                inkSum += b.inkRatio;
                fillSum += (b.centerFillRatio || 0);
                const score = (b.inkRatio * 300) + (255 - b.boxBrightness) + ((b.centerFillRatio || 0) * 800);
                scores.push({ idx: idx+1, score: Math.round(score), bright: Math.round(b.boxBrightness), ink: b.inkRatio.toFixed(3), fill: (b.centerFillRatio||0).toFixed(3), w: b.w, h: b.h });
                if (score > maxScore) { maxScore = score; markedIndex = idx; }
            });

            console.log(`  열${colIndex+1} (${colBlobs.length}블롭):`, scores.map(s => `[${s.idx}] score=${s.score} bright=${s.bright} ink=${s.ink} fill=${s.fill} ${s.w}x${s.h}`).join(' | '));

            const avgBrightness = brightnessSum / colBlobs.length;
            const avgInk = inkSum / colBlobs.length;
            const avgFill = fillSum / colBlobs.length;
            const selected = colBlobs[markedIndex];

            let primaryMarked = -1;
            if (markedIndex !== -1 && colBlobs.length > 1) {
                const diff = avgBrightness - selected.boxBrightness;
                const inkDiff = selected.inkRatio - avgInk;
                const fillDiff = (selected.centerFillRatio || 0) - avgFill;
                if (diff > 8 || inkDiff > 0.03 || fillDiff > 0.05) primaryMarked = markedIndex;
            } else if (colBlobs.length === 1) {
                primaryMarked = 0;
            }

            const markedIndices = [];
            if (primaryMarked !== -1 && colBlobs.length > 1) {
                const pb = colBlobs[primaryMarked];
                const pScore = (pb.inkRatio * 300) + (255 - pb.boxBrightness) + ((pb.centerFillRatio || 0) * 800);
                colBlobs.forEach((b, idx) => {
                    const score = (b.inkRatio * 300) + (255 - b.boxBrightness) + ((b.centerFillRatio || 0) * 800);
                    const fillDiff = (b.centerFillRatio || 0) - avgFill;
                    const inkDiff = b.inkRatio - avgInk;
                    if (score > pScore * 0.8 && (fillDiff > 0.08 || inkDiff > 0.06)) markedIndices.push(idx);
                });
                if (!markedIndices.includes(primaryMarked)) markedIndices.unshift(primaryMarked);
            } else if (primaryMarked !== -1) {
                markedIndices.push(primaryMarked);
            }

            const isMultiMarked = markedIndices.length > 1;
            if (isMultiMarked) markedIndices.forEach(idx => { colBlobs[idx].isMarked = true; });
            else if (primaryMarked !== -1) colBlobs[primaryMarked].isMarked = true;

            let finalMarked = null;
            if (!isMultiMarked && primaryMarked !== -1) finalMarked = primaryMarked + 1;

            console.log(`    → 열${colIndex+1}: primary=${primaryMarked}(0-based) indices=[${markedIndices}] multi=${isMultiMarked} answer=${finalMarked}`);

            return {
                questionNumber: colIndex + 1,
                numChoices: colBlobs.length,
                markedAnswer: finalMarked,
                multiMarked: isMultiMarked,
                markedIndices: markedIndices.map(i => i + 1),
                blobs: colBlobs
            };
        });

        return { rows: structuredRows, maxCols };
    }
};
