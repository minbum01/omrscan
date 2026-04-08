// ============================================
// timingMark.js - 타이밍 마크 기반 OMR 분석
// 기존 BFS 감지와 별도 로직
// ============================================

const TimingMark = {

    // ==========================================
    // 타이밍 마크 감지
    // 지정된 스트립(가장자리 영역)에서 검은 막대 위치를 추출
    // ==========================================
    detectMarks(imageData, stripSide, stripRect) {
        // stripSide: 'top' | 'bottom' | 'left' | 'right'
        // stripRect: { x, y, w, h } — 타이밍 마크가 있는 영역
        const gray = OmrEngine.preprocess(imageData);
        const width = imageData.width;
        const height = imageData.height;

        // 임계값
        let sum = 0;
        for (let i = 0; i < gray.length; i++) sum += gray[i];
        const threshold = (sum / gray.length) * 0.6;

        const isHorizontalStrip = (stripSide === 'top' || stripSide === 'bottom');

        if (isHorizontalStrip) {
            // 상/하단 마크: x축 프로젝션 → 각 열의 어두운 픽셀 비율
            return this._findMarksAlongAxis(gray, width, height, stripRect, 'x', threshold);
        } else {
            // 좌/우측 마크: y축 프로젝션 → 각 행의 어두운 픽셀 비율
            return this._findMarksAlongAxis(gray, width, height, stripRect, 'y', threshold);
        }
    },

    // 축 방향으로 프로젝션하여 마크 위치 추출
    _findMarksAlongAxis(gray, imgW, imgH, rect, axis, threshold) {
        const isX = axis === 'x';
        const projLen = isX ? rect.w : rect.h;
        const crossLen = isX ? rect.h : rect.w;
        const proj = new Float32Array(projLen);

        for (let i = 0; i < projLen; i++) {
            let cnt = 0;
            for (let j = 0; j < crossLen; j++) {
                const px = isX ? (rect.x + i) : (rect.x + j);
                const py = isX ? (rect.y + j) : (rect.y + i);
                if (px >= 0 && px < imgW && py >= 0 && py < imgH) {
                    if (gray[py * imgW + px] < threshold) cnt++;
                }
            }
            proj[i] = cnt / crossLen;
        }

        // 피크 찾기: 평균 이상이고 로컬 최대인 위치
        const mean = proj.reduce((s, v) => s + v, 0) / projLen;
        const peakThresh = Math.max(mean * 1.5, 0.3);

        // 연속 구간 기반 마크 감지 (피크보다 안정적)
        const marks = [];
        let inMark = false, markStart = 0, markSum = 0, markCount = 0;

        for (let i = 0; i < projLen; i++) {
            if (proj[i] > peakThresh) {
                if (!inMark) {
                    inMark = true;
                    markStart = i;
                    markSum = 0;
                    markCount = 0;
                }
                markSum += i * proj[i];
                markCount += proj[i];
            } else {
                if (inMark) {
                    inMark = false;
                    const markCenter = markSum / markCount;
                    const markWidth = i - markStart;
                    // 실제 좌표로 변환
                    const absPos = isX ? (rect.x + markCenter) : (rect.y + markCenter);
                    marks.push({ pos: absPos, width: markWidth, localPos: markCenter });
                }
            }
        }
        // 마지막 마크가 끝까지 이어진 경우
        if (inMark) {
            const markCenter = markSum / markCount;
            const absPos = isX ? (rect.x + markCenter) : (rect.y + markCenter);
            marks.push({ pos: absPos, width: projLen - markStart, localPos: markCenter });
        }

        console.log(`[TimingMark] ${axis}축 감지: ${marks.length}개 마크, rect=(${rect.x},${rect.y},${rect.w},${rect.h})`);
        return marks;
    },

    // ==========================================
    // 템플릿 생성
    // 감지된 마크 + 사용자 지정 행 → 상대 비율로 저장
    // ==========================================
    createTemplate(topMarks, bottomMarks, leftMarks, rightMarks, regions, imgWidth, imgHeight) {
        // 앵커: 각 변의 첫 번째 마크
        const anchors = {
            top: topMarks.length > 0 ? topMarks[0].pos : null,
            bottom: bottomMarks.length > 0 ? bottomMarks[0].pos : null,
            left: leftMarks.length > 0 ? leftMarks[0].pos : null,
            right: rightMarks.length > 0 ? rightMarks[0].pos : null,
            topY: topMarks.length > 0 ? 0 : null,      // 상단 마크의 y위치 (스트립 기준)
            bottomY: bottomMarks.length > 0 ? imgHeight : null,
        };

        // 열 마크: 상단 데이터 마크 (앵커 제외)
        const topDataMarks = topMarks.slice(1).map(m => m.pos);
        const bottomDataMarks = bottomMarks.slice(1).map(m => m.pos);

        // 행 마크: 좌측 데이터 마크 (앵커 제외)
        const leftDataMarks = leftMarks.slice(1).map(m => m.pos);
        const rightDataMarks = rightMarks.slice(1).map(m => m.pos);

        // 상대 비율로 변환
        // 열: 이미지 폭 대비 비율
        const colRatios = topDataMarks.map(x => x / imgWidth);
        const colRatiosBottom = bottomDataMarks.map(x => x / imgWidth);

        // 영역별 행 비율
        const regionTemplates = regions.map(region => ({
            name: region.name,
            type: region.type,
            orientation: region.orientation,
            colRange: region.colRange, // [startIdx, endIdx] — 열 마크 인덱스
            // 행 위치: 이미지 높이 대비 비율
            rowRatios: region.rowPositions.map(y => y / imgHeight),
            numQuestions: region.numQuestions,
            numChoices: region.numChoices,
            startNum: region.startNum || 1,
        }));

        return {
            version: 1,
            imgWidth,
            imgHeight,
            anchors,
            colRatios,           // 상단 열 비율
            colRatiosBottom,     // 하단 열 비율 (휘어짐 보정용)
            leftRowRatios: leftDataMarks.map(y => y / imgHeight),
            rightRowRatios: rightDataMarks.map(y => y / imgHeight),
            regions: regionTemplates,
        };
    },

    // ==========================================
    // 매 장 분석: 타이밍 마크 재감지 → 그리드 계산 → 셀 샘플링
    // ==========================================
    analyzeWithTemplate(imageData, template) {
        const gray = OmrEngine.preprocess(imageData);
        const width = imageData.width;
        const height = imageData.height;

        // 현재 이미지에서 타이밍 마크 재감지 (상/하단)
        // 감지된 마크의 실제 위치를 그대로 열 좌표로 사용
        const currentColPositions = template.colRatios.map(r => r * width);
        const currentColPositionsBottom = template.colRatiosBottom.length > 0
            ? template.colRatiosBottom.map(r => r * width)
            : null;

        // TODO: 실제 구현에서는 여기서 타이밍 마크를 재감지하고
        // 감지된 실제 위치로 currentColPositions를 대체해야 함
        // 현재는 비율 환산으로 대체

        const results = [];

        template.regions.forEach(region => {
            const [colStart, colEnd] = region.colRange;
            const regionCols = currentColPositions.slice(colStart, colEnd + 1);
            const regionColsBottom = currentColPositionsBottom
                ? currentColPositionsBottom.slice(colStart, colEnd + 1)
                : null;

            // 행 위치: 비율 → 실제 좌표
            const rowPositions = region.rowRatios.map(r => r * height);

            const isVert = region.orientation === 'vertical';
            const numQ = region.numQuestions || rowPositions.length;
            const numC = region.numChoices || regionCols.length;

            // 셀 크기 계산
            const colGap = regionCols.length > 1
                ? (regionCols[regionCols.length - 1] - regionCols[0]) / (regionCols.length - 1)
                : 20;
            const rowGap = rowPositions.length > 1
                ? (rowPositions[rowPositions.length - 1] - rowPositions[0]) / (rowPositions.length - 1)
                : 20;
            const sw = (isVert ? colGap : rowGap) * 0.7;
            const sh = (isVert ? rowGap : colGap) * 0.7;

            // 행별 셀 샘플링 → 마킹 판별
            const rows = [];
            const qCount = Math.min(numQ, isVert ? rowPositions.length : regionCols.length);
            const cCount = isVert ? regionCols.length : rowPositions.length;

            for (let q = 0; q < qCount; q++) {
                const cellScores = [];
                const blobs = [];

                for (let c = 0; c < cCount; c++) {
                    let cx, cy;
                    if (isVert) {
                        // 세로형: 행=문항(y), 열=선택지(x)
                        const rowY = rowPositions[q];
                        // 휘어짐 보정: 해당 행에서의 열 위치 보간
                        cx = this._interpolateCol(regionCols, regionColsBottom, c, rowY, height);
                        cy = rowY;
                    } else {
                        // 가로형: 행=선택지(y), 열=문항(x)
                        cx = regionCols[q];
                        cy = rowPositions[c];
                    }

                    const sample = OmrEngine.sampleCell(gray, width, height, cx, cy, sw, sh);
                    const score = (sample.darkRatio * 300) + (255 - sample.brightness) + (sample.centerFill * 800);

                    cellScores.push({
                        col: c, score,
                        brightness: sample.brightness,
                        darkRatio: sample.darkRatio,
                        centerFill: sample.centerFill
                    });

                    blobs.push({
                        x: Math.round(cx - sw / 2), y: Math.round(cy - sh / 2),
                        w: Math.round(sw), h: Math.round(sh),
                        cx, cy, r: Math.min(sw, sh) / 2,
                        boxBrightness: sample.brightness,
                        inkRatio: sample.darkRatio,
                        centerFillRatio: sample.centerFill,
                        isMarked: false
                    });
                }

                // 마킹 판별 (prominence 기반 — 기존 Stage 2 로직과 동일)
                const markResult = this._detectMarking(cellScores, blobs, cCount);
                markResult.questionNumber = region.startNum + q;
                rows.push(markResult);
            }

            results.push({
                regionName: region.name,
                type: region.type,
                orientation: region.orientation,
                rows,
                numChoices: cCount,
                maxCols: cCount
            });
        });

        return results;
    },

    // 휘어짐 보간: 특정 y높이에서의 열 위치 계산
    _interpolateCol(topCols, bottomCols, colIdx, y, imgHeight) {
        if (!bottomCols || bottomCols.length <= colIdx) {
            return topCols[colIdx]; // 하단 마크 없으면 직선
        }
        const t = y / imgHeight; // 0(상단) ~ 1(하단)
        return topCols[colIdx] * (1 - t) + bottomCols[colIdx] * t;
    },

    // 마킹 판별 (prominence 기반)
    _detectMarking(cellScores, blobs, numC) {
        if (cellScores.length === 0) {
            return { blobs, markedAnswer: null, multiMarked: false, markedIndices: [], numChoices: numC };
        }

        // 1차: 행 내 상대 비교
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
            const dB = avgBright - best.brightness;
            const dI = best.darkRatio - avgInk;
            const dF = best.centerFill - avgFill;
            if ((dB > 8 || dI > 0.03 || dF > 0.05) && promRatio > 1.5) primaryMarked = bestIdx;

            const maxFill = Math.max(...cellScores.map(c => c.centerFill));
            const minFill = Math.min(...cellScores.map(c => c.centerFill));
            if (maxFill < 0.5 && (maxFill - minFill) < 0.15) primaryMarked = -1; // 백지
        }

        // 중복 감지
        const markedIndices = [];
        if (primaryMarked !== -1) {
            const pS = cellScores[primaryMarked].score;
            const pF = cellScores[primaryMarked].centerFill;
            cellScores.forEach((c, i) => {
                if (i !== primaryMarked && c.score > pS * 0.95 && c.centerFill > pF * 0.9 && c.centerFill > 0.8) {
                    markedIndices.push(i);
                }
            });
            if (markedIndices.length > 0) markedIndices.unshift(primaryMarked);
        }
        if (markedIndices.length === 0 && primaryMarked !== -1) markedIndices.push(primaryMarked);

        const isMulti = markedIndices.length > 1;
        if (isMulti) markedIndices.forEach(i => { blobs[i].isMarked = true; });
        else if (primaryMarked !== -1) blobs[primaryMarked].isMarked = true;

        const finalMarked = !isMulti && primaryMarked !== -1 ? primaryMarked + 1 : null;

        return {
            blobs,
            markedAnswer: finalMarked,
            multiMarked: isMulti,
            markedIndices: markedIndices.map(i => i + 1),
            numChoices: numC
        };
    }
};
