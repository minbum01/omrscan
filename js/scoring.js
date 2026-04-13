// ============================================
// scoring.js - 다과목 채점 통계 엔진 + 채점 탭 UI
// ============================================

const Scoring = {
    _activeTab: 'omr',
    _defaultMaxQ: 40,
    _sortMode: 'student',
    _selectedSubject: null, // null = 첫 번째 과목
    _upperPct: 27,
    _lowerPct: 27,
    _manualHL: {},
    _selectedColor: '#fecaca',
    _colors: [
        { c: '#fecaca', l: '빨강' }, { c: '#fed7aa', l: '주황' },
        { c: '#fef08a', l: '노랑' }, { c: '#bbf7d0', l: '초록' },
        { c: '#bfdbfe', l: '파랑' }, { c: '#e9d5ff', l: '보라' },
    ],
    _hlRules: [
        { id: 'rate_low', label: '정답률 이하', type: 'rate', op: '<=', value: 40, color: '#fecaca', on: false },
        { id: 'rate_high', label: '정답률 이상', type: 'rate', op: '>=', value: 80, color: '#bbf7d0', on: false },
        { id: 'disc_low', label: '변별도 이하', type: 'disc', op: '<=', value: 0.1, color: '#fef08a', on: false },
        { id: 'disc_neg', label: '변별도 음수', type: 'disc', op: '<', value: 0, color: '#fecaca', on: false },
        { id: 'attractive', label: '매력적 오답', type: 'attractive', color: '#fed7aa', on: false, desc: '정답보다 많이 선택된 오답 선택지' },
    ],
    _highlightCol: null,
    _clickTimer: null,
    _omrColumns: null,
    _reportColumns: null,

    // ==========================================
    // 다과목 데이터 수집
    // ==========================================
    collectData() {
        const images = App.state.images || [];
        const students = App.state.students || [];

        // 1단계: 이미지별 과목별 데이터 추출
        const imgData = []; // { examNo, name, ..., subjects: { '국어': {...}, '영어': {...} } }
        images.forEach((img, imgIdx) => {
            if (!img.results) return;

            const entry = {
                imgIdx, filename: img._originalName || img.name || '',
                examNo: '', name: '', birthday: '', phone: '', subjectCode: '',
                etcFields: {},
                subjects: {},
            };

            img.rois.forEach((roi, roiIdx) => {
                if (!roi.settings) return;
                const res = img.results[roiIdx];
                if (!res) return;
                const type = roi.settings.type;
                const subjName = roi.settings.name || '';

                const digits = (res.rows || []).map(r => {
                    if (r.markedAnswer !== null) {
                        const labels = roi.settings.choiceLabels;
                        return labels && labels[r.markedAnswer - 1] ? labels[r.markedAnswer - 1] : String(r.markedAnswer);
                    }
                    return '?';
                }).join('');

                if (type === 'exam_no' || type === 'phone_exam') entry.examNo = digits;
                else if (type === 'phone') entry.phone = digits;
                else if (type === 'birthday') entry.birthday = digits;
                else if (type === 'subject_code') entry.subjectCode = digits;
                else if (type === 'etc') entry.etcFields[subjName || '기타'] = digits;
                else if (type === 'subject_answer' && subjName) {
                    if (!entry.subjects[subjName]) {
                        entry.subjects[subjName] = { score: 0, correctCount: 0, wrongCount: 0, totalPossible: 0, answers: [] };
                    }
                    const subj = entry.subjects[subjName];

                    // 채점 결과에서 해당 ROI 점수 추출
                    if (img.gradeResult && img.gradeResult.details) {
                        const startNum = roi.settings.startNum || 1;
                        const numQ = roi.settings.numQuestions || 0;
                        img.gradeResult.details.forEach(d => {
                            if (d.questionNumber >= startNum && d.questionNumber < startNum + numQ) {
                                if (d.isCorrect) { subj.correctCount++; subj.score += (d.score || 0); }
                                else subj.wrongCount++;
                                subj.totalPossible += (d.score || 0) + (d.isCorrect ? 0 : (img.gradeResult.totalPossible > 0 ? img.gradeResult.totalPossible / (img.gradeResult.correctCount + img.gradeResult.wrongCount || 1) : 0));
                            }
                        });
                    }

                    (res.rows || []).forEach(r => {
                        const labels = roi.settings.choiceLabels;
                        const markedLabel = r.markedAnswer !== null && labels
                            ? (labels[r.markedAnswer - 1] || String(r.markedAnswer))
                            : (r.markedAnswer !== null ? String(r.markedAnswer) : '');
                        const detail = img.gradeResult && img.gradeResult.details
                            ? img.gradeResult.details.find(d => d.questionNumber === r.questionNumber) : null;
                        subj.answers.push({
                            q: r.questionNumber, marked: r.markedAnswer, markedLabel,
                            isCorrect: detail ? detail.isCorrect : false,
                            correctAnswer: detail ? detail.correctAnswer : null,
                        });
                    });
                }
            });

            // 과목이 없는 이미지 (subject_answer ROI에 이름 없는 경우) — 기존 호환
            if (Object.keys(entry.subjects).length === 0 && img.gradeResult) {
                entry.subjects['기본'] = {
                    score: img.gradeResult.score || 0,
                    correctCount: img.gradeResult.correctCount || 0,
                    wrongCount: img.gradeResult.wrongCount || 0,
                    totalPossible: img.gradeResult.totalPossible || 0,
                    answers: [],
                };
                // answers 수집
                img.rois.forEach((roi, roiIdx) => {
                    if (!roi.settings || roi.settings.type !== 'subject_answer') return;
                    const res = img.results[roiIdx];
                    if (!res) return;
                    (res.rows || []).forEach(r => {
                        const labels = roi.settings.choiceLabels;
                        const ml = r.markedAnswer !== null && labels ? (labels[r.markedAnswer-1]||String(r.markedAnswer)) : (r.markedAnswer!=null?String(r.markedAnswer):'');
                        const det = img.gradeResult.details ? img.gradeResult.details.find(d=>d.questionNumber===r.questionNumber) : null;
                        entry.subjects['기본'].answers.push({ q:r.questionNumber, marked:r.markedAnswer, markedLabel:ml, isCorrect:det?det.isCorrect:false, correctAnswer:det?det.correctAnswer:null });
                    });
                });
            }

            imgData.push(entry);
        });

        // 2단계: 학생별 합산 (수험번호/전화번호로 같은 학생 매칭)
        const studentMap = new Map(); // key → merged entry
        imgData.forEach(entry => {
            const key = entry.examNo || entry.phone || ('img_' + entry.imgIdx);
            if (studentMap.has(key)) {
                const existing = studentMap.get(key);
                // 과목 합산
                Object.entries(entry.subjects).forEach(([subj, data]) => {
                    if (!existing.subjects[subj]) {
                        existing.subjects[subj] = { ...data, answers: [...data.answers] };
                    } else {
                        const es = existing.subjects[subj];
                        es.score += data.score;
                        es.correctCount += data.correctCount;
                        es.wrongCount += data.wrongCount;
                        es.totalPossible += data.totalPossible;
                        es.answers.push(...data.answers);
                    }
                });
                // 정보 보완
                if (!existing.name && entry.name) existing.name = entry.name;
                if (!existing.birthday && entry.birthday) existing.birthday = entry.birthday;
                Object.assign(existing.etcFields, entry.etcFields);
            } else {
                studentMap.set(key, { ...entry, subjects: { ...entry.subjects } });
            }
        });

        let rows = [...studentMap.values()];

        // 총점 계산
        rows.forEach(r => {
            r.totalScore = Object.values(r.subjects).reduce((s, sub) => s + (sub.score || 0), 0);
            r.totalCorrect = Object.values(r.subjects).reduce((s, sub) => s + (sub.correctCount || 0), 0);
            r.totalWrong = Object.values(r.subjects).reduce((s, sub) => s + (sub.wrongCount || 0), 0);
            r.totalPossible = Object.values(r.subjects).reduce((s, sub) => s + (sub.totalPossible || 0), 0);
        });

        // 3단계: 시험인원 순서 정렬 + OMR 없는 인원
        if (students.length > 0) {
            const ordered = [];
            const usedKeys = new Set();
            students.forEach(st => {
                const matched = rows.find(r => {
                    if (usedKeys.has(r.examNo || r.phone || 'x')) return false;
                    return (st.examNo && r.examNo && st.examNo === r.examNo) ||
                           (st.phone && r.phone && st.phone === r.phone);
                });
                if (matched) {
                    usedKeys.add(matched.examNo || matched.phone || 'x');
                    matched.name = st.name || matched.name;
                    if (!matched.birthday && st.birth) matched.birthday = st.birth;
                    ordered.push(matched);
                } else {
                    ordered.push({
                        imgIdx: -1, filename: '', examNo: st.examNo || '', name: st.name || '',
                        birthday: st.birth || '', phone: st.phone || '', subjectCode: '', etcFields: {},
                        subjects: {}, totalScore: '', totalCorrect: '', totalWrong: '', _noOmr: true,
                    });
                }
            });
            rows.filter(r => !usedKeys.has(r.examNo || r.phone || 'x')).forEach(r => ordered.push(r));
            rows = ordered;
        }

        // 정렬
        if (this._sortMode === 'score_desc') {
            rows.sort((a, b) => {
                if (a._noOmr) return 1; if (b._noOmr) return -1;
                return (b.totalScore || 0) - (a.totalScore || 0);
            });
        }

        return rows;
    },

    // 전체 과목 목록
    getSubjectList(rows) {
        const set = new Set();
        rows.forEach(r => Object.keys(r.subjects || {}).forEach(s => set.add(s)));
        return [...set];
    },

    // 현재 선택된 과목
    getCurrentSubject(rows) {
        const list = this.getSubjectList(rows);
        if (this._selectedSubject && list.includes(this._selectedSubject)) return this._selectedSubject;
        return list[0] || '기본';
    },

    // ==========================================
    // 통계 (과목별 + 총점)
    // ==========================================
    calcStats(rows, subjectName) {
        const validRows = rows.filter(r => !r._noOmr && r.subjects);
        if (validRows.length === 0) return null;
        const N = validRows.length;
        const scores = validRows.map(r => subjectName ? (r.subjects[subjectName]?.score || 0) : (r.totalScore || 0));
        const mean = scores.reduce((s, v) => s + v, 0) / N;
        const stdDev = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / N);
        const sorted = [...scores].sort((a, b) => b - a);

        validRows.forEach(r => {
            const sc = subjectName ? (r.subjects[subjectName]?.score || 0) : (r.totalScore || 0);
            const key = subjectName ? `_stat_${subjectName}` : '_stat_total';
            r[key] = {
                rank: sorted.filter(s => s > sc).length + 1,
                tScore: stdDev > 0 ? ((sc - mean) / stdDev) * 20 + 100 : 100,
                percentile: ((N - (sorted.filter(s => s > sc).length + 1)) / N) * 100,
            };
        });

        return { N, mean, stdDev, max: Math.max(...scores), min: Math.min(...scores) };
    },

    // ==========================================
    // 문항분석 (과목별)
    // ==========================================
    calcItemAnalysis(rows, subjectName) {
        const valid = rows.filter(r => !r._noOmr && r.subjects && r.subjects[subjectName]);
        if (valid.length === 0) return [];
        const N = valid.length;
        const uPct = this._upperPct / 100, lPct = this._lowerPct / 100;
        const sortedR = [...valid].sort((a, b) => (b.subjects[subjectName]?.score||0) - (a.subjects[subjectName]?.score||0));
        const upperN = Math.max(1, Math.ceil(N * uPct));
        const lowerN = Math.max(1, Math.ceil(N * lPct));
        const upperRows = sortedR.slice(0, upperN);
        const midRows = sortedR.slice(upperN, N - lowerN);
        const lowerRows = sortedR.slice(N - lowerN);
        const upperHalf = sortedR.slice(0, Math.ceil(N / 2));
        const lowerHalf = sortedR.slice(Math.ceil(N / 2));

        const allQ = new Set();
        valid.forEach(r => (r.subjects[subjectName]?.answers||[]).forEach(a => allQ.add(a.q)));
        return [...allQ].sort((a, b) => a - b).map(q => {
            const gc = group => group.filter(r => { const a = (r.subjects[subjectName]?.answers||[]).find(x=>x.q===q); return a && a.isCorrect; }).length;
            const U = gc(upperRows), M = gc(midRows), L = gc(lowerRows), T = gc(valid);
            const sample = valid[0].subjects[subjectName].answers.find(a => a.q === q);
            const correctRate = (T / N) * 100;
            const avgPct = (uPct + lPct) / 2;
            const discrimination = (avgPct * N) > 0 ? (U - L) / (avgPct * N) : 0;

            const getDist = group => {
                const dist = { blank: 0, multi: 0 };
                for (let n = 1; n <= 7; n++) dist[n] = 0;
                group.forEach(r => {
                    const a = (r.subjects[subjectName]?.answers||[]).find(x=>x.q===q);
                    if (!a || a.marked === null) dist.blank++;
                    else if (a.marked >= 1 && a.marked <= 7) dist[a.marked]++;
                });
                dist.total = group.length;
                return dist;
            };

            return { q, correctAnswer: sample?.correctAnswer,
                upper: { correct: U, wrong: upperN-U, total: upperN },
                mid: { correct: M, wrong: midRows.length-M, total: midRows.length },
                lower: { correct: L, wrong: lowerN-L, total: lowerN },
                totalCorrect: T, correctRate, discrimination,
                distUpper: getDist(upperHalf), distLower: getDist(lowerHalf), distTotal: getDist(valid) };
        });
    },

    // ==========================================
    // CSV
    // ==========================================
    _dl(csv, name) { SubjectManager._downloadFile(csv, `${name}_${SessionManager.currentSessionName||''}_${new Date().toISOString().slice(0,10)}.csv`); },

    downloadOMR(rows, subj) {
        const maxQ = this._defaultMaxQ;
        let csv = `응시번호,성명,${subj}점수`;
        for (let i = 1; i <= maxQ; i++) csv += `,${i}번`;
        for (let i = 1; i <= maxQ; i++) csv += `,${i}번정오`;
        csv += '\n';
        rows.forEach(r => {
            const s = r.subjects?.[subj];
            csv += `${r.examNo},${r.name},${s ? s.score : ''}`;
            for (let i = 1; i <= maxQ; i++) { const a = s?.answers?.find(x=>x.q===i); csv += `,${a?a.markedLabel:''}`; }
            for (let i = 1; i <= maxQ; i++) { const a = s?.answers?.find(x=>x.q===i); csv += `,${a?(a.isCorrect?'O':'X'):''}`; }
            csv += '\n';
        });
        this._dl(csv, `OMR결과표_${subj}`);
    },

    downloadAllOMR(rows) {
        this.getSubjectList(rows).forEach(subj => this.downloadOMR(rows, subj));
    },

    // ==========================================
    // 메인 렌더
    // ==========================================
    renderScoringPanel(container) {
        const rows = this.collectData();
        const subjects = this.getSubjectList(rows);
        const curSubj = this.getCurrentSubject(rows);

        // 모든 과목 + 총점 통계 계산
        subjects.forEach(s => this.calcStats(rows, s));
        this.calcStats(rows, null); // 총점
        const totalStats = this.calcStats(rows, null);

        let html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                <h1 style="font-size:22px; font-weight:700; margin:0;">채점 결과</h1>
                <span style="font-size:13px; color:var(--text-muted);">${SessionManager.currentSessionName||''} · ${subjects.length}과목</span>
            </div>`;

        // 요약 카드
        if (totalStats) {
            html += `<div style="display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin-bottom:20px;">
                ${this._card('응시', totalStats.N+'명', '#3b82f6')}
                ${this._card('평균', totalStats.mean.toFixed(1), '#8b5cf6')}
                ${this._card('표준편차', totalStats.stdDev.toFixed(2), '#6366f1')}
                ${this._card('최고', totalStats.max+'', '#22c55e')}
                ${this._card('최저', totalStats.min+'', '#ef4444')}
            </div>`;
        }

        if (rows.length === 0 || subjects.length === 0) {
            html += `<div style="text-align:center; padding:60px; color:var(--text-muted);">채점된 데이터가 없습니다.</div></div>`;
            container.innerHTML = html; return;
        }

        // 탭
        html += `<div style="display:flex; gap:2px; margin-bottom:16px; border-bottom:2px solid var(--border);">
            ${['omr','report','item','personal'].map(t => {
                const labels = { omr:'OMR 결과표', report:'성적일람표', item:'문항분석표', personal:'개인별 성적표' };
                const active = this._activeTab === t;
                return `<button onclick="Scoring._activeTab='${t}'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));"
                    style="padding:8px 18px; font-size:13px; font-weight:${active?'700':'500'}; border:none;
                    background:${active?'white':'transparent'}; color:${active?'var(--blue)':'var(--text-muted)'};
                    border-bottom:${active?'3px solid var(--blue)':'3px solid transparent'}; cursor:pointer;">${labels[t]}</button>`;
            }).join('')}
        </div>`;

        // 과목 선택 (OMR결과표/문항분석표)
        if (['omr','item'].includes(this._activeTab) && subjects.length > 1) {
            html += `<div style="display:flex; gap:4px; margin-bottom:10px; flex-wrap:wrap;">
                ${subjects.map(s => `<button class="btn btn-sm" style="font-size:11px; ${curSubj===s?'background:var(--blue);color:#fff;':''}"
                    onclick="Scoring._selectedSubject='${s}'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">${s}</button>`).join('')}
            </div>`;
        }

        if (this._activeTab === 'omr') html += this._renderOMR(rows, curSubj);
        else if (this._activeTab === 'report') html += this._renderReport(rows, subjects);
        else if (this._activeTab === 'item') html += this._renderItem(rows, curSubj);
        else if (this._activeTab === 'personal') html += this._renderPersonal(rows, subjects);

        html += `</div>`;
        container.innerHTML = html;
    },

    _card(l, v, c) {
        return `<div style="background:white; border-radius:10px; padding:14px; box-shadow:0 1px 3px rgba(0,0,0,0.08); border-left:4px solid ${c};">
            <div style="font-size:10px; color:var(--text-muted);">${l}</div>
            <div style="font-size:18px; font-weight:700; color:${c};">${v}</div></div>`;
    },

    // ==========================================
    // OMR 결과표 (과목별)
    // ==========================================
    _renderOMR(rows, subj) {
        const maxQ = this._defaultMaxQ;
        const sortBtns = this._sortBtns();
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; gap:4px;">${sortBtns}</div>
            <div style="display:flex; gap:4px;">
                <button class="btn btn-sm" style="font-size:10px;" onclick="Scoring.downloadOMR(Scoring.collectData(),'${subj}')">CSV (${subj})</button>
                <button class="btn btn-sm" style="font-size:10px;" onclick="Scoring.downloadAllOMR(Scoring.collectData())">CSV (전체 과목)</button>
            </div>
        </div>`;

        // 동명이인 감지
        const nameCount = {};
        rows.forEach(r => { if (r.name) nameCount[r.name] = (nameCount[r.name]||0)+1; });

        const th = 'padding:5px 6px; text-align:center; font-size:10px; font-weight:600; border:1px solid #d1d5db; background:#e5e7eb; position:sticky; top:0; z-index:1;';
        const td = 'padding:4px 5px; text-align:center; font-size:10px; border:1px solid #e2e8f0;';

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;"><thead><tr>
            <th style="${th}">응시번호</th><th style="${th}">성명</th><th style="${th}">${subj} 점수</th>`;
        for (let i = 1; i <= maxQ; i++) html += `<th style="${th}">${i}</th>`;
        for (let i = 1; i <= maxQ; i++) html += `<th style="${th} background:#fef3c7;">${i}</th>`;
        html += `</tr></thead><tbody>`;

        rows.forEach((r, ri) => {
            const s = r.subjects?.[subj];
            const dup = nameCount[r.name] > 1 && r.name;
            const bg = dup ? 'background:#fef08a;' : (ri%2?'background:#f8fafc;':'');
            html += `<tr style="${bg}" ${dup?'title="동명이인 또는 체킹 오류 확인 필요"':''}>
                <td style="${td}">${r.examNo}</td>
                <td style="${td} font-weight:600;">${r.name}</td>
                <td style="${td} font-weight:700; color:var(--blue);">${s?s.score:''}</td>`;
            for (let i=1;i<=maxQ;i++) { const a=s?.answers?.find(x=>x.q===i); html+=`<td style="${td}">${a?a.markedLabel:''}</td>`; }
            for (let i=1;i<=maxQ;i++) { const a=s?.answers?.find(x=>x.q===i); const ox=a?(a.isCorrect?'O':'X'):''; html+=`<td style="${td} ${ox==='O'?'color:#22c55e;':''}${ox==='X'?'color:#ef4444;':''} font-weight:700;">${ox}</td>`; }
            html += `</tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    },

    // ==========================================
    // 성적일람표 (과목별 열 반복 + 총점)
    // ==========================================
    _renderReport(rows, subjects) {
        const sortBtns = this._sortBtns();
        const nameCount = {};
        rows.forEach(r => { if (r.name) nameCount[r.name] = (nameCount[r.name]||0)+1; });

        let html = `<div style="display:flex; justify-content:space-between; margin-bottom:10px;">
            <div style="display:flex; gap:4px;">${sortBtns}</div>
            <button class="btn btn-sm" style="font-size:10px;" onclick="Scoring._downloadReport()">CSV 다운로드</button>
        </div>`;

        const th = 'padding:5px 6px; text-align:center; font-size:10px; font-weight:600; border:1px solid #d1d5db; background:#e5e7eb; position:sticky; top:0; z-index:1; white-space:nowrap;';
        const td = 'padding:4px 6px; text-align:center; font-size:11px; border:1px solid #e2e8f0;';

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;"><thead>
        <tr>
            <th style="${th}" rowspan="2">응시번호</th>
            <th style="${th}" rowspan="2">성명</th>
            <th style="${th}" rowspan="2">생년월일</th>`;
        subjects.forEach(s => { html += `<th style="${th} background:#dbeafe;" colspan="5">${s}</th>`; });
        html += `<th style="${th} background:#f0fdf4;" colspan="5">총점</th></tr><tr>`;
        const subHeaders = ['맞은수','점수','표준점수','석차','백분위'];
        for (let i = 0; i < subjects.length + 1; i++) {
            subHeaders.forEach(h => { html += `<th style="${th} font-size:9px;">${h}</th>`; });
        }
        html += `</tr></thead><tbody>`;

        rows.forEach((r, ri) => {
            const dup = nameCount[r.name] > 1 && r.name;
            const bg = dup ? 'background:#fef08a;' : (ri%2?'background:#f8fafc;':'');
            html += `<tr style="${bg}">
                <td style="${td}">${r.examNo}</td>
                <td style="${td} font-weight:600;">${r.name}</td>
                <td style="${td}">${r.birthday||''}</td>`;

            subjects.forEach(s => {
                const sub = r.subjects?.[s];
                const stat = r[`_stat_${s}`];
                if (sub && stat) {
                    html += `<td style="${td}">${sub.correctCount}</td>
                        <td style="${td} font-weight:700; color:var(--blue);">${sub.score}</td>
                        <td style="${td}">${stat.tScore.toFixed(1)}</td>
                        <td style="${td} font-weight:700;">${stat.rank}</td>
                        <td style="${td}">${stat.percentile.toFixed(1)}%</td>`;
                } else {
                    html += '<td style="'+td+'"></td>'.repeat(5);
                }
            });

            // 총점
            const tStat = r['_stat_total'];
            if (!r._noOmr && tStat) {
                html += `<td style="${td}">${r.totalCorrect}</td>
                    <td style="${td} font-weight:700; color:var(--blue);">${r.totalScore}</td>
                    <td style="${td}">${tStat.tScore.toFixed(1)}</td>
                    <td style="${td} font-weight:700;">${tStat.rank}</td>
                    <td style="${td}">${tStat.percentile.toFixed(1)}%</td>`;
            } else {
                html += '<td style="'+td+'"></td>'.repeat(5);
            }
            html += `</tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    },

    _downloadReport() {
        const rows = this.collectData();
        const subjects = this.getSubjectList(rows);
        let csv = '응시번호,성명,생년월일';
        subjects.forEach(s => csv += `,${s}_맞은수,${s}_점수,${s}_표준점수,${s}_석차,${s}_백분위`);
        csv += ',총점_맞은수,총점_점수,총점_표준점수,총점_석차,총점_백분위\n';
        rows.forEach(r => {
            csv += `${r.examNo},${r.name},${r.birthday||''}`;
            subjects.forEach(s => {
                const sub=r.subjects?.[s]; const st=r[`_stat_${s}`];
                csv += sub&&st ? `,${sub.correctCount},${sub.score},${st.tScore.toFixed(1)},${st.rank},${st.percentile.toFixed(1)}` : ',,,,,';
            });
            const t=r['_stat_total'];
            csv += !r._noOmr&&t ? `,${r.totalCorrect},${r.totalScore},${t.tScore.toFixed(1)},${t.rank},${t.percentile.toFixed(1)}` : ',,,,,';
            csv += '\n';
        });
        this._dl(csv, '성적일람표');
    },

    // ==========================================
    // 문항분석표 (과목별)
    // ==========================================
    _renderItem(rows, subj) {
        const items = this.calcItemAnalysis(rows, subj);
        const valid = rows.filter(r=>!r._noOmr&&r.subjects&&r.subjects[subj]);
        const N = valid.length;
        const uPct = this._upperPct, lPct = this._lowerPct, mPct = 100-uPct-lPct;

        let html = `<div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px; padding:4px 10px; background:#f9fafb; border-radius:6px; border:1px solid var(--border);">
                <span style="font-size:10px; font-weight:600;">그룹</span>
                <label style="font-size:10px;">상위<input type="number" value="${uPct}" min="1" max="49" style="width:35px; padding:1px; font-size:10px; border:1px solid var(--border); border-radius:3px; text-align:center;"
                    onchange="Scoring._upperPct=parseInt(this.value)||27; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">%</label>
                <span style="font-size:10px; color:var(--text-muted);">중위${mPct}%</span>
                <label style="font-size:10px;">하위<input type="number" value="${lPct}" min="1" max="49" style="width:35px; padding:1px; font-size:10px; border:1px solid var(--border); border-radius:3px; text-align:center;"
                    onchange="Scoring._lowerPct=parseInt(this.value)||27; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">%</label>
                <span style="font-size:10px; color:var(--text-muted);">총${N}명</span>
            </div>
            <button class="btn btn-sm" style="font-size:10px;" onclick="Scoring._dl('',' ')">CSV</button>
        </div>`;

        if (items.length === 0) { return html + '<div style="padding:20px; text-align:center; color:var(--text-muted);">데이터 없음</div>'; }

        const th2 = 'padding:5px 6px; text-align:center; font-size:10px; font-weight:600; border:1px solid #d1d5db; background:#e5e7eb; position:sticky; top:0; z-index:1;';
        const td = 'padding:4px 5px; text-align:center; font-size:10px; border:1px solid #e2e8f0;';
        const choiceNums = [1,2,3,4,5,6,7];

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;"><thead><tr>
            <th style="${th2}">문항</th><th style="${th2}">정답</th><th style="${th2}">구분</th>
            <th style="${th2}">상위${uPct}%</th><th style="${th2}">중위${mPct}%</th><th style="${th2}">하위${lPct}%</th><th style="${th2}">총계</th>
            <th style="${th2}">정답률</th><th style="${th2}">변별도</th>
            <th style="${th2}">구분</th>
            ${choiceNums.map(n=>`<th style="${th2}">${n}번</th>`).join('')}
            <th style="${th2}">공백</th><th style="${th2}">중복</th><th style="${th2}">계</th>
        </tr></thead><tbody>`;

        const distC = (dist, ca) => choiceNums.map(n => {
            const v=dist[n]||0; const isCA=ca&&ca===n;
            return `<td style="${td} ${isCA?'font-weight:700; text-decoration:underline;':''}">${v}</td>`;
        }).join('') + `<td style="${td}">${dist.blank||0}</td><td style="${td}">${dist.multi||0}</td><td style="${td} font-weight:600;">${dist.total||0}</td>`;

        items.forEach(item => {
            const tc = item.upper.correct+item.mid.correct+item.lower.correct;
            const tw = item.upper.wrong+item.mid.wrong+item.lower.wrong;
            const ca = item.correctAnswer;
            html += `<tr>
                <td rowspan="3" style="${td} font-weight:700; background:#e5e7eb; border-right:2px solid #94a3b8;">${item.q}</td>
                <td rowspan="3" style="${td} font-weight:600;">${ca||''}</td>
                <td style="${td} font-size:9px; font-weight:600;">정답</td>
                <td style="${td}">${item.upper.correct}</td><td style="${td}">${item.mid.correct}</td><td style="${td}">${item.lower.correct}</td>
                <td style="${td} font-weight:600;">${tc}</td>
                <td rowspan="3" style="${td} font-weight:700;">${item.correctRate.toFixed(1)}%</td>
                <td rowspan="3" style="${td} font-weight:700; border-right:2px solid #94a3b8;">${item.discrimination.toFixed(3)}</td>
                <td style="${td} font-size:9px; font-weight:600;">상50%</td>${distC(item.distUpper,ca)}</tr>`;
            html += `<tr><td style="${td} font-size:9px; font-weight:600;">오답</td>
                <td style="${td}">${item.upper.wrong}</td><td style="${td}">${item.mid.wrong}</td><td style="${td}">${item.lower.wrong}</td>
                <td style="${td} font-weight:600;">${tw}</td>
                <td style="${td} font-size:9px; font-weight:600;">하50%</td>${distC(item.distLower,ca)}</tr>`;
            html += `<tr style="border-bottom:2px solid #94a3b8;"><td style="${td} font-size:9px; font-weight:700;">계</td>
                <td style="${td} font-weight:700;">${item.upper.total}</td><td style="${td} font-weight:700;">${item.mid.total}</td>
                <td style="${td} font-weight:700;">${item.lower.total}</td><td style="${td} font-weight:700;">${tc+tw}</td>
                <td style="${td} font-size:9px; font-weight:700;">계</td>${distC(item.distTotal,ca)}</tr>`;
        });

        if (items.length > 0) {
            const avgR = items.reduce((s,i)=>s+i.correctRate,0)/items.length;
            const avgD = items.reduce((s,i)=>s+i.discrimination,0)/items.length;
            html += `<tr style="background:#f8fafc; font-weight:700;">
                <td colspan="7" style="padding:6px; text-align:right; border-top:2px solid var(--border);">평균</td>
                <td style="padding:6px; text-align:center; border-top:2px solid var(--border);">${avgR.toFixed(1)}%</td>
                <td style="padding:6px; text-align:center; border-top:2px solid var(--border);">${avgD.toFixed(3)}</td>
                <td colspan="11" style="border-top:2px solid var(--border);"></td></tr>`;
        }
        html += `</tbody></table></div>`;
        return html;
    },

    // ==========================================
    // 개인별 성적표
    // ==========================================
    _personalIdx: 0,
    _renderPersonal(rows, subjects) {
        const validRows = rows.filter(r => !r._noOmr);
        if (validRows.length === 0) return '<div style="padding:40px; text-align:center; color:var(--text-muted);">데이터 없음</div>';

        const idx = Math.min(this._personalIdx, validRows.length - 1);
        const r = validRows[idx];

        let html = `<div style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">
            <button class="btn btn-sm" ${idx<=0?'disabled':''} onclick="Scoring._personalIdx--; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">◀ 이전</button>
            <select style="padding:4px 8px; font-size:12px; border:1px solid var(--border); border-radius:4px;" onchange="Scoring._personalIdx=parseInt(this.value); Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                ${validRows.map((vr, i) => `<option value="${i}" ${i===idx?'selected':''}>${vr.examNo||''} ${vr.name||'학생'+(i+1)}</option>`).join('')}
            </select>
            <button class="btn btn-sm" ${idx>=validRows.length-1?'disabled':''} onclick="Scoring._personalIdx++; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">다음 ▶</button>
            <span style="font-size:11px; color:var(--text-muted);">${idx+1} / ${validRows.length}</span>
        </div>`;

        // 개인 정보 카드
        html += `<div style="background:white; border-radius:12px; padding:20px; box-shadow:0 2px 8px rgba(0,0,0,0.06); margin-bottom:16px;">
            <div style="display:flex; gap:24px; align-items:center; margin-bottom:16px;">
                <div>
                    <div style="font-size:24px; font-weight:700;">${r.name||'이름 없음'}</div>
                    <div style="font-size:12px; color:var(--text-muted);">수험번호: ${r.examNo||'-'} · 생년월일: ${r.birthday||'-'}</div>
                </div>
                <div style="margin-left:auto; text-align:right;">
                    <div style="font-size:36px; font-weight:800; color:var(--blue);">${r.totalScore||0}<span style="font-size:16px; font-weight:400; color:var(--text-muted);">점</span></div>
                    <div style="font-size:12px; color:var(--text-muted);">총점 석차: ${r._stat_total?.rank||'-'}등</div>
                </div>
            </div>

            <!-- 과목별 카드 -->
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:12px;">
                ${subjects.map(s => {
                    const sub = r.subjects?.[s];
                    const stat = r[`_stat_${s}`];
                    if (!sub) return '';
                    const pct = sub.totalPossible > 0 ? Math.round((sub.score / sub.totalPossible) * 100) : 0;
                    const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#3b82f6' : pct >= 40 ? '#f59e0b' : '#ef4444';
                    return `<div style="border:1px solid var(--border); border-radius:10px; padding:14px; position:relative; overflow:hidden;">
                        <div style="position:absolute; bottom:0; left:0; right:0; height:${pct}%; background:${color}11; transition:height 0.3s;"></div>
                        <div style="position:relative;">
                            <div style="font-size:13px; font-weight:700;">${s}</div>
                            <div style="font-size:28px; font-weight:800; color:${color};">${sub.score}<span style="font-size:12px; color:var(--text-muted);">/${sub.totalPossible||'?'}</span></div>
                            <div style="font-size:11px; color:var(--text-muted);">
                                맞음 ${sub.correctCount} · 틀림 ${sub.wrongCount}<br>
                                ${stat?`석차 ${stat.rank}등 · 백분위 ${stat.percentile.toFixed(1)}%`:''}
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;

        // 과목별 정오 차트
        html += `<div style="background:white; border-radius:12px; padding:20px; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
            <h3 style="font-size:14px; font-weight:700; margin:0 0 12px 0;">문항별 정오표</h3>`;
        subjects.forEach(s => {
            const sub = r.subjects?.[s];
            if (!sub || !sub.answers || sub.answers.length === 0) return;
            html += `<div style="margin-bottom:12px;">
                <div style="font-size:12px; font-weight:600; margin-bottom:4px;">${s} (${sub.correctCount}/${sub.answers.length})</div>
                <div style="display:flex; flex-wrap:wrap; gap:3px;">
                    ${sub.answers.sort((a,b)=>a.q-b.q).map(a => {
                        const bg = a.isCorrect ? '#dcfce7' : '#fee2e2';
                        const color = a.isCorrect ? '#16a34a' : '#dc2626';
                        return `<div style="width:28px; height:28px; border-radius:4px; background:${bg}; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:8px;">
                            <span style="color:var(--text-muted);">${a.q}</span>
                            <span style="font-weight:700; color:${color};">${a.isCorrect?'O':'X'}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        });
        html += `</div>`;
        return html;
    },

    // 정렬 버튼
    _sortBtns() {
        return `<button class="btn btn-sm" style="font-size:10px; ${this._sortMode==='student'?'background:var(--blue);color:#fff;':''}"
            onclick="Scoring._sortMode='student'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">인원명단순</button>
        <button class="btn btn-sm" style="font-size:10px; ${this._sortMode==='score_desc'?'background:var(--blue);color:#fff;':''}"
            onclick="Scoring._sortMode='score_desc'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">성적 내림차순</button>`;
    },

    // 셀 별색 토글
    _toggleCellHL(key) {
        if (this._manualHL[key]) delete this._manualHL[key];
        else this._manualHL[key] = this._selectedColor;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },
};
