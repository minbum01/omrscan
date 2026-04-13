// ============================================
// scoring.js - 채점 통계 엔진 + 채점 탭 UI
// ============================================

const Scoring = {
    _activeTab: 'omr',
    _defaultMaxQ: 40,
    _showColumnSettings: false,

    // OMR 결과표 열 설정 (사용자 커스터마이징)
    _omrColumns: null, // null이면 기본값 사용
    _getOMRColumns() {
        if (this._omrColumns) return this._omrColumns;
        // 기본 열 구성
        const cols = [
            { id: 'examNo', label: '응시번호', type: 'info', visible: true },
            { id: 'name', label: '성명', type: 'info', visible: true },
            { id: 'score', label: '점수', type: 'info', visible: true },
        ];
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
    // 데이터 수집
    // ==========================================
    collectData() {
        const images = App.state.images || [];
        const students = App.state.students || [];
        const rows = [];

        images.forEach((img, imgIdx) => {
            if (!img.results || !img.gradeResult) return;

            const row = {
                imgIdx,
                filename: img._originalName || img.name || '',
                examNo: '', name: '', birthday: '', phone: '',
                etcFields: {},
                // gradeResult 필드명 매칭
                score: img.gradeResult.score || 0,
                totalPossible: img.gradeResult.totalPossible || 0,
                correctCount: img.gradeResult.correctCount || 0,
                wrongCount: img.gradeResult.wrongCount || 0,
                answers: [],
            };

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
                    (res.rows || []).forEach(r => {
                        const labels = roi.settings.choiceLabels;
                        const markedLabel = r.markedAnswer !== null && labels
                            ? (labels[r.markedAnswer - 1] || String(r.markedAnswer))
                            : (r.markedAnswer !== null ? String(r.markedAnswer) : '');
                        row.answers.push({ q: r.questionNumber, marked: r.markedAnswer, markedLabel, isCorrect: false });
                    });
                }
            });

            if (img.gradeResult.details) {
                img.gradeResult.details.forEach(d => {
                    const ans = row.answers.find(a => a.q === d.questionNumber);
                    if (ans) { ans.isCorrect = d.isCorrect; ans.correctAnswer = d.correctAnswer; }
                });
            }

            // 시험인원 매칭
            if (students.length > 0) {
                const matched = students.find(st =>
                    (row.examNo && st.examNo && st.examNo === row.examNo) ||
                    (row.phone && st.phone && st.phone === row.phone)
                );
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

    // ==========================================
    // 통계 계산
    // ==========================================
    calcStats(rows) {
        if (rows.length === 0) return null;
        const N = rows.length;
        const scores = rows.map(r => r.score);
        const mean = scores.reduce((s, v) => s + v, 0) / N;
        const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / N;
        const stdDev = Math.sqrt(variance);

        const sorted = [...scores].sort((a, b) => b - a);
        rows.forEach(r => {
            r.rank = sorted.filter(s => s > r.score).length + 1;
            r.tScore = stdDev > 0 ? ((r.score - mean) / stdDev) * 20 + 100 : 100;
            r.percentile = ((N - r.rank) / N) * 100;
        });

        return { N, mean, stdDev, max: Math.max(...scores), min: Math.min(...scores) };
    },

    // ==========================================
    // 문항분석
    // ==========================================
    calcItemAnalysis(rows) {
        if (rows.length === 0) return [];
        const N = rows.length;
        const sortedRows = [...rows].sort((a, b) => b.score - a.score);
        const upperN = Math.ceil(N * 0.27);
        const lowerN = Math.ceil(N * 0.27);
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
            // 변별도 = (U - L) / (0.27 × N)
            const discrimination = (0.27 * N) > 0 ? (U - L) / (0.27 * N) : 0;

            return { q, correctAnswer: sampleAns ? sampleAns.correctAnswer : null,
                upper: { correct: U, wrong: upperN - U, total: upperN },
                mid: { correct: M, wrong: midRows.length - M, total: midRows.length },
                lower: { correct: L, wrong: lowerN - L, total: lowerN },
                totalCorrect: T, correctRate, discrimination };
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

    downloadOMR(rows) {
        if (!rows.length) return;
        const maxQ = this._defaultMaxQ;
        let csv = '응시번호,성명,점수';
        for (let i = 1; i <= maxQ; i++) csv += `,${i}번`;
        for (let i = 1; i <= maxQ; i++) csv += `,${i}번정오`;
        csv += '\n';
        rows.forEach(r => {
            csv += `${r.examNo},${r.name},${r.score}`;
            for (let i = 1; i <= maxQ; i++) { const a = r.answers.find(x => x.q === i); csv += `,${a ? a.markedLabel : ''}`; }
            for (let i = 1; i <= maxQ; i++) { const a = r.answers.find(x => x.q === i); csv += `,${a ? (a.isCorrect ? 'O' : 'X') : ''}`; }
            csv += '\n';
        });
        this._dl(csv, 'OMR결과표');
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
            csv += `,${r.correctCount},${r.score},${r.tScore.toFixed(1)},${r.rank},${r.percentile.toFixed(1)}\n`;
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
    _renderOMR(rows) {
        const cols = this._getOMRColumns().filter(c => c.visible);

        // 상단 도구
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
                <label style="font-size:11px;">문항수:
                    <input type="number" value="${this._defaultMaxQ}" min="1" max="100" style="width:50px; padding:3px; font-size:11px; border:1px solid var(--border); border-radius:4px;"
                        onchange="Scoring.setMaxQ(this.value)">
                </label>
                <button class="btn btn-sm" style="font-size:10px; padding:3px 8px;"
                    onclick="Scoring._showColumnSettings=!Scoring._showColumnSettings; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                    ${this._showColumnSettings ? '설정 닫기' : '열 설정'}
                </button>
            </div>
            <button class="btn btn-sm" onclick="Scoring.downloadOMR(Scoring.collectData())" style="font-size:11px;">CSV 다운로드</button>
        </div>`;

        // 열 설정 패널
        if (this._showColumnSettings) {
            const allCols = this._getOMRColumns();
            // info 열만 설정 표시 (answer/ox는 문항수로 관리)
            const infoCols = allCols.filter(c => c.type === 'info' || c.type === 'custom');
            html += `<div style="background:#f8fafc; border:1px solid var(--border); border-radius:8px; padding:10px; margin-bottom:12px;">
                <div style="font-size:11px; font-weight:600; margin-bottom:6px;">기본 열 관리 (드래그로 순서 변경 / 이름 수정 / 토글)</div>
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">`;
            infoCols.forEach(col => {
                html += `<div style="display:flex; align-items:center; gap:3px; padding:3px 6px; border:1px solid var(--border); border-radius:4px; background:${col.visible ? 'white' : '#f1f5f9'}; font-size:10px;">
                    <button style="border:none; background:none; cursor:pointer; padding:0; font-size:10px;" onclick="Scoring.moveColumn('${col.id}',-1)">◀</button>
                    <input type="text" value="${col.label}" style="width:${Math.max(40, col.label.length * 10)}px; border:none; font-size:10px; font-weight:600; text-align:center; background:transparent;"
                        onchange="Scoring.renameColumn('${col.id}', this.value)">
                    <button style="border:none; background:none; cursor:pointer; padding:0; font-size:10px;" onclick="Scoring.moveColumn('${col.id}',1)">▶</button>
                    <input type="checkbox" ${col.visible ? 'checked' : ''} onchange="Scoring.toggleColumn('${col.id}')" style="margin:0;">
                    ${col.type === 'custom' ? `<button style="border:none; background:none; cursor:pointer; color:red; font-size:10px;" onclick="Scoring.removeColumn('${col.id}')">✕</button>` : ''}
                </div>`;
            });
            html += `</div>
                <div style="display:flex; gap:4px;">
                    <button class="btn btn-sm" style="font-size:10px; padding:2px 8px;" onclick="Scoring.addColumn(null, prompt('열 이름:') || '새 열')">+ 열 추가</button>
                    <label style="font-size:10px; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" ${allCols.some(c => c.type === 'answer' && !c.visible) ? '' : 'checked'}
                            onchange="Scoring._toggleAnswerCols(this.checked)"> 마킹 내용
                    </label>
                    <label style="font-size:10px; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" ${allCols.some(c => c.type === 'ox' && !c.visible) ? '' : 'checked'}
                            onchange="Scoring._toggleOXCols(this.checked)"> 정오표(O/X)
                    </label>
                </div>
            </div>`;
        }

        // 테이블
        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead><tr>`;

        cols.forEach(col => {
            const bg = col.type === 'ox' ? 'background:#fef3c7;' : col.id === 'score' ? 'color:var(--blue);' : 'background:#f8fafc;';
            html += `<th style="padding:6px 6px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); ${bg} position:sticky; top:0; z-index:1; white-space:nowrap;">${col.label}</th>`;
        });
        html += `</tr></thead><tbody>`;

        rows.forEach((r, ri) => {
            const bg = ri % 2 === 0 ? '' : 'background:#f8fafc;';
            html += `<tr style="${bg}">`;
            cols.forEach(col => {
                let val = '', style = 'padding:5px 6px; text-align:center; font-size:11px; border-bottom:1px solid #f1f5f9;';
                if (col.id === 'examNo') val = r.examNo;
                else if (col.id === 'name') { val = r.name; style += 'font-weight:600;'; }
                else if (col.id === 'score') { val = r.score; style += 'font-weight:700; color:var(--blue); font-size:12px;'; }
                else if (col.type === 'answer') {
                    const a = r.answers.find(x => x.q === col.qNum);
                    val = a ? a.markedLabel : '';
                } else if (col.type === 'ox') {
                    const a = r.answers.find(x => x.q === col.qNum);
                    val = a ? (a.isCorrect ? 'O' : 'X') : '';
                    if (val === 'O') style += 'color:#22c55e; font-weight:700;';
                    else if (val === 'X') style += 'color:#ef4444; font-weight:700;';
                } else if (col.type === 'custom') {
                    val = ''; // 커스텀 열은 비어있음
                }
                html += `<td style="${style}">${val}</td>`;
            });
            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
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
        const etcKeys = [...new Set(rows.flatMap(r => Object.keys(r.etcFields)))];

        let html = `<div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
            <button class="btn btn-sm" onclick="Scoring.downloadReport(Scoring.collectData())" style="font-size:11px;">CSV 다운로드</button>
        </div>`;

        const th = 'style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#f8fafc; position:sticky; top:0; white-space:nowrap;"';
        const td = 'style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9;"';

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead><tr>
            <th ${th}>응시번호</th><th ${th}>성명</th><th ${th}>생년월일</th><th ${th}>수험번호</th>`;
        etcKeys.forEach(k => html += `<th ${th}>${k}</th>`);
        html += `<th ${th} style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#ecfdf5; position:sticky; top:0;">맞은수</th>
            <th ${th} style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#eff6ff; position:sticky; top:0;">점수</th>
            <th ${th} style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#f5f3ff; position:sticky; top:0;">표준점수</th>
            <th ${th} style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#fef3c7; position:sticky; top:0;">석차</th>
            <th ${th} style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#fce7f3; position:sticky; top:0;">백분위</th>
        </tr></thead><tbody>`;

        rows.forEach((r, ri) => {
            const bg = ri % 2 === 0 ? '' : 'background:#f8fafc;';
            html += `<tr style="${bg}">
                <td ${td}>${r.examNo}</td>
                <td ${td} style="padding:6px 8px; font-size:12px; font-weight:600; border-bottom:1px solid #f1f5f9;">${r.name}</td>
                <td ${td}>${r.birthday}</td>
                <td ${td}>${r.examNo}</td>`;
            etcKeys.forEach(k => html += `<td ${td}>${r.etcFields[k] || ''}</td>`);
            html += `<td ${td} style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; color:#22c55e; font-weight:600;">${r.correctCount}</td>
                <td ${td} style="padding:6px 8px; text-align:center; font-size:13px; border-bottom:1px solid #f1f5f9; color:var(--blue); font-weight:700;">${r.score}</td>
                <td ${td}>${r.tScore ? r.tScore.toFixed(1) : ''}</td>
                <td ${td} style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; font-weight:700;">${r.rank || ''}</td>
                <td ${td}>${r.percentile ? r.percentile.toFixed(1) : ''}%</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    },

    // ==========================================
    // 문항분석표
    // ==========================================
    _renderItem(items, totalN) {
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:12px; color:var(--text-muted);">총 ${totalN}명 응시</span>
            <button class="btn btn-sm" onclick="Scoring.downloadItem(Scoring.calcItemAnalysis(Scoring.collectData()))" style="font-size:11px;">CSV 다운로드</button>
        </div>`;

        const th = 'style="padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#f8fafc; position:sticky; top:0;"';
        const td = 'style="padding:5px 6px; text-align:center; font-size:11px; border-bottom:1px solid #f1f5f9;"';

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead>
        <tr>
            <th ${th} rowspan="2">문항</th><th ${th} rowspan="2">정답</th>
            <th ${th} colspan="2" style="padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border-bottom:1px solid var(--border); background:#dbeafe;">상위 27%</th>
            <th ${th} colspan="2" style="padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border-bottom:1px solid var(--border); background:#f3f4f6;">중위 46%</th>
            <th ${th} colspan="2" style="padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border-bottom:1px solid var(--border); background:#fef2f2;">하위 27%</th>
            <th ${th} rowspan="2" style="padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#ecfdf5;">정답률</th>
            <th ${th} rowspan="2" style="padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#fef3c7;">변별도</th>
        </tr>
        <tr>
            <th style="padding:4px 6px; font-size:10px; background:#dbeafe; border-bottom:2px solid var(--border);">O</th>
            <th style="padding:4px 6px; font-size:10px; background:#dbeafe; border-bottom:2px solid var(--border);">X</th>
            <th style="padding:4px 6px; font-size:10px; background:#f3f4f6; border-bottom:2px solid var(--border);">O</th>
            <th style="padding:4px 6px; font-size:10px; background:#f3f4f6; border-bottom:2px solid var(--border);">X</th>
            <th style="padding:4px 6px; font-size:10px; background:#fef2f2; border-bottom:2px solid var(--border);">O</th>
            <th style="padding:4px 6px; font-size:10px; background:#fef2f2; border-bottom:2px solid var(--border);">X</th>
        </tr>
        </thead><tbody>`;

        items.forEach((item, ri) => {
            const bg = ri % 2 === 0 ? '' : 'background:#f8fafc;';
            const rc = item.correctRate >= 80 ? '#22c55e' : item.correctRate < 40 ? '#ef4444' : 'var(--text)';
            const dc = item.discrimination >= 0.3 ? '#22c55e' : item.discrimination < 0.1 ? '#ef4444' : 'var(--text)';
            html += `<tr style="${bg}">
                <td ${td} style="padding:5px 6px; text-align:center; font-size:12px; font-weight:700; border-bottom:1px solid #f1f5f9;">${item.q}</td>
                <td ${td} style="padding:5px 6px; text-align:center; font-size:11px; font-weight:600; border-bottom:1px solid #f1f5f9; color:var(--blue);">${item.correctAnswer || ''}</td>
                <td ${td}>${item.upper.correct}</td><td ${td}>${item.upper.wrong}</td>
                <td ${td}>${item.mid.correct}</td><td ${td}>${item.mid.wrong}</td>
                <td ${td}>${item.lower.correct}</td><td ${td}>${item.lower.wrong}</td>
                <td style="padding:5px 6px; text-align:center; font-size:12px; font-weight:700; color:${rc}; border-bottom:1px solid #f1f5f9;">${item.correctRate.toFixed(1)}%</td>
                <td style="padding:5px 6px; text-align:center; font-size:12px; font-weight:700; color:${dc}; border-bottom:1px solid #f1f5f9;">${item.discrimination.toFixed(3)}</td>
            </tr>`;
        });

        if (items.length > 0) {
            const avgR = items.reduce((s, i) => s + i.correctRate, 0) / items.length;
            const avgD = items.reduce((s, i) => s + i.discrimination, 0) / items.length;
            html += `<tr style="background:#f8fafc; font-weight:700;">
                <td colspan="8" style="padding:8px; text-align:right; font-size:12px; border-top:2px solid var(--border);">전체 평균</td>
                <td style="padding:8px; text-align:center; font-size:13px; color:var(--blue); border-top:2px solid var(--border);">${avgR.toFixed(1)}%</td>
                <td style="padding:8px; text-align:center; font-size:13px; color:var(--blue); border-top:2px solid var(--border);">${avgD.toFixed(3)}</td>
            </tr>`;
        }

        html += `</tbody></table></div>`;
        return html;
    }
};
