// ============================================
// canvas.js - 캔버스 렌더링, 팬/줌, ROI 드래그
// ============================================

const CanvasManager = {
    // 팬 상태
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    panScrollX: 0,
    panScrollY: 0,

    // ROI 선택/이동/리사이즈 상태
    selectedRoiIdx: -1,
    roiDragMode: null, // 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r'
    roiDragStartX: 0,
    roiDragStartY: 0,
    roiOriginal: null, // { x, y, w, h }

    // 이진화 설정

    init() {
        const { canvas, canvasContainer, btnModePan, btnModeDraw,
                btnClearRois, btnUndo, btnZoomIn, btnZoomOut, btnZoomFit, btnAnalyze } = App.els;

        btnModePan.addEventListener('click', () => this.setMode('pan'));
        btnModeDraw.addEventListener('click', () => this.setMode('draw'));
        btnClearRois.addEventListener('click', () => this.clearAllRois());
        btnUndo.addEventListener('click', () => this.undoLastRoi());
        btnZoomIn.addEventListener('click', () => this.zoomBy(0.15));
        btnZoomOut.addEventListener('click', () => this.zoomBy(-0.15));
        btnZoomFit.addEventListener('click', () => this.zoomFit());
        btnAnalyze.addEventListener('click', () => this.runAnalysis());

        // 이미지 조정바 초기화
        this.initAdjustBar();


        // 마우스 이벤트
        canvas.addEventListener('mousedown', (e) => this.handleStart(e));
        window.addEventListener('mousemove', (e) => this.handleMove(e));
        window.addEventListener('mouseup', (e) => this.handleEnd(e));

        // 팬 모드 마우스 이벤트
        canvasContainer.addEventListener('mousedown', (e) => {
            if (!App.state.isDrawingMode && e.target !== canvas) {
                this.startPan(e);
            }
        });
        canvas.addEventListener('mousedown', (e) => {
            if (!App.state.isDrawingMode) {
                this.startPan(e);
            }
        });

        // Ctrl+휠 = 줌 / 일반 휠 = 스크롤
        canvasContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                this.zoomBy(e.deltaY > 0 ? -0.1 : 0.1);
            }
        }, { passive: false });
    },

    setMode(mode) {
        const { btnModeDraw, btnModePan, canvasContainer } = App.els;
        App.state.isDrawingMode = (mode === 'draw');

        btnModeDraw.classList.toggle('active', App.state.isDrawingMode);
        btnModePan.classList.toggle('active', !App.state.isDrawingMode);
        canvasContainer.classList.toggle('mode-draw', App.state.isDrawingMode);
        canvasContainer.classList.toggle('mode-pan', !App.state.isDrawingMode);
    },

    // --- 팬 (드래그로 스크롤) ---
    startPan(e) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.panScrollX = App.els.canvasContainer.scrollLeft;
        this.panScrollY = App.els.canvasContainer.scrollTop;
        App.els.canvasContainer.style.cursor = 'grabbing';
        e.preventDefault();
    },

    // --- 줌 ---
    zoomBy(delta) {
        App.state.zoom = Math.max(App.state.minZoom, Math.min(App.state.maxZoom, App.state.zoom + delta));
        this.applyZoom();
    },

    zoomFit() {
        const container = App.els.canvasContainer;
        const canvas = App.els.canvas;
        if (!canvas.width || !canvas.height) return;

        const pad = 24;
        const scaleX = (container.clientWidth - pad) / canvas.width;
        const scaleY = (container.clientHeight - pad) / canvas.height;
        App.state.zoom = Math.min(scaleX, scaleY, 1.5);
        this.applyZoom();
    },

    applyZoom() {
        App.els.canvas.style.transform = `scale(${App.state.zoom})`;
        App.updateStatusBar();
    },

    // --- ROI 관리 ---
    clearAllRois() {
        const imgObj = App.getCurrentImage();
        if (!imgObj) return;
        imgObj.rois = [];
        imgObj.results = null;
        imgObj.gradeResult = null;
        this.render();
        App.updateStep(App.STEPS.REGION);
        ImageManager.updateList();
        Toast.info('모든 영역 박스가 삭제되었습니다');
    },

    undoLastRoi() {
        const imgObj = App.getCurrentImage();
        if (!imgObj || imgObj.rois.length === 0) return;
        imgObj.rois.pop();
        imgObj.results = null;
        imgObj.gradeResult = null;
        this.render();
        App.updateStep(App.STEPS.REGION);
        ImageManager.updateList();
    },

    // ROI 개별 삭제
    deleteRoi(index) {
        const imgObj = App.getCurrentImage();
        if (!imgObj || index < 0 || index >= imgObj.rois.length) return;
        imgObj.rois.splice(index, 1);
        imgObj.results = null;
        imgObj.gradeResult = null;
        this.render();
        App.updateStep(App.STEPS.REGION);
        ImageManager.updateList();
    },

    // --- 마우스 좌표 (줌 보정) ---
    getMousePos(evt) {
        const canvas = App.els.canvas;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.top) * scaleY
        };
    },

    // ROI 위의 마우스 위치 판별 (모서리/변/내부)
    hitTestRoi(pos, roi, margin = 8) {
        const { x, y, w, h } = roi;
        const r = x + w, b = y + h;

        // 모서리
        if (Math.abs(pos.x - x) < margin && Math.abs(pos.y - y) < margin) return 'resize-tl';
        if (Math.abs(pos.x - r) < margin && Math.abs(pos.y - y) < margin) return 'resize-tr';
        if (Math.abs(pos.x - x) < margin && Math.abs(pos.y - b) < margin) return 'resize-bl';
        if (Math.abs(pos.x - r) < margin && Math.abs(pos.y - b) < margin) return 'resize-br';
        // 변
        if (Math.abs(pos.y - y) < margin && pos.x > x && pos.x < r) return 'resize-t';
        if (Math.abs(pos.y - b) < margin && pos.x > x && pos.x < r) return 'resize-b';
        if (Math.abs(pos.x - x) < margin && pos.y > y && pos.y < b) return 'resize-l';
        if (Math.abs(pos.x - r) < margin && pos.y > y && pos.y < b) return 'resize-r';
        // 내부
        if (pos.x > x && pos.x < r && pos.y > y && pos.y < b) return 'move';

        return null;
    },

    handleStart(e) {
        if (App.state.currentIndex === -1) return;

        const pos = this.getMousePos(e);
        const imgObj = App.getCurrentImage();

        // 기존 ROI 위에 클릭했는지 확인 (리사이즈/이동 우선)
        if (imgObj && imgObj.rois.length > 0) {
            for (let i = imgObj.rois.length - 1; i >= 0; i--) {
                const mode = this.hitTestRoi(pos, imgObj.rois[i]);
                if (mode) {
                    this.selectedRoiIdx = i;
                    this.roiDragMode = mode;
                    this.roiDragStartX = pos.x;
                    this.roiDragStartY = pos.y;
                    this.roiOriginal = { ...imgObj.rois[i] };
                    e.preventDefault();
                    this.render();
                    return;
                }
            }

            // ROI 위가 아니면 라벨 클릭 체크
            for (let i = 0; i < imgObj.rois.length; i++) {
                const lr = imgObj.rois[i]._labelRect;
                if (lr && pos.x >= lr.x && pos.x <= lr.x + lr.w && pos.y >= lr.y && pos.y <= lr.y + lr.h) {
                    e.preventDefault();
                    UI.openRoiSettingsPopup(i);
                    return;
                }
            }
        }

        // ROI 위가 아니면 새 박스 드래그 시작 (드로우 모드일 때만)
        if (!App.state.isDrawingMode) return;
        this.selectedRoiIdx = -1;
        this.roiDragMode = null;
        App.state.startX = pos.x;
        App.state.startY = pos.y;
        App.state.currentX = pos.x;
        App.state.currentY = pos.y;
        App.state.isDrawing = true;
    },

    handleMove(e) {
        // 팬 드래그
        if (this.isPanning) {
            const dx = e.clientX - this.panStartX;
            const dy = e.clientY - this.panStartY;
            App.els.canvasContainer.scrollLeft = this.panScrollX - dx;
            App.els.canvasContainer.scrollTop = this.panScrollY - dy;
            return;
        }

        // ROI 이동/리사이즈
        if (this.roiDragMode && this.selectedRoiIdx >= 0) {
            const imgObj = App.getCurrentImage();
            if (!imgObj) return;
            const pos = this.getMousePos(e);
            const dx = pos.x - this.roiDragStartX;
            const dy = pos.y - this.roiDragStartY;
            const roi = imgObj.rois[this.selectedRoiIdx];
            const orig = this.roiOriginal;

            switch (this.roiDragMode) {
                case 'move':
                    roi.x = orig.x + dx;
                    roi.y = orig.y + dy;
                    break;
                case 'resize-br':
                    roi.w = Math.max(20, orig.w + dx);
                    roi.h = Math.max(20, orig.h + dy);
                    break;
                case 'resize-bl':
                    roi.x = orig.x + dx;
                    roi.w = Math.max(20, orig.w - dx);
                    roi.h = Math.max(20, orig.h + dy);
                    break;
                case 'resize-tr':
                    roi.y = orig.y + dy;
                    roi.w = Math.max(20, orig.w + dx);
                    roi.h = Math.max(20, orig.h - dy);
                    break;
                case 'resize-tl':
                    roi.x = orig.x + dx;
                    roi.y = orig.y + dy;
                    roi.w = Math.max(20, orig.w - dx);
                    roi.h = Math.max(20, orig.h - dy);
                    break;
                case 'resize-t':
                    roi.y = orig.y + dy;
                    roi.h = Math.max(20, orig.h - dy);
                    break;
                case 'resize-b':
                    roi.h = Math.max(20, orig.h + dy);
                    break;
                case 'resize-l':
                    roi.x = orig.x + dx;
                    roi.w = Math.max(20, orig.w - dx);
                    break;
                case 'resize-r':
                    roi.w = Math.max(20, orig.w + dx);
                    break;
            }

            requestAnimationFrame(() => this.render());
            return;
        }

        // ROI 위 커서 변경
        if (!App.state.isDrawing && App.state.currentIndex >= 0) {
            const imgObj = App.getCurrentImage();
            const pos2 = this.getMousePos(e);
            const container = App.els.canvasContainer;
            container.classList.remove('cursor-move', 'cursor-nwse', 'cursor-nesw', 'cursor-ns', 'cursor-ew');

            if (imgObj) {
                for (let i = imgObj.rois.length - 1; i >= 0; i--) {
                    const mode = this.hitTestRoi(pos2, imgObj.rois[i]);
                    if (mode) {
                        if (mode === 'move') container.classList.add('cursor-move');
                        else if (mode === 'resize-tl' || mode === 'resize-br') container.classList.add('cursor-nwse');
                        else if (mode === 'resize-tr' || mode === 'resize-bl') container.classList.add('cursor-nesw');
                        else if (mode === 'resize-t' || mode === 'resize-b') container.classList.add('cursor-ns');
                        else if (mode === 'resize-l' || mode === 'resize-r') container.classList.add('cursor-ew');
                        break;
                    }
                }
            }
        }

        // 새 박스 드래그
        if (!App.state.isDrawing || !App.state.isDrawingMode) return;
        const pos = this.getMousePos(e);
        App.state.currentX = pos.x;
        App.state.currentY = pos.y;
        requestAnimationFrame(() => this.render());
    },

    handleEnd(e) {
        // 팬 끝
        if (this.isPanning) {
            this.isPanning = false;
            if (!App.state.isDrawingMode) {
                App.els.canvasContainer.style.cursor = 'grab';
            }
            return;
        }

        // ROI 이동/리사이즈 끝
        if (this.roiDragMode && this.selectedRoiIdx >= 0) {
            const imgObj = App.getCurrentImage();
            const orig = this.roiOriginal;
            const roi = imgObj ? imgObj.rois[this.selectedRoiIdx] : null;

            // 실제로 이동/크기가 변경되었는지 확인
            const moved = orig && roi && (
                Math.abs(roi.x - orig.x) > 2 || Math.abs(roi.y - orig.y) > 2 ||
                Math.abs(roi.w - orig.w) > 2 || Math.abs(roi.h - orig.h) > 2
            );

            if (moved && imgObj) {
                imgObj.results = null;
                imgObj.gradeResult = null;
                this.render();
                setTimeout(() => this.runAnalysis(), 50);
            }

            this.roiDragMode = null;
            return;
        }

        // 새 박스 끝
        if (!App.state.isDrawing || !App.state.isDrawingMode) return;
        App.state.isDrawing = false;
        const pos = this.getMousePos(e);
        const s = App.state;
        const w = pos.x - s.startX;
        const h = pos.y - s.startY;

        if (Math.abs(w) > 20 && Math.abs(h) > 20) {
            const rx = w > 0 ? s.startX : pos.x;
            const ry = h > 0 ? s.startY : pos.y;
            const rw = Math.abs(w);
            const rh = Math.abs(h);
            const imgObj = App.getCurrentImage();

            const newSettings = UI.defaultSettings();

            // 자동 감지 (방향 포함)
            try {
                const imageData = this.getAdjustedImageData(imgObj, rx, ry, rw, rh);
                const detected = OmrEngine.autoDetect(imageData, rx, ry, this.bubbleSize);
                if (detected) {
                    newSettings.numQuestions = detected.numQuestions;
                    newSettings.numChoices = detected.numChoices;
                    newSettings.orientation = detected.orientation;

                    // 가로이고 선택지 10개면 1-0, 아니면 일반 매핑
                    if (detected.orientation === 'horizontal' && detected.numChoices >= 9) {
                        newSettings.choicePreset = '1-0';
                        newSettings.choiceLabels = [...UI.CHOICE_PRESETS['1-0'].labels];
                        newSettings.numChoices = 10;
                    } else {
                        const presetMap = { 4: '1-4', 5: '1-5', 9: '1-9', 10: '1-0' };
                        if (presetMap[detected.numChoices]) {
                            newSettings.choicePreset = presetMap[detected.numChoices];
                            newSettings.choiceLabels = [...UI.CHOICE_PRESETS[newSettings.choicePreset].labels];
                        } else {
                            newSettings.choiceLabels = Array.from({ length: detected.numChoices }, (_, i) => String(i + 1));
                        }
                    }
                }
            } catch (e) {
                console.warn('자동 감지 실패:', e);
            }

            // ROI 추가
            imgObj.rois.push({ x: rx, y: ry, w: rw, h: rh, settings: newSettings });
            imgObj.results = null;
            imgObj.gradeResult = null;
            App.els.btnAnalyze.disabled = false;

            // 설정 팝업 먼저 표시 → 확인 시 분석 실행
            this.render();
            const newIdx = imgObj.rois.length - 1;
            setTimeout(() => UI.openRoiSettingsPopup(newIdx), 100);
        } else {
            this.render();
        }
    },

    // --- 분석 실행 ---
    runAnalysis() {
        const imgObj = App.getCurrentImage();
        if (!imgObj || imgObj.rois.length === 0) {
            Toast.error('먼저 박스 모드(D)에서 분석할 영역을 드래그하세요');
            return;
        }

        App.els.btnAnalyze.disabled = true;
        const text = App.els.btnAnalyze.querySelector('.analyze-label');
        const spinner = App.els.btnAnalyze.querySelector('.spinner');
        if (text) text.textContent = '분석 중...';
        if (spinner) spinner.style.display = 'inline-block';

        setTimeout(() => {
          try {
            const ctx = App.els.ctx;
            ctx.clearRect(0, 0, App.els.canvas.width, App.els.canvas.height);
            ctx.drawImage(imgObj.imgElement, 0, 0);

            imgObj.results = [];
            imgObj.validationErrors = [];

            imgObj.rois.forEach((roi, idx) => {
                const s = roi.settings || UI.defaultSettings();
                const orientation = s.orientation || 'vertical';
                const numQ = s.numQuestions || 0;
                const numC = s.numChoices || 0;
                const bSize = s.bubbleSize || this.bubbleSize || 0;
                const stretch = s.stretchRatio || 1.0;
                const useStretch = stretch > 1.0;
                const elongatedMode = s.elongatedMode || false;

                // 가로 스트레칭: 원본 ROI를 임시 캔버스에 늘려서 그리고 그 픽셀을 분석
                let imageData;
                if (useStretch) {
                    const dstW = Math.round(roi.w * stretch);
                    const dstH = Math.round(roi.h);
                    const off = document.createElement('canvas');
                    off.width = dstW; off.height = dstH;
                    const offCtx = off.getContext('2d', { willReadFrequently: true });
                    // 원본 이미지에서 ROI 영역만 늘려서 복사
                    const srcImg = this._getIntensifiedImage(imgObj) || imgObj.imgElement;
                    offCtx.drawImage(srcImg, roi.x, roi.y, roi.w, roi.h, 0, 0, dstW, dstH);
                    imageData = offCtx.getImageData(0, 0, dstW, dstH);
                } else {
                    imageData = this.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h);
                }

                // 스트레칭 시 offsetX/Y=0 (ROI 내부 상대좌표로 분석)
                const analysisOffsetX = useStretch ? 0 : roi.x;
                const analysisOffsetY = useStretch ? 0 : roi.y;
                const analysis = OmrEngine.analyzeROI(imageData, analysisOffsetX, analysisOffsetY, orientation, numQ, numC, null, bSize, elongatedMode);

                // 스트레칭 역변환: 상대좌표 → 원본 절대좌표로 복원
                if (useStretch) {
                    analysis.rows.forEach(row => {
                        if (row.blobs) {
                            row.blobs.forEach(blob => {
                                blob.cx = blob.cx / stretch + roi.x;
                                blob.cy = blob.cy + roi.y;
                                blob.w = Math.round(blob.w / stretch);
                                blob.x = Math.round(blob.cx - blob.w / 2);
                                blob.y = Math.round(blob.cy - blob.h / 2);
                            });
                        }
                    });
                }

                // 버블 크기만 저장 (좌표는 이미지마다 새로 찾음)
                if (bSize > 0) s.bubbleSize = bSize;
                const startNum = s.startNum || 1;
                const expectedQ = s.numQuestions || 20;
                const expectedC = s.numChoices || 5;

                // 탐지된 행에 문항번호 부여
                analysis.rows.forEach((row, i) => {
                    row.questionNumber = startNum + i;
                });

                const detectedQ = analysis.rows.length;
                const regionName = s.name || `영역 ${idx + 1}`;

                // ── 검증: 문항수 불일치 ──
                if (detectedQ < expectedQ) {
                    // 부족한 문항을 "미인식"으로 채움
                    for (let i = detectedQ; i < expectedQ; i++) {
                        analysis.rows.push({
                            questionNumber: startNum + i,
                            numChoices: 0,
                            markedAnswer: null,
                            blobs: [],
                            undetected: true // 미인식 플래그
                        });
                    }
                    imgObj.validationErrors.push({
                        roiIndex: idx + 1,
                        regionName,
                        type: 'missing_questions',
                        expected: expectedQ,
                        detected: detectedQ,
                        missing: expectedQ - detectedQ
                    });
                } else if (detectedQ > expectedQ) {
                    imgObj.validationErrors.push({
                        roiIndex: idx + 1,
                        regionName,
                        type: 'extra_questions',
                        expected: expectedQ,
                        detected: detectedQ,
                        extra: detectedQ - expectedQ
                    });
                }

                // ── 검증: 지선다 불일치 ──
                analysis.rows.forEach(row => {
                    if (row.numChoices > 0 && row.numChoices !== expectedC && !row.undetected) {
                        if (!imgObj.validationErrors.find(e =>
                            e.roiIndex === idx + 1 && e.type === 'choice_mismatch')) {
                            imgObj.validationErrors.push({
                                roiIndex: idx + 1,
                                regionName,
                                type: 'choice_mismatch',
                                expected: expectedC,
                                detected: row.numChoices,
                                questionNumber: row.questionNumber
                            });
                        }
                    }
                });

                imgObj.results.push({
                    roiIndex: idx + 1,
                    numQuestions: analysis.rows.length,
                    numChoices: analysis.maxCols,
                    rows: analysis.rows,
                    settings: s,
                    debugBlobs: analysis.debugBlobs
                });
            });

            // 검증 경고 토스트
            if (imgObj.validationErrors.length > 0) {
                const missingErrs = imgObj.validationErrors.filter(e => e.type === 'missing_questions');
                if (missingErrs.length > 0) {
                    missingErrs.forEach(e => {
                        Toast.error(`${e.regionName}: ${e.expected}문항 중 ${e.detected}개만 인식 (${e.missing}개 누락)`);
                    });
                }
            }

            // 결과 탭으로 자동 전환
            App.state.rightTab = 'results';

            // 정답이 있으면 자동 채점 (전역 또는 영역별)
            const hasAnyAnswers = App.state.answerKey ||
                imgObj.rois.some(r => r.settings && r.settings.type === 'subject_answer' && r.settings.answerKey);
            // 휴대폰번호 접두사 적용 (채점 여부 무관)
            ImageManager.applyPhonePrefix(imgObj);

            if (hasAnyAnswers) {
                imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
                if (imgObj.gradeResult) {
                    App.updateStep(App.STEPS.GRADE);
                    Toast.success(imgObj.validationErrors.length > 0 ? '채점 완료 (검증 경고 있음)' : '분석 및 채점 완료');
                } else {
                    App.updateStep(App.STEPS.ANALYZE);
                    Toast.success('분석 완료');
                }
            } else {
                App.updateStep(App.STEPS.ANALYZE);
                Toast.success(imgObj.validationErrors.length > 0 ? '분석 완료 (검증 경고 있음)' : '분석 완료');
            }

            this.render();
            ImageManager.updateList();
            UI.updateRightPanel();

          } catch (err) {
            console.error('분석 오류:', err);
            Toast.error('분석 중 오류 발생: ' + err.message);
          } finally {
            if (text) text.textContent = '분석 실행';
            if (spinner) spinner.style.display = 'none';
            App.els.btnAnalyze.disabled = false;
          }
        }, 100);
    },

    // 진하기(감마) 설정
    intensity: 250,
    _intensityCache: new Map(),
    bubbleSize: 0, // 0 = 자동

    // --- 이미지 조정바 초기화 ---
    initAdjustBar() {
        const intensityInput = document.getElementById('adj-intensity');
        const intensityVal = document.getElementById('adj-intensity-val');

        intensityInput.addEventListener('input', () => {
            this.intensity = parseInt(intensityInput.value);
            intensityVal.textContent = intensityInput.value;
            this._intensityCache.clear();
            this.render(); // 현재 이미지만 적용
        });

        document.getElementById('adj-apply-all').addEventListener('click', () => {
            if (this.intensity === 100) return;
            const images = App.state.images;
            if (!images || images.length === 0) return;
            const gamma = this.intensity / 100;
            const lut = new Uint8Array(256);
            for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, gamma));
            let done = 0;
            Toast.info(`전체 이미지 진하기 적용 중... (0/${images.length})`);
            const processNext = () => {
                if (done >= images.length) { Toast.success(`완료 (${images.length}장)`); return; }
                const imgObj = images[done];
                const img = imgObj.imgElement;
                const key = (imgObj.src || img.src) + '_' + this.intensity;
                if (!this._intensityCache.has(key)) {
                    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                    const off = document.createElement('canvas');
                    off.width = w; off.height = h;
                    const ctx = off.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0);
                    const imgData = ctx.getImageData(0, 0, w, h);
                    const d = imgData.data;
                    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]]; }
                    ctx.putImageData(imgData, 0, 0);
                    this._intensityCache.set(key, off);
                }
                done++;
                if (done % 10 === 0) Toast.info(`전체 이미지 진하기 적용 중... (${done}/${images.length})`);
                setTimeout(processNext, 0); // UI 블로킹 방지
            };
            processNext();
        });

        document.getElementById('adj-reset').addEventListener('click', () => {
            this.intensity = 100;
            intensityInput.value = 100;
            intensityVal.textContent = '100';
            this._intensityCache.clear();
            this.render();
        });

        document.getElementById('adj-rotate-left').addEventListener('click', () => this.rotateImage(-90));
        document.getElementById('adj-rotate-right').addEventListener('click', () => this.rotateImage(90));

        // 미세 기울기 버튼
        document.getElementById('adj-skew-ccw').addEventListener('click', () => this.applySkew(-0.5));
        document.getElementById('adj-skew-cw').addEventListener('click', () => this.applySkew(0.5));

        // 분석 로그 체크박스
        document.getElementById('adj-debug-log').addEventListener('change', (e) => {
            OmrEngine.debugLog = e.target.checked;
        });
    },

    // 감마 보정된 이미지 생성 (캐시)
    _getIntensifiedImage(imgObj) {
        if (this.intensity === 100) return null; // 원본 사용

        const img = imgObj.imgElement;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const key = (imgObj.src || img.src) + '_' + this.intensity;

        if (this._intensityCache.has(key)) return this._intensityCache.get(key);

        // 감마 LUT: 슬라이더 오른쪽(150)=진하게, 왼쪽(50)=옅게
        const gamma = this.intensity / 100;
        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            lut[i] = Math.round(255 * Math.pow(i / 255, gamma));
        }

        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const offCtx = off.getContext('2d', { willReadFrequently: true });
        offCtx.drawImage(img, 0, 0);
        const imgData = offCtx.getImageData(0, 0, w, h);
        const d = imgData.data;

        for (let i = 0; i < d.length; i += 4) {
            d[i] = lut[d[i]];
            d[i+1] = lut[d[i+1]];
            d[i+2] = lut[d[i+2]];
        }
        offCtx.putImageData(imgData, 0, 0);

        // 캐시 (최대 200개)
        if (this._intensityCache.size > 200) {
            const firstKey = this._intensityCache.keys().next().value;
            this._intensityCache.delete(firstKey);
        }
        this._intensityCache.set(key, off);
        return off;
    },

    // 미세 기울기 보정
    applySkew(degrees) {
        const applyAll = document.getElementById('adj-skew-all').checked;
        const images = applyAll ? App.state.images : [App.getCurrentImage()];
        if (!images || images.length === 0 || !images[0]) return;

        this._intensityCache.clear();
        this._srcCanvasCache = null;
        let remaining = images.length;

        images.forEach(imgObj => {
            if (!imgObj) { remaining--; return; }
            const img = imgObj.imgElement;
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;

            const off = document.createElement('canvas');
            off.width = w; off.height = h;
            const offCtx = off.getContext('2d');
            offCtx.translate(w / 2, h / 2);
            offCtx.rotate(degrees * Math.PI / 180);
            offCtx.drawImage(img, -w / 2, -h / 2);

            off.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const newImg = new Image();
                newImg.onload = () => {
                    URL.revokeObjectURL(url);
                    imgObj.imgElement = newImg;
                    // ROI와 결과는 유지 (미세 보정이므로)
                    imgObj.results = null;
                    imgObj.gradeResult = null;

                    remaining--;
                    if (remaining === 0) {
                        const cur = App.getCurrentImage();
                        if (cur) {
                            const { canvas } = App.els;
                            canvas.width = cur.imgElement.width;
                            canvas.height = cur.imgElement.height;
                            this.zoomFit();
                            this.render();
                        }
                        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
                        UI.updateRightPanel();
                    }
                };
                newImg.src = url;
            }, 'image/png');
        });
    },

    // 전체 이미지 90도 회전
    rotateImage(degrees) {
        const images = App.state.images;
        if (!images || images.length === 0) return;

        let remaining = images.length;

        images.forEach(imgObj => {
            const img = imgObj.imgElement;
            const sw = img.naturalWidth || img.width;
            const sh = img.naturalHeight || img.height;

            const off = document.createElement('canvas');
            const isSwap = (degrees === 90 || degrees === -90);
            off.width = isSwap ? sh : sw;
            off.height = isSwap ? sw : sh;
            const offCtx = off.getContext('2d');

            offCtx.translate(off.width / 2, off.height / 2);
            offCtx.rotate(degrees * Math.PI / 180);
            offCtx.drawImage(img, -sw / 2, -sh / 2);

            // toBlob → createObjectURL (toDataURL보다 안정적)
            off.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const newImg = new Image();
                newImg.onload = () => {
                    URL.revokeObjectURL(url);
                    imgObj.imgElement = newImg;
                    imgObj.rois = [];
                    imgObj.results = null;
                    imgObj.gradeResult = null;

                    remaining--;
                    if (remaining === 0) {
                        const cur = App.getCurrentImage();
                        if (cur) {
                            const { canvas } = App.els;
                            canvas.width = cur.imgElement.width;
                            canvas.height = cur.imgElement.height;
                            canvas.style.display = 'block';
                            document.getElementById('canvas-empty').style.display = 'none';
                            this.zoomFit();
                            this.render();
                        }
                        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
                    }
                };
                newImg.src = url;
            }, 'image/png');
        });
    },


    // 분석용 이미지 데이터 (진하기 적용)
    // srcCanvas를 전달하면 재사용 (batch용 최적화)
    getAdjustedImageData(imgObj, x, y, w, h, srcCanvas) {
        const intensified = this._getIntensifiedImage(imgObj);
        if (intensified) {
            return intensified.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h);
        }
        if (srcCanvas) {
            return srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h);
        }
        // 캐시된 원본 캔버스 사용
        const img = imgObj.imgElement;
        const key = imgObj.src || img.src;
        if (!this._srcCanvasCache || this._srcCanvasCacheKey !== key) {
            const off = document.createElement('canvas');
            off.width = img.naturalWidth || img.width;
            off.height = img.naturalHeight || img.height;
            const offCtx = off.getContext('2d', { willReadFrequently: true });
            offCtx.drawImage(img, 0, 0);
            this._srcCanvasCache = off;
            this._srcCanvasCacheKey = key;
        }
        return this._srcCanvasCache.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h);
    },

    // --- 렌더링 ---
    render() {
        const imgObj = App.getCurrentImage();
        if (!imgObj) return;

        // 이미지가 있으면 조정바 표시
        const bar = document.getElementById('image-adjust-bar');
        if (bar) bar.style.display = 'flex';

        const { canvas, ctx } = App.els;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const intensified = this._getIntensifiedImage(imgObj);
        ctx.drawImage(intensified || imgObj.imgElement, 0, 0);

        // ROI 박스
        imgObj.rois.forEach((roi, idx) => {
            const isSelected = idx === this.selectedRoiIdx;
            ctx.strokeStyle = isSelected ? '#2563eb' : '#4A7CFF';
            ctx.lineWidth = isSelected ? 4 : 3;
            ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
            ctx.fillStyle = isSelected ? 'rgba(37, 99, 235, 0.12)' : 'rgba(74, 124, 255, 0.08)';
            ctx.fillRect(roi.x, roi.y, roi.w, roi.h);

            // 선택된 ROI: 모서리/변 핸들 그리기
            if (isSelected) {
                const hSize = 6;
                ctx.fillStyle = '#2563eb';
                const corners = [
                    [roi.x, roi.y], [roi.x + roi.w, roi.y],
                    [roi.x, roi.y + roi.h], [roi.x + roi.w, roi.y + roi.h]
                ];
                corners.forEach(([cx, cy]) => {
                    ctx.fillRect(cx - hSize/2, cy - hSize/2, hSize, hSize);
                });
                // 변 중앙 핸들
                const midHandles = [
                    [roi.x + roi.w/2, roi.y], [roi.x + roi.w/2, roi.y + roi.h],
                    [roi.x, roi.y + roi.h/2], [roi.x + roi.w, roi.y + roi.h/2]
                ];
                midHandles.forEach(([cx, cy]) => {
                    ctx.fillRect(cx - hSize/2, cy - hSize/2, hSize, hSize);
                });
            }

            // 영역명 + 설정 라벨 (클릭 가능)
            const name = (roi.settings && roi.settings.name) || `영역 ${idx + 1}`;
            const orient = (roi.settings && roi.settings.orientation === 'horizontal') ? '가로' : '세로';
            const nq = roi.settings ? (roi.settings.numQuestions || '?') : '?';
            const nc = roi.settings ? (roi.settings.numChoices || '?') : '?';
            const text = `${name} | ${nq}Q×${nc}C | ${orient}`;
            ctx.font = 'bold 16px sans-serif';
            const tw = ctx.measureText(text).width;
            const labelX = roi.x, labelY = roi.y + roi.h;
            const labelW = tw + 16, labelH = 24;
            ctx.fillStyle = '#4A7CFF';
            ctx.fillRect(labelX, labelY, labelW, labelH);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(text, labelX + 8, labelY + 18);
            // 라벨 영역 저장 (클릭 감지용)
            roi._labelRect = { x: labelX, y: labelY, w: labelW, h: labelH };

            // 가로 스트레칭 미리보기
            const s = roi.settings || {};
            const stretch = s.stretchRatio || 1.0;
            if (s.showStretchPreview && stretch > 1.0) {
                try {
                    // ROI 영역 픽셀을 임시 캔버스에 복사 → 가로로 늘림 → 원본 옆에 그림
                    const srcImg = intensified || imgObj.imgElement;
                    const dstW = Math.round(roi.w * stretch);
                    const dstH = Math.round(roi.h);
                    // 미리보기 위치: ROI 우측 옆 (10px 간격)
                    const previewX = roi.x + roi.w + 10;
                    const previewY = roi.y;

                    // 원본 ROI → 늘려서 복사
                    ctx.save();
                    // 배경 박스
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(previewX - 2, previewY - 2, dstW + 4, dstH + 4);
                    // 스트레칭 그리기
                    ctx.drawImage(srcImg, roi.x, roi.y, roi.w, roi.h, previewX, previewY, dstW, dstH);
                    // 미리보기 테두리 (주황색)
                    ctx.strokeStyle = '#f97316';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(previewX, previewY, dstW, dstH);
                    ctx.setLineDash([]);
                    // 라벨
                    ctx.font = 'bold 13px sans-serif';
                    ctx.fillStyle = '#f97316';
                    ctx.fillText(`미리보기 (×${stretch})`, previewX, previewY - 4);
                    ctx.restore();

                    // 미리보기 영역 좌표 저장 (분석 시 이 영역에 결과 표시)
                    roi._previewRect = { x: previewX, y: previewY, w: dstW, h: dstH, stretch };
                } catch (e) {
                    console.warn('미리보기 렌더 실패:', e);
                }
            } else {
                roi._previewRect = null;
            }
        });

        // 드래그 중
        if (App.state.isDrawing) {
            const s = App.state;
            ctx.strokeStyle = '#EF4444';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.strokeRect(s.startX, s.startY, s.currentX - s.startX, s.currentY - s.startY);
            ctx.setLineDash([]);
        }

        // BFS가 찾은 블롭 표시 (항상)
        if (imgObj.results) {
            imgObj.results.forEach(roiResult => {
                if (!roiResult.debugBlobs) return;
                const db = roiResult.debugBlobs;
                // BFS 전체 블롭 (빨간 점선) — 필터 전
                db.all.forEach(b => {
                    ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.strokeRect(b.cx - b.w/2, b.cy - b.h/2, b.w, b.h);
                    ctx.setLineDash([]);
                });
                // 필터 통과 블롭 (초록 실선)
                db.filtered.forEach(b => {
                    ctx.strokeStyle = '#22c55e';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(b.cx - b.w/2, b.cy - b.h/2, b.w, b.h);
                    // 좌표 표시
                    ctx.font = '9px monospace';
                    ctx.fillStyle = '#22c55e';
                    ctx.fillText(`${Math.round(b.cx)},${Math.round(b.cy)}`, b.cx - b.w/2, b.cy - b.h/2 - 2);
                });
            });
        }

        // 분석 결과 오버레이 (네모박스 기반)
        if (imgObj.results) {
            const hasGrade = imgObj.gradeResult !== null;
            const details = hasGrade ? imgObj.gradeResult.details : null;

            imgObj.results.forEach(roiResult => {
                roiResult.rows.forEach(row => {
                    const isMulti = row.multiMarked;
                    const isBlankRow = !row.undetected && row.markedAnswer === null && !isMulti;
                    (row.blobs || []).forEach(blob => {
                        const bx = blob.x || (blob.cx - blob.w / 2);
                        const by = blob.y || (blob.cy - blob.h / 2);
                        const bw = blob.w, bh = blob.h;

                        if (blob.isMarked) {
                            if (row.corrected && row._userCorrected) {
                                ctx.fillStyle = 'rgba(139, 92, 246, 0.4)';
                                ctx.strokeStyle = '#7c3aed';
                            } else if (isMulti) {
                                ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
                                ctx.strokeStyle = '#dc2626';
                            } else if (hasGrade && details) {
                                const d = details.find(d => d.questionNumber === row.questionNumber);
                                const isCorrect = d ? d.isCorrect : true;
                                ctx.fillStyle = isCorrect ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)';
                                ctx.strokeStyle = isCorrect ? '#16a34a' : '#dc2626';
                            } else {
                                ctx.fillStyle = 'rgba(74, 124, 255, 0.35)';
                                ctx.strokeStyle = '#4A7CFF';
                            }
                            ctx.lineWidth = 2.5;
                            ctx.fillRect(bx, by, bw, bh);
                            ctx.strokeRect(bx, by, bw, bh);
                        } else if (isBlankRow) {
                            ctx.strokeStyle = '#f59e0b';
                            ctx.lineWidth = 2.5;
                            ctx.strokeRect(bx, by, bw, bh);
                        } else {
                            ctx.strokeStyle = '#22c55e';
                            ctx.lineWidth = 2;
                            ctx.strokeRect(bx, by, bw, bh);
                        }
                    });
                });
            });
        }
    }
};
