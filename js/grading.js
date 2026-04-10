// ============================================
// grading.js - 정답 입력 모달 및 채점
// ============================================

const Grading = {
    init() {
        App.els.btnAnswerKey.addEventListener('click', () => this.openModal());
    },

    openModal() {
        const existing = document.getElementById('answer-modal');
        if (existing) existing.remove();

        const ak = App.state.answerKey;
        const dq = ak ? ak.numQuestions : 20;
        const dc = ak ? ak.numChoices : 5;
        const ds = ak ? ak.scorePerQuestion : 5;

        // 기존 정답을 문자열로 변환
        let existingAnswers = '';
        if (ak && ak.answers) {
            existingAnswers = ak.answers.map(a => a || '').join('');
        }

        const overlay = document.createElement('div');
        overlay.id = 'answer-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:480px;">
                <div class="modal-header">
                    <h2>정답 입력</h2>
                    <p>숫자를 연속으로 입력하세요. (예: 31423...)</p>
                </div>
                <div class="modal-body">
                    <div style="display:flex; gap:12px; margin-bottom:16px;">
                        <div style="flex:1;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">문항 수</label>
                            <input type="number" id="ak-questions" value="${dq}" min="1" max="100"
                                style="width:100%; padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">지선다 수</label>
                            <input type="number" id="ak-choices" value="${dc}" min="2" max="10"
                                style="width:100%; padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">문항당 배점</label>
                            <input type="number" id="ak-score" value="${ds}" min="1" max="100"
                                style="width:100%; padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                        </div>
                    </div>

                    <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">정답 (숫자 연속 입력)</label>
                    <input type="text" id="ak-input" value="${existingAnswers}" placeholder="31423142..."
                        style="width:100%; padding:10px 12px; border:2px solid var(--blue); border-radius:8px; font-size:18px; font-weight:700; font-family:monospace; letter-spacing:4px;"
                        autofocus>
                    <div id="ak-preview" style="margin-top:12px;"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn" id="ak-cancel">취소</button>
                    <button class="btn btn-danger" id="ak-clear">정답 초기화</button>
                    <button class="btn btn-primary" id="ak-save">저장</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const inputEl = document.getElementById('ak-input');
        const previewEl = document.getElementById('ak-preview');

        // 실시간 미리보기
        const updatePreview = () => {
            const numQ = parseInt(document.getElementById('ak-questions').value) || 20;
            const val = inputEl.value.trim();
            let html = '<div style="display:grid; grid-template-columns:repeat(10, 1fr); gap:3px;">';
            for (let i = 0; i < numQ; i++) {
                const ans = val[i] || '';
                const filled = ans !== '';
                html += `<div style="text-align:center; padding:4px 2px; border-radius:4px; font-size:11px;
                    background:${filled ? 'var(--blue-light)' : 'var(--bg-input)'}; color:${filled ? 'var(--blue)' : 'var(--text-muted)'};">
                    <div style="font-size:9px; color:var(--text-muted);">${i+1}</div>
                    <div style="font-weight:700;">${ans || '·'}</div>
                </div>`;
            }
            html += '</div>';
            html += `<div style="margin-top:8px; font-size:11px; color:var(--text-muted); text-align:center;">${val.length} / ${numQ}문항 입력됨</div>`;
            previewEl.innerHTML = html;
        };

        inputEl.addEventListener('input', updatePreview);
        document.getElementById('ak-questions').addEventListener('input', updatePreview);
        updatePreview();

        // 입력 포커스
        setTimeout(() => inputEl.focus(), 100);

        document.getElementById('ak-cancel').addEventListener('click', () => overlay.remove());
        document.getElementById('ak-clear').addEventListener('click', () => {
            App.state.answerKey = null;
            App.state.images.forEach(img => img.gradeResult = null);
            ImageManager.updateList();
            App.updateStatusBar();
            UI.updateRightPanel();
            CanvasManager.render();
            Toast.info('정답이 초기화되었습니다');
            overlay.remove();
        });
        document.getElementById('ak-save').addEventListener('click', () => this.save(overlay));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    },

    save(overlay) {
        const numQ = parseInt(document.getElementById('ak-questions').value) || 20;
        const numC = parseInt(document.getElementById('ak-choices').value) || 5;
        const score = parseInt(document.getElementById('ak-score').value) || 5;

        const inputVal = (document.getElementById('ak-input').value || '').trim();

        if (inputVal.length === 0) {
            Toast.error('정답을 입력해주세요');
            return;
        }

        const answers = [];
        for (let i = 0; i < numQ; i++) {
            const ch = inputVal[i];
            if (ch && /[0-9a-zA-Z]/.test(ch)) {
                const num = parseInt(ch);
                answers.push(isNaN(num) ? null : (num === 0 ? numC : num)); // 0은 마지막 선택지
            } else {
                answers.push(null);
            }
        }

        App.state.answerKey = {
            numQuestions: numQ,
            numChoices: numC,
            scorePerQuestion: score,
            answers,
            totalPossible: numQ * score
        };

        // 이미 분석된 이미지 재채점
        App.state.images.forEach(img => {
            if (img.results) {
                img.gradeResult = this.grade(img.results);
            }
        });

        ImageManager.updateList();
        CanvasManager.render();
        App.updateStatusBar();
        UI.updateRightPanel();
        Toast.success(`정답 ${numQ}문항 저장 완료`);
        overlay.remove();
    },

    // 영역별 정답 문자열을 답 배열로 변환
    // 쉼표로 구분된 라벨 기반 (예: "1,2,3,4,5" 또는 "ㄱ,ㄴ,ㄷ,ㄹ,ㅁ")
    // 또는 기존 숫자 연속 입력도 지원 (하위 호환)
    parseAnswerString(str, numChoices, choiceLabels) {
        if (!str) return [];
        // 쉼표가 있으면 라벨 기반으로 파싱
        if (str.indexOf(',') >= 0) {
            return str.split(',').map(token => {
                const t = token.trim();
                if (!t) return null;
                // 라벨 배열에서 인덱스 찾기 (1-based)
                if (choiceLabels && choiceLabels.length > 0) {
                    const idx = choiceLabels.indexOf(t);
                    if (idx >= 0) return idx + 1;
                }
                // fallback: 숫자 파싱
                const num = parseInt(t);
                if (!isNaN(num)) return num === 0 ? numChoices : num;
                return null;
            });
        }
        // 기존 숫자 연속 입력 방식 (하위 호환)
        return str.split('').map(ch => {
            const num = parseInt(ch);
            if (isNaN(num)) return null;
            return num === 0 ? numChoices : num;
        });
    },

    // 영역별 정답 가져오기
    getAnswersForRoi(roiIdx, imgObj) {
        const roi = imgObj.rois[roiIdx];
        if (!roi || !roi.settings) return null;
        const s = roi.settings;

        if (s.type !== 'subject_answer') return null;

        // 과목 이름으로 연결된 경우 우선 적용
        if (s.subjectName && App.state.subjects) {
            const subj = App.state.subjects.find(x => x.name === s.subjectName);
            if (subj && subj.answers) {
                return this.parseAnswerString(subj.answers, s.numChoices || 5, s.choiceLabels);
            }
        }

        if (s.answerSource === 'direct') {
            // 직접 입력된 정답
            if (!s.answerKey) return null;
            return this.parseAnswerString(s.answerKey, s.numChoices || 5, s.choiceLabels);
        }

        if (s.answerSource && s.answerSource.startsWith('code_')) {
            // 과목코드 연동
            const codeRoiIdx = parseInt(s.answerSource.split('_')[1]);
            const codeRoi = imgObj.rois[codeRoiIdx];
            if (!codeRoi || !codeRoi.settings || codeRoi.settings.type !== 'subject_code') return null;

            // 과목코드 영역에서 감지된 코드
            const codeRes = imgObj.results ? imgObj.results[codeRoiIdx] : null;
            if (!codeRes || !codeRes.rows) return null;

            const detectedCode = codeRes.rows.map(r => {
                if (r.markedAnswer !== null) {
                    const labels = codeRoi.settings.choiceLabels;
                    return labels && labels[r.markedAnswer - 1] ? labels[r.markedAnswer - 1] : `${r.markedAnswer}`;
                }
                return '?';
            }).join('');

            // 코드 목록에서 매칭 (영역의 codeList 또는 전역 subjects)
            const codeList = (codeRoi.settings.codeList && codeRoi.settings.codeList.length > 0)
                ? codeRoi.settings.codeList
                : (App.state.subjects || []);
            const matched = codeList.find(c => c.code === detectedCode);
            if (!matched || !matched.answers) return null;
            return this.parseAnswerString(matched.answers, s.numChoices || 5, s.choiceLabels);
        }

        // 전역 정답 (하위 호환)
        if (App.state.answerKey) {
            return App.state.answerKey.answers;
        }

        return null;
    },

    // 채점 (영역별)
    grade(results, imgObj) {
        if (!results || !imgObj) return null;

        let totalCorrect = 0;
        let totalWrong = 0;
        let totalScore = 0;
        let totalPossible = 0;
        const allDetails = [];
        const scorePerQ = (App.state.answerKey && App.state.answerKey.scorePerQuestion) || 5;

        results.forEach((res, resIdx) => {
            const roi = imgObj.rois[resIdx];
            if (!roi || !roi.settings || roi.settings.type !== 'subject_answer') return;

            const answers = this.getAnswersForRoi(resIdx, imgObj);
            if (!answers || answers.length === 0) return;

            res.rows.forEach((row, rowIdx) => {
                const ansIdx = row.questionNumber - (roi.settings.startNum || 1);
                const correct = ansIdx >= 0 && ansIdx < answers.length ? answers[ansIdx] : null;

                if (!correct) {
                    allDetails.push({
                        questionNumber: row.questionNumber,
                        correctAnswer: null,
                        markedAnswer: row.markedAnswer,
                        isCorrect: false,
                        score: 0,
                        undetected: !!row.undetected
                    });
                    return;
                }

                totalPossible += scorePerQ;
                const isCorrect = row.markedAnswer === correct;
                const qScore = isCorrect ? scorePerQ : 0;
                if (isCorrect) totalCorrect++;
                else totalWrong++;
                totalScore += qScore;

                allDetails.push({
                    questionNumber: row.questionNumber,
                    correctAnswer: correct,
                    markedAnswer: row.markedAnswer,
                    isCorrect,
                    score: qScore,
                    undetected: !!row.undetected
                });
            });
        });

        if (totalPossible === 0) return null;

        return {
            correctCount: totalCorrect,
            wrongCount: totalWrong,
            score: totalScore,
            totalPossible,
            details: allDetails
        };
    }
};
