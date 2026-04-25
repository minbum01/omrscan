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

        const savedUpper = Scoring._upperPct, savedLower = Scoring._lowerPct;
        Scoring._upperPct = 12;
        Scoring._lowerPct = 30;
        const itemAnalysis = {};
        subjects.forEach(subj => {
            itemAnalysis[subj] = Scoring.calcItemAnalysis(rows, subj);
        });
        Scoring._upperPct = savedUpper;
        Scoring._lowerPct = savedLower;

        const reportData = {
            examName, examDate, N, subjects, stats,
            students: rows.map(r => ({
                examNo: r.examNo || '', name: r.name || '',
                phone: r.phone || '', birthday: r.birthday || '',
                totalScore: r.totalScore, totalMax: r.totalMax,
                totalCorrect: r.totalCorrect, rank: r.rank, percentile: r.percentile,
                _noOmr: r._noOmr || false,
                subjects: Object.fromEntries(subjects.map(s => [s, {
                    score: r.subjects[s] ? r.subjects[s].score : '',
                    correctCount: r.subjects[s] ? r.subjects[s].correctCount : '',
                    totalPossible: r.subjects[s] ? r.subjects[s].totalPossible : '',
                    rank: r.subjects[s] ? r.subjects[s].rank : '',
                    answers: r.subjects[s] ? (r.subjects[s].answers || []).map(a => ({
                        q: a.q, marked: a.marked, isCorrect: a.isCorrect, correctAnswer: a.correctAnswer
                    })) : [],
                }])),
            })),
            itemAnalysis: Object.fromEntries(subjects.map(s => [s, (itemAnalysis[s] || []).map(it => ({
                q: it.q, correctAnswer: it.correctAnswer, correctRate: it.correctRate,
                discrimination: it.discrimination,
                upperCorrectRate: it.upper ? (it.upper.correct / Math.max(1, it.upper.total) * 100) : 0,
                lowerCorrectRate: it.lower ? (it.lower.correct / Math.max(1, it.lower.total) * 100) : 0,
                distTotal: it.distTotal || {},
            }))])),
        };

        const html = this._buildHTML(reportData);

        if (window.electronAPI && window.electronAPI.saveReport) {
            const result = await window.electronAPI.saveReport(sessionName, html);
            if (result.success) Toast.success(`성적표 생성: ${result.path}`);
            else Toast.error('성적표 저장 실패: ' + (result.error || ''));
        } else {
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${examName}_성적표.html`;
            a.click();
            URL.revokeObjectURL(a.href);
        }
    },

    _buildHTML(data) {
        // 학생 테이블 행 (데이터 무거움 — 별도 생성)
        const stuRows = data.students.map((st, i) => {
            const sc = data.subjects.map(s => {
                const sub = st.subjects[s] || {};
                return `<td class="sc" data-s="${s}" contenteditable="true">${sub.score !== '' && sub.score != null ? sub.score : ''}</td>`;
            }).join('');
            return `<tr>
<td>${i + 1}</td>
<td class="maskable" contenteditable="true">${st.examNo}</td>
<td class="maskable" contenteditable="true">${st.name}</td>
${sc}
<td class="col-total" contenteditable="true" style="font-weight:700;">${st._noOmr ? '' : (st.totalScore != null ? st.totalScore : '')}</td>
<td class="col-rank" contenteditable="true">${st._noOmr ? '' : (st.rank || '')}</td>
<td class="col-pct" contenteditable="true">${st._noOmr ? '' : (st.percentile != null ? st.percentile.toFixed(1) : '')}</td>
</tr>`;
        }).join('');

        // 문항분석 테이블 (과목별)
        const itemSections = data.subjects.map(subj => {
            const items = data.itemAnalysis[subj] || [];
            if (!items.length) return '';
            const rows = items.map(it => {
                const cr = it.correctRate != null ? it.correctRate.toFixed(1) : '-';
                const cls = it.correctRate < 40 ? 'cr-low' : it.correctRate > 80 ? 'cr-high' : '';
                const disc = it.discrimination != null ? it.discrimination.toFixed(2) : '-';
                const dcls = it.discrimination < 0.2 ? 'cr-low' : it.discrimination > 0.4 ? 'cr-high' : '';
                const dist = it.distTotal || {};
                const tot = dist.total || 1;
                let choices = '';
                for (let c = 1; c <= 5; c++) {
                    const pct = ((dist[c] || 0) / tot * 100).toFixed(0);
                    const isAns = c === it.correctAnswer;
                    choices += `<td contenteditable="true" style="${isAns ? 'font-weight:700;color:#16a34a;' : ''}">${pct}%</td>`;
                }
                return `<tr>
<td>${it.q}</td>
<td contenteditable="true" style="font-weight:700;">${it.correctAnswer || '-'}</td>
<td class="${cls}" contenteditable="true">${cr}%</td>
<td class="col-upper" contenteditable="true">${it.upperCorrectRate != null ? it.upperCorrectRate.toFixed(0) : ''}%</td>
<td class="col-lower" contenteditable="true">${it.lowerCorrectRate != null ? it.lowerCorrectRate.toFixed(0) : ''}%</td>
<td class="${dcls} col-disc" contenteditable="true">${disc}</td>
${choices}
</tr>`;
            }).join('');
            return `
<div class="rpt-section subj-sec" data-s="${subj}">
<div class="section-title">${subj} — 문항별 정답분석</div>
<div class="item-grid">
<table class="tbl item-tbl"><thead><tr>
<th>Q</th><th>정답</th><th>정답률</th>
<th class="col-upper">상위<span class="upper-pct">12</span>%</th>
<th class="col-lower">상위<span class="lower-pct">30</span>%</th>
<th class="col-disc">변별도</th>
<th>①</th><th>②</th><th>③</th><th>④</th><th>⑤</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="chart-box"><canvas class="item-chart" data-s="${subj}" width="500" height="220"></canvas></div>
</div></div>`;
        }).join('');

        const totalQ = data.subjects.reduce((s, subj) => s + (data.itemAnalysis[subj] || []).length, 0);

        return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${data.examName} 성적표</title>
<style>
:root{--primary:#1e40af;--primary-light:#dbeafe;--bg:#f0f2f5;--card:#fff;--border:#d1d5db;--text:#1e293b;--muted:#64748b;--success:#16a34a;--danger:#dc2626;--warning:#f59e0b;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Pretendard','Noto Sans KR',-apple-system,sans-serif;background:var(--bg);color:var(--text);font-size:11px;display:flex;height:100vh;overflow:hidden;}

/* === 레이아웃 === */
#report-area{flex:4;height:100vh;overflow-y:auto;padding:24px 32px;background:#dee2e6;}
#report-paper{background:var(--card);padding:28px 32px;max-width:1200px;margin:0 auto;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.1);}
#settings-panel{flex:1;min-width:240px;max-width:300px;height:100vh;overflow-y:auto;padding:16px;background:#f8fafc;border-left:1px solid var(--border);}

/* === 인쇄 === */
@media print{
body{display:block;background:#fff;}
#settings-panel{display:none!important;}
#report-area{flex:1;height:auto;overflow:visible;padding:0;background:#fff;}
#report-paper{box-shadow:none;padding:8mm;border-radius:0;max-width:100%;}
@page{size:A3 landscape;margin:6mm;}
.page-break{page-break-before:always;}
.no-print{display:none!important;}
}

/* === 헤더 === */
.rpt-header{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1e40af 100%);color:#fff;padding:20px 28px;border-radius:10px;margin-bottom:20px;position:relative;overflow:hidden;}
.rpt-header::after{content:'';position:absolute;top:0;right:0;width:30%;height:100%;background:radial-gradient(ellipse at top right,rgba(255,255,255,0.1),transparent 70%);pointer-events:none;}
.rpt-header h1{font-size:20px;font-weight:800;letter-spacing:-0.02em;position:relative;}
.header-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px 16px;margin-top:12px;position:relative;}
.meta-item{display:flex;flex-direction:column;gap:2px;}
.meta-label{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;}
.meta-value{font-size:13px;font-weight:700;color:#fff;}
[contenteditable]:hover{outline:2px dashed rgba(96,165,250,0.6);outline-offset:2px;border-radius:3px;}
[contenteditable]:focus{outline:2px solid #60a5fa;background:rgba(255,255,255,0.08);border-radius:3px;}

/* === 섹션 === */
.rpt-section{margin-bottom:20px;}
.section-title{font-size:14px;font-weight:800;color:var(--text);margin-bottom:10px;padding:6px 12px;background:linear-gradient(90deg,var(--primary-light),#fff);border-left:4px solid var(--primary);border-radius:0 6px 6px 0;letter-spacing:-0.01em;}

/* === 테이블 공통 === */
.tbl{border-collapse:collapse;width:100%;font-size:10px;}
.tbl th,.tbl td{border:1px solid #e2e8f0;padding:4px 6px;text-align:center;}
.tbl th{background:linear-gradient(180deg,#1e293b,#334155);color:#fff;font-weight:600;font-size:9px;letter-spacing:0.02em;}
.tbl td[contenteditable]:hover{background:#eff6ff;}
.tbl tr:nth-child(even){background:#f8fafc;}
.tbl tr:hover{background:#e0f2fe;}

/* === 분포 === */
.dist-section{display:flex;flex-direction:column;gap:12px;}
.dist-bar-table{overflow-x:auto;}
.dist-bar-table .tbl{width:auto;min-width:100%;}
.dist-bar-table .tbl td,.dist-bar-table .tbl th{white-space:nowrap;min-width:42px;}
.chart-box{background:linear-gradient(180deg,#fafbfc,#f1f5f9);border:1px solid #e2e8f0;border-radius:8px;padding:12px;position:relative;}

/* === 학생 테이블 === */
#stu-wrap{overflow:auto;max-height:none;}
#stu-wrap.paged{max-height:none;page-break-before:always;}
.stu-tbl th{position:sticky;top:0;z-index:2;}

/* === 문항분석 === */
.item-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.cr-low{background:#fef2f2!important;color:var(--danger);font-weight:700;}
.cr-high{background:#f0fdf4!important;color:var(--success);font-weight:700;}

/* === 정보 박스 === */
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.info-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;}
.info-box .section-title{font-size:12px;margin-bottom:8px;}
.memo-area{margin-top:8px;padding:8px 10px;border:1px dashed #cbd5e1;border-radius:6px;min-height:50px;font-size:11px;color:var(--muted);line-height:1.6;}

/* === 마스킹 === */
.masked{filter:blur(5px);user-select:none;transition:filter 0.2s;}

/* === 설정 패널 === */
.sg{margin-bottom:10px;padding:8px 10px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;}
.sg h3{font-size:11px;font-weight:700;color:#334155;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f1f5f9;}
.sr{display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:10px;}
.sr label{min-width:70px;font-weight:600;color:#475569;font-size:10px;}
.sr input[type=text],.sr input[type=number],.sr select{padding:3px 5px;border:1px solid #d1d5db;border-radius:4px;font-size:10px;flex:1;min-width:0;}
.sr input[type=color]{width:28px;height:20px;border:1px solid #d1d5db;border-radius:3px;cursor:pointer;padding:0;}
.sr input[type=checkbox]{margin:0;}
.sr button{padding:3px 8px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;font-size:10px;background:#fff;}
.sr button:hover{background:#f1f5f9;}
.print-btn{width:100%;padding:8px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.02em;}
.print-btn:hover{background:#1e3a8a;}
</style>
</head>
<body>

<!-- ========== 성적표 (4/5) ========== -->
<div id="report-area">
<div id="report-paper">

<div class="rpt-header">
<h1 contenteditable="true" id="rpt-title">${data.examDate} ${data.examName}</h1>
<div class="header-meta">
<div class="meta-item"><span class="meta-label">날짜</span><span class="meta-value" contenteditable="true" id="rpt-date">${data.examDate}</span></div>
<div class="meta-item"><span class="meta-label">교수명</span><span class="meta-value" contenteditable="true" id="rpt-teacher">(입력)</span></div>
<div class="meta-item"><span class="meta-label">과목</span><span class="meta-value" id="rpt-subjects">${data.subjects.join(' + ')}</span></div>
<div class="meta-item"><span class="meta-label">응시인원</span><span class="meta-value" id="rpt-n">${data.N}명</span></div>
<div class="meta-item"><span class="meta-label">평균점수</span><span class="meta-value" id="rpt-avg">${data.stats.mean ? data.stats.mean.toFixed(1) : '-'}점</span></div>
<div class="meta-item"><span class="meta-label">평균맞은수</span><span class="meta-value" id="rpt-avg-c">${totalQ > 0 && data.stats.mean ? (data.stats.mean / (data.stats.max || 1) * totalQ).toFixed(1) : '-'}개</span></div>
</div>
</div>

<!-- 점수 분포 -->
<div class="rpt-section">
<div class="section-title">점수 분포표</div>
<div class="dist-section">
<div class="dist-bar-table"><table class="tbl" id="dist-table"><thead id="dist-thead"><tr></tr></thead><tbody id="dist-tbody"><tr></tr></tbody></table></div>
<div class="chart-box"><canvas id="dist-chart" height="220"></canvas></div>
</div>
</div>

<!-- 학생별 성적 -->
<div class="rpt-section" id="stu-section">
<div class="section-title">학생별 성적표</div>
<div id="stu-wrap" style="overflow:auto;max-height:500px;">
<table class="tbl stu-tbl" id="stu-table">
<thead><tr>
<th>순번</th><th class="col-examno">수험번호</th><th class="col-name">이름</th>
${data.subjects.map(s => `<th class="sc" data-s="${s}">${s}</th>`).join('')}
<th class="col-total">총점</th><th class="col-rank">석차</th><th class="col-pct">백분위</th>
</tr></thead>
<tbody>${stuRows}</tbody>
</table>
</div>
</div>

<!-- 문항분석 -->
${itemSections}

<!-- 시험 정보 + 최고 오답률 -->
<div class="rpt-section">
<div class="info-grid">
<div class="info-box">
<div class="section-title">시험 정보</div>
<table class="tbl" style="font-size:11px;">
<tr><td style="font-weight:700;width:90px;text-align:left;background:#f8fafc;">총 문항수</td><td contenteditable="true">${totalQ}문항</td></tr>
<tr><td style="font-weight:700;text-align:left;background:#f8fafc;">과목별</td><td contenteditable="true">${data.subjects.map(s => s + ': ' + (data.itemAnalysis[s] || []).length + '문항').join(', ')}</td></tr>
<tr><td style="font-weight:700;text-align:left;background:#f8fafc;">응시인원</td><td contenteditable="true">${data.N}명</td></tr>
<tr><td style="font-weight:700;text-align:left;background:#f8fafc;">평균</td><td contenteditable="true">${data.stats.mean ? data.stats.mean.toFixed(1) : '-'}점</td></tr>
<tr><td style="font-weight:700;text-align:left;background:#f8fafc;">표준편차</td><td contenteditable="true">${data.stats.stdDev ? data.stats.stdDev.toFixed(2) : '-'}</td></tr>
<tr><td style="font-weight:700;text-align:left;background:#f8fafc;">최고/최저</td><td contenteditable="true">${data.stats.max || '-'} / ${data.stats.min || '-'}점</td></tr>
</table>
<div class="memo-area" contenteditable="true">메모 — 클릭하여 자유 입력</div>
</div>
<div class="info-box">
<div class="section-title">최고 오답률 문항 (Top 5)</div>
<div id="top-wrong"></div>
<div class="memo-area" contenteditable="true">코멘트 — 클릭하여 자유 입력</div>
</div>
</div>
</div>

</div></div>

<!-- ========== 설정 패널 (1/5) ========== -->
<div id="settings-panel">
<div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:12px;">⚙ 설정</div>

<div class="sg"><h3>기본 정보</h3>
<div class="sr"><label>시험명</label><input type="text" value="${data.examName}" oninput="$('#rpt-title').textContent=this.value"></div>
<div class="sr"><label>날짜</label><input type="text" value="${data.examDate}" oninput="$('#rpt-date').textContent=this.value"></div>
<div class="sr"><label>교수명</label><input type="text" value="" oninput="$('#rpt-teacher').textContent=this.value"></div>
</div>

<div class="sg"><h3>과목 선택</h3>
${data.subjects.map(s => `<div class="sr"><label><input type="checkbox" class="subj-cb" value="${s}" checked onchange="recalcAll()"> ${s}</label></div>`).join('')}
</div>

<div class="sg"><h3>점수 분포</h3>
<div class="sr"><label>구간</label><select id="bin-size" onchange="rebuildChart()"><option value="5" selected>5점</option><option value="10">10점</option><option value="1">1점</option></select></div>
<div class="sr"><label>레이블</label><input type="checkbox" id="show-labels" checked onchange="rebuildChart()"></div>
<div class="sr"><label>막대색</label><input type="color" id="bar-color" value="#1e40af" onchange="rebuildChart()"></div>
</div>

<div class="sg"><h3>학생 테이블</h3>
<div class="sr"><label>표시 열</label></div>
<div class="sr" style="flex-wrap:wrap;gap:3px;">
<label><input type="checkbox" checked onchange="toggleCol('col-examno',this.checked)">수험번호</label>
<label><input type="checkbox" checked onchange="toggleCol('col-name',this.checked)">이름</label>
<label><input type="checkbox" checked onchange="toggleCol('col-total',this.checked)">총점</label>
<label><input type="checkbox" checked onchange="toggleCol('col-rank',this.checked)">석차</label>
<label><input type="checkbox" checked onchange="toggleCol('col-pct',this.checked)">백분위</label>
</div>
<div class="sr"><label>정렬</label><select onchange="sortStudents(this.value)">
<option value="num">순번</option><option value="score_desc">총점↓</option><option value="score_asc">총점↑</option><option value="name">이름</option><option value="examno">수험번호</option>
</select></div>
<div class="sr"><label>별도 페이지</label><input type="checkbox" id="stu-paged" onchange="toggleStudentPage(this.checked)"></div>
</div>

<div class="sg"><h3>마스킹</h3>
<div class="sr"><label>대상</label><select id="mask-mode"><option value="all">수험번호+이름</option><option value="examno">수험번호만</option><option value="name">이름만</option></select></div>
<div class="sr"><label>방식</label><select id="mask-style"><option value="blur">블러</option><option value="star">*** 처리</option></select></div>
<div class="sr"><label>위치</label><input type="text" id="mask-pos" value="3,4,5" placeholder="*처리할 자리 (콤마)"></div>
<div class="sr"><button onclick="applyMask()">마스킹 적용</button><button onclick="clearMask()">해제</button></div>
</div>

<div class="sg"><h3>문항분석</h3>
<div class="sr"><label>오답기준↓</label><input type="number" id="cr-low" value="40" min="0" max="100" onchange="recolorItems()">%</div>
<div class="sr"><label>정답기준↑</label><input type="number" id="cr-high" value="80" min="0" max="100" onchange="recolorItems()">%</div>
<div class="sr"><label>상위그룹</label><input type="number" id="upper-pct" value="12" min="1" max="50" onchange="$$('.upper-pct').forEach(e=>e.textContent=this.value)">%</div>
<div class="sr"><label>하위그룹</label><input type="number" id="lower-pct" value="30" min="1" max="50" onchange="$$('.lower-pct').forEach(e=>e.textContent=this.value)">%</div>
<div class="sr" style="flex-wrap:wrap;gap:3px;">
<label><input type="checkbox" checked onchange="toggleCol('col-upper',this.checked)">상위%</label>
<label><input type="checkbox" checked onchange="toggleCol('col-lower',this.checked)">하위%</label>
<label><input type="checkbox" checked onchange="toggleCol('col-disc',this.checked)">변별도</label>
</div>
</div>

<div class="sg"><h3>표시 섹션</h3>
<div class="sr"><label><input type="checkbox" checked onchange="$('#stu-section').style.display=this.checked?'':'none'">학생 목록</label></div>
<div class="sr"><label><input type="checkbox" checked onchange="$$('.subj-sec').forEach(e=>e.style.display=this.checked?'':'none')">문항분석</label></div>
</div>

<div class="sg">
<button class="print-btn" onclick="window.print()">🖨 인쇄 / PDF</button>
<div style="font-size:9px;color:var(--muted);margin-top:4px;text-align:center;">설정 패널은 인쇄에 포함되지 않습니다</div>
</div>
</div>

<script>
const D=${JSON.stringify(data)};
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);

function getChecked(){return[...$$('.subj-cb:checked')].map(c=>c.value);}

function toggleCol(cls,show){
    $$('.'+cls).forEach(el=>{el.style.display=show?'':'none';});
    // th도
    $$('th.'+cls).forEach(el=>{el.style.display=show?'':'none';});
}

function recalcAll(){
    const ck=getChecked();
    $$('.sc').forEach(el=>el.style.display=ck.includes(el.dataset.s)?'':'none');
    $$('.subj-sec').forEach(el=>el.style.display=ck.includes(el.dataset.s)?'':'none');
    $('#rpt-subjects').textContent=ck.join(' + ');
    // 총점/석차 재계산
    const stuRows=[...$('#stu-table tbody').querySelectorAll('tr')];
    const scoreArr=[];
    stuRows.forEach((tr,i)=>{
        const st=D.students[i];if(!st||st._noOmr)return;
        let sum=0;ck.forEach(s=>{const sub=st.subjects[s];if(sub&&typeof sub.score==='number')sum+=sub.score;});
        scoreArr.push({i,sum,tr});
    });
    scoreArr.sort((a,b)=>b.sum-a.sum);
    scoreArr.forEach((s,rank)=>{
        const tds=s.tr.querySelectorAll('td');
        s.tr.querySelector('.col-total').textContent=s.sum;
        s.tr.querySelector('.col-rank').textContent=rank+1;
        const pct=scoreArr.length>1?((scoreArr.length-rank-1)/(scoreArr.length-1)*100).toFixed(1):'100.0';
        s.tr.querySelector('.col-pct').textContent=pct;
    });
    const count=scoreArr.length;
    const avg=count>0?(scoreArr.reduce((s,x)=>s+x.sum,0)/count).toFixed(1):'-';
    $('#rpt-avg').textContent=avg+'점';
    $('#rpt-n').textContent=count+'명';
    rebuildChart();rebuildItemCharts();buildTopWrong();
}

function rebuildChart(){
    const bin=parseInt($('#bin-size').value)||5;
    const labels=$('#show-labels').checked;
    const color=$('#bar-color').value;
    const ck=getChecked();
    const scores=D.students.filter(s=>!s._noOmr).map(st=>{let sum=0;ck.forEach(s=>{const sub=st.subjects[s];if(sub&&typeof sub.score==='number')sum+=sub.score;});return sum;});
    const mx=Math.max(...scores,10);
    const bins={};for(let v=0;v<=mx;v+=bin)bins[v]=0;
    scores.forEach(s=>{const b=Math.floor(s/bin)*bin;bins[b]=(bins[b]||0)+1;});
    const keys=Object.keys(bins).map(Number).sort((a,b)=>a-b);
    const maxC=Math.max(...Object.values(bins),1);

    // 가로 테이블 (행열 뒤집기)
    let thRow='<tr><th style="background:#334155;">점수</th>';
    let tdRow='<tr><td style="font-weight:700;background:#f1f5f9;">인원</td>';
    keys.forEach(k=>{
        thRow+=\`<th>\${k}~\${k+bin-1}</th>\`;
        tdRow+=\`<td contenteditable="true">\${bins[k]}</td>\`;
    });
    thRow+='</tr>';tdRow+='</tr>';
    $('#dist-thead').innerHTML=thRow;
    $('#dist-tbody').innerHTML=tdRow;

    // 차트
    const cv=$('#dist-chart');if(!cv)return;
    cv.width=Math.max(600,keys.length*50);
    const ctx=cv.getContext('2d'),W=cv.width,H=cv.height;
    ctx.clearRect(0,0,W,H);
    const pad={l:45,r:15,t:20,b:35};
    const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
    const bW=Math.max(12,cW/keys.length-6);

    // 배경 격자
    ctx.strokeStyle='#e2e8f0';ctx.lineWidth=0.5;
    for(let i=0;i<=5;i++){
        const y=pad.t+cH-cH*(i/5);
        ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();
        ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='right';
        ctx.fillText(Math.round(maxC*i/5),pad.l-4,y+3);
    }
    // Y축 라벨
    ctx.save();ctx.translate(10,pad.t+cH/2);ctx.rotate(-Math.PI/2);
    ctx.fillStyle='#64748b';ctx.font='bold 9px sans-serif';ctx.textAlign='center';
    ctx.fillText('인원',0,0);ctx.restore();

    // 막대
    keys.forEach((k,i)=>{
        const x=pad.l+i*(bW+6)+3;
        const h=(bins[k]/maxC)*cH;
        const y=pad.t+cH-h;
        // 그라데이션
        const grad=ctx.createLinearGradient(x,y,x,y+h);
        grad.addColorStop(0,color);grad.addColorStop(1,color+'cc');
        ctx.fillStyle=grad;
        ctx.beginPath();ctx.roundRect(x,y,bW,h,[3,3,0,0]);ctx.fill();
        // X축
        ctx.fillStyle='#475569';ctx.font='8px sans-serif';ctx.textAlign='center';
        ctx.fillText(k+'',x+bW/2,H-pad.b+12);
        // 데이터 레이블
        if(labels&&bins[k]>0){
            ctx.fillStyle='#0f172a';ctx.font='bold 9px sans-serif';
            ctx.fillText(bins[k],x+bW/2,y-4);
        }
    });
    // X축 제목
    ctx.fillStyle='#64748b';ctx.font='bold 9px sans-serif';ctx.textAlign='center';
    ctx.fillText('점수',W/2,H-2);
}

function rebuildItemCharts(){
    $$('.item-chart').forEach(cv=>{
        const subj=cv.dataset.s;const items=D.itemAnalysis[subj]||[];if(!items.length)return;
        cv.width=Math.max(500,items.length*22);
        const ctx=cv.getContext('2d'),W=cv.width,H=cv.height;ctx.clearRect(0,0,W,H);
        const pad={l:40,r:15,t:15,b:30};
        const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
        const bW=Math.max(8,cW/items.length-3);
        // 격자
        ctx.strokeStyle='#e2e8f0';ctx.lineWidth=0.5;
        for(let i=0;i<=4;i++){
            const y=pad.t+cH-cH*(i/4);
            ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();
            ctx.fillStyle='#94a3b8';ctx.font='8px sans-serif';ctx.textAlign='right';
            ctx.fillText((i*25)+'%',pad.l-3,y+3);
        }
        // 막대
        items.forEach((it,i)=>{
            const x=pad.l+i*(bW+3);const cr=it.correctRate||0;
            const h=(cr/100)*cH;const y=pad.t+cH-h;
            ctx.fillStyle=cr<40?'#ef4444':cr>80?'#22c55e':'#3b82f6';
            ctx.fillRect(x,y,bW,h);
            ctx.fillStyle='#64748b';ctx.font='7px sans-serif';ctx.textAlign='center';
            ctx.fillText(it.q,x+bW/2,H-pad.b+10);
        });
        // 평균선
        const avg=items.reduce((s,it)=>s+(it.correctRate||0),0)/items.length;
        const avgY=pad.t+cH-(avg/100)*cH;
        ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;ctx.setLineDash([5,3]);
        ctx.beginPath();ctx.moveTo(pad.l,avgY);ctx.lineTo(W-pad.r,avgY);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#f59e0b';ctx.font='bold 9px sans-serif';ctx.textAlign='left';
        ctx.fillText('평균 '+avg.toFixed(0)+'%',pad.l+5,avgY-5);
        // 상위12% 선
        const u=items.reduce((s,it)=>s+(it.upperCorrectRate||0),0)/items.length;
        const uY=pad.t+cH-(u/100)*cH;
        ctx.strokeStyle='#22c55e';ctx.lineWidth=1;ctx.setLineDash([3,2]);
        ctx.beginPath();ctx.moveTo(pad.l,uY);ctx.lineTo(W-pad.r,uY);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#22c55e';ctx.font='8px sans-serif';
        ctx.fillText($('#upper-pct').value+'%그룹 '+u.toFixed(0)+'%',pad.l+5,uY-4);
    });
}

function recolorItems(){
    const lo=parseInt($('#cr-low').value)||40;
    const hi=parseInt($('#cr-high').value)||80;
    $$('.item-tbl tbody tr').forEach(tr=>{
        const c=tr.children[2];if(!c)return;
        const v=parseFloat(c.textContent);
        c.className=v<lo?'cr-low':v>hi?'cr-high':'';
    });
}

function sortStudents(mode){
    const tbody=$('#stu-table tbody');
    const rows=[...tbody.querySelectorAll('tr')];
    rows.sort((a,b)=>{
        if(mode==='score_desc'){const av=parseFloat(a.querySelector('.col-total')?.textContent)||0;const bv=parseFloat(b.querySelector('.col-total')?.textContent)||0;return bv-av;}
        if(mode==='score_asc'){const av=parseFloat(a.querySelector('.col-total')?.textContent)||0;const bv=parseFloat(b.querySelector('.col-total')?.textContent)||0;return av-bv;}
        if(mode==='name'){return(a.children[2]?.textContent||'').localeCompare(b.children[2]?.textContent||'');}
        if(mode==='examno'){return(a.children[1]?.textContent||'').localeCompare(b.children[1]?.textContent||'');}
        return parseInt(a.children[0]?.textContent||0)-parseInt(b.children[0]?.textContent||0);
    });
    rows.forEach(r=>tbody.appendChild(r));
}

function toggleStudentPage(paged){
    const wrap=$('#stu-wrap');
    const sec=$('#stu-section');
    if(paged){wrap.style.maxHeight='none';sec.classList.add('page-break');}
    else{wrap.style.maxHeight='500px';sec.classList.remove('page-break');}
}

let maskBackup=[];
function applyMask(){
    clearMask();
    const mode=$('#mask-mode').value;
    const style=$('#mask-style').value;
    const posStr=$('#mask-pos').value;
    const positions=posStr.split(',').map(s=>parseInt(s.trim())-1).filter(n=>!isNaN(n));
    const rows=$('#stu-table tbody').querySelectorAll('tr');
    rows.forEach(tr=>{
        const examTd=tr.children[1];
        const nameTd=tr.children[2];
        if(style==='blur'){
            if(mode==='all'||mode==='examno'){maskBackup.push({el:examTd,orig:examTd.innerHTML});examTd.classList.add('masked');}
            if(mode==='all'||mode==='name'){maskBackup.push({el:nameTd,orig:nameTd.innerHTML});nameTd.classList.add('masked');}
        }else{
            // * 처리
            const maskText=(text)=>{
                const chars=[...text];
                positions.forEach(p=>{if(p>=0&&p<chars.length)chars[p]='*';});
                return chars.join('');
            };
            if(mode==='all'||mode==='examno'){maskBackup.push({el:examTd,orig:examTd.textContent});examTd.textContent=maskText(examTd.textContent);}
            if(mode==='all'||mode==='name'){maskBackup.push({el:nameTd,orig:nameTd.textContent});nameTd.textContent=maskText(nameTd.textContent);}
        }
    });
}
function clearMask(){
    maskBackup.forEach(({el,orig})=>{el.classList.remove('masked');el.innerHTML=orig;});
    maskBackup=[];
}

function buildTopWrong(){
    const ck=getChecked();const all=[];
    ck.forEach(subj=>{(D.itemAnalysis[subj]||[]).forEach(it=>{all.push({subj,...it});});});
    all.sort((a,b)=>(a.correctRate||0)-(b.correctRate||0));
    const top5=all.slice(0,5);
    let h='<table class="tbl" style="font-size:10px;"><thead><tr><th>과목</th><th>문항</th><th>정답</th><th>정답률</th><th>최다오답</th></tr></thead><tbody>';
    top5.forEach(it=>{
        const dist=it.distTotal||{};let mw=0,mc='-';
        for(let c=1;c<=5;c++){if(c===it.correctAnswer)continue;if((dist[c]||0)>mw){mw=dist[c];mc=c;}}
        const tot=dist.total||1;
        h+=\`<tr><td>\${it.subj}</td><td contenteditable="true">\${it.q}번</td><td>\${it.correctAnswer||'-'}</td><td style="color:var(--danger);font-weight:700;">\${(it.correctRate||0).toFixed(1)}%</td><td>\${mc}번(\${(mw/tot*100).toFixed(0)}%)</td></tr>\`;
    });
    h+='</tbody></table>';
    $('#top-wrong').innerHTML=h;
}

window.addEventListener('DOMContentLoaded',()=>{recalcAll();});
</script>
</body>
</html>`;
    },
};
