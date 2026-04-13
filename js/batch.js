// ============================================
// batch.js - 일괄 분석/채점 처리
// ============================================

const BatchProcess = {
    init() {
        // 드롭다운 메뉴의 개별 항목에서 직접 호출하므로 별도 바인딩 불필요
    },

    run(forceResetAll = false) {
        const images = App.state.images;
        if (images.length === 0) {
            Toast.error('업로드된 이미지가 없습니다');
            return;
        }


        // 현재 선택된 이미지를 템플릿으로 (ROI가 있는 경우)
        const currentImg = App.getCurrentImage();
        const template = (currentImg && currentImg.rois.length > 0) ? currentImg : images.find(img => img.rois.length > 0);
        if (!template) {
            Toast.error('먼저 하나의 이미지에서 영역 박스를 설정해주세요');
            return;
        }

        this._forceReset = forceResetAll;
        this._template = template;

        const overlay = this.createModal(images.length);
        document.body.appendChild(overlay);

        let processed = 0;

        const processNext = () => {
            if (processed >= images.length) {
                this.finish(overlay, images.length);
                return;
            }

            const imgObj = images[processed];

            const template = this._template;
            // ROI가 없는 경우에만 템플릿 적용 (forceReset 이더라도 기존 ROI 유지)
            if (imgObj.rois.length === 0) {
                imgObj.rois = template.rois.map(r => ({
                    x: r.x, y: r.y, w: r.w, h: r.h,
                    settings: r.settings
                        ? { ...r.settings, choiceLabels: r.settings.choiceLabels ? [...r.settings.choiceLabels] : undefined, codeList: r.settings.codeList ? [...r.settings.codeList] : [] }
                        : UI.defaultSettings()
                }));
            }

            // 개별수정 유지 모드: 수기 교정된 row 백업
            const correctedBackup = {};
            if (!this._forceReset && imgObj.results) {
                imgObj.results.forEach((res, resIdx) => {
                    if (res && res.rows) {
                        res.rows.forEach(row => {
                            if (row.corrected) {
                                const key = `${resIdx}_${row.questionNumber}`;
                                correctedBackup[key] = { markedAnswer: row.markedAnswer, markedIndices: row.markedIndices };
                            }
                        });
                    }
                });
            }

            imgObj.results = [];
            imgObj.validationErrors = [];

            // 이미지별 진하기 적용 + 캔버스 생성
            const imgIntensity = imgObj.intensity || CanvasManager.intensity || 100;
            let batchCanvas = null;
            if (imgIntensity === 100) {
                batchCanvas = document.createElement('canvas');
                batchCanvas.width = imgObj.imgElement.naturalWidth || imgObj.imgElement.width;
                batchCanvas.height = imgObj.imgElement.naturalHeight || imgObj.imgElement.height;
                const bctx = batchCanvas.getContext('2d', { willReadFrequently: true });
                bctx.drawImage(imgObj.imgElement, 0, 0);
            } else {
                // 이미지별 진하기 적용
                const prevIntensity = CanvasManager.intensity;
                CanvasManager.intensity = imgIntensity;
                batchCanvas = CanvasManager._getIntensifiedImage(imgObj);
                CanvasManager.intensity = prevIntensity;
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
                const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds);

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

                imgObj.results.push({
                    roiIndex: idx + 1,
                    numQuestions: analysis.rows.length,
                    numChoices: analysis.maxCols,
                    rows: analysis.rows,
                    settings: s
                });
            });

            // 수기 교정 복원
            if (Object.keys(correctedBackup).length > 0) {
                imgObj.results.forEach((res, resIdx) => {
                    if (res && res.rows) {
                        res.rows.forEach(row => {
                            const key = `${resIdx}_${row.questionNumber}`;
                            if (correctedBackup[key]) {
                                row.markedAnswer = correctedBackup[key].markedAnswer;
                                row.markedIndices = correctedBackup[key].markedIndices;
                                row.corrected = true;
                                row._userCorrected = true;
                                row.undetected = false;
                                // blob isMarked 동기화 (오버레이 색상 반영)
                                if (row.blobs) {
                                    row.blobs.forEach((b, bi) => {
                                        b.isMarked = Array.isArray(row.markedIndices)
                                            ? row.markedIndices.includes(bi + 1)
                                            : (row.markedAnswer === bi + 1);
                                    });
                                }
                            }
                        });
                    }
                });
            }

            ImageManager.applyPhonePrefix(imgObj);

            // 과목별 채점 (과목관리 또는 ROI 직접 정답 기반)
            const hasAnswers = (App.state.subjects && App.state.subjects.length > 0) ||
                imgObj.rois.some(r => r.settings && r.settings.answerKey);
            if (hasAnswers || App.state.answerKey) {
                // ROI별 과목 정답 로드
                imgObj.rois.forEach(roi => {
                    if (roi.settings && roi.settings.type === 'subject_answer' && roi.settings.name) {
                        UI._loadAnswersFromSubject(roi);
                    }
                });
                imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
            }

            processed++;
            this.updateProgress(processed, images.length);
            setTimeout(processNext, 30);
        };

        setTimeout(processNext, 50);
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

        const processNext = () => {
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

            // ROI 적용 (ROI 없는 이미지에만 템플릿 적용, forceReset이어도 기존 ROI 유지)
            if (imgObj.rois.length === 0) {
                imgObj.rois = template.rois.map(r => ({
                    x: r.x, y: r.y, w: r.w, h: r.h,
                    settings: r.settings
                        ? { ...r.settings,
                            choiceLabels: r.settings.choiceLabels ? [...r.settings.choiceLabels] : undefined,
                            codeList: r.settings.codeList ? [...r.settings.codeList] : [] }
                        : UI.defaultSettings()
                }));
            }

            // 수기 교정 백업
            const correctedBackup = {};
            if (!forceResetAll && imgObj.results) {
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
                const analysis = OmrEngine.analyzeROI(imageData, roi.x, roi.y, orientation, numQ, numC, null, bSize, elongatedMode, elongatedThresholds);

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
            if (Object.keys(correctedBackup).length > 0) {
                imgObj.results.forEach((res, ri) => {
                    if (res && res.rows) {
                        res.rows.forEach(row => {
                            const k = `${ri}_${row.questionNumber}`;
                            if (correctedBackup[k]) {
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
                    if (roi.settings && roi.settings.type === 'subject_answer' && roi.settings.name) {
                        UI._loadAnswersFromSubject(roi);
                    }
                });
                imgObj.gradeResult = Grading.grade(imgObj.results, imgObj);
            }

            processed++;
            this.updateProgress(processed, tasks.length);
            setTimeout(processNext, 30);
        };

        setTimeout(processNext, 50);
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
                        <button class="btn btn-primary" id="batch-close" style="width:100%;">닫기</button>
                    </div>
                </div>
            </div>
        `;
        return overlay;
    },

    updateProgress(current, total) {
        const bar = document.getElementById('batch-bar');
        const progressText = document.getElementById('batch-text');
        const pct = Math.round((current / total) * 100);
        if (bar) bar.style.width = pct + '%';
        if (progressText) progressText.textContent = `${current} / ${total} 처리 중...`;
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

            if (warnings.length > 0) {
                summaryText += `\n⚠ 검증 경고 ${warnings.length}장`;
                summary.style.whiteSpace = 'pre-line';
            }

            summary.textContent = summaryText;
        }

        const closeBtn = document.getElementById('batch-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                overlay.remove();
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

        Toast.success('일괄 처리 완료');
    }
};
