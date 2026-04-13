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

        // 수기 교정 기록이 있으면 경고
        const hasCorrected = images.some(img =>
            img.results && img.results.some(res =>
                res.rows.some(r => r.corrected)
            )
        );
        if (hasCorrected) {
            if (!confirm('수기 교정한 기록이 있습니다.\n일괄 채점하면 교정 내용이 초기화됩니다.\n계속하시겠습니까?')) return;
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
            // ROI가 없거나 전체 재설정이면 템플릿 적용
            if (imgObj.rois.length === 0 || (this._forceReset && imgObj !== template)) {
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
                // 모드와 무관하게 항상 임계값 전달 (답인식 하한 등 후처리 필터 적용 위해)
                const elongatedThresholds = UI.getThresholds(s);
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
