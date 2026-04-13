// ============================================
// scoring.js - 채점 통계 엔진 + 채점 탭 UI
// OMR 결과표 / 성적일람표 / 문항분석표
// ============================================

const Scoring = {

    // ==========================================
    // 통계 계산 엔진
    // ==========================================

    // 전체 이미지에서 채점 데이터 수집
    collectData() {
        const images = App.state.images || [];
        const students = App.state.students || [];
        const rows = [];

        images.forEach((img, imgIdx) => {
            if (!img.results || !img.gradeResult) return;

            const row = {
                imgIdx,
                filename: img._originalName || img.name || '',
                examNo: '',
                name: '',
                birthday: '',
                phone: '',
                etcFields: {},   // 기타 영역 { 영역명: 감지값 }
                score: img.gradeResult.totalScore || 0,
                totalPossible: img.gradeResult.totalPossible || 0,
                correctCount: img.gradeResult.totalCorrect || 0,
                wrongCount: img.gradeResult.totalWrong || 0,
                answers: [],     // [{ q: 1, marked: 3, correct: 2, isCorrect: false }, ...]
            };

            // ROI별 데이터 추출
            img.rois.forEach((roi, roiIdx) => {
                if (!roi.settings) return;
                const res = img.results[roiIdx];
                if (!res) return;

                const type = roi.settings.type;
                const digits = (res.rows || []).map(r => {
                    if (r.markedAnswer !== null) {
                        const labels = roi.settings.choiceLabels;
                        return labels && labels[r.markedAnswer - 1] ? labels[r.markedAnswer - 1] : String(r.markedAnswer);
                    }
                    return '?';
                }).join('');

                if (type === 'exam_no' || type === 'phone_exam') row.examNo = digits;
                else if (type === 'phone') row.phone = digits;
                else if (type === 'birthday') row.birthday = digits;
                else if (type === 'etc') row.etcFields[roi.settings.name || '기타'] = digits;
                else if (type === 'subject_answer') {
                    // 문항별 답안
                    (res.rows || []).forEach(r => {
                        const labels = roi.settings.choiceLabels;
                        const markedLabel = r.markedAnswer !== null && labels
                            ? (labels[r.markedAnswer - 1] || String(r.markedAnswer))
                            : (r.markedAnswer !== null ? String(r.markedAnswer) : '');
                        row.answers.push({
                            q: r.questionNumber,
                            marked: r.markedAnswer,
                            markedLabel,
                            isCorrect: false
                        });
                    });
                }
            });

            // 채점 상세 매칭
            if (img.gradeResult.details) {
                img.gradeResult.details.forEach(d => {
                    const ans = row.answers.find(a => a.q === d.questionNumber);
                    if (ans) {
                        ans.isCorrect = d.isCorrect;
                        ans.correctAnswer = d.correctAnswer;
                    }
                });
            }

            // 시험인원 매칭
            if (students.length > 0) {
                const matched = students.find(st => {
                    if (row.examNo && st.examNo && st.examNo === row.examNo) return true;
                    if (row.phone && st.phone && st.phone === row.phone) return true;
                    return false;
                });
                if (matched) {
                    row.name = matched.name || '';
                    if (!row.birthday && matched.birth) row.birthday = matched.birth;
                    if (!row.phone && matched.phone) row.phone = matched.phone;
                    if (!row.examNo && matched.examNo) row.examNo = matched.examNo;
                }
            }

            rows.push(row);
        });

        return rows;
    },

    // 통계 계산
    calcStats(rows) {
        if (rows.length === 0) return null;
        const N = rows.length;
        const scores = rows.map(r => r.score);
        const mean = scores.reduce((s, v) => s + v, 0) / N;
        const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / N;
        const stdDev = Math.sqrt(variance);
        const max = Math.max(...scores);
        const min = Math.min(...scores);

        // 석차 (동석차 처리)
        const sorted = [...scores].sort((a, b) => b - a);
        rows.forEach(r => {
            r.rank = sorted.filter(s => s > r.score).length + 1;
            // 표준점수: T = ((X - μ) / σ) × 20 + 100
            r.tScore = stdDev > 0 ? ((r.score - mean) / stdDev) * 20 + 100 : 100;
            // 백분위: ((N - R) / N) × 100
            r.percentile = ((N - r.rank) / N) * 100;
        });

        return { N, mean, stdDev, max, min };
    },

    // 문항분석 계산
    calcItemAnalysis(rows) {
        if (rows.length === 0) return [];
        const N = rows.length;

        // 총점 기준 정렬
        const sortedRows = [...rows].sort((a, b) => b.score - a.score);
        const upperN = Math.ceil(N * 0.27);
        const lowerN = Math.ceil(N * 0.27);
        const upperRows = sortedRows.slice(0, upperN);
        const midRows = sortedRows.slice(upperN, N - lowerN);
        const lowerRows = sortedRows.slice(N - lowerN);
        const upperHalf = sortedRows.slice(0, Math.ceil(N / 2));
        const lowerHalf = sortedRows.slice(Math.ceil(N / 2));

        // 전체 문항 번호 수집
        const allQ = new Set();
        rows.forEach(r => r.answers.forEach(a => allQ.add(a.q)));
        const qNumbers = [...allQ].sort((a, b) => a - b);

        // 선택지 목록 (첫 번째 이미지에서)
        const choiceLabels = {};
        (App.state.images || []).forEach(img => {
            (img.rois || []).forEach(roi => {
                if (roi.settings && roi.settings.type === 'subject_answer' && roi.settings.choiceLabels) {
                    roi.settings.choiceLabels.forEach((l, i) => { choiceLabels[i + 1] = l; });
                }
            });
        });

        return qNumbers.map(q => {
            const getCorrectCount = (group) => group.filter(r => {
                const a = r.answers.find(x => x.q === q);
                return a && a.isCorrect;
            }).length;

            const getDistribution = (group) => {
                const dist = {};
                let blank = 0;
                group.forEach(r => {
                    const a = r.answers.find(x => x.q === q);
                    if (!a || a.marked === null) blank++;
                    else {
                        const key = a.marked;
                        dist[key] = (dist[key] || 0) + 1;
                    }
                });
                return { dist, blank };
            };

            const upperCorrect = getCorrectCount(upperRows);
            const midCorrect = getCorrectCount(midRows);
            const lowerCorrect = getCorrectCount(lowerRows);
            const totalCorrect = getCorrectCount(rows);

            // 정답 번호
            const sampleAns = rows[0].answers.find(a => a.q === q);
            const correctAnswer = sampleAns ? sampleAns.correctAnswer : null;

            // 정답률 = 정답자수 / 전체
            const correctRate = (totalCorrect / N) * 100;

            // 변별도 = (U - L) / (0.27 × N)
            const discrimination = (0.27 * N) > 0 ? (upperCorrect - lowerCorrect) / (0.27 * N) : 0;

            // 정답률 차이 (참고)
            const pUpper = upperN > 0 ? upperCorrect / upperN : 0;
            const pLower = lowerN > 0 ? lowerCorrect / lowerN : 0;
            const deltaP = pUpper - pLower;

            return {
                q, correctAnswer,
                upper: { correct: upperCorrect, wrong: upperN - upperCorrect, total: upperN },
                mid: { correct: midCorrect, wrong: midRows.length - midCorrect, total: midRows.length },
                lower: { correct: lowerCorrect, wrong: lowerN - lowerCorrect, total: lowerN },
                totalCorrect, correctRate,
                discrimination,  // (U-L)/(0.27*N)
                deltaP,          // 정답률 차이 (참고)
                upperHalfDist: getDistribution(upperHalf),
                lowerHalfDist: getDistribution(lowerHalf),
            };
        });
    },

    // ==========================================
    // CSV 다운로드
    // ==========================================

    downloadOMRResult(rows) {
        if (rows.length === 0) { Toast.error('데이터가 없습니다'); return; }
        const maxQ = Math.max(...rows.map(r => r.answers.length));
        let csv = '응시번호,성명,점수';
        for (let i = 1; i <= maxQ; i++) csv += `,${i}번`;
        for (let i = 1; i <= maxQ; i++) csv += `,${i}번정오`;
        csv += '\n';

        rows.forEach(r => {
            csv += `${r.examNo},${r.name},${r.score}`;
            for (let i = 1; i <= maxQ; i++) {
                const a = r.answers.find(x => x.q === i);
                csv += `,${a ? a.markedLabel : ''}`;
            }
            for (let i = 1; i <= maxQ; i++) {
                const a = r.answers.find(x => x.q === i);
                csv += `,${a ? (a.isCorrect ? 'O' : 'X') : ''}`;
            }
            csv += '\n';
        });

        SubjectManager._downloadFile(csv, `OMR결과표_${SessionManager.currentSessionName || ''}_${new Date().toISOString().slice(0, 10)}.csv`);
    },

    downloadScoreReport(rows, stats) {
        if (rows.length === 0) { Toast.error('데이터가 없습니다'); return; }
        const etcKeys = new Set();
        rows.forEach(r => Object.keys(r.etcFields).forEach(k => etcKeys.add(k)));
        const etcArr = [...etcKeys];

        let csv = '응시번호,성명,생년월일,수험번호';
        etcArr.forEach(k => { csv += `,${k}`; });
        csv += ',맞은개수,점수,표준점수,석차,백분위\n';

        rows.forEach(r => {
            csv += `${r.examNo},${r.name},${r.birthday},${r.examNo}`;
            etcArr.forEach(k => { csv += `,${r.etcFields[k] || ''}`; });
            csv += `,${r.correctCount},${r.score},${r.tScore.toFixed(2)},${r.rank},${r.percentile.toFixed(2)}\n`;
        });

        SubjectManager._downloadFile(csv, `성적일람표_${SessionManager.currentSessionName || ''}_${new Date().toISOString().slice(0, 10)}.csv`);
    },

    downloadItemAnalysis(items) {
        if (items.length === 0) { Toast.error('데이터가 없습니다'); return; }
        let csv = '문항,정답,상위27%정답,상위27%오답,중위46%정답,중위46%오답,하위27%정답,하위27%오답,정답률(%),변별도,정답률차이\n';
        items.forEach(item => {
            csv += `${item.q},${item.correctAnswer || ''},${item.upper.correct},${item.upper.wrong},${item.mid.correct},${item.mid.wrong},${item.lower.correct},${item.lower.wrong},${item.correctRate.toFixed(1)},${item.discrimination.toFixed(3)},${item.deltaP.toFixed(3)}\n`;
        });

        SubjectManager._downloadFile(csv, `문항분석표_${SessionManager.currentSessionName || ''}_${new Date().toISOString().slice(0, 10)}.csv`);
    },

    // ==========================================
    // 채점 탭 UI 렌더링
    // ==========================================
    _activeScoreTab: 'omr',

    renderScoringPanel(container) {
        const rows = this.collectData();
        const stats = this.calcStats(rows);
        const items = this.calcItemAnalysis(rows);

        let html = `<div style="display:flex; gap:4px; margin-bottom:8px;">
            <button class="btn btn-sm ${this._activeScoreTab === 'omr' ? 'btn-primary' : ''}" onclick="Scoring._activeScoreTab='omr'; Scoring.renderScoringPanel(document.getElementById('scoring-content'))">OMR 결과표</button>
            <button class="btn btn-sm ${this._activeScoreTab === 'report' ? 'btn-primary' : ''}" onclick="Scoring._activeScoreTab='report'; Scoring.renderScoringPanel(document.getElementById('scoring-content'))">성적일람표</button>
            <button class="btn btn-sm ${this._activeScoreTab === 'item' ? 'btn-primary' : ''}" onclick="Scoring._activeScoreTab='item'; Scoring.renderScoringPanel(document.getElementById('scoring-content'))">문항분석표</button>
        </div>`;

        if (rows.length === 0) {
            html += `<div style="text-align:center; padding:20px; color:var(--text-muted);">채점된 이미지가 없습니다. 분석 후 채점을 실행하세요.</div>`;
            container.innerHTML = html;
            return;
        }

        // 요약 통계
        if (stats) {
            html += `<div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                <div style="padding:4px 8px; background:var(--bg-input); border-radius:4px; font-size:11px;">응시 <b>${stats.N}</b>명</div>
                <div style="padding:4px 8px; background:var(--bg-input); border-radius:4px; font-size:11px;">평균 <b>${stats.mean.toFixed(1)}</b></div>
                <div style="padding:4px 8px; background:var(--bg-input); border-radius:4px; font-size:11px;">표준편차 <b>${stats.stdDev.toFixed(2)}</b></div>
                <div style="padding:4px 8px; background:var(--bg-input); border-radius:4px; font-size:11px;">최고 <b>${stats.max}</b> / 최저 <b>${stats.min}</b></div>
            </div>`;
        }

        if (this._activeScoreTab === 'omr') html += this._renderOMRTable(rows);
        else if (this._activeScoreTab === 'report') html += this._renderReportTable(rows, stats);
        else if (this._activeScoreTab === 'item') html += this._renderItemTable(items, rows.length);

        container.innerHTML = html;
    },

    _renderOMRTable(rows) {
        const maxQ = Math.max(...rows.map(r => r.answers.length), 0);
        let html = `<div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
            <table style="border-collapse:collapse; font-size:10px; white-space:nowrap;">
            <thead><tr style="background:var(--bg-input); position:sticky; top:0;">
                <th style="padding:3px 6px; border:1px solid var(--border);">응시번호</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">성명</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">점수</th>`;
        for (let i = 1; i <= maxQ; i++) html += `<th style="padding:3px 4px; border:1px solid var(--border);">${i}</th>`;
        for (let i = 1; i <= maxQ; i++) html += `<th style="padding:3px 4px; border:1px solid var(--border); color:var(--text-muted);">${i}</th>`;
        html += `</tr></thead><tbody>`;

        rows.forEach(r => {
            html += `<tr>
                <td style="padding:2px 4px; border:1px solid var(--border);">${r.examNo}</td>
                <td style="padding:2px 4px; border:1px solid var(--border);">${r.name}</td>
                <td style="padding:2px 4px; border:1px solid var(--border); font-weight:600;">${r.score}</td>`;
            for (let i = 1; i <= maxQ; i++) {
                const a = r.answers.find(x => x.q === i);
                html += `<td style="padding:2px 3px; border:1px solid var(--border); text-align:center;">${a ? a.markedLabel : ''}</td>`;
            }
            for (let i = 1; i <= maxQ; i++) {
                const a = r.answers.find(x => x.q === i);
                const ox = a ? (a.isCorrect ? 'O' : 'X') : '';
                const color = ox === 'O' ? 'var(--green)' : ox === 'X' ? 'var(--red)' : '';
                html += `<td style="padding:2px 3px; border:1px solid var(--border); text-align:center; color:${color}; font-weight:600;">${ox}</td>`;
            }
            html += `</tr>`;
        });

        html += `</tbody></table></div>
            <button class="btn btn-sm" style="margin-top:8px;" onclick="Scoring.downloadOMRResult(Scoring.collectData())">CSV 다운로드</button>`;
        return html;
    },

    _renderReportTable(rows, stats) {
        const etcKeys = new Set();
        rows.forEach(r => Object.keys(r.etcFields).forEach(k => etcKeys.add(k)));
        const etcArr = [...etcKeys];

        let html = `<div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
            <table style="border-collapse:collapse; font-size:10px; white-space:nowrap;">
            <thead><tr style="background:var(--bg-input); position:sticky; top:0;">
                <th style="padding:3px 6px; border:1px solid var(--border);">응시번호</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">성명</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">생년월일</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">수험번호</th>`;
        etcArr.forEach(k => { html += `<th style="padding:3px 6px; border:1px solid var(--border);">${k}</th>`; });
        html += `<th style="padding:3px 6px; border:1px solid var(--border);">맞은수</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">점수</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">표준점수</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">석차</th>
                <th style="padding:3px 6px; border:1px solid var(--border);">백분위</th>
            </tr></thead><tbody>`;

        rows.forEach(r => {
            html += `<tr>
                <td style="padding:2px 4px; border:1px solid var(--border);">${r.examNo}</td>
                <td style="padding:2px 4px; border:1px solid var(--border);">${r.name}</td>
                <td style="padding:2px 4px; border:1px solid var(--border);">${r.birthday}</td>
                <td style="padding:2px 4px; border:1px solid var(--border);">${r.examNo}</td>`;
            etcArr.forEach(k => { html += `<td style="padding:2px 4px; border:1px solid var(--border);">${r.etcFields[k] || ''}</td>`; });
            html += `<td style="padding:2px 4px; border:1px solid var(--border); text-align:center;">${r.correctCount}</td>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center; font-weight:600;">${r.score}</td>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center;">${r.tScore.toFixed(1)}</td>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center;">${r.rank}</td>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center;">${r.percentile.toFixed(1)}</td>
            </tr>`;
        });

        html += `</tbody></table></div>
            <button class="btn btn-sm" style="margin-top:8px;" onclick="Scoring.downloadScoreReport(Scoring.collectData(), Scoring.calcStats(Scoring.collectData()))">CSV 다운로드</button>`;
        return html;
    },

    _renderItemTable(items, totalN) {
        let html = `<div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
            <table style="border-collapse:collapse; font-size:10px; white-space:nowrap;">
            <thead><tr style="background:var(--bg-input); position:sticky; top:0;">
                <th style="padding:3px 4px; border:1px solid var(--border);">문항</th>
                <th style="padding:3px 4px; border:1px solid var(--border);">정답</th>
                <th style="padding:3px 4px; border:1px solid var(--border);" colspan="2">상위27%</th>
                <th style="padding:3px 4px; border:1px solid var(--border);" colspan="2">중위46%</th>
                <th style="padding:3px 4px; border:1px solid var(--border);" colspan="2">하위27%</th>
                <th style="padding:3px 4px; border:1px solid var(--border);">정답률</th>
                <th style="padding:3px 4px; border:1px solid var(--border);">변별도</th>
            </tr>
            <tr style="background:var(--bg-input); position:sticky; top:20px;">
                <th></th><th></th>
                <th style="padding:2px 3px; border:1px solid var(--border); font-size:9px;">O</th>
                <th style="padding:2px 3px; border:1px solid var(--border); font-size:9px;">X</th>
                <th style="padding:2px 3px; border:1px solid var(--border); font-size:9px;">O</th>
                <th style="padding:2px 3px; border:1px solid var(--border); font-size:9px;">X</th>
                <th style="padding:2px 3px; border:1px solid var(--border); font-size:9px;">O</th>
                <th style="padding:2px 3px; border:1px solid var(--border); font-size:9px;">X</th>
                <th></th><th></th>
            </tr></thead><tbody>`;

        items.forEach(item => {
            const rateColor = item.correctRate >= 80 ? 'var(--green)' : item.correctRate < 40 ? 'var(--red)' : '';
            const discColor = item.discrimination >= 0.3 ? 'var(--green)' : item.discrimination < 0.1 ? 'var(--red)' : '';
            html += `<tr>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center; font-weight:600;">${item.q}</td>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center;">${item.correctAnswer || ''}</td>
                <td style="padding:2px 3px; border:1px solid var(--border); text-align:center;">${item.upper.correct}</td>
                <td style="padding:2px 3px; border:1px solid var(--border); text-align:center;">${item.upper.wrong}</td>
                <td style="padding:2px 3px; border:1px solid var(--border); text-align:center;">${item.mid.correct}</td>
                <td style="padding:2px 3px; border:1px solid var(--border); text-align:center;">${item.mid.wrong}</td>
                <td style="padding:2px 3px; border:1px solid var(--border); text-align:center;">${item.lower.correct}</td>
                <td style="padding:2px 3px; border:1px solid var(--border); text-align:center;">${item.lower.wrong}</td>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center; color:${rateColor}; font-weight:600;">${item.correctRate.toFixed(1)}%</td>
                <td style="padding:2px 4px; border:1px solid var(--border); text-align:center; color:${discColor}; font-weight:600;">${item.discrimination.toFixed(3)}</td>
            </tr>`;
        });

        // 평균 행
        if (items.length > 0) {
            const avgRate = items.reduce((s, i) => s + i.correctRate, 0) / items.length;
            const avgDisc = items.reduce((s, i) => s + i.discrimination, 0) / items.length;
            html += `<tr style="background:var(--bg-input); font-weight:600;">
                <td style="padding:3px 4px; border:1px solid var(--border);" colspan="8">평균</td>
                <td style="padding:3px 4px; border:1px solid var(--border); text-align:center;">${avgRate.toFixed(1)}%</td>
                <td style="padding:3px 4px; border:1px solid var(--border); text-align:center;">${avgDisc.toFixed(3)}</td>
            </tr>`;
        }

        html += `</tbody></table></div>
            <button class="btn btn-sm" style="margin-top:8px;" onclick="Scoring.downloadItemAnalysis(Scoring.calcItemAnalysis(Scoring.collectData()))">CSV 다운로드</button>`;
        return html;
    }
};
