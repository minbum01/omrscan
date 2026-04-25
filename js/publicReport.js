// ============================================
// publicReport.js - 게시용 전체 성적표 (HTML 생성)
// 기존 로직 변경 없음 — 읽기 전용 + 새 파일 생성
// ============================================

const PublicReport = {

    async generate() {
        if (!SessionManager.currentSessionName) {
            Toast.error('세션을 먼저 저장하세요');
            return;
        }

        const rows = Scoring.collectData();
        if (!rows || rows.length === 0) {
            Toast.error('채점 데이터가 없습니다');
            return;
        }

        const stats = Scoring.calcStats(rows);
        const subjects = Scoring.getSubjectList(rows);
        const sessionName = SessionManager.currentSessionName;
        const examName = SessionManager.currentExamName || sessionName;
        const examDate = SessionManager.currentExamDate || '';
        const N = rows.filter(r => !r._noOmr).length;

        // 과목별 문항분석 데이터 수집 (상위 12%, 하위 30%)
        const savedUpper = Scoring._upperPct, savedLower = Scoring._lowerPct;
        Scoring._upperPct = 12;
        Scoring._lowerPct = 30;
        const itemAnalysis = {};
        subjects.forEach(subj => {
            itemAnalysis[subj] = Scoring.calcItemAnalysis(rows, subj);
        });
        Scoring._upperPct = savedUpper;
        Scoring._lowerPct = savedLower;

        // 인라인 데이터 JSON
        const reportData = {
            examName, examDate, N,
            subjects,
            stats,
            // 학생별 데이터
            students: rows.map(r => ({
                examNo: r.examNo || '',
                name: r.name || '',
                phone: r.phone || '',
                birthday: r.birthday || '',
                totalScore: r.totalScore,
                totalMax: r.totalMax,
                totalCorrect: r.totalCorrect,
                rank: r.rank,
                percentile: r.percentile,
                _noOmr: r._noOmr || false,
                subjects: Object.fromEntries(
                    subjects.map(s => [s, {
                        score: r.subjects[s] ? r.subjects[s].score : '',
                        correctCount: r.subjects[s] ? r.subjects[s].correctCount : '',
                        totalPossible: r.subjects[s] ? r.subjects[s].totalPossible : '',
                        rank: r.subjects[s] ? r.subjects[s].rank : '',
                        answers: r.subjects[s] ? (r.subjects[s].answers || []).map(a => ({
                            q: a.q, marked: a.marked, isCorrect: a.isCorrect, correctAnswer: a.correctAnswer
                        })) : [],
                    }])
                ),
            })),
            // 문항분석
            itemAnalysis: Object.fromEntries(
                subjects.map(s => [s, (itemAnalysis[s] || []).map(it => ({
                    q: it.q,
                    correctAnswer: it.correctAnswer,
                    correctRate: it.correctRate,
                    discrimination: it.discrimination,
                    upperCorrectRate: it.upper ? (it.upper.correct / Math.max(1, it.upper.total) * 100) : 0,
                    lowerCorrectRate: it.lower ? (it.lower.correct / Math.max(1, it.lower.total) * 100) : 0,
                    distTotal: it.distTotal || {},
                }))])
            ),
        };

        // HTML 생성
        const html = this._buildHTML(reportData);

        // 저장 + 열기
        if (window.electronAPI && window.electronAPI.saveReport) {
            const result = await window.electronAPI.saveReport(sessionName, html);
            if (result.success) Toast.success(`성적표 생성: ${result.path}`);
            else Toast.error('성적표 저장 실패: ' + (result.error || ''));
        } else {
            // 웹 폴백
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${examName}_성적표.html`;
            a.click();
            URL.revokeObjectURL(a.href);
        }
    },

    _buildHTML(data) {
        return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${data.examName} 성적표</title>
<style>
${this._css()}
</style>
</head>
<body>
<div id="report-root">
    ${this._headerSection(data)}
    ${this._subjectCheckboxes(data)}
    ${this._scoreDistribution(data)}
    ${this._studentTable(data)}
    ${this._itemAnalysisSection(data)}
    ${this._examInfoSection(data)}
    ${this._topWrongSection(data)}
</div>
<script>
const REPORT_DATA = ${JSON.stringify(data)};
${this._inlineJS()}
</script>
</body>
</html>`;
    },

    _css() {
        return `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Pretendard','Noto Sans KR',-apple-system,system-ui,sans-serif; background:#f8fafc; color:#0f172a; font-size:12px; }
#report-root { max-width:1100px; margin:20px auto; background:#fff; padding:24px; border-radius:12px; box-shadow:0 2px 16px rgba(0,0,0,0.08); }
@media print {
    body { background:#fff; }
    #report-root { box-shadow:none; margin:0; padding:10px; max-width:100%; }
    .no-print { display:none !important; }
    @page { size:A4 landscape; margin:8mm; }
}

/* 헤더 */
.rpt-header { background:linear-gradient(135deg,#1e293b,#334155); color:#fff; padding:16px 24px; border-radius:8px; margin-bottom:16px; }
.rpt-header h1 { font-size:18px; font-weight:800; }
.rpt-header .meta { display:flex; gap:24px; margin-top:8px; font-size:12px; color:#cbd5e1; }
.rpt-header .meta span { display:flex; align-items:center; gap:4px; }
.rpt-header .meta .val { color:#fff; font-weight:700; }
[contenteditable]:hover { outline:2px dashed #3b82f6; outline-offset:2px; cursor:text; }
[contenteditable]:focus { outline:2px solid #3b82f6; outline-offset:2px; background:rgba(59,130,246,0.05); }

/* 체크박스 */
.subj-checks { display:flex; gap:12px; margin-bottom:12px; padding:8px 12px; background:#f1f5f9; border-radius:6px; align-items:center; flex-wrap:wrap; }
.subj-checks label { font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px; }

/* 점수 분포 */
.dist-section { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
.dist-table { border-collapse:collapse; width:100%; font-size:11px; }
.dist-table th,.dist-table td { border:1px solid #e2e8f0; padding:4px 6px; text-align:center; }
.dist-table th { background:#f1f5f9; font-weight:700; }
.chart-wrap { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; min-height:200px; }

/* 학생 테이블 */
.stu-table { border-collapse:collapse; width:100%; font-size:11px; margin-bottom:16px; }
.stu-table th,.stu-table td { border:1px solid #e2e8f0; padding:3px 6px; text-align:center; }
.stu-table th { background:#1e293b; color:#fff; font-weight:600; position:sticky; top:0; }
.stu-table tr:nth-child(even) { background:#f8fafc; }
.stu-table .masked { filter:blur(4px); user-select:none; }

/* 문항분석 */
.item-section { margin-bottom:16px; }
.item-table { border-collapse:collapse; width:100%; font-size:10px; }
.item-table th,.item-table td { border:1px solid #e2e8f0; padding:3px 5px; text-align:center; }
.item-table th { background:#f1f5f9; font-weight:700; }
.item-table .low { background:#fef2f2; color:#dc2626; font-weight:700; }
.item-table .high { background:#f0fdf4; color:#16a34a; font-weight:700; }
.item-table .mid { background:#fefce8; }

/* 시험정보/오답 */
.info-section { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
.info-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; }
.info-box h3 { font-size:13px; font-weight:700; margin-bottom:8px; color:#334155; }

/* 버튼 */
.toolbar { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
.toolbar button { padding:6px 14px; font-size:11px; border:1px solid #d1d5db; border-radius:6px; cursor:pointer; background:#fff; font-weight:600; }
.toolbar button:hover { background:#f1f5f9; }
.toolbar button.primary { background:#3b82f6; color:#fff; border-color:#3b82f6; }
.toolbar button.primary:hover { background:#2563eb; }
`;
    },

    _headerSection(data) {
        return `
<div class="rpt-header">
    <h1 contenteditable="true">${data.examDate} ${data.examName}</h1>
    <div class="meta">
        <span>날짜 <span class="val" contenteditable="true">${data.examDate}</span></span>
        <span>교수명 <span class="val" contenteditable="true">(입력)</span></span>
        <span>과목 <span class="val">${data.subjects.join(', ')}</span></span>
        <span>응시인원 <span class="val" id="rpt-total-n">${data.N}</span>명</span>
        <span>평균점수 <span class="val" id="rpt-avg-score">${data.stats.mean ? data.stats.mean.toFixed(1) : '-'}</span>점</span>
    </div>
</div>
<div class="toolbar no-print">
    <button class="primary" onclick="window.print()">인쇄 / PDF</button>
    <button onclick="toggleMask()">마스킹 토글</button>
    <label>구간단위: <select id="bin-size" onchange="rebuildChart()">
        <option value="5" selected>5점</option>
        <option value="10">10점</option>
        <option value="20">20점</option>
    </select></label>
    <label><input type="checkbox" id="show-labels" checked onchange="rebuildChart()"> 데이터레이블</label>
</div>`;
    },

    _subjectCheckboxes(data) {
        const checks = data.subjects.map((s, i) =>
            `<label><input type="checkbox" class="subj-cb" value="${s}" checked onchange="recalcAll()"> ${s}</label>`
        ).join('');
        return `<div class="subj-checks no-print"><span style="font-size:11px;color:#64748b;font-weight:700;">과목 선택:</span> ${checks}</div>`;
    },

    _scoreDistribution(data) {
        return `
<div class="dist-section">
    <div>
        <table class="dist-table" id="dist-table"><thead><tr><th>점수</th><th>인원</th></tr></thead><tbody id="dist-tbody"></tbody></table>
    </div>
    <div class="chart-wrap">
        <canvas id="dist-chart" width="500" height="220"></canvas>
    </div>
</div>`;
    },

    _studentTable(data) {
        const subjHeaders = data.subjects.map(s => `<th class="subj-col" data-subj="${s}">${s}</th>`).join('');
        const rows = data.students.map((st, i) => {
            const subjCells = data.subjects.map(s => {
                const sub = st.subjects[s] || {};
                return `<td class="subj-col" data-subj="${s}">${sub.score !== '' && sub.score != null ? sub.score : ''}</td>`;
            }).join('');
            return `<tr>
                <td>${i + 1}</td>
                <td class="maskable">${st.examNo}</td>
                <td class="maskable">${st.name}</td>
                ${subjCells}
                <td style="font-weight:700;">${st._noOmr ? '' : (st.totalScore != null ? st.totalScore : '')}</td>
                <td>${st._noOmr ? '' : (st.rank || '')}</td>
            </tr>`;
        }).join('');

        return `
<div style="overflow-x:auto; max-height:400px; margin-bottom:16px;">
    <table class="stu-table">
        <thead><tr><th>#</th><th>수험번호</th><th>이름</th>${subjHeaders}<th>총점</th><th>석차</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
</div>`;
    },

    _itemAnalysisSection(data) {
        let html = '';
        data.subjects.forEach(subj => {
            const items = data.itemAnalysis[subj] || [];
            if (items.length === 0) return;

            const rows = items.map(it => {
                const cr = it.correctRate != null ? it.correctRate.toFixed(1) : '-';
                const crClass = it.correctRate < 40 ? 'low' : it.correctRate > 80 ? 'high' : '';
                const disc = it.discrimination != null ? it.discrimination.toFixed(2) : '-';
                const discClass = it.discrimination < 0.2 ? 'low' : it.discrimination > 0.4 ? 'high' : '';
                // 선택지별 비율
                const dist = it.distTotal || {};
                const total = dist.total || 1;
                const choices = [];
                for (let c = 1; c <= 5; c++) {
                    const cnt = dist[c] || 0;
                    const pct = (cnt / total * 100).toFixed(0);
                    const isAnswer = c === it.correctAnswer;
                    choices.push(`<td style="${isAnswer ? 'font-weight:700;color:#16a34a;' : ''}">${pct}%</td>`);
                }
                return `<tr>
                    <td>${it.q}</td><td style="font-weight:700;">${it.correctAnswer || '-'}</td>
                    <td class="${crClass}">${cr}%</td>
                    <td class="${discClass}">${disc}</td>
                    ${choices.join('')}
                </tr>`;
            }).join('');

            html += `
<div class="item-section subj-section" data-subj="${subj}">
    <h3 style="font-size:13px;font-weight:700;margin-bottom:6px;color:#1e293b;">${subj} 문항분석</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <table class="item-table">
            <thead><tr><th>Q</th><th>정답</th><th>정답률</th><th>변별도</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="chart-wrap">
            <canvas class="item-chart" data-subj="${subj}" width="450" height="200"></canvas>
        </div>
    </div>
</div>`;
        });
        return html;
    },

    _examInfoSection(data) {
        const totalQ = data.subjects.reduce((s, subj) => s + (data.itemAnalysis[subj] || []).length, 0);
        const subjInfo = data.subjects.map(s => `${s}: ${(data.itemAnalysis[s] || []).length}문항`).join(', ');
        return `
<div class="info-section">
    <div class="info-box">
        <h3>시험 정보</h3>
        <table style="width:100%;font-size:11px;">
            <tr><td style="font-weight:600;width:80px;">총 문항수</td><td>${totalQ}문항</td></tr>
            <tr><td style="font-weight:600;">과목별</td><td>${subjInfo}</td></tr>
            <tr><td style="font-weight:600;">응시인원</td><td>${data.N}명</td></tr>
            <tr><td style="font-weight:600;">평균</td><td>${data.stats.mean ? data.stats.mean.toFixed(1) : '-'}점</td></tr>
            <tr><td style="font-weight:600;">표준편차</td><td>${data.stats.stdDev ? data.stats.stdDev.toFixed(2) : '-'}</td></tr>
            <tr><td style="font-weight:600;">최고점</td><td>${data.stats.max || '-'}점</td></tr>
            <tr><td style="font-weight:600;">최저점</td><td>${data.stats.min || '-'}점</td></tr>
        </table>
        <div contenteditable="true" style="margin-top:8px;padding:6px;border:1px dashed #d1d5db;border-radius:4px;min-height:40px;font-size:11px;color:#64748b;">메모 입력 영역 (클릭하여 편집)</div>
    </div>
    <div class="info-box" id="top-wrong-box">
        <h3>최고 오답률 문항</h3>
        <div id="top-wrong-content"></div>
        <div contenteditable="true" style="margin-top:8px;padding:6px;border:1px dashed #d1d5db;border-radius:4px;min-height:40px;font-size:11px;color:#64748b;">코멘트 입력 (클릭하여 편집)</div>
    </div>
</div>`;
    },

    _topWrongSection() { return ''; }, // _examInfoSection에 통합

    _inlineJS() {
        return `
let maskOn = false;

function toggleMask() {
    maskOn = !maskOn;
    document.querySelectorAll('.maskable').forEach(el => {
        el.classList.toggle('masked', maskOn);
    });
}

function getCheckedSubjects() {
    return Array.from(document.querySelectorAll('.subj-cb:checked')).map(cb => cb.value);
}

function recalcAll() {
    const checked = getCheckedSubjects();
    // 과목 열 표시/숨김
    document.querySelectorAll('.subj-col').forEach(el => {
        el.style.display = checked.includes(el.dataset.subj) ? '' : 'none';
    });
    document.querySelectorAll('.subj-section').forEach(el => {
        el.style.display = checked.includes(el.dataset.subj) ? '' : 'none';
    });
    // 총점 재계산
    const tbody = document.querySelector('.stu-table tbody');
    if (tbody) {
        const rows = tbody.querySelectorAll('tr');
        let totalSum = 0, count = 0;
        rows.forEach((tr, i) => {
            const st = REPORT_DATA.students[i];
            if (!st || st._noOmr) return;
            let sum = 0;
            checked.forEach(s => {
                const sub = st.subjects[s];
                if (sub && typeof sub.score === 'number') sum += sub.score;
            });
            const totalCell = tr.querySelector('td[style*="font-weight"]') || tr.children[tr.children.length - 2];
            if (totalCell) totalCell.textContent = sum;
            totalSum += sum;
            count++;
        });
        const avg = count > 0 ? (totalSum / count).toFixed(1) : '-';
        const avgEl = document.getElementById('rpt-avg-score');
        if (avgEl) avgEl.textContent = avg;
    }
    rebuildChart();
    rebuildItemCharts();
    buildTopWrong();
}

function rebuildChart() {
    const binSize = parseInt(document.getElementById('bin-size').value) || 5;
    const showLabels = document.getElementById('show-labels').checked;
    const checked = getCheckedSubjects();
    const students = REPORT_DATA.students.filter(s => !s._noOmr);

    // 합산 점수 계산
    const scores = students.map(st => {
        let sum = 0;
        checked.forEach(s => {
            const sub = st.subjects[s];
            if (sub && typeof sub.score === 'number') sum += sub.score;
        });
        return sum;
    });

    const maxScore = Math.max(...scores, 100);
    const bins = {};
    for (let v = 0; v <= maxScore; v += binSize) bins[v] = 0;
    scores.forEach(s => {
        const b = Math.floor(s / binSize) * binSize;
        bins[b] = (bins[b] || 0) + 1;
    });

    // 테이블
    const tbody = document.getElementById('dist-tbody');
    if (tbody) {
        let html = '';
        Object.keys(bins).sort((a,b) => b-a).forEach(k => {
            html += '<tr><td>' + k + '~' + (parseInt(k)+binSize-1) + '점</td><td>' + bins[k] + '</td></tr>';
        });
        tbody.innerHTML = html;
    }

    // 차트
    const canvas = document.getElementById('dist-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const keys = Object.keys(bins).map(Number).sort((a,b) => a-b);
    const maxCount = Math.max(...Object.values(bins), 1);
    const barW = Math.max(8, (W - 60) / keys.length - 4);
    const chartH = H - 40;

    keys.forEach((k, i) => {
        const x = 40 + i * (barW + 4);
        const h = (bins[k] / maxCount) * chartH;
        const y = chartH - h + 10;

        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(x, y, barW, h);

        // 레이블
        ctx.fillStyle = '#64748b';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(k + '', x + barW/2, H - 2);

        if (showLabels && bins[k] > 0) {
            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(bins[k], x + barW/2, y - 4);
        }
    });
}

function rebuildItemCharts() {
    document.querySelectorAll('.item-chart').forEach(canvas => {
        const subj = canvas.dataset.subj;
        const items = REPORT_DATA.itemAnalysis[subj] || [];
        if (items.length === 0) return;

        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        const barW = Math.max(6, (W - 60) / items.length - 2);
        const chartH = H - 30;

        items.forEach((it, i) => {
            const x = 40 + i * (barW + 2);
            const cr = it.correctRate || 0;
            const h = (cr / 100) * chartH;
            const y = chartH - h + 10;

            ctx.fillStyle = cr < 40 ? '#ef4444' : cr > 80 ? '#22c55e' : '#3b82f6';
            ctx.fillRect(x, y, barW, h);

            ctx.fillStyle = '#94a3b8';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(it.q, x + barW/2, H - 2);
        });

        // 평균선
        const avgCR = items.reduce((s, it) => s + (it.correctRate || 0), 0) / items.length;
        const avgY = chartH - (avgCR / 100) * chartH + 10;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(40, avgY);
        ctx.lineTo(W - 10, avgY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('평균 ' + avgCR.toFixed(0) + '%', W - 60, avgY - 3);
    });
}

function buildTopWrong() {
    const checked = getCheckedSubjects();
    const box = document.getElementById('top-wrong-content');
    if (!box) return;

    const allItems = [];
    checked.forEach(subj => {
        (REPORT_DATA.itemAnalysis[subj] || []).forEach(it => {
            allItems.push({ subj, ...it });
        });
    });

    // 정답률 낮은 순 상위 5개
    allItems.sort((a, b) => (a.correctRate || 0) - (b.correctRate || 0));
    const top5 = allItems.slice(0, 5);

    let html = '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<tr style="background:#fef2f2;"><th style="padding:3px 6px;border:1px solid #fecaca;">과목</th><th style="border:1px solid #fecaca;">문항</th><th style="border:1px solid #fecaca;">정답</th><th style="border:1px solid #fecaca;">정답률</th><th style="border:1px solid #fecaca;">최다오답</th></tr>';
    top5.forEach(it => {
        // 최다 오답 선택지
        const dist = it.distTotal || {};
        let maxWrong = 0, maxWrongChoice = '-';
        for (let c = 1; c <= 5; c++) {
            if (c === it.correctAnswer) continue;
            if ((dist[c] || 0) > maxWrong) { maxWrong = dist[c]; maxWrongChoice = c; }
        }
        const total = dist.total || 1;
        const wrongPct = (maxWrong / total * 100).toFixed(0);
        html += '<tr><td style="padding:3px 6px;border:1px solid #fecaca;">' + it.subj + '</td><td style="border:1px solid #fecaca;">' + it.q + '번</td><td style="border:1px solid #fecaca;">' + (it.correctAnswer||'-') + '</td><td style="border:1px solid #fecaca;color:#dc2626;font-weight:700;">' + (it.correctRate||0).toFixed(1) + '%</td><td style="border:1px solid #fecaca;">' + maxWrongChoice + '번(' + wrongPct + '%)</td></tr>';
    });
    html += '</table>';
    box.innerHTML = html;
}

// 초기화
window.addEventListener('DOMContentLoaded', () => {
    recalcAll();
});
`;
    },
};
