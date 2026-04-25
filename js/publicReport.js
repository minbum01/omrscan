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
        return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${data.examName} 성적표</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Pretendard','Noto Sans KR',sans-serif;background:#e2e8f0;color:#0f172a;font-size:11px;display:flex;height:100vh;overflow:hidden;}

/* 3/5 : 성적표 영역 */
#report-area{width:60%;height:100vh;overflow-y:auto;padding:16px;background:#94a3b8;}
#report-paper{background:#fff;padding:20px;min-height:420mm;width:420mm;max-width:100%;margin:0 auto;box-shadow:0 2px 20px rgba(0,0,0,0.15);}

/* 2/5 : 설정 패널 */
#settings-panel{width:40%;height:100vh;overflow-y:auto;padding:16px;background:#f8fafc;border-left:2px solid #cbd5e1;}
.setting-group{margin-bottom:14px;padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;}
.setting-group h3{font-size:12px;font-weight:700;color:#334155;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0;}
.setting-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;}
.setting-row label{min-width:80px;font-weight:600;color:#475569;}
.setting-row input[type=text],.setting-row input[type=number],.setting-row select{padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;flex:1;}
.setting-row input[type=color]{width:32px;height:24px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;}

/* 인쇄 */
@media print{
    body{display:block;background:#fff;}
    #settings-panel{display:none!important;}
    #report-area{width:100%;height:auto;overflow:visible;padding:0;background:#fff;}
    #report-paper{box-shadow:none;padding:8mm;width:100%;min-height:auto;}
    @page{size:A3 landscape;margin:8mm;}
}

/* 공통 테이블 */
.rpt-table{border-collapse:collapse;width:100%;font-size:10px;}
.rpt-table th,.rpt-table td{border:1px solid #cbd5e1;padding:3px 5px;text-align:center;}
.rpt-table th{background:#1e293b;color:#fff;font-weight:600;font-size:9px;}
.rpt-table td[contenteditable]:hover{background:#eff6ff;outline:1px dashed #3b82f6;}
.rpt-table tr:nth-child(even){background:#f8fafc;}

/* 헤더 */
.rpt-header{background:linear-gradient(135deg,#1e293b,#334155);color:#fff;padding:14px 20px;border-radius:6px;margin-bottom:12px;}
.rpt-header h1{font-size:16px;font-weight:800;}
.rpt-header-meta{display:flex;gap:16px;margin-top:6px;font-size:11px;color:#cbd5e1;flex-wrap:wrap;}
.rpt-header-meta .v{color:#fff;font-weight:700;}
[contenteditable]:hover{outline:2px dashed #60a5fa;outline-offset:1px;}
[contenteditable]:focus{outline:2px solid #3b82f6;background:rgba(59,130,246,0.05);}

/* 섹션 */
.rpt-section{margin-bottom:14px;}
.rpt-section-title{font-size:12px;font-weight:800;color:#1e293b;margin-bottom:6px;padding:4px 8px;background:#f1f5f9;border-left:4px solid #3b82f6;border-radius:0 4px 4px 0;}

/* 분포 */
.dist-grid{display:grid;grid-template-columns:auto 1fr;gap:12px;}
.chart-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px;display:flex;align-items:center;justify-content:center;}

/* 정답률 색상 */
.cr-low{background:#fef2f2;color:#dc2626;font-weight:700;}
.cr-high{background:#f0fdf4;color:#16a34a;font-weight:700;}
.cr-mid{background:#fefce8;}

/* 마스킹 */
.masked{filter:blur(4px);user-select:none;}
</style>
</head>
<body>

<!-- ===== 성적표 영역 (3/5) ===== -->
<div id="report-area">
<div id="report-paper">

    <!-- 헤더 -->
    <div class="rpt-header">
        <h1 contenteditable="true" id="rpt-title">${data.examDate} ${data.examName}</h1>
        <div class="rpt-header-meta">
            <span>날짜 <span class="v" contenteditable="true" id="rpt-date">${data.examDate}</span></span>
            <span>교수명 <span class="v" contenteditable="true" id="rpt-teacher">(입력)</span></span>
            <span>과목 <span class="v" id="rpt-subjects">${data.subjects.join(' + ')}</span></span>
            <span>응시인원 <span class="v" id="rpt-n">${data.N}</span>명</span>
            <span>평균점수 <span class="v" id="rpt-avg">${data.stats.mean ? data.stats.mean.toFixed(1) : '-'}</span>점</span>
            <span>평균맞은문항수 <span class="v" id="rpt-avg-correct">${(data.stats.mean && data.stats.max ? (data.stats.mean / (data.stats.max / data.students.filter(s=>!s._noOmr).reduce((mx,s)=>Math.max(mx,s.totalCorrect||0),0) || 1) * (data.students.filter(s=>!s._noOmr).reduce((mx,s)=>Math.max(mx,s.totalCorrect||0),0))).toFixed(1) : '-')}</span>개</span>
        </div>
    </div>

    <!-- 점수 분포 -->
    <div class="rpt-section">
        <div class="rpt-section-title">점수 분포표</div>
        <div class="dist-grid">
            <table class="rpt-table" id="dist-table" style="width:auto;">
                <thead><tr><th>점수</th><th>인원</th></tr></thead>
                <tbody id="dist-tbody"></tbody>
            </table>
            <div class="chart-box"><canvas id="dist-chart" width="550" height="200"></canvas></div>
        </div>
    </div>

    <!-- 학생별 성적 -->
    <div class="rpt-section">
        <div class="rpt-section-title">학생별 성적표</div>
        <div style="overflow-x:auto;max-height:350px;">
            <table class="rpt-table" id="stu-table">
                <thead><tr>
                    <th>순번</th><th>수험번호</th><th>이름</th>
                    ${data.subjects.map(s=>`<th class="sc" data-s="${s}">${s}</th>`).join('')}
                    <th>총점</th><th>석차</th><th>백분위</th>
                </tr></thead>
                <tbody>
                ${data.students.map((st,i)=>{
                    const sc = data.subjects.map(s=>{
                        const sub=st.subjects[s]||{};
                        return `<td class="sc" data-s="${s}" contenteditable="true">${sub.score!==''&&sub.score!=null?sub.score:''}</td>`;
                    }).join('');
                    return `<tr>
                        <td>${i+1}</td>
                        <td class="maskable" contenteditable="true">${st.examNo}</td>
                        <td class="maskable" contenteditable="true">${st.name}</td>
                        ${sc}
                        <td contenteditable="true" style="font-weight:700;">${st._noOmr?'':(st.totalScore!=null?st.totalScore:'')}</td>
                        <td contenteditable="true">${st._noOmr?'':(st.rank||'')}</td>
                        <td contenteditable="true">${st._noOmr?'':(st.percentile!=null?st.percentile.toFixed(1):'')}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <!-- 과목별 문항분석 -->
    ${data.subjects.map(subj=>{
        const items=data.itemAnalysis[subj]||[];
        if(!items.length) return '';
        return `
    <div class="rpt-section subj-sec" data-s="${subj}">
        <div class="rpt-section-title">${subj} — 문항별 정답분석</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <table class="rpt-table item-tbl">
                <thead><tr><th>Q</th><th>정답</th><th>정답률</th><th>상위12%</th><th>상위30%</th><th>변별도</th><th>①</th><th>②</th><th>③</th><th>④</th><th>⑤</th></tr></thead>
                <tbody>
                ${items.map(it=>{
                    const cr=it.correctRate!=null?it.correctRate.toFixed(1):'-';
                    const cls=it.correctRate<40?'cr-low':it.correctRate>80?'cr-high':'';
                    const ucr=it.upperCorrectRate!=null?it.upperCorrectRate.toFixed(0):'';
                    const lcr=it.lowerCorrectRate!=null?it.lowerCorrectRate.toFixed(0):'';
                    const disc=it.discrimination!=null?it.discrimination.toFixed(2):'-';
                    const dcls=it.discrimination<0.2?'cr-low':it.discrimination>0.4?'cr-high':'';
                    const dist=it.distTotal||{};
                    const tot=dist.total||1;
                    let choices='';
                    for(let c=1;c<=5;c++){
                        const pct=((dist[c]||0)/tot*100).toFixed(0);
                        const isAns=c===it.correctAnswer;
                        choices+=`<td contenteditable="true" style="${isAns?'font-weight:700;color:#16a34a;':''}">${pct}%</td>`;
                    }
                    return `<tr><td>${it.q}</td><td contenteditable="true" style="font-weight:700;">${it.correctAnswer||'-'}</td><td class="${cls}" contenteditable="true">${cr}%</td><td contenteditable="true">${ucr}%</td><td contenteditable="true">${lcr}%</td><td class="${dcls}" contenteditable="true">${disc}</td>${choices}</tr>`;
                }).join('')}
                </tbody>
            </table>
            <div class="chart-box"><canvas class="item-chart" data-s="${subj}" width="450" height="200"></canvas></div>
        </div>
    </div>`;
    }).join('')}

    <!-- 시험 정보 + 최고 오답률 -->
    <div class="rpt-section" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
            <div class="rpt-section-title" style="margin-bottom:6px;">시험 정보</div>
            <table class="rpt-table" style="font-size:11px;">
                <tr><td style="font-weight:700;width:100px;text-align:left;">총 문항수</td><td contenteditable="true">${data.subjects.reduce((s,subj)=>(data.itemAnalysis[subj]||[]).length+s,0)}문항</td></tr>
                <tr><td style="font-weight:700;text-align:left;">과목별</td><td contenteditable="true">${data.subjects.map(s=>s+': '+(data.itemAnalysis[s]||[]).length+'문항').join(', ')}</td></tr>
                <tr><td style="font-weight:700;text-align:left;">응시인원</td><td contenteditable="true">${data.N}명</td></tr>
                <tr><td style="font-weight:700;text-align:left;">평균</td><td contenteditable="true">${data.stats.mean?data.stats.mean.toFixed(1):'-'}점</td></tr>
                <tr><td style="font-weight:700;text-align:left;">표준편차</td><td contenteditable="true">${data.stats.stdDev?data.stats.stdDev.toFixed(2):'-'}</td></tr>
                <tr><td style="font-weight:700;text-align:left;">최고/최저</td><td contenteditable="true">${data.stats.max||'-'} / ${data.stats.min||'-'}점</td></tr>
            </table>
            <div contenteditable="true" style="margin-top:8px;padding:8px;border:1px dashed #cbd5e1;border-radius:4px;min-height:50px;font-size:11px;color:#64748b;">메모 영역 — 클릭하여 자유 입력</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
            <div class="rpt-section-title" style="margin-bottom:6px;">최고 오답률 문항 (Top 5)</div>
            <div id="top-wrong"></div>
            <div contenteditable="true" style="margin-top:8px;padding:8px;border:1px dashed #cbd5e1;border-radius:4px;min-height:50px;font-size:11px;color:#64748b;">코멘트 — 클릭하여 자유 입력</div>
        </div>
    </div>

</div><!-- /report-paper -->
</div><!-- /report-area -->

<!-- ===== 설정 패널 (2/5) ===== -->
<div id="settings-panel">
    <h2 style="font-size:15px;font-weight:800;margin-bottom:12px;color:#1e293b;">설정</h2>

    <div class="setting-group">
        <h3>기본 정보</h3>
        <div class="setting-row"><label>시험명</label><input type="text" id="set-title" value="${data.examName}" oninput="document.getElementById('rpt-title').textContent=this.value"></div>
        <div class="setting-row"><label>날짜</label><input type="text" id="set-date" value="${data.examDate}" oninput="document.getElementById('rpt-date').textContent=this.value"></div>
        <div class="setting-row"><label>교수명</label><input type="text" id="set-teacher" value="" oninput="document.getElementById('rpt-teacher').textContent=this.value"></div>
    </div>

    <div class="setting-group">
        <h3>과목 선택 (합산)</h3>
        ${data.subjects.map(s=>`<div class="setting-row"><label><input type="checkbox" class="subj-cb" value="${s}" checked onchange="recalcAll()"> ${s}</label></div>`).join('')}
    </div>

    <div class="setting-group">
        <h3>점수 분포 차트</h3>
        <div class="setting-row"><label>구간 단위</label><select id="bin-size" onchange="rebuildChart()"><option value="5" selected>5점</option><option value="10">10점</option><option value="20">20점</option></select></div>
        <div class="setting-row"><label>데이터레이블</label><input type="checkbox" id="show-labels" checked onchange="rebuildChart()"></div>
        <div class="setting-row"><label>막대 색상</label><input type="color" id="bar-color" value="#3b82f6" onchange="rebuildChart()"></div>
    </div>

    <div class="setting-group">
        <h3>문항분석 색상 기준</h3>
        <div class="setting-row"><label>오답 기준(↓)</label><input type="number" id="cr-low" value="40" min="0" max="100" onchange="recolorItems()">%</div>
        <div class="setting-row"><label>정답 기준(↑)</label><input type="number" id="cr-high" value="80" min="0" max="100" onchange="recolorItems()">%</div>
    </div>

    <div class="setting-group">
        <h3>표시 옵션</h3>
        <div class="setting-row"><label>마스킹</label><button onclick="toggleMask()" style="padding:4px 12px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;">수험번호/이름 마스킹 토글</button></div>
        <div class="setting-row"><label>섹션 표시</label></div>
        <div class="setting-row" style="flex-wrap:wrap;gap:4px;">
            <label><input type="checkbox" checked onchange="toggleSection('dist-table',this.checked)"> 분포표</label>
            <label><input type="checkbox" checked onchange="toggleSection('stu-table',this.checked)"> 학생목록</label>
            <label><input type="checkbox" checked onchange="document.querySelectorAll('.subj-sec').forEach(el=>el.style.display=this.checked?'':'none')"> 문항분석</label>
        </div>
    </div>

    <div class="setting-group">
        <h3>인쇄</h3>
        <button onclick="window.print()" style="width:100%;padding:8px;background:#1e293b;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">인쇄 / PDF 저장</button>
        <div style="font-size:10px;color:#64748b;margin-top:4px;">* 설정 패널은 인쇄에 포함되지 않습니다</div>
    </div>
</div>

<script>
const D = ${JSON.stringify(data)};

let maskOn = false;
function toggleMask(){
    maskOn=!maskOn;
    document.querySelectorAll('.maskable').forEach(el=>el.classList.toggle('masked',maskOn));
}
function toggleSection(id,show){
    const el=document.getElementById(id);
    if(el)el.closest('.rpt-section').style.display=show?'':'none';
}
function getChecked(){return Array.from(document.querySelectorAll('.subj-cb:checked')).map(c=>c.value);}

function recalcAll(){
    const ck=getChecked();
    // 과목 열 표시/숨김
    document.querySelectorAll('.sc').forEach(el=>el.style.display=ck.includes(el.dataset.s)?'':'none');
    document.querySelectorAll('.subj-sec').forEach(el=>el.style.display=ck.includes(el.dataset.s)?'':'none');
    document.getElementById('rpt-subjects').textContent=ck.join(' + ');
    // 총점/석차 재계산
    let totalSum=0,count=0;
    const stuRows=document.querySelectorAll('#stu-table tbody tr');
    const scoreArr=[];
    stuRows.forEach((tr,i)=>{
        const st=D.students[i];if(!st||st._noOmr)return;
        let sum=0;
        ck.forEach(s=>{const sub=st.subjects[s];if(sub&&typeof sub.score==='number')sum+=sub.score;});
        scoreArr.push({i,sum});
        totalSum+=sum;count++;
    });
    scoreArr.sort((a,b)=>b.sum-a.sum);
    scoreArr.forEach((s,rank)=>{
        const tr=stuRows[s.i];if(!tr)return;
        const cells=tr.querySelectorAll('td');
        cells[cells.length-3].textContent=s.sum;
        cells[cells.length-2].textContent=rank+1;
        const pct=scoreArr.length>1?((scoreArr.length-rank-1)/(scoreArr.length-1)*100).toFixed(1):'100.0';
        cells[cells.length-1].textContent=pct;
    });
    const avg=count>0?(totalSum/count).toFixed(1):'-';
    document.getElementById('rpt-avg').textContent=avg;
    document.getElementById('rpt-n').textContent=count;
    rebuildChart();rebuildItemCharts();buildTopWrong();
}

function rebuildChart(){
    const bin=parseInt(document.getElementById('bin-size').value)||5;
    const labels=document.getElementById('show-labels').checked;
    const color=document.getElementById('bar-color').value;
    const ck=getChecked();
    const scores=D.students.filter(s=>!s._noOmr).map(st=>{let sum=0;ck.forEach(s=>{const sub=st.subjects[s];if(sub&&typeof sub.score==='number')sum+=sub.score;});return sum;});
    const mx=Math.max(...scores,100);
    const bins={};for(let v=0;v<=mx;v+=bin)bins[v]=0;
    scores.forEach(s=>{const b=Math.floor(s/bin)*bin;bins[b]=(bins[b]||0)+1;});
    // 테이블
    const tb=document.getElementById('dist-tbody');
    if(tb){let h='';Object.keys(bins).sort((a,b)=>b-a).forEach(k=>{h+='<tr><td>'+k+'~'+(+k+bin-1)+'점</td><td contenteditable="true">'+bins[k]+'</td></tr>';});tb.innerHTML=h;}
    // 차트
    const cv=document.getElementById('dist-chart');if(!cv)return;
    const ctx=cv.getContext('2d'),W=cv.width,H=cv.height;ctx.clearRect(0,0,W,H);
    const keys=Object.keys(bins).map(Number).sort((a,b)=>a-b);
    const maxC=Math.max(...Object.values(bins),1);
    const bW=Math.max(8,(W-60)/keys.length-4),cH=H-35;
    keys.forEach((k,i)=>{
        const x=40+i*(bW+4),h=(bins[k]/maxC)*cH,y=cH-h+10;
        ctx.fillStyle=color;ctx.fillRect(x,y,bW,h);
        ctx.fillStyle='#64748b';ctx.font='8px sans-serif';ctx.textAlign='center';
        ctx.fillText(k+'',x+bW/2,H-2);
        if(labels&&bins[k]>0){ctx.fillStyle='#0f172a';ctx.font='bold 9px sans-serif';ctx.fillText(bins[k],x+bW/2,y-3);}
    });
}

function rebuildItemCharts(){
    document.querySelectorAll('.item-chart').forEach(cv=>{
        const subj=cv.dataset.s;const items=D.itemAnalysis[subj]||[];if(!items.length)return;
        const ctx=cv.getContext('2d'),W=cv.width,H=cv.height;ctx.clearRect(0,0,W,H);
        const bW=Math.max(6,(W-60)/items.length-2),cH=H-30;
        items.forEach((it,i)=>{
            const x=40+i*(bW+2),cr=it.correctRate||0,h=(cr/100)*cH,y=cH-h+10;
            ctx.fillStyle=cr<40?'#ef4444':cr>80?'#22c55e':'#3b82f6';
            ctx.fillRect(x,y,bW,h);
            ctx.fillStyle='#94a3b8';ctx.font='7px sans-serif';ctx.textAlign='center';
            ctx.fillText(it.q,x+bW/2,H-2);
        });
        // 평균선
        const avg=items.reduce((s,it)=>s+(it.correctRate||0),0)/items.length;
        const avgY=cH-(avg/100)*cH+10;
        ctx.strokeStyle='#f59e0b';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);
        ctx.beginPath();ctx.moveTo(40,avgY);ctx.lineTo(W-10,avgY);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#f59e0b';ctx.font='bold 8px sans-serif';ctx.textAlign='left';
        ctx.fillText('평균'+avg.toFixed(0)+'%',W-55,avgY-3);
        // 상위12%선
        const u12=items.reduce((s,it)=>s+(it.upperCorrectRate||0),0)/items.length;
        const u12Y=cH-(u12/100)*cH+10;
        ctx.strokeStyle='#22c55e';ctx.lineWidth=1;ctx.setLineDash([2,2]);
        ctx.beginPath();ctx.moveTo(40,u12Y);ctx.lineTo(W-10,u12Y);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#22c55e';ctx.font='7px sans-serif';ctx.fillText('12%',W-55,u12Y-3);
    });
}

function recolorItems(){
    const lo=parseInt(document.getElementById('cr-low').value)||40;
    const hi=parseInt(document.getElementById('cr-high').value)||80;
    document.querySelectorAll('.item-tbl tbody tr').forEach(tr=>{
        const crCell=tr.children[2];if(!crCell)return;
        const v=parseFloat(crCell.textContent);
        crCell.className=v<lo?'cr-low':v>hi?'cr-high':'';
    });
}

function buildTopWrong(){
    const ck=getChecked();const all=[];
    ck.forEach(subj=>{(D.itemAnalysis[subj]||[]).forEach(it=>{all.push({subj,...it});});});
    all.sort((a,b)=>(a.correctRate||0)-(b.correctRate||0));
    const top5=all.slice(0,5);
    let h='<table class="rpt-table" style="font-size:10px;"><tr><th>과목</th><th>문항</th><th>정답</th><th>정답률</th><th>최다오답</th></tr>';
    top5.forEach(it=>{
        const dist=it.distTotal||{};let mw=0,mc='-';
        for(let c=1;c<=5;c++){if(c===it.correctAnswer)continue;if((dist[c]||0)>mw){mw=dist[c];mc=c;}}
        const tot=dist.total||1;
        h+='<tr><td>'+it.subj+'</td><td contenteditable="true">'+it.q+'번</td><td>'+( it.correctAnswer||'-')+'</td><td style="color:#dc2626;font-weight:700;">'+(it.correctRate||0).toFixed(1)+'%</td><td>'+mc+'번('+(mw/tot*100).toFixed(0)+'%)</td></tr>';
    });
    h+='</table>';
    document.getElementById('top-wrong').innerHTML=h;
}

window.addEventListener('DOMContentLoaded',()=>{recalcAll();});
</script>
</body>
</html>`;
    },
};
