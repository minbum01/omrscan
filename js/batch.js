// ============================================
// batch.js - 일괄 분석/채점 처리
// ============================================

const BatchProcess = {
    init() {
        // 드롭다운 메뉴의 개별 항목에서 직접 호출하므로 별도 바인딩 불필요
    },

    // 특정 이미지 배열에 대해서만 일괄 분석 (오류 탭 재분석용)
    // 각 이미지의 현재 ROI 사용 — 양식 적용이 이미 호출부에서 끝난 상태 가정
    runForImages(images) {
        if (!images || images.length === 0) { Toast.error('재분석할 이미지가 없습니다'); return; }
        const missingRoi = images.find(img => !img.rois || img.rois.length === 0);
        if (missingRoi) { Toast.error(`박스(ROI)가 없는 이미지: ${missingRoi.name}`); return; }

        const overlay = this.createModal(images.length);
        document.body.appendChild(overlay);

        let processed = 0;
        const processNext = async () => {
            if (processed >= images.length) {
                this.finishPartial(overlay, images.length);
                return;
            }
            const imgObj = images[processed];
            try {
                imgObj.results = [];
                imgObj.validationErrors = [];

                // Lazy Loading 복원
                if (typeof ImageManager !== 'undefined' && (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0)) {
                    const loaded = await ImageManager.ensureLoaded(imgObj);
                    if (!loaded) throw new Error('이미지 로드 실패');
                }

                const imgIntensity = imgObj.intensity || CanvasManager.intensity || 100;
                let batchCanvas = null;
                const imgEl = imgObj.imgElement;
                const bw = imgEl.naturalWidth || imgEl.width;
                const bh = imgEl.naturalHeight || imgEl.height;
                if (!bw || !bh) throw new Error('이미지 크기 0');
                if (imgIntensity !== 100) {
                    const prev = CanvasManager.intensity;
                    CanvasManager.intensity = imgIntensity;
                    batchCanvas = CanvasManager._getIntensifiedImage(imgObj);
                    CanvasManager.intensity = prev;
                }
                if (!batchCanvas) {
                    batchCanvas = document.createElement('canvas');
                    batchCanvas.width = bw; batchCanvas.height = bh;
                    batchCanvas.getContext('2d', { willReadFrequently: true }).drawImage(imgEl, 0, 0);
                }

                imgObj.rois.forEach((roi, idx) => {
                    const imageData = CanvasManager.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h, batchCanvas);
                    const s = roi.settings || UI.defaultSettings();
                    const orientation = s.orientation || 'vertical';
                    const numQ = s.numQuestions || 0;
                    const numC = s.numChoices || 0;
                    const bSize = s.bubbleSize || CanvasManager.bubbleSize || 0;
                    const elongatedMode = s.elongatedMode || false;
                    const elongatedThresholds = elongatedMode ? UI.getThresholds(s) : null;
                    const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds, roi.blobPattern || null);

                    const startNum = s.startNum || 1;
                    const expectedQ = s.numQuestions || 20;
                    const expectedC = s.numChoices || 5;
                    const regionName = s.name || `영역 ${idx + 1}`;

                    analysis.rows.forEach((row, i) => { row.questionNumber = startNum + i; });

                    const detectedQ = analysis.rows.length;
                    if (detectedQ < expectedQ) {
                        for (let i = detectedQ; i < expectedQ; i++) {
                            analysis.rows.push({
                                questionNumber: startNum + i, numChoices: 0,
                                markedAnswer: null, blobs: [], undetected: true,
                            });
                        }
                        imgObj.validationErrors.push({
                            roiIndex: idx + 1, regionName, type: 'missing_questions',
                            expected: expectedQ, detected: detectedQ, missing: expectedQ - detectedQ,
                        });
                    }
                    if (analysis.validation && analysis.validation.choiceMismatchRows && analysis.validation.choiceMismatchRows.length > 0) {
                        imgObj.validationErrors.push({
                            roiIndex: idx + 1, regionName, type: 'choice_mismatch',
                            expected: expectedC, rows: analysis.validation.choiceMismatchRows,
                        });
                    }

                    imgObj.results.push({
                        roiIndex: idx + 1, numQuestions: analysis.rows.length,
                        numChoices: analysis.maxCols, rows: analysis.rows,
                        settings: s, validation: analysis.validation,
                    });
                });

                ImageManager.applyPhonePrefix(imgObj);

                const hasAnswers = (App.state.subjects && App.state.subjects.length > 0) ||
                    imgObj.rois.some(r => r.settings && r.settings.answerKey);
                if (hasAnswers || App.state.answerKey) {
                    imgObj.rois.forEach(roi => {
                        if (roi.settings && roi.settings.type === 'subject_answer') UI._loadAnswersFromSubject(roi);
                    });
                    imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
                }
            } catch (err) {
                console.error(`[BatchPartial] 이미지 ${processed + 1}:`, err);
                imgObj.validationErrors = imgObj.validationErrors || [];
                imgObj.validationErrors.push({ type: 'process_error', message: err.message });
            }
            processed++;
            if (processed % 5 === 0 || processed >= images.length) {
                this.updateProgress(processed, images.length);
                setTimeout(processNext, 0);
            } else {
                processNext();
            }
        };
        setTimeout(processNext, 10);
    },

    finishPartial(overlay, count) {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof CanvasManager !== 'undefined') CanvasManager.render();
        if (typeof UI !== 'undefined') UI.updateRightPanel();
        if (typeof Correction !== 'undefined') {
            Correction.invalidate && Correction.invalidate();
            Correction.updateBadge && Correction.updateBadge();
        }
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        Toast.success(`오류 이미지 ${count}장 재분석 완료`);
    },

    // 현재 이미지만 분석 (기울기/진하기/박스 등 개별 조정 유지)
    runCurrentOnly() {
        const img = App.getCurrentImage();
        if (!img) { Toast.error('현재 이미지가 없습니다'); return; }
        if (!img.rois || img.rois.length === 0) { Toast.error('영역 박스를 먼저 설정하세요'); return; }
        if (typeof CanvasManager !== 'undefined' && typeof CanvasManager.runAnalysis === 'function') {
            CanvasManager.runAnalysis();
        } else {
            Toast.error('분석 엔진을 찾을 수 없습니다');
        }
    },

    run(forceResetAll = false) {
        const images = App.state.images;
        if (images.length === 0) {
            Toast.error('업로드된 이미지가 없습니다');
            return;
        }

        // 일괄채점 = 강제 리셋 — 모든 교정/확정 초기화
        images.forEach(img => {
            img._correctionConfirmed = false;
        });

        // 현재 선택된 이미지를 템플릿으로 (ROI가 있는 경우)
        const currentImg = App.getCurrentImage();
        const template = (currentImg && currentImg.rois.length > 0) ? currentImg : images.find(img => img.rois.length > 0);
        if (!template) {
            Toast.error('먼저 하나의 이미지에서 영역 박스를 설정해주세요');
            return;
        }

        this._template = template;

        const overlay = this.createModal(images.length);
        document.body.appendChild(overlay);

        let processed = 0;

        const processNext = async () => {
            if (processed >= images.length) {
                // 1차 분석 완료 → 실패 이미지 자동 재시도 → 1.5배 재분석
                this._retryFailedImages(images, overlay, () => {
                    this._retryXvImages(images, overlay, () => {
                        this.finish(overlay, images.length);
                    });
                });
                return;
            }

            const imgObj = images[processed];

            try {

            const template = this._template;
            // 템플릿 이미지가 아니면 항상 템플릿 ROI로 덮어쓰기
            // (타입 변경, 설정 변경, 박스 추가/삭제 모두 반영)
            if (imgObj !== template) {
                imgObj.rois = template.rois.map(r => ({
                    x: r.x, y: r.y, w: r.w, h: r.h,
                    settings: r.settings
                        ? { ...r.settings, choiceLabels: r.settings.choiceLabels ? [...r.settings.choiceLabels] : undefined, codeList: r.settings.codeList ? [...r.settings.codeList] : [] }
                        : UI.defaultSettings(),
                    blobPattern: r.blobPattern || null,
                }));
            }

            // 일괄채점 = 강제 리셋 — 이전 결과/교정 모두 초기화
            imgObj.results = [];
            imgObj.validationErrors = [];

            // Lazy Loading: 이미지가 해제된 상태면 복원
            if (typeof ImageManager !== 'undefined' && (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0)) {
                const loaded = await ImageManager.ensureLoaded(imgObj);
                if (!loaded) {
                    console.warn(`[Batch] 이미지 ${processed + 1}: 로드 실패 — 건너뜀`);
                    throw new Error('이미지 로드 실패');
                }
            }

            // 이미지별 진하기 적용 + 캔버스 생성
            const imgIntensity = imgObj.intensity || CanvasManager.intensity || 100;
            let batchCanvas = null;
            const imgEl = imgObj.imgElement;
            const bw = imgEl.naturalWidth || imgEl.width;
            const bh = imgEl.naturalHeight || imgEl.height;
            if (!bw || !bh) {
                console.warn(`[Batch] 이미지 ${processed + 1}: 크기 0 — 건너뜀`);
                throw new Error('이미지 크기 0 (미로드)');
            }
            if (imgIntensity !== 100) {
                const prevIntensity = CanvasManager.intensity;
                CanvasManager.intensity = imgIntensity;
                batchCanvas = CanvasManager._getIntensifiedImage(imgObj);
                CanvasManager.intensity = prevIntensity;
            }
            // intensified가 없으면 원본으로 fallback
            if (!batchCanvas) {
                batchCanvas = document.createElement('canvas');
                batchCanvas.width = bw;
                batchCanvas.height = bh;
                const bctx = batchCanvas.getContext('2d', { willReadFrequently: true });
                bctx.drawImage(imgEl, 0, 0);
            }

            imgObj.rois.forEach((roi, idx) => {
                const imageData = CanvasManager.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h, batchCanvas);
                const s = roi.settings || UI.defaultSettings();
                const orientation = s.orientation || 'vertical';
                const numQ = s.numQuestions || 0;
                const numC = s.numChoices || 0;
                const bSize = s.bubbleSize || CanvasManager.bubbleSize || 0;
                const elongatedMode = s.elongatedMode || false;
                const elongatedThresholds = elongatedMode ? UI.getThresholds(s) : null;
                OmrEngine.startImageLog(imgObj.name || imgObj._originalName, idx, s, roi.blobPattern);
                const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds, roi.blobPattern || null);
                OmrEngine.endImageLog(analysis, s);

                const startNum = s.startNum || 1;
                const expectedQ = s.numQuestions || 20;
                const expectedC = s.numChoices || 5;
                const regionName = s.name || `영역 ${idx + 1}`;

                analysis.rows.forEach((row, i) => {
                    row.questionNumber = startNum + i;
                });

                const detectedQ = analysis.rows.length;
                if (detectedQ < expectedQ) {
                    for (let i = detectedQ; i < expectedQ; i++) {
                        analysis.rows.push({
                            questionNumber: startNum + i,
                            numChoices: 0,
                            markedAnswer: null,
                            blobs: [],
                            undetected: true
                        });
                    }
                    imgObj.validationErrors.push({
                        roiIndex: idx + 1, regionName,
                        type: 'missing_questions',
                        expected: expectedQ, detected: detectedQ,
                        missing: expectedQ - detectedQ
                    });
                }

                // 선택지 수 불일치 점검 (analyzeROI validation 결과)
                if (analysis.validation && analysis.validation.choiceMismatchRows && analysis.validation.choiceMismatchRows.length > 0) {
                    imgObj.validationErrors.push({
                        roiIndex: idx + 1, regionName,
                        type: 'choice_mismatch',
                        expected: expectedC,
                        rows: analysis.validation.choiceMismatchRows,
                    });
                }

                imgObj.results.push({
                    roiIndex: idx + 1,
                    numQuestions: analysis.rows.length,
                    numChoices: analysis.maxCols,
                    rows: analysis.rows,
                    settings: s,
                    validation: analysis.validation,
                });
            });

            ImageManager.applyPhonePrefix(imgObj);

            // 과목별 채점 (과목관리 또는 ROI 직접 정답 기반)
            const hasAnswers = (App.state.subjects && App.state.subjects.length > 0) ||
                imgObj.rois.some(r => r.settings && r.settings.answerKey);
            if (hasAnswers || App.state.answerKey) {
                // ROI별 과목 정답 로드
                imgObj.rois.forEach(roi => {
                    if (roi.settings && roi.settings.type === 'subject_answer') {
                        UI._loadAnswersFromSubject(roi);
                    }
                });
                imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
            }

            } catch (err) {
                console.error(`[Batch] 이미지 ${processed + 1} 처리 오류:`, err);
                imgObj.validationErrors = imgObj.validationErrors || [];
                imgObj.validationErrors.push({ type: 'process_error', message: err.message });
            }

            processed++;
            // 5장마다 UI 갱신 (매장 하면 렉)
            if (processed % 5 === 0 || processed >= images.length) {
                this.updateProgress(processed, images.length);
                setTimeout(processNext, 0);
            } else {
                processNext();
            }
        };

        setTimeout(processNext, 10);
    },

    // ─────────────────────────────────────────
    // 전체 교시 일괄 처리
    // ─────────────────────────────────────────
    runAllPeriods(forceResetAll = false) {
        const periods = App.state.periods || [];

        // 단일 교시이면 일반 run() 과 동일
        if (periods.length <= 1) {
            this.run(forceResetAll);
            return;
        }

        // 전체 (period, imgObj) 쌍 수집
        const tasks = [];
        periods.forEach(p => {
            (p.images || []).forEach(img => tasks.push({ period: p, imgObj: img }));
        });

        if (tasks.length === 0) {
            Toast.error('처리할 이미지가 없습니다');
            return;
        }

        // 교시별 ROI 템플릿 (ROI 있는 첫 번째 이미지)
        const templateByPeriod = {};
        periods.forEach(p => {
            const t = (p.images || []).find(img => img.rois && img.rois.length > 0);
            if (t) templateByPeriod[p.id] = t;
        });


        const overlay = this.createModal(tasks.length);
        const txt = overlay.querySelector('#batch-text');
        if (txt) txt.textContent = `0 / ${tasks.length} 처리 중 (전체 ${periods.length}교시)...`;
        document.body.appendChild(overlay);

        let processed = 0;

        // 처리 전 App.state 원본 보존
        const savedPeriodId  = App.state.currentPeriodId;
        const savedAnswerKey = App.state.answerKey;
        const savedSubjects  = App.state.subjects;

        const processNext = async () => {
            if (processed >= tasks.length) {
                // 원래 교시 복원
                App.state.currentPeriodId = savedPeriodId;
                App.state.answerKey       = savedAnswerKey;
                App.state.subjects        = savedSubjects;
                const cur = App.getCurrentPeriod();
                if (cur) App.state.images = cur.images;
                if (typeof PeriodManager !== 'undefined') PeriodManager.render();
                this._finishAllPeriods(overlay, tasks.length, periods.length);
                return;
            }

            const { period, imgObj } = tasks[processed];
            const template = templateByPeriod[period.id];

            if (!template) {
                // 이 교시에 ROI 없음 → 스킵
                processed++;
                this.updateProgress(processed, tasks.length);
                setTimeout(processNext, 0);
                return;
            }

            // ROI 동기화: 템플릿 이미지가 아니면 항상 덮어쓰기
            if (imgObj !== template) {
                imgObj.rois = template.rois.map(r => ({
                    x: r.x, y: r.y, w: r.w, h: r.h,
                    settings: r.settings
                        ? { ...r.settings,
                            choiceLabels: r.settings.choiceLabels ? [...r.settings.choiceLabels] : undefined,
                            codeList: r.settings.codeList ? [...r.settings.codeList] : [] }
                        : UI.defaultSettings(),
                    blobPattern: r.blobPattern || null,
                }));
            }

            // 수기 교정 백업 (항상 수행)
            const correctedBackup = {};
            if (imgObj.results) {
                imgObj.results.forEach((res, ri) => {
                    if (res && res.rows) {
                        res.rows.forEach(row => {
                            if (row.corrected) correctedBackup[`${ri}_${row.questionNumber}`] = { markedAnswer: row.markedAnswer, markedIndices: row.markedIndices };
                        });
                    }
                });
            }

            imgObj.results = [];
            imgObj.validationErrors = [];

            // Lazy Loading: 이미지 로드 보장
            if (typeof ImageManager !== 'undefined' && (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0)) {
                const loaded = await ImageManager.ensureLoaded(imgObj);
                if (!loaded) { processed++; setTimeout(processNext, 0); return; }
            }

            // 캔버스
            const imgIntensity = imgObj.intensity || CanvasManager.intensity || 100;
            let batchCanvas;
            if (imgIntensity === 100) {
                batchCanvas = document.createElement('canvas');
                batchCanvas.width  = imgObj.imgElement.naturalWidth  || imgObj.imgElement.width;
                batchCanvas.height = imgObj.imgElement.naturalHeight || imgObj.imgElement.height;
                batchCanvas.getContext('2d', { willReadFrequently: true }).drawImage(imgObj.imgElement, 0, 0);
            } else {
                const prevI = CanvasManager.intensity;
                CanvasManager.intensity = imgIntensity;
                batchCanvas = CanvasManager._getIntensifiedImage(imgObj);
                CanvasManager.intensity = prevI;
            }

            // ROI 분석
            imgObj.rois.forEach((roi, idx) => {
                const imageData = CanvasManager.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h, batchCanvas);
                const s = roi.settings || UI.defaultSettings();
                const orientation = s.orientation || 'vertical';
                const numQ = s.numQuestions || 0;
                const numC = s.numChoices || 0;
                const bSize = s.bubbleSize || CanvasManager.bubbleSize || 0;
                const elongatedMode = s.elongatedMode || false;
                const elongatedThresholds = elongatedMode ? UI.getThresholds(s) : null;
                OmrEngine.startImageLog(imgObj.name || imgObj._originalName, idx, s, roi.blobPattern);
                const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds, roi.blobPattern || null);
                OmrEngine.endImageLog(analysis, s);

                const startNum  = s.startNum   || 1;
                const expectedQ = s.numQuestions || 20;
                analysis.rows.forEach((row, i) => { row.questionNumber = startNum + i; });

                if (analysis.rows.length < expectedQ) {
                    for (let i = analysis.rows.length; i < expectedQ; i++) {
                        analysis.rows.push({ questionNumber: startNum + i, numChoices: 0, markedAnswer: null, blobs: [], undetected: true });
                    }
                    imgObj.validationErrors.push({
                        roiIndex: idx + 1, regionName: s.name || `영역 ${idx + 1}`,
                        type: 'missing_questions', expected: expectedQ, detected: analysis.rows.length - (expectedQ - analysis.rows.length), missing: expectedQ - analysis.rows.length
                    });
                }
                imgObj.results.push({ roiIndex: idx + 1, numQuestions: analysis.rows.length, numChoices: analysis.maxCols, rows: analysis.rows, settings: s });
            });

            // 수기 교정 복원
            // run(false): 항상 복원
            // run(true): OMR이 미인식(undetected) 또는 빈 답(markedAnswer===null)일 때만 복원
            if (Object.keys(correctedBackup).length > 0) {
                imgObj.results.forEach((res, ri) => {
                    if (res && res.rows) {
                        res.rows.forEach(row => {
                            const k = `${ri}_${row.questionNumber}`;
                            if (correctedBackup[k]) {
                                const shouldRestore = !forceResetAll
                                    || row.undetected
                                    || row.markedAnswer === null;
                                if (shouldRestore) {
                                    row.markedAnswer  = correctedBackup[k].markedAnswer;
                                    row.markedIndices = correctedBackup[k].markedIndices;
                                    row.corrected     = true;
                                    row._userCorrected = true;
                                    row.undetected    = false;
                                    if (row.blobs) {
                                        row.blobs.forEach((b, bi) => {
                                            b.isMarked = Array.isArray(row.markedIndices)
                                                ? row.markedIndices.includes(bi + 1)
                                                : (row.markedAnswer === bi + 1);
                                        });
                                    }
                                }
                            }
                        });
                    }
                });
            }

            ImageManager.applyPhonePrefix(imgObj);

            // 채점: 이 교시의 answerKey 임시 적용 (subjects 는 세션 전역 그대로 사용)
            const hasAnswers = (App.state.subjects && App.state.subjects.length > 0) ||
                imgObj.rois.some(r => r.settings && r.settings.answerKey);
            if (hasAnswers || period.answerKey) {
                App.state.answerKey = period.answerKey || null;
                imgObj.rois.forEach(roi => {
                    if (roi.settings && roi.settings.type === 'subject_answer') {
                        UI._loadAnswersFromSubject(roi);
                    }
                });
                imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
            }

            processed++;
            if (processed % 5 === 0 || processed >= tasks.length) {
                this.updateProgress(processed, tasks.length);
                setTimeout(processNext, 0);
            } else {
                processNext();
            }
        };

        setTimeout(processNext, 10);
    },

    _finishAllPeriods(overlay, total, periodCount) {
        const progressText = document.getElementById('batch-text');
        const done         = document.getElementById('batch-done');
        const summary      = document.getElementById('batch-summary');
        const bar          = document.getElementById('batch-bar');

        if (bar) bar.style.width = '100%';
        if (progressText) progressText.textContent = `${total}장 완료 (${periodCount}교시)`;
        if (done) done.style.display = 'block';

        if (summary) {
            let gradedCount = 0, totalScore = 0;
            (App.state.periods || []).forEach(p => {
                (p.images || []).forEach(img => {
                    if (img.gradeResult) { gradedCount++; totalScore += img.gradeResult.score || 0; }
                });
            });
            const avg = gradedCount > 0 ? (totalScore / gradedCount).toFixed(1) : 0;
            summary.textContent = gradedCount > 0
                ? `전체 ${periodCount}교시 채점 완료 ${gradedCount}장 · 평균 ${avg}점`
                : `전체 ${periodCount}교시 분석 완료 ${total}장 (정답 미입력)`;
        }

        const closeBtn = document.getElementById('batch-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                overlay.remove();
                ImageManager.invalidateStatus(); // 전체 캐시 무효화
                ImageManager.updateList();
                CanvasManager.render();
                UI.updateRightPanel();
                const imgObj = App.getCurrentImage();
                if (imgObj && imgObj.gradeResult) {
                    App.state.rightTab = 'results';
                    App.updateStep(App.STEPS.GRADE);
                } else if (imgObj && imgObj.results) {
                    App.state.rightTab = 'results';
                    App.updateStep(App.STEPS.ANALYZE);
                }
            });
        }
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        Toast.success(`전체 ${periodCount}교시 일괄 처리 완료`);
    },

    createModal(total) {
        const overlay = document.createElement('div');
        overlay.id = 'batch-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:400px;">
                <div class="modal-header"><h2>일괄 처리</h2></div>
                <div class="modal-body" style="text-align:center;">
                    <div class="progress-bar-track" style="margin-bottom:12px;">
                        <div class="progress-bar-fill" id="batch-bar" style="width:0%"></div>
                    </div>
                    <p id="batch-text" style="font-size:13px; color:var(--text-secondary);">0 / ${total} 처리 중...</p>
                    <div id="batch-done" style="display:none; margin-top:16px;">
                        <p id="batch-summary" style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;"></p>
                        <button class="btn" id="batch-save-log" style="width:100%; margin-bottom:6px; display:none;">분석 로그 저장</button>
                        <button class="btn btn-primary" id="batch-close" style="width:100%;">닫기</button>
                    </div>
                </div>
            </div>
        `;
        return overlay;
    },

    _progressStartTime: 0,
    updateProgress(current, total) {
        if (!this._progressStartTime || current <= 5) this._progressStartTime = Date.now() - (current * 50);
        const bar = document.getElementById('batch-bar');
        const progressText = document.getElementById('batch-text');
        const pct = Math.round((current / total) * 100);
        if (bar) bar.style.width = pct + '%';

        let timeInfo = '';
        if (current > 2 && this._progressStartTime) {
            const elapsed = (Date.now() - this._progressStartTime) / 1000;
            const perItem = elapsed / current;
            const remaining = perItem * (total - current);
            if (remaining > 60) timeInfo = ` (약 ${Math.ceil(remaining / 60)}분 남음)`;
            else if (remaining > 5) timeInfo = ` (약 ${Math.round(remaining)}초 남음)`;
        }
        if (progressText) progressText.textContent = `${current} / ${total} 처리 중...${timeInfo}`;
    },

    // ─────────────────────────────────────────
    // 실패 이미지 자동 재시도 (진하기 + 미세 회전)
    // null이 있는 ROI 중 "인식 오류 null"만 대상 (진짜 공란 제외)
    // ─────────────────────────────────────────
    _retryFailedImages(images, overlay, onComplete) {
        const rlog = (...args) => {
            if (!OmrEngine._fileLog) return; // 분석로그 OFF면 아무것도 안 함
            const msg = args.join(' ');
            OmrEngine._fileLogBuffer.push(msg);
        };

        // ── 1단계: 재시도 대상 수집 ──
        // 각 이미지의 각 ROI에서 "인식 오류 null"이 있는지 판별
        const failed = []; // { imgObj, imgIdx, failedRois: [{ ri, errorNullCount }] }

        images.forEach((imgObj, imgIdx) => {
            if (!imgObj.results) return;
            const failedRois = [];

            imgObj.results.forEach((res, ri) => {
                const roi = imgObj.rois[ri];
                if (!roi || !roi.settings) return;
                const rows = res.rows || [];
                if (rows.length === 0) return;

                // null인 문항 분류: 진짜 공란 vs 인식 오류
                let errorNullCount = 0;
                let realBlankCount = 0;
                const hasNaN = rows.some(r => r.blobs && r.blobs.some(b => isNaN(b.cx) || isNaN(b.cy)));

                rows.forEach(r => {
                    if (r.markedAnswer !== null || r.corrected || r.undetected) return;
                    if (!r.blobs || r.blobs.length === 0) { errorNullCount++; return; }

                    const fills = r.blobs.map(b => b.centerFillRatio || 0);
                    const maxFill = Math.max(...fills);
                    const sorted = [...fills].sort((a, b) => b - a);
                    const gap = sorted.length >= 2 ? sorted[0] - sorted[1] : 0;

                    if (maxFill < 0.35 && gap < 0.08) {
                        realBlankCount++; // 진짜 공란
                    } else {
                        errorNullCount++; // 인식 오류
                    }
                });

                // missing_questions도 인식 오류
                if (imgObj.validationErrors) {
                    imgObj.validationErrors.forEach(e => {
                        if (e.type === 'missing_questions' && (e.roiIndex || 1) - 1 === ri) {
                            errorNullCount += e.missing || 0;
                        }
                    });
                }

                // 블롭 간격 불안정 검출 — 양식 기대 간격 대비 ±20% 이상 편차
                let unstableGap = false;
                const bp = roi.blobPattern;
                if (bp && (bp.colSpacing || bp.rowSpacing)) {
                    const isVert = roi.settings.orientation === 'vertical';
                    const expectedGap = isVert ? (bp.colSpacing || bp.rowSpacing) : (bp.rowSpacing || bp.colSpacing);
                    if (expectedGap > 0) {
                        rows.forEach(r => {
                            if (!r.blobs || r.blobs.length < 2) return;
                            for (let bi = 1; bi < r.blobs.length; bi++) {
                                const dx = Math.abs(r.blobs[bi].cx - r.blobs[bi-1].cx);
                                const dy = Math.abs(r.blobs[bi].cy - r.blobs[bi-1].cy);
                                const actualGap = isVert ? dx : dy;
                                if (actualGap > 0 && Math.abs(actualGap - expectedGap) / expectedGap > 0.20) {
                                    unstableGap = true;
                                }
                            }
                        });
                    }
                }

                if (errorNullCount > 0 || hasNaN || unstableGap) {
                    failedRois.push({ ri, errorNullCount, realBlankCount, hasNaN, unstableGap });
                }
            });

            if (failedRois.length > 0) {
                failed.push({ imgObj, imgIdx, failedRois });
            }
        });

        // 로그
        rlog(`\n${'═'.repeat(80)}`);
        rlog(`[Retry] 재시도 대상: 전체 ${images.length}장 중 ${failed.length}장`);
        failed.forEach(({ imgObj, failedRois }) => {
            const details = failedRois.map(f => `ROI${f.ri+1}(오류null=${f.errorNullCount} 공란=${f.realBlankCount} NaN=${f.hasNaN} 간격불안정=${f.unstableGap || false})`).join(', ');
            rlog(`  대상: ${imgObj.name} — ${details}`);
        });
        images.forEach((imgObj, imgIdx) => {
            if (failed.some(f => f.imgIdx === imgIdx)) return;
            if (!imgObj.results) return;
            const nullTotal = imgObj.results.reduce((s, res) => s + res.rows.filter(r => r.markedAnswer === null && !r.corrected && !r.undetected).length, 0);
            if (nullTotal > 0) rlog(`  패스: ${imgObj.name} — null ${nullTotal}개 (전부 진짜 공란)`);
        });
        rlog('─'.repeat(80));

        if (failed.length === 0) { onComplete(); return; }

        // ── 2단계: 재시도 실행 ──
        this._retryStartTime = Date.now();
        const progressText = document.getElementById('batch-text');
        const bar = document.getElementById('batch-bar');
        if (progressText) progressText.textContent = `오류 문항 추가 검증중... (0/${failed.length})`;
        if (bar) bar.style.width = '0%';

        const baseIntensity = CanvasManager.intensity || 115;

        // 8가지 조합
        const retryCombos = [
            [100, 0],       // 1: +100%
            [100, 0.5],     // 2: +100% +0.5°
            [100, 1.0],     // 3: +100% +1.0°
            [100, -0.5],    // 4: +100% -0.5°
            [100, -1.0],    // 5: +100% -1.0°
            [200, 0],       // 6: +200%
            [200, 0.5],     // 7: +200% +0.5°
            [200, -0.5],    // 8: +200% -0.5°
        ];

        let retryIdx = 0;

        const processNextRetry = async () => {
            if (retryIdx >= failed.length) { onComplete(); return; }

            const { imgObj, failedRois } = failed[retryIdx];
            const imgIntensity = imgObj.intensity || baseIntensity;

            // Lazy Loading 복원
            if (typeof ImageManager !== 'undefined' && (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0)) {
                await ImageManager.ensureLoaded(imgObj);
            }
            if (!imgObj.imgElement || imgObj.imgElement.width === 0) {
                retryIdx++;
                setTimeout(processNextRetry, 0);
                return;
            }

            const imgEl = imgObj.imgElement;
            const bw = imgEl.naturalWidth || imgEl.width;
            const bh = imgEl.naturalHeight || imgEl.height;
            const failedRoiIndices = failedRois.map(f => f.ri);

            rlog(`[Retry] ${imgObj.name}: ROI=[${failedRoiIndices.map(i=>i+1).join(',')}] 기본intensity=${imgIntensity}`);

            let solved = false;

            for (let ci = 0; ci < retryCombos.length && !solved; ci++) {
                const [intensityOffset, rotation] = retryCombos[ci];
                const tryIntensity = imgIntensity + intensityOffset;

                // 진하기 적용
                const prevI = CanvasManager.intensity;
                CanvasManager.intensity = tryIntensity;
                let srcCanvas = CanvasManager._getIntensifiedImage(imgObj);
                CanvasManager.intensity = prevI;

                if (!srcCanvas) {
                    srcCanvas = document.createElement('canvas');
                    srcCanvas.width = bw; srcCanvas.height = bh;
                    srcCanvas.getContext('2d', { willReadFrequently: true }).drawImage(imgEl, 0, 0);
                }

                // 회전 적용
                let analyzeCanvas = srcCanvas;
                if (rotation !== 0) {
                    const rotCanvas = document.createElement('canvas');
                    rotCanvas.width = bw; rotCanvas.height = bh;
                    const rctx = rotCanvas.getContext('2d', { willReadFrequently: true });
                    rctx.fillStyle = '#FFFFFF';
                    rctx.fillRect(0, 0, bw, bh);
                    rctx.translate(bw / 2, bh / 2);
                    rctx.rotate(rotation * Math.PI / 180);
                    rctx.drawImage(srcCanvas, -bw / 2, -bh / 2);
                    analyzeCanvas = rotCanvas;
                }

                // 전체 ROI 재분석 (실패 ROI만이 아니라 전체 — 회전은 이미지 전체에 영향)
                let totalNull = 0;
                const newAllResults = [];

                for (let ri = 0; ri < imgObj.rois.length; ri++) {
                    const roi = imgObj.rois[ri];
                    if (!roi || !roi.settings) continue;
                    const s = roi.settings;

                    const imageData = CanvasManager.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h, analyzeCanvas);
                    const orientation = s.orientation || 'vertical';
                    const numQ = s.numQuestions || 0;
                    const numC = s.numChoices || 0;
                    const bSize = s.bubbleSize || CanvasManager.bubbleSize || 0;
                    const elongatedMode = s.elongatedMode || false;
                    const elongatedThresholds = elongatedMode ? UI.getThresholds(s) : null;

                    OmrEngine.startImageLog(imgObj.name + ` [재시도${ci+1}: +${intensityOffset}% ${rotation > 0 ? '+' : ''}${rotation}°]`, ri, s, roi.blobPattern);
                    const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds, roi.blobPattern || null);
                    OmrEngine.endImageLog(analysis, s);

                    const startNum = s.startNum || 1;
                    analysis.rows.forEach((row, i) => { row.questionNumber = startNum + i; });

                    const nullCount = analysis.rows.filter(r => r.markedAnswer === null).length;
                    totalNull += nullCount;

                    newAllResults.push({
                        ri, analysis,
                        roiResult: {
                            roiIndex: ri + 1,
                            numQuestions: analysis.rows.length,
                            numChoices: analysis.maxCols,
                            rows: analysis.rows,
                            settings: s,
                            validation: analysis.validation,
                            _retryInfo: { intensityOffset, rotation },
                        }
                    });
                }

                // 이전 결과 대비 비교
                const prevNull = imgObj.results.reduce((s, res) => s + (res.rows || []).filter(r => r.markedAnswer === null && !r.corrected && !r.undetected).length, 0);

                rlog(`  시도${ci+1}: +${intensityOffset}% ${rotation}° → null=${totalNull}(이전${prevNull})`);

                // 채택 조건: null 0개 (완전 인식) 또는 null이 줄었으면 채택
                if (totalNull === 0 || (totalNull < prevNull)) {
                    solved = true;
                    newAllResults.forEach(({ ri, roiResult }) => { imgObj.results[ri] = roiResult; });
                    imgObj.validationErrors = [];
                    // 진하기 갱신 (슬라이더 반영)
                    imgObj.intensity = tryIntensity;

                    ImageManager.applyPhonePrefix(imgObj);
                    const hasAnswers = (App.state.subjects && App.state.subjects.length > 0) ||
                        imgObj.rois.some(r => r.settings && r.settings.answerKey);
                    if (hasAnswers || App.state.answerKey) {
                        imgObj.rois.forEach(roi => {
                            if (roi.settings && roi.settings.type === 'subject_answer') UI._loadAnswersFromSubject(roi);
                        });
                        imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
                    }

                    rlog(`  → 완전 인식! 결과 채택`);
                }
            }

            if (!solved) {
                rlog(`  → ${retryCombos.length}회 시도 후 미해결`);
            }

            retryIdx++;
            let retryTime = '';
            if (retryIdx > 1 && this._retryStartTime) {
                const elapsed = (Date.now() - this._retryStartTime) / 1000;
                const remaining = (elapsed / retryIdx) * (failed.length - retryIdx);
                if (remaining > 60) retryTime = ` (약 ${Math.ceil(remaining / 60)}분 남음)`;
                else if (remaining > 5) retryTime = ` (약 ${Math.round(remaining)}초 남음)`;
            }
            if (progressText) progressText.textContent = `오류 문항 추가 검증중... (${retryIdx}/${failed.length})${retryTime}`;
            if (bar) bar.style.width = Math.round((retryIdx / failed.length) * 100) + '%';

            if (retryIdx % 3 === 0 || retryIdx >= failed.length) {
                setTimeout(processNextRetry, 0);
            } else {
                processNextRetry();
            }
        };

        setTimeout(processNextRetry, 50);
    },

    // ─────────────────────────────────────────
    // 1.5배 자동교정 이미지 재분석 (진하기 +100%)
    // retry 완료 후 실행. _xvAutoCorrected가 있는 ROI만 대상.
    // ─────────────────────────────────────────
    _retryXvImages(images, overlay, onComplete) {
        // 1.5배 자동교정 항목이 있는 이미지 수집
        const xvImages = [];
        images.forEach((imgObj, imgIdx) => {
            if (!imgObj.results) return;
            const hasXv = imgObj.results.some(res =>
                res.rows.some(r => r._xvAutoCorrected)
            );
            if (hasXv) xvImages.push({ imgObj, imgIdx });
        });

        if (xvImages.length === 0) { onComplete(); return; }

        const progressText = document.getElementById('batch-text');
        const bar = document.getElementById('batch-bar');
        if (progressText) progressText.textContent = `1.5배 항목 재검증중... (0/${xvImages.length})`;
        if (bar) bar.style.width = '0%';

        const baseIntensity = CanvasManager.intensity || 115;
        const xvStartTime = Date.now();
        let xvIdx = 0;
        let improved = 0;

        const processNextXv = async () => {
            if (xvIdx >= xvImages.length) {
                if (improved > 0 && typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
                onComplete();
                return;
            }

            const { imgObj } = xvImages[xvIdx];
            const imgIntensity = imgObj.intensity || baseIntensity;
            const tryIntensity = imgIntensity + 100; // +100%

            // Lazy Loading
            if (typeof ImageManager !== 'undefined' && (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0)) {
                await ImageManager.ensureLoaded(imgObj);
            }
            if (!imgObj.imgElement || imgObj.imgElement.width === 0) {
                xvIdx++;
                setTimeout(processNextXv, 0);
                return;
            }

            const imgEl = imgObj.imgElement;
            const bw = imgEl.naturalWidth || imgEl.width;
            const bh = imgEl.naturalHeight || imgEl.height;

            // 진하기 +100% 캔버스
            const prevI = CanvasManager.intensity;
            CanvasManager.intensity = tryIntensity;
            let srcCanvas = CanvasManager._getIntensifiedImage(imgObj);
            CanvasManager.intensity = prevI;

            if (!srcCanvas) {
                srcCanvas = document.createElement('canvas');
                srcCanvas.width = bw; srcCanvas.height = bh;
                srcCanvas.getContext('2d', { willReadFrequently: true }).drawImage(imgEl, 0, 0);
            }

            // 1.5배 자동교정이 있는 ROI만 재분석
            let thisImproved = false;
            imgObj.results.forEach((res, ri) => {
                const hasXvRows = res.rows.some(r => r._xvAutoCorrected);
                if (!hasXvRows) return;

                const roi = imgObj.rois[ri];
                if (!roi || !roi.settings) return;
                const s = roi.settings;

                const imageData = CanvasManager.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h, srcCanvas);
                const orientation = s.orientation || 'vertical';
                const numQ = s.numQuestions || 0;
                const numC = s.numChoices || 0;
                const bSize = s.bubbleSize || CanvasManager.bubbleSize || 0;
                const elongatedMode = s.elongatedMode || false;
                const elongatedThresholds = elongatedMode ? UI.getThresholds(s) : null;

                const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds, roi.blobPattern || null);

                const startNum = s.startNum || 1;
                analysis.rows.forEach((row, i) => { row.questionNumber = startNum + i; });

                // 비교: 이전 1.5배 자동교정 수 vs 새 결과
                const prevXvCount = res.rows.filter(r => r._xvAutoCorrected).length;
                const newXvCount = analysis.rows.filter(r => r._xvAutoCorrected).length;

                if (analysis.rows.length >= numQ && newXvCount < prevXvCount) {
                    // 개선됨 → 채택
                    imgObj.results[ri] = {
                        roiIndex: ri + 1,
                        numQuestions: analysis.rows.length,
                        numChoices: analysis.maxCols,
                        rows: analysis.rows,
                        settings: s,
                        validation: analysis.validation,
                        _retryInfo: { intensityOffset: 100, rotation: 0, type: 'xv_retry' },
                    };
                    thisImproved = true;
                }
            });

            if (thisImproved) {
                improved++;
                // 진하기도 +100%로 갱신 (슬라이더 반영)
                imgObj.intensity = tryIntensity;
                // 재채점
                ImageManager.applyPhonePrefix(imgObj);
                const hasAnswers = (App.state.subjects && App.state.subjects.length > 0) ||
                    imgObj.rois.some(r => r.settings && r.settings.answerKey);
                if (hasAnswers || App.state.answerKey) {
                    imgObj.rois.forEach(roi => {
                        if (roi.settings && roi.settings.type === 'subject_answer') UI._loadAnswersFromSubject(roi);
                    });
                    imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
                }
            }

            xvIdx++;
            // 진행률 + 남은 시간
            let timeInfo = '';
            if (xvIdx > 1) {
                const elapsed = (Date.now() - xvStartTime) / 1000;
                const remaining = (elapsed / xvIdx) * (xvImages.length - xvIdx);
                if (remaining > 60) timeInfo = ` (약 ${Math.ceil(remaining / 60)}분 남음)`;
                else if (remaining > 5) timeInfo = ` (약 ${Math.round(remaining)}초 남음)`;
            }
            if (progressText) progressText.textContent = `1.5배 항목 재검증중... (${xvIdx}/${xvImages.length})${timeInfo}`;
            if (bar) bar.style.width = Math.round((xvIdx / xvImages.length) * 100) + '%';

            if (xvIdx % 5 === 0 || xvIdx >= xvImages.length) {
                setTimeout(processNextXv, 0);
            } else {
                processNextXv();
            }
        };

        setTimeout(processNextXv, 50);
    },

    // BUG9 fix: 변수명 충돌 해결
    finish(overlay, total) {
        const progressText = document.getElementById('batch-text');
        const done = document.getElementById('batch-done');
        const summary = document.getElementById('batch-summary');
        const bar = document.getElementById('batch-bar');

        if (bar) bar.style.width = '100%';
        if (progressText) progressText.textContent = `${total} / ${total} 완료`;
        if (done) done.style.display = 'block';

        if (summary) {
            const warnings = App.state.images.filter(i => i.validationErrors && i.validationErrors.length > 0);
            let summaryText = '';

            if (App.state.answerKey) {
                const graded = App.state.images.filter(i => i.gradeResult);
                const scores = graded.map(i => i.gradeResult.score);
                const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;
                summaryText = `채점 완료 ${graded.length}장 · 평균 ${avg}점`;
            } else {
                summaryText = `분석 완료 ${total}장 (정답 미입력)`;
            }

            // 재시도로 해결된 이미지 수
            const retried = App.state.images.filter(i => i.results && i.results.some(r => r._retryInfo && r._retryInfo.type !== 'xv_retry'));
            const xvRetried = App.state.images.filter(i => i.results && i.results.some(r => r._retryInfo && r._retryInfo.type === 'xv_retry'));
            if (retried.length > 0) {
                summaryText += `\n✓ 추가 검증으로 ${retried.length}장 복구됨`;
            }
            if (xvRetried.length > 0) {
                summaryText += `\n✓ 1.5배 재검증으로 ${xvRetried.length}장 개선됨`;
            }
            if (warnings.length > 0) {
                summaryText += `\n⚠ 검증 경고 ${warnings.length}장`;
            }
            if (retried.length > 0 || warnings.length > 0) {
                summary.style.whiteSpace = 'pre-line';
            }

            summary.textContent = summaryText;
        }

        // 분석 로그가 수집된 상태면 저장 버튼 표시
        const logBtn = document.getElementById('batch-save-log');
        if (logBtn && OmrEngine._fileLog && OmrEngine._fileLogBuffer.length > 0) {
            logBtn.style.display = '';
            logBtn.addEventListener('click', async () => {
                if (window.electronAPI && window.electronAPI.saveLog) {
                    const result = await window.electronAPI.saveLog(OmrEngine.exportLog());
                    if (result.success) Toast.success(`로그 저장 완료`);
                    else Toast.error('로그 저장 실패');
                } else {
                    const blob = new Blob([OmrEngine.exportLog()], { type: 'text/plain' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `분석로그_${new Date().toISOString().slice(0, 10)}.txt`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                }
            });
        }

        const closeBtn = document.getElementById('batch-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                overlay.remove();
                ImageManager.invalidateStatus();
                ImageManager.updateList();
                CanvasManager.render();
                UI.updateRightPanel();
                // BUG3 fix: 현재 이미지 상태에 맞게 스텝+탭 전환
                const imgObj = App.getCurrentImage();
                if (imgObj && imgObj.gradeResult) {
                    App.state.rightTab = 'results';
                    App.updateStep(App.STEPS.GRADE);
                } else if (imgObj && imgObj.results) {
                    App.state.rightTab = 'results';
                    App.updateStep(App.STEPS.ANALYZE);
                }
            });
        }

        if (typeof Correction !== 'undefined') {
            Correction.invalidate && Correction.invalidate();
            Correction.updateBadge && Correction.updateBadge();
        }
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
        Toast.success('일괄 처리 완료');
    }
};
