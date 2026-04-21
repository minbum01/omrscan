// ============================================
// template.js - 양식(ROI 템플릿) 저장/불러오기
// ============================================

const TemplateManager = {
    init() {
        document.getElementById('btn-save-template').addEventListener('click', () => this.save());
        document.getElementById('btn-load-template').addEventListener('click', () => this.triggerLoad());
        document.getElementById('template-file-input').addEventListener('change', (e) => this.load(e));
    },

    async save() {
        const imgObj = App.getCurrentImage();
        if (!imgObj || imgObj.rois.length === 0) {
            Toast.error('저장할 영역이 없습니다. 먼저 ROI를 설정하세요.');
            return;
        }
        // Lazy Loading 복원
        if (typeof ImageManager !== 'undefined') await ImageManager.ensureLoaded(imgObj);
        if (!imgObj.imgElement || imgObj.imgElement.width === 0) {
            Toast.error('이미지를 로드할 수 없습니다.');
            return;
        }

        // ROI별 블롭 "상대 규격" 추출 (좌표가 아니라 거리·크기만)
        // - 새 OMR 분석 시 BFS가 찾은 블롭이 부족/이상할 때 이 규격으로 빈 자리 보간
        // - 절대 좌표가 아니므로 ROI 크기가 달라도 비율로 확장됨
        const extractBlobPattern = (roi, roiIdx) => {
            const res = imgObj.results && imgObj.results[roiIdx];
            if (!res || !res.rows || res.rows.length === 0) return null;

            // 모든 blob의 cx, cy, w, h 수집
            const allBlobs = [];
            res.rows.forEach((row, rowIdx) => {
                if (!row.blobs) return;
                row.blobs.forEach((b, colIdx) => {
                    if (b.cx === undefined || b.cy === undefined) return;
                    allBlobs.push({ rowIdx, colIdx, cx: b.cx, cy: b.cy, w: b.w, h: b.h });
                });
            });
            if (allBlobs.length < 2) return null;

            // 평균 버블 크기
            const avgBubbleW = allBlobs.reduce((s, b) => s + b.w, 0) / allBlobs.length;
            const avgBubbleH = allBlobs.reduce((s, b) => s + b.h, 0) / allBlobs.length;

            const numC = (roi.settings && roi.settings.numChoices) || 5;

            // 열 간격 (같은 행 내 인접 열 간 거리)
            const colSpacings = [];
            res.rows.forEach((row, rowIdx) => {
                const inRow = allBlobs.filter(b => b.rowIdx === rowIdx).sort((a, b) => a.cx - b.cx);
                for (let i = 1; i < inRow.length; i++) colSpacings.push(inRow[i].cx - inRow[i - 1].cx);
            });
            let avgColSpacing = colSpacings.length > 0
                ? colSpacings.reduce((s, v) => s + v, 0) / colSpacings.length : 0;

            // Fallback: 인접 간격 계산 실패 시 → 전체 블롭의 cx 분포에서 클러스터링으로 추정
            if (avgColSpacing < 5) {
                // cx 값을 정렬 후 10px 이내 간격을 같은 열로 묶음
                const xs = allBlobs.map(b => b.cx).sort((a, b) => a - b);
                const uniqueXs = [];
                xs.forEach(x => {
                    if (uniqueXs.length === 0 || x - uniqueXs[uniqueXs.length - 1] > 10) {
                        uniqueXs.push(x);
                    }
                });
                if (uniqueXs.length >= 2) {
                    // 인접 unique-x 간 거리 평균
                    const gaps = [];
                    for (let i = 1; i < uniqueXs.length; i++) gaps.push(uniqueXs[i] - uniqueXs[i - 1]);
                    avgColSpacing = gaps.reduce((s, v) => s + v, 0) / gaps.length;
                } else if (numC > 1) {
                    // 최후의 수단: ROI 폭을 numC로 균등 분할
                    avgColSpacing = roi.w / numC;
                }
            }

            // 행 간격 (같은 열 내 인접 행 간 거리)
            const rowSpacings = [];
            for (let c = 0; c < numC; c++) {
                const inCol = allBlobs.filter(b => b.colIdx === c).sort((a, b) => a.cy - b.cy);
                for (let i = 1; i < inCol.length; i++) rowSpacings.push(inCol[i].cy - inCol[i - 1].cy);
            }
            let avgRowSpacing = rowSpacings.length > 0
                ? rowSpacings.reduce((s, v) => s + v, 0) / rowSpacings.length : 0;

            // Fallback: 행 간격도 같은 방식으로 추정
            if (avgRowSpacing < 5) {
                const ys = allBlobs.map(b => b.cy).sort((a, b) => a - b);
                const uniqueYs = [];
                ys.forEach(y => {
                    if (uniqueYs.length === 0 || y - uniqueYs[uniqueYs.length - 1] > 10) {
                        uniqueYs.push(y);
                    }
                });
                if (uniqueYs.length >= 2) {
                    const gaps = [];
                    for (let i = 1; i < uniqueYs.length; i++) gaps.push(uniqueYs[i] - uniqueYs[i - 1]);
                    avgRowSpacing = gaps.reduce((s, v) => s + v, 0) / gaps.length;
                } else {
                    const numR = res.rows.length;
                    if (numR > 1) avgRowSpacing = roi.h / numR;
                }
            }

            // 각 행의 대표 Y (상대 비율)
            const rowYRatios = [];
            res.rows.forEach((row, rowIdx) => {
                const inRow = allBlobs.filter(b => b.rowIdx === rowIdx);
                if (inRow.length === 0) return;
                const avgY = inRow.reduce((s, b) => s + b.cy, 0) / inRow.length;
                rowYRatios.push((avgY - roi.y) / roi.h);
            });

            // 각 열의 대표 X — x 좌표 클러스터링 (colIdx 의존 X → 누락 행에도 강건)
            const colXRatios = [];
            const colXAbs = [];
            {
                // 1) 모든 cx 정렬
                const cxs = allBlobs.map(b => b.cx).sort((a, b) => a - b);
                // 2) tolerance = 평균 버블 폭의 60% 또는 최소 4px
                const tol = Math.max(4, avgBubbleW * 0.6);
                // 3) 정렬된 cx들을 tolerance로 클러스터링
                const clusters = [];
                let cur = [cxs[0]];
                for (let i = 1; i < cxs.length; i++) {
                    if (cxs[i] - cur[cur.length - 1] <= tol) cur.push(cxs[i]);
                    else { clusters.push(cur); cur = [cxs[i]]; }
                }
                if (cur.length) clusters.push(cur);
                // 4) 클러스터 크기(blob 수)로 내림차순 정렬 후 상위 numC개 선택
                //    (numC보다 많은 클러스터가 나오면 서브 클러스터 제거)
                let selected = [...clusters].sort((a, b) => b.length - a.length).slice(0, numC);
                // 5) 다시 x 오름차순 정렬
                selected.sort((a, b) => (a[0] + a[a.length - 1]) - (b[0] + b[b.length - 1]));
                // 6) 각 클러스터 중위수 (평균 대신 중위수 — 아웃라이어 robust)
                selected.forEach(cluster => {
                    const sorted = [...cluster].sort((a, b) => a - b);
                    const mid = sorted.length % 2 === 0
                        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                        : sorted[(sorted.length - 1) / 2];
                    colXAbs.push(mid);
                    colXRatios.push((mid - roi.x) / roi.w);
                });
            }

            return {
                savedAt: new Date().toISOString(),
                numRows: res.rows.length,
                numCols: numC,
                orientation: (roi.settings && roi.settings.orientation) || 'vertical',
                // ── 절대 픽셀값 (동일 OMR 양식은 버블 크기/간격이 고정) ──
                bubbleW: avgBubbleW,        // 버블 폭 (px)
                bubbleH: avgBubbleH,        // 버블 높이 (px)
                colSpacing: avgColSpacing,  // 열 간격 (px)
                rowSpacing: avgRowSpacing,  // 행 간격 (px)
                // ── 비율값 (하위호환, 최후의 fallback용) ──
                bubbleWRatio: avgBubbleW / roi.w,
                bubbleHRatio: avgBubbleH / roi.h,
                colSpacingRatio: avgColSpacing / roi.w,
                rowSpacingRatio: avgRowSpacing / roi.h,
                rowYRatios, colXRatios,
                // 절대 좌표 (ROI 기준 px) — 동일 크기의 OMR이면 비율보다 정확
                colXAbsolute: colXAbs.map(x => x - roi.x),
                sampleBlobCount: allBlobs.length,
            };
        };

        // 참조 이미지 dataURL — 양식 수정 시 복원용
        let refImageDataUrl = null;
        try {
            const cv = document.createElement('canvas');
            cv.width = imgObj.imgElement.width;
            cv.height = imgObj.imgElement.height;
            cv.getContext('2d').drawImage(imgObj.imgElement, 0, 0);
            refImageDataUrl = cv.toDataURL('image/jpeg', 0.92);
        } catch (_) { /* 크기 초과 등 실패 시 저장 없이 계속 */ }

        const template = {
            version: '1.2',
            type: 'omr-template',
            savedAt: new Date().toISOString(),
            imageWidth: imgObj.imgElement.width,
            imageHeight: imgObj.imgElement.height,
            // 진하기 — 양식 제작 당시 사용자가 맞춘 값
            intensity: imgObj.intensity || CanvasManager.intensity || 115,
            rois: imgObj.rois.map((roi, idx) => ({
                x: roi.x, y: roi.y, w: roi.w, h: roi.h,
                settings: roi.settings || { startNum: 1, numQuestions: 20, numChoices: 5, orientation: 'vertical' },
                blobPattern: extractBlobPattern(roi, idx),
            })),
            // 참조 이미지 (양식 수정 시에만 사용, 다른 OMR에 적용 시엔 무시)
            referenceImage: refImageDataUrl ? {
                dataUrl: refImageDataUrl,
                width: imgObj.imgElement.width,
                height: imgObj.imgElement.height,
                name: imgObj._originalName || imgObj.name || 'template_image.jpg',
            } : null,
        };

        const isElectron = window.electronAPI && window.electronAPI.isElectron;
        const defaultName = (typeof SessionManager !== 'undefined' && SessionManager.currentExamName) || 'omr_template';

        // Electron 즉시 저장: 이전 저장 경로가 있으면 바로 덮어쓰기
        if (isElectron && this._lastSavePath) {
            (async () => {
                const res = await window.electronAPI.saveTemplate(this._lastSavePath, template);
                if (res.success) Toast.success(`양식 저장됨: ${this._lastSavePath}`);
                else Toast.error('저장 실패: ' + (res.error || ''));
            })();
            return;
        }

        // Electron 첫 저장: FileBrowser로 경로 선택
        if (isElectron && typeof FileBrowser !== 'undefined') {
            FileBrowser.openSave({
                kind: 'template',
                title: '양식 저장',
                defaultName,
                onSave: async (relPath) => {
                    this._lastSavePath = relPath; // 경로 기억 → 다음부터 즉시 저장
                    const res = await window.electronAPI.saveTemplate(relPath, template);
                    if (res.success) Toast.success(`양식 저장됨: ${res.path}`);
                    else Toast.error('저장 실패: ' + (res.error || ''));
                },
            });
            return;
        }

        // 웹 폴백: 브라우저 다운로드
        const json = JSON.stringify(template, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = defaultName + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        Toast.success('양식 템플릿 저장 완료');
    },

    // 다른이름으로 양식 저장 — 항상 FileBrowser 열기
    saveAs() {
        // _lastSavePath 무시하고 강제로 FileBrowser
        const prevPath = this._lastSavePath;
        this._lastSavePath = null; // 즉시 저장 경로 초기화
        this.save(); // save()가 _lastSavePath 없으면 FileBrowser 열기
        // 저장 후 원래 경로 복원하지 않음 (새 경로가 _lastSavePath로 설정됨)
    },

    triggerLoad() {
        const isElectron = window.electronAPI && window.electronAPI.isElectron;
        if (isElectron && typeof FileBrowser !== 'undefined') {
            FileBrowser.open({
                kind: 'template',
                title: '양식 불러오기',
                onPick: async (relPath) => {
                    const res = await window.electronAPI.loadTemplate(relPath);
                    if (!res.success) { Toast.error('불러오기 실패: ' + (res.error || '')); return; }
                    this._lastSavePath = relPath; // 불러온 경로 기억 → 저장 시 즉시 덮어쓰기
                    this._applyTemplate(res.data);
                },
            });
            return;
        }
        // 웹 폴백
        document.getElementById('template-file-input').click();
    },

    // 양식 수정 모드 — 참조 이미지까지 복원하여 새 세션 생성
    _applyTemplateForEdit(template, templateName) {
        if (!template || template.type !== 'omr-template') { Toast.error('유효한 양식 파일이 아닙니다'); return; }
        if (!template.referenceImage || !template.referenceImage.dataUrl) {
            Toast.error('참조 이미지가 포함되지 않은 양식입니다 (이전 버전). 이미지를 수동으로 불러온 뒤 양식을 적용하세요.');
            return;
        }

        // 새 양식 세션 생성 (template-only)
        const tplBase = (templateName || '양식').split('/').pop().replace(/\.json$/i, '');
        const today = SessionManager._todayStr();
        SessionManager.currentSessionName = `[양식]${tplBase}_${today}`;
        SessionManager.currentExamName = `[양식] ${tplBase}`;
        SessionManager.currentExamDate = today;
        SessionManager.isTemplateMode = true;
        SessionManager._hasUnsavedChanges = false;

        if (typeof ImageManager !== 'undefined') {
            ImageManager.releaseImageResources(App.state.images);
            ImageManager.releaseImageResources(App.state.deletedImages);
        }
        App.state.subjects = [];
        App.state.students = [];
        App.state.matchFields = { name: true, birth: false, examNo: false, phone: false };
        App.state.images = [];
        App.state.deletedImages = [];
        App.state.currentIndex = -1;
        App.state.answerKey = null;
        if (typeof App._initPeriods === 'function') App._initPeriods();

        SessionManager._closeStartScreen();
        SessionManager._updateHeader();

        // 참조 이미지 로드 → 이미지 추가 → ROI 적용
        const img = new Image();
        img.onload = () => {
            const thumb = typeof ImageManager !== 'undefined' ? ImageManager.createThumbnail(img) : null;
            const refName = template.referenceImage.name || '양식_기준.jpg';
            const imgObj = {
                name: refName, _originalName: refName, _pristineName: refName,
                imgElement: img, thumb,
                periodId: (App.state.periods && App.state.periods[0] && App.state.periods[0].id) || 'p1',
                rois: template.rois.map(r => ({
                    x: r.x, y: r.y, w: r.w, h: r.h,
                    settings: { ...r.settings },
                    blobPattern: r.blobPattern || null,
                })),
                results: null, gradeResult: null, _correctionConfirmed: false,
                intensity: template.intensity || 115,
            };
            const p = (App.state.periods || [])[0];
            if (p) { p.images = p.images || []; p.images.push(imgObj); }
            App.state.images = (p && p.images) || [imgObj];
            App.state.currentIndex = 0;

            if (template.intensity) {
                CanvasManager.intensity = template.intensity;
                const intInput = document.getElementById('adj-intensity');
                const intVal = document.getElementById('adj-intensity-val');
                if (intInput) intInput.value = template.intensity;
                if (intVal) intVal.textContent = template.intensity;
                CanvasManager._intensityCache && CanvasManager._intensityCache.clear();
            }

            if (typeof ImageManager !== 'undefined') { ImageManager.updateList(); ImageManager.select(0); }
            if (typeof UI !== 'undefined') UI.updateRightPanel();
            CanvasManager.render();
            App.updateStep(App.STEPS.REGION);
            // 새 세션 생성이지만 데이터 변경이 있으므로 캐시 초기화
            if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
            if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
            Toast.success(`양식 편집 모드 — ROI ${template.rois.length}개 복원됨`);
        };
        img.onerror = () => Toast.error('참조 이미지 로드 실패');
        img.src = template.referenceImage.dataUrl;
    },

    // 양식 데이터 → 현재 이미지에 적용 (다른 OMR에 ROI만)
    _applyTemplate(template) {
        try {
            if (template.type !== 'omr-template') { Toast.error('유효한 양식 파일이 아닙니다'); return; }
            const imgObj = App.getCurrentImage();
            if (!imgObj) { Toast.error('먼저 이미지를 선택하세요'); return; }

            imgObj.rois = template.rois.map(roi => ({
                x: roi.x, y: roi.y, w: roi.w, h: roi.h,
                settings: { ...roi.settings },
                blobPattern: roi.blobPattern || null,
            }));
            imgObj.results = null;
            imgObj.gradeResult = null;

            if (template.intensity) {
                imgObj.intensity = template.intensity;
                CanvasManager.intensity = template.intensity;
                (App.state.images || []).forEach(i => { i.intensity = template.intensity; });
                const intInput = document.getElementById('adj-intensity');
                const intVal = document.getElementById('adj-intensity-val');
                if (intInput) intInput.value = template.intensity;
                if (intVal) intVal.textContent = template.intensity;
                CanvasManager._intensityCache && CanvasManager._intensityCache.clear();
            }

            CanvasManager.render();
            App.updateStep(App.STEPS.REGION);
            ImageManager.updateList();
            // 캐시 무효화 + dirty 플래그 — results/gradeResult/rois가 바뀌었음
            if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
            if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
            if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
            const msg = `양식 불러오기 완료 (영역 ${template.rois.length}개${template.intensity ? `, 진하기 ${template.intensity}%` : ''})`;
            Toast.success(msg);
        } catch (err) {
            Toast.error('양식 적용 실패: ' + err.message);
        }
    },

    load(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                this._applyTemplate(JSON.parse(event.target.result));
            } catch (err) {
                Toast.error('파일 형식 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }
};
