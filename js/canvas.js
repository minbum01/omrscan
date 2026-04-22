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
        const deletedId = imgObj.rois[index]._id;
        imgObj.rois.splice(index, 1);
        // 삭제된 ROI를 참조하는 다른 ROI의 코드 연결 정리
        if (deletedId) {
            imgObj.rois.forEach(r => {
                if (!r.settings) return;
                if (r.settings.linkedCodeRoiId === deletedId) {
                    r.settings.linkedCodeRoiId = null;
                    r.settings.answerSource = 'direct';
                }
                if (r.settings.linkedCodeRoiIds && r.settings.linkedCodeRoiIds.includes(deletedId)) {
                    r.settings.linkedCodeRoiIds = r.settings.linkedCodeRoiIds.filter(id => id !== deletedId);
                    if (r.settings.linkedCodeRoiIds.length === 0) {
                        r.settings.linkedCodeRoiIds = null;
                        r.settings.answerSource = 'direct';
                    }
                }
            });
        }
        imgObj.results = null;
        imgObj.gradeResult = null;
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
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
                    const wasSelected = this.selectedRoiIdx === i;
                    this.selectedRoiIdx = i;
                    this.roiDragMode = mode;
                    this.roiDragStartX = pos.x;
                    this.roiDragStartY = pos.y;
                    this.roiOriginal = { ...imgObj.rois[i] };
                    e.preventDefault();
                    this.render();
                    // 새로 선택된 ROI면 우측 패널 리렌더 + 해당 카드로 스크롤
                    if (!wasSelected) {
                        UI.updateRightPanel();
                        UI.scrollToRoiCard(i);
                    }
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
            if (!roi || !orig) return;

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

            if (!imgObj || !roi || !orig) {
                this.roiDragMode = null;
                return;
            }

            // 실제로 이동/크기가 변경되었는지 확인
            const moved = (
                Math.abs(roi.x - orig.x) > 8 || Math.abs(roi.y - orig.y) > 8 ||
                Math.abs(roi.w - orig.w) > 8 || Math.abs(roi.h - orig.h) > 8
            );

            if (moved) {
                imgObj.results = null;
                imgObj.gradeResult = null;
                if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
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
                    // 감지된 선택지 수에 맞춰 기본 라벨 생성 (사용자가 나중에 수정 가능)
                    newSettings.choiceLabels = Array.from({ length: detected.numChoices }, (_, i) => String(i + 1));
                }
            } catch (e) {
                console.warn('자동 감지 실패:', e);
            }

            // ROI 추가
            const roiId = (typeof UI !== 'undefined') ? UI._genRoiId() : ('roi_' + Date.now().toString(36));
            imgObj.rois.push({ x: rx, y: ry, w: rw, h: rh, _id: roiId, settings: newSettings, _isNewRoi: true });
            imgObj.results = null;
            imgObj.gradeResult = null;
            if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
            App.els.btnAnalyze.disabled = false;

            this.render();
            const newIdx = imgObj.rois.length - 1;
            // 과목코드 박스 치기 모드면 코드 타입 + 가로 방향 강제
            if (typeof UI !== 'undefined' && UI._pendingCodeLinkRoiIdx != null) {
                const codeSettings = imgObj.rois[newIdx].settings;
                codeSettings.type = 'subject_code';
                codeSettings.name = '';
                codeSettings.orientation = 'horizontal'; // 과목코드는 항상 가로
                codeSettings.numQuestions = 1; // 1자리
                imgObj.rois[newIdx]._isPendingCodeBox = true;
                setTimeout(() => UI.openRoiSettingsPopup(newIdx), 100);
            } else {
                setTimeout(() => UI.openRoiSettingsPopup(newIdx), 100);
            }
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
            if (!imgObj.imgElement || imgObj.imgElement.width === 0) { Toast.error('이미지 로드 안 됨'); return; }
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
                const elongatedMode = s.elongatedMode || false;
                const elongatedThresholds = elongatedMode ? UI.getThresholds(s) : null;

                const imageData = this.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h);
                const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds, roi.blobPattern || null);

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
            ImageManager.invalidateStatus(imgObj);
            ImageManager.updateList();
            UI.updateRightPanel();
            if (typeof Correction !== 'undefined') {
                Correction.invalidate && Correction.invalidate();
                Correction.updateBadge && Correction.updateBadge();
            }
            if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
            if (typeof SessionManager !== 'undefined') SessionManager.markDirty();

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
    intensity: 115,
    _intensityCache: new Map(),
    bubbleSize: 0, // 0 = 자동

    // --- 이미지 조정바 초기화 ---
    initAdjustBar() {
        const intensityInput = document.getElementById('adj-intensity');
        const intensityVal = document.getElementById('adj-intensity-val');

        const allCb = document.getElementById('adj-intensity-all');

        intensityInput.addEventListener('input', () => {
            this.intensity = parseInt(intensityInput.value);
            intensityVal.textContent = intensityInput.value;
            this._intensityCache.clear();

            if (allCb.checked) {
                // 전체 모드: 모든 이미지에 intensity 저장
                (App.state.images || []).forEach(imgObj => { imgObj.intensity = this.intensity; });
            } else {
                // 개별 모드: 현재 이미지만
                const curImg = App.getCurrentImage();
                if (curImg) curImg.intensity = this.intensity;
            }
            this.render();
        });

        // "전체" 체크박스: 토글 유지. 체크 시 현재 값을 전체에 즉시 반영
        allCb.addEventListener('change', (e) => {
            if (!e.target.checked) return; // 해제 시 아무것도 안 함
            const images = App.state.images;
            if (!images || images.length === 0) { e.target.checked = false; return; }
            // 현재 intensity를 모든 이미지에 반영
            images.forEach(imgObj => { imgObj.intensity = this.intensity; });
            this._intensityCache.clear();
            Toast.success(`전체 이미지 진하기 ${this.intensity} 적용`);
        });

        document.getElementById('adj-reset').addEventListener('click', () => {
            this.intensity = 100;
            intensityInput.value = 100;
            intensityVal.textContent = '100';
            this._intensityCache.clear();
            if (allCb.checked) {
                (App.state.images || []).forEach(imgObj => { imgObj.intensity = 100; });
            } else {
                const curImg = App.getCurrentImage();
                if (curImg) curImg.intensity = 100;
            }
            this.render();
        });

        document.getElementById('adj-rotate-left').addEventListener('click', () => {
            const applyAll = document.getElementById('adj-rotate-all').checked;
            this.rotateImage(-90, applyAll);
        });
        document.getElementById('adj-rotate-right').addEventListener('click', () => {
            const applyAll = document.getElementById('adj-rotate-all').checked;
            this.rotateImage(90, applyAll);
        });

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
        if (!w || !h) return null; // 이미지 미로드 시 원본 사용

        const key = (imgObj.src || img.src || 'img_' + (imgObj._originalName || '')) + '_' + this.intensity;

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
        if (this._intensityCache.size > 20) {
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
            if (!imgObj || !imgObj.imgElement || imgObj.imgElement.width === 0) { remaining--; return; }
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
                    // 이전 _imgSrc가 blob이면 해제, 보정된 blob URL을 재사용
                    if (typeof ImageManager !== 'undefined') ImageManager._revokeBlobUrl(imgObj._imgSrc);
                    imgObj.imgElement = newImg;
                    imgObj._imgSrc = url;
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
            }, 'image/jpeg', 0.92);
        });
    },

    // 90도 회전 (applyAll=true면 전체, false면 현재 이미지만)
    rotateImage(degrees, applyAll) {
        const images = applyAll ? App.state.images : [App.getCurrentImage()];
        if (!images || images.length === 0 || !images[0]) return;

        const total = images.length;
        let completed = 0;
        const SHOW_LOADING = total >= 15;

        // 로딩 오버레이
        let loadingEl = null;
        if (SHOW_LOADING) {
            loadingEl = document.createElement('div');
            loadingEl.id = 'rotate-loading-overlay';
            loadingEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10100;display:flex;align-items:center;justify-content:center;';
            loadingEl.innerHTML = `<div style="background:#fff;border-radius:12px;padding:28px 40px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
                <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:8px;">이미지 회전 중...</div>
                <div id="rotate-loading-progress" style="font-size:14px;color:#3b82f6;font-weight:600;">0 / ${total}</div>
                <div style="margin-top:12px;width:240px;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                    <div id="rotate-loading-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#3b82f6,#2563eb);border-radius:3px;transition:width 0.15s;"></div>
                </div>
            </div>`;
            document.body.appendChild(loadingEl);
        }

        const _rotateStart = Date.now();
        const updateProgress = () => {
            if (!loadingEl) return;
            const pct = Math.round((completed / total) * 100);
            const prog = document.getElementById('rotate-loading-progress');
            const bar = document.getElementById('rotate-loading-bar');
            let timeInfo = '';
            if (completed > 2) {
                const elapsed = (Date.now() - _rotateStart) / 1000;
                const remaining = (elapsed / completed) * (total - completed);
                if (remaining > 60) timeInfo = ` (약 ${Math.ceil(remaining / 60)}분 남음)`;
                else if (remaining > 5) timeInfo = ` (약 ${Math.round(remaining)}초 남음)`;
            }
            if (prog) prog.textContent = `${completed} / ${total}${timeInfo}`;
            if (bar) bar.style.width = pct + '%';
        };

        const finish = () => {
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
            if (loadingEl) loadingEl.remove();
        };

        // 순차 처리 (한 번에 하나씩 → UI 블로킹 방지)
        const processNext = async (idx) => {
            if (idx >= total) { finish(); return; }
            const imgObj = images[idx];
            if (!imgObj) { completed++; updateProgress(); setTimeout(() => processNext(idx + 1), 0); return; }

            // Lazy Loading: 이미지가 해제된 상태면 복원
            if (typeof ImageManager !== 'undefined' && (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0)) {
                await ImageManager.ensureLoaded(imgObj);
            }
            if (!imgObj.imgElement || imgObj.imgElement.width === 0) { completed++; updateProgress(); setTimeout(() => processNext(idx + 1), 0); return; }

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

            off.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const newImg = new Image();
                newImg.onload = () => {
                    // 이전 _imgSrc가 blob이면 해제
                    if (typeof ImageManager !== 'undefined') ImageManager._revokeBlobUrl(imgObj._imgSrc);
                    imgObj.imgElement = newImg;
                    // 회전된 이미지의 blob URL을 그대로 _imgSrc로 사용 (Lazy Loading 복원 시 회전 상태 유지)
                    imgObj._imgSrc = url;
                    imgObj.rois = [];
                    imgObj.results = null;
                    imgObj.gradeResult = null;

                    completed++;
                    updateProgress();
                    // setTimeout으로 UI 갱신 기회 부여
                    setTimeout(() => processNext(idx + 1), 0);
                };
                newImg.src = url;
            }, 'image/jpeg', 0.92);
        };

        // 시작
        if (SHOW_LOADING) setTimeout(() => processNext(0), 50);
        else processNext(0);
    },


    // 분석용 이미지 데이터 (진하기 적용)
    // srcCanvas를 전달하면 우선 사용 (batch용: 이미 imgObj.intensity로 보정된 캔버스)
    getAdjustedImageData(imgObj, x, y, w, h, srcCanvas) {
        // 좌표 클램핑 — 기울기/회전 후 이미지 크기가 달라질 수 있음
        const _clampAndGet = (canvas) => {
            const cw = canvas.width, ch = canvas.height;
            const cx = Math.max(0, Math.round(x));
            const cy = Math.max(0, Math.round(y));
            const cW = Math.min(Math.round(w), cw - cx);
            const cH = Math.min(Math.round(h), ch - cy);
            if (cW <= 0 || cH <= 0) {
                // 영역이 이미지 밖 → 빈 ImageData 반환
                const off = document.createElement('canvas');
                off.width = Math.max(1, Math.round(w));
                off.height = Math.max(1, Math.round(h));
                return off.getContext('2d').getImageData(0, 0, off.width, off.height);
            }
            return canvas.getContext('2d', { willReadFrequently: true }).getImageData(cx, cy, cW, cH);
        };

        if (srcCanvas) return _clampAndGet(srcCanvas);

        const intensified = this._getIntensifiedImage(imgObj);
        if (intensified) return _clampAndGet(intensified);

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
        return _clampAndGet(this._srcCanvasCache);
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

            // 과목코드 연결선 표시
            if (roi.settings && roi.settings.linkedCodeRoiId) {
                const cIdx = imgObj.rois.findIndex(r => r._id === roi.settings.linkedCodeRoiId);
                if (cIdx >= 0) {
                    const cRoi = imgObj.rois[cIdx];
                    ctx.save();
                    ctx.strokeStyle = '#0ea5e9';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 4]);
                    ctx.beginPath();
                    ctx.moveTo(roi.x + roi.w / 2, roi.y + roi.h / 2);
                    ctx.lineTo(cRoi.x + cRoi.w / 2, cRoi.y + cRoi.h / 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
            }

            // 영역명 + 설정 라벨 (클릭 가능)
            let name = (roi.settings && roi.settings.name) || `영역 ${idx + 1}`;
            if (roi.settings && roi.settings.linkedCodeRoiId) name = `[코드연동] ${name}`;
            if (roi.settings && roi.settings.type === 'subject_code') name = `[과목코드] ${name || idx + 1}`;
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

            imgObj.results.forEach((roiResult, roiIdx) => {
                // 해당 ROI가 과목답안인지 확인 (채점 색상은 과목답안만)
                const roiSettings = imgObj.rois[roiIdx] ? imgObj.rois[roiIdx].settings : null;
                const isAnswerRoi = roiSettings && roiSettings.type === 'subject_answer';

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
                            } else if (isAnswerRoi && hasGrade && details) {
                                // 채점 색상: 과목답안 영역만 적용
                                const d = details.find(d => d.questionNumber === row.questionNumber);
                                const isCorrect = d ? d.isCorrect : true;
                                ctx.fillStyle = isCorrect ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)';
                                ctx.strokeStyle = isCorrect ? '#16a34a' : '#dc2626';
                            } else {
                                // 비답안 영역 (생년월일/수험번호/전화번호 등): 파란색
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
