// ============================================
// scoring.js - 채점 통계 엔진 + 채점 탭 UI
// ============================================

const Scoring = {
    _activeTab: 'omr',
    _defaultMaxQ: 40,
    _showColumnSettings: false,
    _sortMode: 'student', // 'student' = 인원명단순, 'score_desc' = 성적 내림차순
    _currentSubject: null,   // OMR 결과표: 선택된 과목 (null = 자동으로 첫 과목 사용)
    _itemSubject: null,      // 문항분석표: 선택된 과목
    // 문항분석 그룹 비율 (사용자 커스터마이징)
    _upperPct: 27,
    _lowerPct: 27,
    // 별색 처리
    _manualHL: {},     // 수동 클릭: { 'q1_rate': '#fecaca' }
    _selectedColor: '#fecaca',
    _colors: [
        { c: '#fecaca', l: '빨강' }, { c: '#fed7aa', l: '주황' },
        { c: '#fef08a', l: '노랑' }, { c: '#bbf7d0', l: '초록' },
        { c: '#bfdbfe', l: '파랑' }, { c: '#e9d5ff', l: '보라' },
    ],
    // 규칙 기반 별색
    _hlRules: [
        { id: 'rate_low', label: '정답률 이하', type: 'rate', op: '<=', value: 40, color: '#fecaca', on: false },
        { id: 'rate_high', label: '정답률 이상', type: 'rate', op: '>=', value: 80, color: '#bbf7d0', on: false },
        { id: 'disc_low', label: '변별도 이하', type: 'disc', op: '<=', value: 0.1, color: '#fef08a', on: false },
        { id: 'disc_neg', label: '변별도 음수', type: 'disc', op: '<', value: 0, color: '#fecaca', on: false },
        { id: 'attractive', label: '매력적 오답', type: 'attractive', color: '#fed7aa', on: false, desc: '정답보다 많이 선택된 오답 선택지' },
    ],

    // OMR 결과표 열 설정 (사용자 커스터마이징)
    _omrColumns: null, // null이면 기본값 사용
    _getOMRColumns() {
        if (this._omrColumns) return this._omrColumns;

        // 기본 열 (디폴트 표시)
        const cols = [
            { id: 'examNo', label: '응시번호', type: 'info', visible: true },
            { id: 'name', label: '성명', type: 'info', visible: true },
            { id: 'score', label: '점수', type: 'info', visible: true },
        ];

        // OMR 영역에서 가져올 수 있는 추가 열 (디폴트 비표시)
        const roiCols = [
            { id: 'birthday', label: '생년월일', type: 'info', visible: false },
            { id: 'phone', label: '전화번호', type: 'info', visible: false },
            { id: 'subjectCode', label: '과목코드', type: 'info', visible: false },
            { id: 'correctCount', label: '맞은개수', type: 'info', visible: false },
            { id: 'wrongCount', label: '틀린개수', type: 'info', visible: false },
            { id: 'totalPossible', label: '만점', type: 'info', visible: false },
            { id: 'rank', label: '석차', type: 'info', visible: false },
            { id: 'tScore', label: '표준점수', type: 'info', visible: false },
            { id: 'percentile', label: '백분위', type: 'info', visible: false },
            { id: 'filename', label: '파일명', type: 'info', visible: false },
        ];

        // 기타(etc) ROI 영역들도 추가
        const etcNames = new Set();
        (App.state.images || []).forEach(img => {
            (img.rois || []).forEach(roi => {
                if (roi.settings && roi.settings.type === 'etc' && roi.settings.name) {
                    etcNames.add(roi.settings.name);
                }
            });
        });
        etcNames.forEach(name => {
            roiCols.push({ id: 'etc_' + name, label: name, type: 'info', visible: false, etcName: name });
        });

        cols.push(...roiCols);

        // 마킹 + 정오
        for (let i = 1; i <= this._defaultMaxQ; i++) {
            cols.push({ id: `q${i}`, label: `${i}번`, type: 'answer', qNum: i, visible: true });
        }
        for (let i = 1; i <= this._defaultMaxQ; i++) {
            cols.push({ id: `ox${i}`, label: `${i}번`, type: 'ox', qNum: i, visible: true });
        }
        this._omrColumns = cols;
        return cols;
    },

    // 열 토글
    toggleColumn(colId) {
        const cols = this._getOMRColumns();
        const col = cols.find(c => c.id === colId);
        if (col) col.visible = !col.visible;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 열 이름 변경
    renameColumn(colId, newLabel) {
        const cols = this._getOMRColumns();
        const col = cols.find(c => c.id === colId);
        if (col) col.label = newLabel;
    },

    // 열 순서 이동
    moveColumn(colId, direction) {
        const cols = this._getOMRColumns();
        const idx = cols.findIndex(c => c.id === colId);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= cols.length) return;
        [cols[idx], cols[newIdx]] = [cols[newIdx], cols[idx]];
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 열 추가
    addColumn(afterColId, label) {
        const cols = this._getOMRColumns();
        const idx = afterColId ? cols.findIndex(c => c.id === afterColId) : cols.length - 1;
        const newId = 'custom_' + Date.now();
        cols.splice(idx + 1, 0, { id: newId, label: label || '새 열', type: 'custom', visible: true });
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 열 삭제
    removeColumn(colId) {
        const cols = this._getOMRColumns();
        const idx = cols.findIndex(c => c.id === colId);
        if (idx >= 0) cols.splice(idx, 1);
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 문항수 변경
    setMaxQ(n) {
        this._defaultMaxQ = Math.max(1, Math.min(100, parseInt(n) || 40));
        this._omrColumns = null; // 리셋
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // ==========================================
    // 데이터 수집 (시험인원 등록 순서 기준)
    // ==========================================
    collectData() {
        const images = App.state.images || [];
        const students = App.state.students || [];

        // 1단계: 이미지에서 OMR 데이터 추출 (과목별 분리)
        const omrRows = [];
        images.forEach((img, imgIdx) => {
            if (!img.results || !img.gradeResult) return;

            const row = {
                imgIdx, filename: img._originalName || img.name || '',
                examNo: '', name: '', birthday: '', phone: '', subjectCode: '',
                etcFields: {},
                // 하위호환: 전체 합산 값
                score: img.gradeResult.score || 0,
                totalPossible: img.gradeResult.totalPossible || 0,
                correctCount: img.gradeResult.correctCount || 0,
                wrongCount: img.gradeResult.wrongCount || 0,
                answers: [], _matched: false,
                // 다과목 구조
                subjects: {},          // { 국어: {score, correctCount, wrongCount, totalPossible, answers}, ... }
                totalScore: 0,
                totalCorrect: 0,
                totalWrong: 0,
                totalMax: 0,
            };

            // ROI별 정답 영역 순회 — details와 순서 일치
            const details = img.gradeResult.details || [];
            let detailCursor = 0;
            const scorePerQ = (App.state.answerKey && App.state.answerKey.scorePerQuestion) || 5;

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
                else if (type === 'subject_code') row.subjectCode = digits;
                else if (type === 'etc') row.etcFields[roi.settings.name || '기타'] = digits;
                else if (type === 'subject_answer') {
                    // 과목명: ROI 이름 (이름 없으면 "과목N")
                    const subjectName = (roi.settings.name && roi.settings.name.trim()) || `과목${roiIdx + 1}`;
                    if (!row.subjects[subjectName]) {
                        row.subjects[subjectName] = {
                            score: 0, correctCount: 0, wrongCount: 0, totalPossible: 0, answers: [],
                        };
                    }
                    const sub = row.subjects[subjectName];
                    const labels = roi.settings.choiceLabels;

                    (res.rows || []).forEach(r => {
                        const markedLabel = r.markedAnswer !== null && labels
                            ? (labels[r.markedAnswer - 1] || String(r.markedAnswer))
                            : (r.markedAnswer !== null ? String(r.markedAnswer) : '');

                        const detail = details[detailCursor++] || null;
                        const ans = {
                            q: r.questionNumber,
                            marked: r.markedAnswer,
                            markedLabel,
                            isCorrect: detail ? !!detail.isCorrect : false,
                            correctAnswer: detail ? detail.correctAnswer : null,
                            subject: subjectName,
                        };
                        sub.answers.push(ans);
                        row.answers.push(ans); // 하위호환: 전체 합쳐서도 제공

                        if (detail && detail.correctAnswer !== null && detail.correctAnswer !== undefined) {
                            sub.totalPossible += scorePerQ;
                            if (detail.isCorrect) {
                                sub.correctCount++;
                                sub.score += detail.score || scorePerQ;
                            } else {
                                sub.wrongCount++;
                            }
                        }
                    });
                }
            });

            // 전체 합산 (다과목일 때는 subjects의 합계 == gradeResult 값)
            Object.values(row.subjects).forEach(s => {
                row.totalScore += s.score;
                row.totalCorrect += s.correctCount;
                row.totalWrong += s.wrongCount;
                row.totalMax += s.totalPossible;
            });

            omrRows.push(row);
        });

        // 2단계: 시험인원 등록 순서 기준으로 정렬
        if (students.length === 0) return omrRows; // 인원 미등록 시 이미지 순

        const rows = [];
        const usedOmr = new Set();

        students.forEach(st => {
            // 인원 → OMR 매칭
            const matched = omrRows.find((r, i) => {
                if (usedOmr.has(i)) return false;
                if (st.examNo && r.examNo && st.examNo === r.examNo) return true;
                if (st.phone && r.phone && st.phone === r.phone) return true;
                if (st.birth && r.birthday && st.birth === r.birthday) return true;
                return false;
            });

            if (matched) {
                const idx = omrRows.indexOf(matched);
                usedOmr.add(idx);
                // 인원 정보로 보완
                matched.name = st.name || matched.name;
                if (!matched.birthday && st.birth) matched.birthday = st.birth;
                if (!matched.phone && st.phone) matched.phone = st.phone;
                if (!matched.examNo && st.examNo) matched.examNo = st.examNo;
                matched._matched = true;
                rows.push(matched);
            } else {
                // OMR 없는 인원 → 공란 행
                rows.push({
                    imgIdx: -1, filename: '',
                    examNo: st.examNo || '', name: st.name || '',
                    birthday: st.birth || '', phone: st.phone || '',
                    subjectCode: '', etcFields: {},
                    score: '', totalPossible: '', correctCount: '', wrongCount: '',
                    answers: [], subjects: {},
                    totalScore: '', totalCorrect: '', totalWrong: '', totalMax: '',
                    _matched: false, _noOmr: true,
                });
            }
        });

        // 매칭 안 된 OMR도 추가 (미등록 인원)
        omrRows.forEach((r, i) => {
            if (!usedOmr.has(i)) rows.push(r);
        });

        // 정렬 적용
        if (this._sortMode === 'score_desc') {
            rows.sort((a, b) => {
                if (a._noOmr && !b._noOmr) return 1;
                if (!a._noOmr && b._noOmr) return -1;
                if (a._noOmr && b._noOmr) return 0;
                return (b.score || 0) - (a.score || 0);
            });
        }
        // 'student' = 기본 (인원명단 순서, 이미 정렬됨)

        return rows;
    },

    // ==========================================
    // 과목 관련 헬퍼
    // ==========================================
    // rows에서 등장한 모든 과목명을 순서대로 반환 (첫 등장 순)
    getSubjectList(rows) {
        const seen = [];
        const set = new Set();
        rows.forEach(r => {
            if (!r.subjects) return;
            Object.keys(r.subjects).forEach(name => {
                if (!set.has(name)) { set.add(name); seen.push(name); }
            });
        });
        return seen;
    },

    // 특정 행의 과목 데이터 가져오기 (없으면 null)
    getSubjectData(row, subjectName) {
        if (!row || !row.subjects) return null;
        return row.subjects[subjectName] || null;
    },

    // ==========================================
    // 통계 계산
    // ==========================================
    calcStats(rows) {
        const validRows = rows.filter(r => !r._noOmr);
        if (validRows.length === 0) return null;
        const N = validRows.length;

        // 전체 합산 (기존 동작 유지: 단일 과목일 땐 r.score == totalScore)
        const scores = validRows.map(r => r.score);
        const mean = scores.reduce((s, v) => s + v, 0) / N;
        const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / N;
        const stdDev = Math.sqrt(variance);

        const sorted = [...scores].sort((a, b) => b - a);
        validRows.forEach(r => {
            r.rank = sorted.filter(s => s > r.score).length + 1;
            r.tScore = stdDev > 0 ? ((r.score - mean) / stdDev) * 20 + 100 : 100;
            r.percentile = ((N - r.rank) / N) * 100;
        });

        // 과목별 독립 통계 (각 r.subjects[subj]에 rank/tScore/percentile 기록)
        const subjectNames = this.getSubjectList(validRows);
        subjectNames.forEach(subj => {
            const subScores = validRows.map(r => (r.subjects[subj] ? r.subjects[subj].score : 0));
            const subMean = subScores.reduce((s, v) => s + v, 0) / N;
            const subVar = subScores.reduce((s, v) => s + (v - subMean) ** 2, 0) / N;
            const subStd = Math.sqrt(subVar);
            const subSorted = [...subScores].sort((a, b) => b - a);
            validRows.forEach(r => {
                const s = r.subjects[subj];
                if (!s) return;
                s.rank = subSorted.filter(v => v > s.score).length + 1;
                s.tScore = subStd > 0 ? ((s.score - subMean) / subStd) * 20 + 100 : 100;
                s.percentile = ((N - s.rank) / N) * 100;
            });
        });

        return { N, mean, stdDev, max: Math.max(...scores), min: Math.min(...scores), subjects: subjectNames };
    },

    // ==========================================
    // 문항분석
    // ==========================================
    calcItemAnalysis(rows) {
        rows = rows.filter(r => !r._noOmr);
        if (rows.length === 0) return [];
        const N = rows.length;
        const uPct = this._upperPct / 100;
        const lPct = this._lowerPct / 100;
        const sortedRows = [...rows].sort((a, b) => b.score - a.score);
        const upperN = Math.max(1, Math.ceil(N * uPct));
        const lowerN = Math.max(1, Math.ceil(N * lPct));
        const upperRows = sortedRows.slice(0, upperN);
        const midRows = sortedRows.slice(upperN, N - lowerN);
        const lowerRows = sortedRows.slice(N - lowerN);
        const upperHalf = sortedRows.slice(0, Math.ceil(N / 2));
        const lowerHalf = sortedRows.slice(Math.ceil(N / 2));

        const allQ = new Set();
        rows.forEach(r => r.answers.forEach(a => allQ.add(a.q)));
        const qNumbers = [...allQ].sort((a, b) => a - b);

        return qNumbers.map(q => {
            const gc = (group) => group.filter(r => { const a = r.answers.find(x => x.q === q); return a && a.isCorrect; }).length;
            const U = gc(upperRows), M = gc(midRows), L = gc(lowerRows), T = gc(rows);
            const sampleAns = rows[0].answers.find(a => a.q === q);
            const correctRate = (T / N) * 100;
            // 변별도 = (U - L) / ((상위비율+하위비율)/2 × N)
            const avgPct = (uPct + lPct) / 2;
            const discrimination = (avgPct * N) > 0 ? (U - L) / (avgPct * N) : 0;

            // 반응분포 (상부50% / 하부50%)
            const getDist = (group) => {
                const dist = { blank: 0, multi: 0 };
                for (let n = 1; n <= 7; n++) dist[n] = 0;
                group.forEach(r => {
                    const a = r.answers.find(x => x.q === q);
                    if (!a || a.marked === null) dist.blank++;
                    else if (a.marked === -1) dist.multi++; // 중복
                    else {
                        const key = a.marked;
                        if (key >= 1 && key <= 7) dist[key] = (dist[key] || 0) + 1;
                        else dist[key] = (dist[key] || 0) + 1;
                    }
                });
                dist.total = group.length;
                return dist;
            };

            return { q, correctAnswer: sampleAns ? sampleAns.correctAnswer : null,
                upper: { correct: U, wrong: upperN - U, total: upperN },
                mid: { correct: M, wrong: midRows.length - M, total: midRows.length },
                lower: { correct: L, wrong: lowerN - L, total: lowerN },
                totalCorrect: T, correctRate, discrimination,
                distUpper: getDist(upperHalf),
                distLower: getDist(lowerHalf),
                distTotal: getDist(rows),
            };
        });
    },

    // ==========================================
    // CSV 다운로드
    // ==========================================
    _dl(csv, name) {
        const n = SessionManager.currentSessionName || '';
        const d = new Date().toISOString().slice(0, 10);
        SubjectManager._downloadFile(csv, `${name}_${n}_${d}.csv`);
    },

    // rows + 선택 과목 → CSV 문자열
    _buildOMRCsv(rows, subj) {
        const proj = rows.map(r => r._noOmr ? r : this._projectRow(r, subj));
        // 이 과목(또는 전체)에서 등장한 문항번호 추출
        const qSet = new Set();
        proj.forEach(r => (r.answers || []).forEach(a => qSet.add(a.q)));
        const qNums = [...qSet].sort((a, b) => a - b);
        const maxQ = qNums.length ? qNums[qNums.length - 1] : this._defaultMaxQ;
        const qs = qNums.length ? qNums : Array.from({ length: maxQ }, (_, i) => i + 1);

        let csv = '응시번호,성명,점수';
        qs.forEach(q => csv += `,${q}번`);
        qs.forEach(q => csv += `,${q}번정오`);
        csv += '\n';
        proj.forEach(r => {
            csv += `${r.examNo},${r.name},${r._noOmr ? '' : r.score}`;
            qs.forEach(q => {
                if (r._noOmr) { csv += ','; return; }
                const a = r.answers.find(x => x.q === q);
                csv += `,${a ? a.markedLabel : ''}`;
            });
            qs.forEach(q => {
                if (r._noOmr) { csv += ','; return; }
                const a = r.answers.find(x => x.q === q);
                csv += `,${a ? (a.isCorrect ? 'O' : 'X') : ''}`;
            });
            csv += '\n';
        });
        return csv;
    },

    // 현재 과목 CSV
    downloadOMR(rows) {
        if (!rows.length) return;
        const subj = this._resolveSubject(rows, this._currentSubject);
        const csv = this._buildOMRCsv(rows, subj);
        this._dl(csv, subj ? `OMR결과표_${subj}` : 'OMR결과표');
    },

    // 전체 과목 CSV (과목별 파일)
    downloadAllOMR(rows) {
        if (!rows.length) return;
        const list = this.getSubjectList(rows);
        if (list.length === 0) {
            this._dl(this._buildOMRCsv(rows, null), 'OMR결과표');
            return;
        }
        list.forEach(subj => {
            const csv = this._buildOMRCsv(rows, subj);
            this._dl(csv, `OMR결과표_${subj}`);
        });
    },

    downloadReport(rows) {
        if (!rows.length) return;
        const etcKeys = [...new Set(rows.flatMap(r => Object.keys(r.etcFields)))];
        let csv = '응시번호,성명,생년월일,수험번호';
        etcKeys.forEach(k => csv += `,${k}`);
        csv += ',맞은수,점수,표준점수,석차,백분위\n';
        rows.forEach(r => {
            csv += `${r.examNo},${r.name},${r.birthday},${r.examNo}`;
            etcKeys.forEach(k => csv += `,${r.etcFields[k] || ''}`);
            if (r._noOmr) {
                csv += ',,,,,\n';
            } else {
                csv += `,${r.correctCount},${r.score},${r.tScore ? r.tScore.toFixed(1) : ''},${r.rank || ''},${r.percentile ? r.percentile.toFixed(1) : ''}\n`;
            }
        });
        this._dl(csv, '성적일람표');
    },

    downloadItem(items) {
        if (!items.length) return;
        let csv = '문항,정답,상위27%O,상위27%X,중위46%O,중위46%X,하위27%O,하위27%X,정답률(%),변별도\n';
        items.forEach(i => {
            csv += `${i.q},${i.correctAnswer||''},${i.upper.correct},${i.upper.wrong},${i.mid.correct},${i.mid.wrong},${i.lower.correct},${i.lower.wrong},${i.correctRate.toFixed(1)},${i.discrimination.toFixed(3)}\n`;
        });
        this._dl(csv, '문항분석표');
    },

    // ==========================================
    // 메인 렌더링
    // ==========================================
    renderScoringPanel(container) {
        const rows = this.collectData();
        const stats = this.calcStats(rows);
        const items = this.calcItemAnalysis(rows);

        let html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <!-- 헤더 -->
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
                <h1 style="font-size:22px; font-weight:700; margin:0; color:var(--text);">채점 결과</h1>
                <span style="font-size:13px; color:var(--text-muted);">${SessionManager.currentSessionName || ''}</span>
            </div>`;

        // 요약 카드
        if (stats) {
            html += `
            <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:24px;">
                ${this._statCard('응시 인원', `${stats.N}명`, '#3b82f6')}
                ${this._statCard('평균', `${stats.mean.toFixed(1)}점`, '#8b5cf6')}
                ${this._statCard('표준편차', `${stats.stdDev.toFixed(2)}`, '#6366f1')}
                ${this._statCard('최고점', `${stats.max}점`, '#22c55e')}
                ${this._statCard('최저점', `${stats.min}점`, '#ef4444')}
            </div>`;
        }

        if (rows.length === 0) {
            html += `<div style="text-align:center; padding:60px 20px; color:var(--text-muted); font-size:15px;">
                채점된 이미지가 없습니다.<br>분석 탭에서 분석 후 채점을 실행하세요.
            </div></div>`;
            container.innerHTML = html;
            return;
        }

        // 탭 바
        html += `<div style="display:flex; gap:2px; margin-bottom:16px; border-bottom:2px solid var(--border);">
            ${this._tabBtn('omr', 'OMR 결과표')}
            ${this._tabBtn('report', '성적일람표')}
            ${this._tabBtn('item', '문항분석표')}
        </div>`;

        // 탭 내용
        html += `<div id="scoring-tab-content">`;
        if (this._activeTab === 'omr') html += this._renderOMR(rows);
        else if (this._activeTab === 'report') html += this._renderReport(rows);
        else if (this._activeTab === 'item') html += this._renderItem(items, rows.length);
        html += `</div></div>`;

        container.innerHTML = html;
    },

    _statCard(label, value, color) {
        return `<div style="background:white; border-radius:10px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,0.08); border-left:4px solid ${color};">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${label}</div>
            <div style="font-size:20px; font-weight:700; color:${color};">${value}</div>
        </div>`;
    },

    _tabBtn(id, label) {
        const active = this._activeTab === id;
        return `<button onclick="Scoring._activeTab='${id}'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));"
            style="padding:8px 20px; font-size:13px; font-weight:${active ? '700' : '500'}; border:none;
            background:${active ? 'white' : 'transparent'}; color:${active ? 'var(--blue)' : 'var(--text-muted)'};
            border-bottom:${active ? '3px solid var(--blue)' : '3px solid transparent'};
            cursor:pointer; transition:all 0.15s;">${label}</button>`;
    },

    // ==========================================
    // OMR 결과표
    // ==========================================
    // 선택된 과목 기준으로 row의 값들을 투영 (score/answers/correctCount/rank/tScore/percentile)
    _projectRow(r, subj) {
        if (!subj || !r.subjects || !r.subjects[subj]) return r;
        const s = r.subjects[subj];
        return Object.assign({}, r, {
            score: s.score,
            correctCount: s.correctCount,
            wrongCount: s.wrongCount,
            totalPossible: s.totalPossible,
            answers: s.answers,
            rank: s.rank,
            tScore: s.tScore,
            percentile: s.percentile,
        });
    },

    // OMR/문항분석용 현재 과목 결정 (없으면 첫 과목 자동 선택)
    _resolveSubject(rows, stored) {
        const list = this.getSubjectList(rows);
        if (list.length === 0) return null;
        if (stored && list.includes(stored)) return stored;
        return list[0];
    },

    setCurrentSubject(name) {
        this._currentSubject = name || null;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    setItemSubject(name) {
        this._itemSubject = name || null;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    _subjectDropdown(rows, storedField, handler) {
        const list = this.getSubjectList(rows);
        if (list.length === 0) return '';
        const current = this._resolveSubject(rows, this[storedField]);
        const opts = list.map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('');
        return `<label style="font-size:11px; display:flex; align-items:center; gap:6px;">
            <span style="font-weight:600; color:var(--text-muted);">과목:</span>
            <select onchange="Scoring.${handler}(this.value)"
                style="padding:4px 8px; font-size:11px; border:1px solid var(--border); border-radius:6px; background:white; font-weight:600;">
                ${opts}
            </select>
        </label>`;
    },

    _renderOMR(rowsOrig) {
        const cols = this._getOMRColumns().filter(c => c.visible);
        const subj = this._resolveSubject(rowsOrig, this._currentSubject);
        const rows = rowsOrig.map(r => r._noOmr ? r : this._projectRow(r, subj));

        // 상단 도구
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
                ${this._subjectDropdown(rowsOrig, '_currentSubject', 'setCurrentSubject')}
                <label style="font-size:11px;">문항수:
                    <input type="number" value="${this._defaultMaxQ}" min="1" max="100" style="width:50px; padding:3px; font-size:11px; border:1px solid var(--border); border-radius:4px;"
                        onchange="Scoring.setMaxQ(this.value)">
                </label>
                <button class="btn btn-sm" style="font-size:10px; padding:3px 8px;"
                    onclick="Scoring._showColumnSettings=!Scoring._showColumnSettings; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                    ${this._showColumnSettings ? '설정 닫기' : '열 설정'}
                </button>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn btn-sm" onclick="Scoring.downloadOMR(Scoring.collectData())" style="font-size:11px;">현재 과목 CSV</button>
                <button class="btn btn-sm" onclick="Scoring.downloadAllOMR(Scoring.collectData())" style="font-size:11px;">전체 과목 CSV</button>
            </div>
        </div>`;

        // 뱃지 영역 (공용 함수)
        html += this._renderBadgeBar(this._getOMRColumns, 'toggleColumn', 'omr');

        // 정렬 + 마킹/정오 토글 + 문항수
        const allCols = this._getOMRColumns();
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding:8px 12px; background:#f8fafc; border-radius:8px; flex-wrap:wrap;">
            ${this._renderSortButtons()}
            <div style="width:1px; height:20px; background:var(--border);"></div>
            <label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" ${allCols.some(c => c.type === 'answer' && !c.visible) ? '' : 'checked'}
                    onchange="Scoring._toggleAnswerCols(this.checked)">
                <span style="padding:2px 8px; border-radius:10px; background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:600;">마킹 내용</span>
            </label>
            <label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" ${allCols.some(c => c.type === 'ox' && !c.visible) ? '' : 'checked'}
                    onchange="Scoring._toggleOXCols(this.checked)">
                <span style="padding:2px 8px; border-radius:10px; background:#fef3c7; color:#92400e; font-size:10px; font-weight:600;">정오표(O/X)</span>
            </label>
            <span style="font-size:10px; color:var(--text-muted); margin-left:auto;">
                문항수: <input type="number" value="${this._defaultMaxQ}" min="1" max="100"
                    style="width:45px; padding:2px; font-size:11px; border:1px solid var(--border); border-radius:4px; text-align:center;"
                    onchange="Scoring.setMaxQ(this.value)">
            </span>
        </div>`;

        // 테이블
        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead><tr>`;

        cols.forEach(col => {
            const hl = (this._highlightCol === col.id) ? 'background:#93c5fd !important;' : '';
            const bg = col.type === 'ox' ? 'background:#fef3c7;' : col.id === 'score' ? 'color:var(--blue);' : 'background:#f8fafc;';
            html += `<th style="padding:6px 6px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); ${bg} ${hl} position:sticky; top:0; z-index:1; white-space:nowrap;">${col.label}</th>`;
        });
        html += `</tr></thead><tbody>`;

        rows.forEach((r, ri) => {
            const bg = ri % 2 === 0 ? '' : 'background:#f8fafc;';
            const noOmr = r._noOmr;
            html += `<tr style="${bg} ${noOmr ? 'opacity:0.5;' : ''}">`;
            cols.forEach(col => {
                const hl = (this._highlightCol === col.id) ? 'background:#dbeafe !important;' : '';
                let val = '', style = `padding:5px 6px; text-align:center; font-size:11px; border-bottom:1px solid #f1f5f9; ${hl}`;
                if (noOmr && col.type !== 'info') { val = ''; html += `<td style="${style}">${val}</td>`; return; }
                if (col.id === 'examNo') val = r.examNo;
                else if (col.id === 'name') { val = r.name; style += 'font-weight:600;'; }
                else if (col.id === 'score') { val = r.score; style += 'font-weight:700; color:var(--blue); font-size:12px;'; }
                else if (col.id === 'birthday') val = r.birthday;
                else if (col.id === 'phone') val = r.phone;
                else if (col.id === 'subjectCode') val = r.subjectCode || '';
                else if (col.id === 'correctCount') { val = r.correctCount; style += 'color:#22c55e; font-weight:600;'; }
                else if (col.id === 'wrongCount') { val = r.wrongCount; style += 'color:#ef4444;'; }
                else if (col.id === 'totalPossible') val = r.totalPossible;
                else if (col.id === 'rank') { val = r.rank || ''; style += 'font-weight:700;'; }
                else if (col.id === 'tScore') val = r.tScore ? r.tScore.toFixed(1) : '';
                else if (col.id === 'percentile') val = r.percentile ? r.percentile.toFixed(1) + '%' : '';
                else if (col.id === 'filename') val = r.filename;
                else if (col.id && col.id.startsWith('etc_')) { val = r.etcFields[col.etcName || col.id.replace('etc_','')] || ''; }
                else if (col.type === 'answer') {
                    const a = r.answers.find(x => x.q === col.qNum);
                    val = a ? a.markedLabel : '';
                } else if (col.type === 'ox') {
                    const a = r.answers.find(x => x.q === col.qNum);
                    val = a ? (a.isCorrect ? 'O' : 'X') : '';
                    if (val === 'O') style += 'color:#22c55e; font-weight:700;';
                    else if (val === 'X') style += 'color:#ef4444; font-weight:700;';
                } else if (col.type === 'custom') {
                    val = '';
                }
                html += `<td style="${style}">${val}</td>`;
            });
            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    },

    // 정렬 버튼
    _renderSortButtons() {
        const isStudent = this._sortMode === 'student';
        const isScore = this._sortMode === 'score_desc';
        return `
            <button class="btn btn-sm" style="font-size:10px; padding:3px 10px; ${isStudent ? 'background:var(--blue); color:#fff;' : ''}"
                onclick="Scoring._sortMode='student'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">인원명단순</button>
            <button class="btn btn-sm" style="font-size:10px; padding:3px 10px; ${isScore ? 'background:var(--blue); color:#fff;' : ''}"
                onclick="Scoring._sortMode='score_desc'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">성적 내림차순</button>`;
    },

    // 셀 별색 토글 (수동)
    _toggleCellHL(key) {
        if (this._manualHL[key]) delete this._manualHL[key];
        else this._manualHL[key] = this._selectedColor;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 규칙 기반 별색 계산
    _calcRuleHL(items) {
        const hl = {};
        this._hlRules.forEach(rule => {
            if (!rule.on) return;
            items.forEach(item => {
                if (rule.type === 'rate') {
                    const v = item.correctRate;
                    if ((rule.op === '<=' && v <= rule.value) || (rule.op === '>=' && v >= rule.value) || (rule.op === '<' && v < rule.value))
                        hl['q'+item.q+'_rate'] = rule.color;
                } else if (rule.type === 'disc') {
                    const v = item.discrimination;
                    if ((rule.op === '<=' && v <= rule.value) || (rule.op === '>=' && v >= rule.value) || (rule.op === '<' && v < rule.value))
                        hl['q'+item.q+'_disc'] = rule.color;
                } else if (rule.type === 'attractive' && item.distTotal && item.correctAnswer) {
                    const caCount = item.distTotal[item.correctAnswer] || 0;
                    for (let n = 1; n <= 7; n++) {
                        if (n !== item.correctAnswer && (item.distTotal[n] || 0) > caCount)
                            hl['q'+item.q+'_dt_'+n] = rule.color;
                    }
                }
            });
        });
        // 수동이 규칙보다 우선
        return { ...hl, ...this._manualHL };
    },

    // 성적일람표 열 설정
    _reportColumns: null,
    _getReportColumns() {
        if (this._reportColumns) return this._reportColumns;
        const cols = [
            { id: 'examNo', label: '응시번호', type: 'info', visible: true },
            { id: 'name', label: '성명', type: 'info', visible: true },
            { id: 'birthday', label: '생년월일', type: 'info', visible: true },
            { id: 'phone', label: '전화번호', type: 'info', visible: false },
            { id: 'subjectCode', label: '과목코드', type: 'info', visible: false },
            { id: 'filename', label: '파일명', type: 'info', visible: false },
        ];
        // 기타 ROI
        const etcNames = new Set();
        (App.state.images || []).forEach(img => {
            (img.rois || []).forEach(roi => {
                if (roi.settings && roi.settings.type === 'etc' && roi.settings.name) etcNames.add(roi.settings.name);
            });
        });
        etcNames.forEach(name => cols.push({ id: 'etc_' + name, label: name, type: 'info', visible: true, etcName: name }));

        // 성적 열
        cols.push(
            { id: 'correctCount', label: '맞은개수', type: 'info', visible: true },
            { id: 'score', label: '점수', type: 'info', visible: true },
            { id: 'tScore', label: '표준점수', type: 'info', visible: true },
            { id: 'rank', label: '석차', type: 'info', visible: true },
            { id: 'percentile', label: '백분위', type: 'info', visible: true },
            { id: 'wrongCount', label: '틀린개수', type: 'info', visible: false },
            { id: 'totalPossible', label: '만점', type: 'info', visible: false },
        );
        this._reportColumns = cols;
        return cols;
    },

    // 선택된 열 하이라이트
    _highlightCol: null,

    // 공용 뱃지 UI 렌더
    _renderBadgeBar(columnsGetter, toggleFn, prefix) {
        const allCols = columnsGetter.call(this);
        const active = allCols.filter(c => c.visible);
        const inactive = allCols.filter(c => !c.visible);
        const fnName = columnsGetter.name || '_getOMRColumns';

        let html = `
        <style>
            .badge-area { transition: background 0.2s; }
            .badge-area.drag-over { background: #dbeafe !important; border-color: var(--blue) !important; }
            .scoring-badge-item {
                padding: 4px 12px; border-radius: 14px; font-size: 11px; cursor: grab;
                user-select: none; transition: all 0.2s ease; display: inline-block;
            }
            .scoring-badge-item:active { cursor: grabbing; transform: scale(1.05); }
            .scoring-badge-item.inactive {
                border: 1.5px dashed #cbd5e1; color: #94a3b8; background: white;
            }
            .scoring-badge-item.inactive:hover {
                border-color: var(--blue); color: var(--blue); background: #eff6ff;
                transform: translateY(-1px); box-shadow: 0 2px 4px rgba(59,130,246,0.15);
            }
            .scoring-badge-item.active {
                border: 1.5px solid var(--blue); color: var(--blue); background: #eff6ff; font-weight: 600;
            }
            .scoring-badge-item.active:hover {
                background: #dbeafe; transform: translateY(-1px); box-shadow: 0 2px 6px rgba(59,130,246,0.2);
            }
            .scoring-badge-item.active.highlighted {
                background: var(--blue); color: white; box-shadow: 0 2px 8px rgba(59,130,246,0.3);
            }
            .scoring-badge-item.dragging { opacity: 0.4; transform: scale(0.95); }
            .drop-indicator { animation: pulse 0.6s ease infinite alternate; }
            @keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }
        </style>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:14px;">
            <div style="margin-bottom:8px;">
                <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; font-weight:500;">사용 가능한 항목 — 아래 헤더 영역으로 드래그하세요</div>
                <div class="badge-area" style="display:flex; flex-wrap:wrap; gap:5px; min-height:30px; padding:6px; border-radius:6px;"
                    id="${prefix}-available"
                    ondragover="Scoring._onBadgeDragOver(event);"
                    ondragleave="Scoring._onBadgeDragLeave(event);"
                    ondrop="Scoring._onBadgeDrop(event,'${toggleFn}','available');">
                    ${inactive.map(c => `<span class="scoring-badge-item inactive" draggable="true" data-col-id="${c.id}"
                        ondragstart="Scoring._onBadgeDragStart(event,'${c.id}')"
                        ondragend="this.classList.remove('dragging')">${c.label}</span>`).join('')}
                    ${inactive.length === 0 ? '<span style="font-size:10px; color:var(--text-muted); padding:4px;">모든 항목이 추가됨</span>' : ''}
                </div>
            </div>
            <div>
                <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; font-weight:500;">현재 표 헤더 — 드래그로 순서 변경 · 위로 드래그하여 제거 · 클릭하면 열 하이라이트</div>
                <div class="badge-area" style="display:flex; flex-wrap:wrap; gap:5px; min-height:34px; padding:6px; border:1.5px solid var(--border); border-radius:8px; background:white;"
                    id="${prefix}-active"
                    ondragover="Scoring._onBadgeDragOver(event);"
                    ondragleave="Scoring._onBadgeDragLeave(event);"
                    ondrop="Scoring._onBadgeDrop(event,'${toggleFn}','active');">
                    ${active.filter(c => c.type === 'info' || c.type === 'custom').map(c => `<span class="scoring-badge-item active ${this._highlightCol === c.id ? 'highlighted' : ''}"
                        draggable="true" data-col-id="${c.id}" data-toggle-fn="${toggleFn}" tabindex="0"
                        ondragstart="Scoring._onBadgeDragStart(event,'${c.id}')"
                        ondragend="this.classList.remove('dragging')"
                        onclick="Scoring._onBadgeClick('${c.id}')"
                        ondblclick="event.stopPropagation(); event.preventDefault(); Scoring._startBadgeRename(this,'${c.id}','${toggleFn}')"
                        onkeydown="if(event.key==='Delete')Scoring._deleteBadge('${c.id}','${toggleFn}'); if(event.key==='Escape')Scoring._clearHighlight();"
                        >${c.label}</span>`).join('')}
                </div>
            </div>
        </div>`;
        return html;
    },

    _onBadgeDragStart(e, colId) {
        this._dragColId = colId;
        e.dataTransfer.effectAllowed = 'move';
        e.target.classList.add('dragging');
    },

    // 드래그 중 삽입 위치 인디케이터
    _onBadgeDragOver(e) {
        e.preventDefault();
        const container = e.currentTarget;
        container.classList.add('drag-over');

        // 기존 인디케이터 제거
        container.querySelectorAll('.drop-indicator').forEach(el => el.remove());

        // 삽입 위치 계산
        const badges = container.querySelectorAll('.scoring-badge-item');
        let insertBefore = null;
        for (const badge of badges) {
            const rect = badge.getBoundingClientRect();
            if (e.clientX < rect.left + rect.width / 2) {
                insertBefore = badge;
                break;
            }
        }

        // 인디케이터 삽입
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.cssText = 'width:3px; height:24px; background:var(--blue); border-radius:2px; flex-shrink:0; animation:pulse 0.6s ease infinite alternate;';
        if (insertBefore) {
            container.insertBefore(indicator, insertBefore);
        } else {
            container.appendChild(indicator);
        }
    },

    _onBadgeDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
        e.currentTarget.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    },

    _getColsForToggleFn(toggleFn) {
        return toggleFn === 'toggleColumn' ? this._getOMRColumns() : this._getReportColumns();
    },

    _onBadgeDrop(e, toggleFn, target) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        e.currentTarget.querySelectorAll('.drop-indicator').forEach(el => el.remove());

        if (!this._dragColId) return;
        const colId = this._dragColId;
        this._dragColId = null;

        const cols = this._getColsForToggleFn(toggleFn);
        const col = cols.find(c => c.id === colId);
        if (!col) return;

        if (target === 'available') {
            // active → available: 제거 (비활성화)
            if (col.visible) {
                col.visible = false;
                this.renderScoringPanel(document.getElementById('scoring-content'));
            }
        } else {
            // available → active: 추가 (활성화)
            if (!col.visible) {
                col.visible = true;
            }

            // 드롭 위치에 따라 순서 변경
            const badges = e.currentTarget.querySelectorAll('.scoring-badge-item');
            let insertBeforeId = null;
            for (const badge of badges) {
                if (badge.dataset.colId === colId) continue;
                const rect = badge.getBoundingClientRect();
                if (e.clientX < rect.left + rect.width / 2) {
                    insertBeforeId = badge.dataset.colId;
                    break;
                }
            }

            // 배열에서 이동
            const fromIdx = cols.findIndex(c => c.id === colId);
            if (fromIdx >= 0) {
                const [moved] = cols.splice(fromIdx, 1);
                if (insertBeforeId) {
                    const toIdx = cols.findIndex(c => c.id === insertBeforeId);
                    cols.splice(toIdx >= 0 ? toIdx : cols.length, 0, moved);
                } else {
                    // 맨 끝 (info/custom 중)
                    const lastInfo = cols.reduce((last, c, i) => (c.type === 'info' || c.type === 'custom') ? i : last, cols.length - 1);
                    cols.splice(lastInfo + 1, 0, moved);
                }
            }

            this.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    _clickTimer: null,
    _onBadgeClick(colId) {
        // 더블클릭 구분용 딜레이
        if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; return; }
        this._clickTimer = setTimeout(() => {
            this._clickTimer = null;
            this._highlightCol = colId;
            this.renderScoringPanel(document.getElementById('scoring-content'));
            setTimeout(() => {
                const badge = document.querySelector(`.scoring-badge-item[data-col-id="${colId}"]`);
                if (badge) badge.focus();
            }, 50);
        }, 250);
    },

    // Escape로 선택 해제
    _clearHighlight() {
        if (this._highlightCol) {
            this._highlightCol = null;
            this.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    // Delete 키로 뱃지 제거 (비활성화)
    _deleteBadge(colId, toggleFn) {
        const cols = this._getColsForToggleFn(toggleFn);
        const col = cols.find(c => c.id === colId);
        if (col && col.visible) {
            col.visible = false;
            if (this._highlightCol === colId) this._highlightCol = null;
            this.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    // 더블클릭 → 인라인 이름 변경 (Electron prompt 미지원 대응)
    _startBadgeRename(el, colId, toggleFn) {
        const cols = this._getColsForToggleFn(toggleFn);
        const col = cols.find(c => c.id === colId);
        if (!col) return;

        const oldLabel = col.label;
        const rect = el.getBoundingClientRect();

        // 뱃지를 input으로 교체
        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldLabel;
        input.style.cssText = `width:${Math.max(60, oldLabel.length * 12)}px; padding:3px 8px; border-radius:14px; border:2px solid var(--blue); font-size:11px; font-weight:600; text-align:center; outline:none;`;
        el.textContent = '';
        el.appendChild(input);
        el.draggable = false;
        input.focus();
        input.select();

        const finish = () => {
            const newLabel = input.value.trim() || oldLabel;
            col.label = newLabel;
            el.draggable = true;
            this.renderScoringPanel(document.getElementById('scoring-content'));
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = oldLabel; input.blur(); }
            e.stopPropagation(); // Delete 키 등 전파 방지
        });
    },

    // 성적일람표 열 토글
    toggleReportColumn(colId) {
        const cols = this._getReportColumns();
        const col = cols.find(c => c.id === colId);
        if (col) col.visible = !col.visible;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 드래그 앤 드롭
    _dragColId: null,
    _onDragStart(e, colId) {
        this._dragColId = colId;
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
        setTimeout(() => { if (e.target) e.target.style.opacity = '1'; }, 200);
    },
    _onDropBadge(e) {
        e.preventDefault();
        if (!this._dragColId) return;
        // 드롭 위치의 가장 가까운 뱃지 찾기
        const badges = document.querySelectorAll('#scoring-active-badges .scoring-badge');
        const dropX = e.clientX;
        let insertBeforeId = null;
        badges.forEach(badge => {
            const rect = badge.getBoundingClientRect();
            if (dropX < rect.left + rect.width / 2) {
                if (!insertBeforeId) insertBeforeId = badge.dataset.colId;
            }
        });
        // 순서 변경
        const cols = this._getOMRColumns();
        const fromIdx = cols.findIndex(c => c.id === this._dragColId);
        if (fromIdx < 0) return;
        const [moved] = cols.splice(fromIdx, 1);
        if (insertBeforeId) {
            const toIdx = cols.findIndex(c => c.id === insertBeforeId);
            cols.splice(toIdx, 0, moved);
        } else {
            // 맨 끝에 추가 (info/custom 영역 끝)
            const lastInfoIdx = cols.reduce((last, c, i) => (c.type === 'info' || c.type === 'custom') ? i : last, -1);
            cols.splice(lastInfoIdx + 1, 0, moved);
        }
        this._dragColId = null;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 마킹/정오 열 일괄 토글
    _toggleAnswerCols(show) {
        this._getOMRColumns().forEach(c => { if (c.type === 'answer') c.visible = show; });
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },
    _toggleOXCols(show) {
        this._getOMRColumns().forEach(c => { if (c.type === 'ox') c.visible = show; });
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // ==========================================
    // 성적일람표
    // ==========================================
    _renderReport(rows) {
        const cols = this._getReportColumns().filter(c => c.visible);

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="display:flex; gap:4px;">${this._renderSortButtons()}</div>
            <button class="btn btn-sm" onclick="Scoring.downloadReport(Scoring.collectData())" style="font-size:11px;">CSV 다운로드</button>
        </div>`;

        // 뱃지 바
        html += this._renderBadgeBar(this._getReportColumns, 'toggleReportColumn', 'report');

        const th = 'style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#f8fafc; position:sticky; top:0; white-space:nowrap;"';
        const td = 'style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9;"';

        // 열별 특수 스타일
        const colStyle = {
            score: 'background:#eff6ff;', correctCount: 'background:#ecfdf5;',
            tScore: 'background:#f5f3ff;', rank: 'background:#fef3c7;', percentile: 'background:#fce7f3;',
        };

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead><tr>`;
        cols.forEach(col => {
            const extra = colStyle[col.id] || '';
            const hl = (this._highlightCol === col.id) ? 'background:#93c5fd !important;' : '';
            html += `<th style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#f8fafc; position:sticky; top:0; white-space:nowrap; ${extra} ${hl}">${col.label}</th>`;
        });
        html += `</tr></thead><tbody>`;

        rows.forEach((r, ri) => {
            const bg = ri % 2 === 0 ? '' : 'background:#f8fafc;';
            html += `<tr style="${bg}">`;
            cols.forEach(col => {
                const hl = (this._highlightCol === col.id) ? 'background:#dbeafe !important;' : '';
                let val = '', style = `style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; ${hl}"`;
                if (col.id === 'examNo') val = r.examNo;
                else if (col.id === 'name') { val = r.name; style = `style="padding:6px 8px; font-size:12px; font-weight:600; border-bottom:1px solid #f1f5f9; ${hl}"`; }
                else if (col.id === 'birthday') val = r.birthday;
                else if (col.id === 'phone') val = r.phone;
                else if (col.id === 'subjectCode') val = r.subjectCode || '';
                else if (col.id === 'filename') val = r.filename;
                else if (col.id === 'correctCount') { val = r.correctCount; style = `style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; color:#22c55e; font-weight:600; ${hl}"`; }
                else if (col.id === 'score') { val = r.score; style = `style="padding:6px 8px; text-align:center; font-size:13px; border-bottom:1px solid #f1f5f9; color:var(--blue); font-weight:700; ${hl}"`; }
                else if (col.id === 'tScore') val = r.tScore ? r.tScore.toFixed(1) : '';
                else if (col.id === 'rank') { val = r.rank || ''; style = `style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; font-weight:700; ${hl}"`; }
                else if (col.id === 'percentile') val = r.percentile ? r.percentile.toFixed(1) + '%' : '';
                else if (col.id === 'wrongCount') val = r.wrongCount;
                else if (col.id === 'totalPossible') val = r.totalPossible;
                else if (col.id && col.id.startsWith('etc_')) val = r.etcFields[col.etcName || col.id.replace('etc_', '')] || '';
                html += `<td ${style}>${val}</td>`;
            });
            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    },

    // ==========================================
    // 문항분석표
    // ==========================================
    _renderItem(items, totalN) {
        const uPct = this._upperPct;
        const lPct = this._lowerPct;
        const mPct = 100 - uPct - lPct;

        // 설정 바
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px; padding:6px 12px; background:#f8fafc; border-radius:8px; border:1px solid var(--border);">
                <span style="font-size:11px; font-weight:600;">그룹 비율</span>
                <label style="font-size:11px; display:flex; align-items:center; gap:3px;">상위
                    <input type="number" value="${uPct}" min="1" max="49" style="width:38px; padding:2px; font-size:11px; border:1px solid var(--border); border-radius:4px; text-align:center;"
                        onchange="Scoring._upperPct=parseInt(this.value)||27; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">%
                </label>
                <span style="font-size:11px; color:var(--text-muted);">중위 ${mPct}%</span>
                <label style="font-size:11px; display:flex; align-items:center; gap:3px;">하위
                    <input type="number" value="${lPct}" min="1" max="49" style="width:38px; padding:2px; font-size:11px; border:1px solid var(--border); border-radius:4px; text-align:center;"
                        onchange="Scoring._lowerPct=parseInt(this.value)||27; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">%
                </label>
                <span style="font-size:11px; color:var(--text-muted);">총 ${totalN}명</span>
            </div>
            <button class="btn btn-sm" onclick="Scoring.downloadItem(Scoring.calcItemAnalysis(Scoring.collectData()))" style="font-size:11px;">CSV 다운로드</button>
        </div>`;

        // 별색 도구: 규칙 + 수동
        const allHL = this._calcRuleHL(items);

        html += `<div style="margin-bottom:10px; padding:8px 10px; background:#f9fafb; border-radius:8px; border:1px solid var(--border);">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
                <span style="font-size:11px; font-weight:600;">별색 규칙</span>
                <span style="font-size:9px; color:var(--text-muted);">체크 후 기준값/색상 지정 · 셀 직접 클릭도 가능</span>
                <button class="btn btn-sm" style="font-size:9px; padding:2px 6px; margin-left:auto;" onclick="Scoring._manualHL={}; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">수동 초기화</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
                ${this._hlRules.map((rule, ri) => `
                <div style="display:flex; align-items:center; gap:4px; padding:3px 8px; border:1px solid ${rule.on ? rule.color : 'var(--border)'}; border-radius:6px; background:${rule.on ? rule.color+'33' : 'white'}; font-size:10px;">
                    <input type="checkbox" ${rule.on ? 'checked' : ''} onchange="Scoring._hlRules[${ri}].on=this.checked; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                    <span style="font-weight:600;" ${rule.desc ? `title="${rule.desc}"` : ''}>${rule.label}${rule.desc ? ' ℹ' : ''}</span>
                    ${rule.value !== undefined && rule.type !== 'attractive' ? `
                        <input type="number" value="${rule.value}" step="${rule.type==='disc' ? '0.01' : '1'}" style="width:45px; padding:1px 3px; font-size:10px; border:1px solid var(--border); border-radius:3px; text-align:center;"
                            onchange="Scoring._hlRules[${ri}].value=parseFloat(this.value); Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                        <span>${rule.type==='rate' ? '%' : ''}</span>
                    ` : ''}
                    <span onclick="const cs=Scoring._colors; const ci=cs.findIndex(c=>c.c===Scoring._hlRules[${ri}].color); Scoring._hlRules[${ri}].color=cs[(ci+1)%cs.length].c; Scoring.renderScoringPanel(document.getElementById('scoring-content'));"
                        style="width:14px; height:14px; border-radius:3px; background:${rule.color}; cursor:pointer; border:1px solid #aaa;" title="색상 변경 (클릭)"></span>
                </div>
                `).join('')}
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:10px; font-weight:600;">수동 별색</span>
                <div style="display:flex; gap:3px;">
                    ${this._colors.map(c => `<span onclick="Scoring._selectedColor='${c.c}'; document.querySelectorAll('.hl-sw').forEach(s=>s.style.outline=''); this.style.outline='2px solid #333';"
                        class="hl-sw" title="${c.l}"
                        style="width:16px; height:16px; border-radius:3px; background:${c.c}; cursor:pointer; border:1px solid #ccc;
                        ${this._selectedColor === c.c ? 'outline:2px solid #333;' : ''}"></span>`).join('')}
                </div>
                <span style="font-size:9px; color:var(--text-muted);">색 선택 → 셀 클릭</span>
            </div>
        </div>`;

        const thBase = 'padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border:1px solid var(--border); position:sticky; top:0;';

        const choiceNums = [1,2,3,4,5,6,7];
        const th2 = 'padding:5px 6px; text-align:center; font-size:10px; font-weight:600; border:1px solid #d1d5db; background:#e5e7eb; color:#374151; position:sticky; top:0; z-index:1;';

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead>
        <tr>
            <th style="${th2}">문항</th>
            <th style="${th2}">정답</th>
            <th style="${th2}">구분</th>
            <th style="${th2}">상위${uPct}%</th>
            <th style="${th2}">중위${mPct}%</th>
            <th style="${th2}">하위${lPct}%</th>
            <th style="${th2}">총계</th>
            <th style="${th2}">정답률</th>
            <th style="${th2}">변별도</th>
            <th style="${th2}">구분</th>
            ${choiceNums.map(n => `<th style="${th2}">${n}번</th>`).join('')}
            <th style="${th2}">공백</th>
            <th style="${th2}">중복</th>
            <th style="${th2}">계</th>
        </tr>
        </thead><tbody>`;

        const td = 'padding:4px 5px; text-align:center; font-size:10px; border:1px solid #e2e8f0;';

        // 반응분포 셀 헬퍼
        const distCells = (dist, ca, qNum, group) => {
            let h = '';
            choiceNums.forEach(n => {
                const v = dist[n] || 0;
                const isCA = ca && ca === n;
                const key = 'q'+qNum+'_d'+group+'_'+n;
                const hl = allHL[key] ? 'background:'+allHL[key]+';' : '';
                h += `<td style="${td} cursor:pointer; ${isCA ? 'font-weight:700; text-decoration:underline;' : ''} ${hl}"
                    onclick="Scoring._toggleCellHL('${key}')">${v}</td>`;
            });
            h += `<td style="${td}">${dist.blank || 0}</td>`;
            h += `<td style="${td}">${dist.multi || 0}</td>`;
            h += `<td style="${td} font-weight:600;">${dist.total || 0}</td>`;
            return h;
        };

        // 클릭 가능 셀 헬퍼
        const cc = (key, val, extra) => {
            const bg = allHL[key] ? 'background:'+allHL[key]+';' : '';
            return `<td style="${td} cursor:pointer; ${extra || ''} ${bg}" onclick="Scoring._toggleCellHL('${key}')">${val}</td>`;
        };
        const ccR = (key, val, extra) => {
            const bg = allHL[key] ? 'background:'+allHL[key]+';' : '';
            return `<td rowspan="3" style="${td} cursor:pointer; vertical-align:middle; ${extra || ''} ${bg}" onclick="Scoring._toggleCellHL('${key}')">${val}</td>`;
        };

        items.forEach((item, ri) => {
            const totalCorrect = item.upper.correct + item.mid.correct + item.lower.correct;
            const totalWrong = item.upper.wrong + item.mid.wrong + item.lower.wrong;
            const totalAll = totalCorrect + totalWrong;
            const ca = item.correctAnswer;
            const q = item.q;

            // 행 1: 정답수
            html += `<tr>
                ${ccR('q'+q+'_num', q, 'font-weight:700; font-size:11px; border-right:2px solid #d1d5db; background:#e5e7eb;')}
                ${ccR('q'+q+'_ans', ca || '', 'font-weight:600;')}
                ${cc('q'+q+'_r1_lbl', '정답', 'font-size:9px; font-weight:600;')}
                ${cc('q'+q+'_uc', item.upper.correct, '')}
                ${cc('q'+q+'_mc', item.mid.correct, '')}
                ${cc('q'+q+'_lc', item.lower.correct, '')}
                ${cc('q'+q+'_tc', totalCorrect, 'font-weight:600;')}
                ${ccR('q'+q+'_rate', item.correctRate.toFixed(1)+'%', 'font-weight:700;')}
                ${ccR('q'+q+'_disc', item.discrimination.toFixed(3), 'font-weight:700; border-right:2px solid #d1d5db;')}
                ${cc('q'+q+'_d1_lbl', '상50%', 'font-size:9px; font-weight:600;')}
                ${distCells(item.distUpper, ca, q, 'u')}
            </tr>`;

            // 행 2: 오답수
            html += `<tr>
                ${cc('q'+q+'_r2_lbl', '오답', 'font-size:9px; font-weight:600;')}
                ${cc('q'+q+'_uw', item.upper.wrong, '')}
                ${cc('q'+q+'_mw', item.mid.wrong, '')}
                ${cc('q'+q+'_lw', item.lower.wrong, '')}
                ${cc('q'+q+'_tw', totalWrong, 'font-weight:600;')}
                ${cc('q'+q+'_d2_lbl', '하50%', 'font-size:9px; font-weight:600;')}
                ${distCells(item.distLower, ca, q, 'l')}
            </tr>`;

            // 행 3: 계
            html += `<tr style="border-bottom:2px solid #94a3b8;">
                ${cc('q'+q+'_r3_lbl', '계', 'font-size:9px; font-weight:700;')}
                ${cc('q'+q+'_ut', item.upper.total, 'font-weight:700;')}
                ${cc('q'+q+'_mt', item.mid.total, 'font-weight:700;')}
                ${cc('q'+q+'_lt', item.lower.total, 'font-weight:700;')}
                ${cc('q'+q+'_tt', totalAll, 'font-weight:700;')}
                ${cc('q'+q+'_d3_lbl', '계', 'font-size:9px; font-weight:700;')}
                ${distCells(item.distTotal, ca, q, 't')}
            </tr>`;
        });

        if (items.length > 0) {
            const avgR = items.reduce((s, i) => s + i.correctRate, 0) / items.length;
            const avgD = items.reduce((s, i) => s + i.discrimination, 0) / items.length;
            html += `<tr style="background:#f8fafc; font-weight:700;">
                <td colspan="16" style="padding:8px; text-align:right; font-size:12px; border-top:2px solid var(--border);">전체 평균</td>
                <td colspan="11" style="padding:8px; font-size:12px; border-top:2px solid var(--border);">
                    정답률 <span style="color:var(--blue);">${avgR.toFixed(1)}%</span> · 변별도 <span style="color:var(--blue);">${avgD.toFixed(3)}</span>
                </td>
            </tr>`;
        }

        html += `</tbody></table></div>`;
        return html;
    }
};
