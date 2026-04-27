// ============================================
// publicReport.js - 게시용 전체 성적표 (HTML 생성)
// 비파괴 — 새 HTML 파일 생성
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

        // 문항분석 — 게시용 기본 비율 (12% / 30%)
        const savedUpper = Scoring._upperPct, savedLower = Scoring._lowerPct;
        Scoring._upperPct = 12;
        Scoring._lowerPct = 30;
        const itemAnalysis = {};
        subjects.forEach(subj => {
            itemAnalysis[subj] = Scoring.calcItemAnalysis(rows, subj);
        });
        Scoring._upperPct = savedUpper;
        Scoring._lowerPct = savedLower;

        // 모든 학생의 etcFields 키 통합
        const etcKeySet = new Set();
        rows.forEach(r => { if (r.etcFields) Object.keys(r.etcFields).forEach(k => etcKeySet.add(k)); });
        const etcKeys = [...etcKeySet];

        const reportData = {
            examName, examDate, N, subjects, stats,
            etcKeys,
            students: rows.map(r => ({
                examNo: r.examNo || '',
                name: r.name || '',
                phone: r.phone || '',
                birthday: r.birthday || '',
                subjectCode: r.subjectCode || '',
                etcFields: r.etcFields || {},
                totalScore:   r.totalScore   != null ? r.totalScore   : '',
                totalMax:     r.totalMax     != null ? r.totalMax     : '',
                totalCorrect: r.totalCorrect != null ? r.totalCorrect : '',
                totalWrong:   r.totalWrong   != null ? r.totalWrong   : '',
                rank:         r.rank         != null ? r.rank         : '',
                percentile:   r.percentile   != null ? r.percentile   : '',
                tScore:       r.tScore       != null ? r.tScore       : '',
                _noOmr: r._noOmr || false,
                subjects: Object.fromEntries(subjects.map(s => {
                    const sub = r.subjects && r.subjects[s];
                    return [s, sub ? {
                        score:         sub.score         != null ? sub.score         : '',
                        correctCount:  sub.correctCount  != null ? sub.correctCount  : '',
                        wrongCount:    sub.wrongCount    != null ? sub.wrongCount    : '',
                        totalPossible: sub.totalPossible != null ? sub.totalPossible : '',
                        rank:          sub.rank          != null ? sub.rank          : '',
                        percentile:    sub.percentile    != null ? sub.percentile    : '',
                        tScore:        sub.tScore        != null ? sub.tScore        : '',
                        periodName:    sub.periodName    || '',
                        answers: (sub.answers || []).map(a => ({
                            q: a.q, marked: a.marked, isCorrect: a.isCorrect, correctAnswer: a.correctAnswer
                        })),
                    } : { score: '', correctCount: '', wrongCount: '', totalPossible: '', rank: '', percentile: '', tScore: '', periodName: '', answers: [] }];
                })),
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

    // 게시용 성적표 탭 패널 — 안내 + 생성 버튼
    renderPanel(container) {
        if (!container) return;
        const sessionName = (typeof SessionManager !== 'undefined' && SessionManager.currentSessionName) || '';
        const examName = (typeof SessionManager !== 'undefined' && SessionManager.currentExamName) || sessionName || '';
        const rowCount = (typeof Scoring !== 'undefined' && Scoring.collectData) ? (Scoring.collectData() || []).length : 0;
        const ready = !!sessionName && rowCount > 0;

        let html = `<div style="background:#fff; border-radius:12px; padding:32px; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
            <h2 style="margin:0 0 8px; font-size:22px; font-weight:700;">게시용 성적표</h2>
            <p style="margin:0 0 24px; color:var(--text-muted); font-size:13px; line-height:1.6;">
                현재 채점 결과를 정적 HTML 파일로 저장합니다. 저장된 파일은 별도 창(브라우저)에서 열려 마스킹·열표시·정렬 등을 자유롭게 조정할 수 있습니다.
            </p>

            <div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-bottom:24px;">
                <div style="padding:14px; background:var(--bg-input); border-radius:8px;">
                    <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">시험명</div>
                    <div style="font-size:14px; font-weight:600;">${examName ? this._esc(examName) : '<span style="color:var(--red);">세션을 먼저 저장하세요</span>'}</div>
                </div>
                <div style="padding:14px; background:var(--bg-input); border-radius:8px;">
                    <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">채점 데이터</div>
                    <div style="font-size:14px; font-weight:600;">${rowCount > 0 ? `${rowCount}명` : '<span style="color:var(--red);">데이터 없음</span>'}</div>
                </div>
            </div>

            <button onclick="PublicReport.generate()" ${ready ? '' : 'disabled'}
                style="width:100%; padding:14px; font-size:15px; font-weight:700; border:none; border-radius:8px; cursor:${ready ? 'pointer' : 'not-allowed'};
                       background:${ready ? 'var(--blue)' : 'var(--bg-input)'}; color:${ready ? '#fff' : 'var(--text-muted)'};">
                성적표 HTML 생성하기
            </button>
            ${ready ? '' : '<p style="margin:12px 0 0; font-size:11px; color:var(--text-muted); text-align:center;">세션을 저장하고 채점 데이터가 있어야 생성할 수 있습니다.</p>'}
        </div>`;

        container.innerHTML = html;
    },

    _esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },

    // HTML 안전 JSON 인젝션
    _safeJSON(obj) {
        return JSON.stringify(obj)
            .replace(new RegExp('[\\u2028\\u2029]', 'g'), c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026');
    },

    _buildHTML(data) {
        const titleSafe = this._esc(data.examName || '성적표');
        return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${titleSafe} 성적표</title>
<style>${this._css()}</style>
</head>
<body>
${this._bodyHTML(data)}
<script>
const D = ${this._safeJSON(data)};
${this._clientJS()}
<\/script>
</body>
</html>`;
    },

    _css() {
        return `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap');
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
:root{--pri:#1e40af;--pri-d:#1e3a8a;--pri-l:#dbeafe;--pri-xl:#eff6ff;--bg:#f1f5f9;--card:#fff;--bdr:#e2e8f0;--tx:#0f172a;--tx2:#334155;--mt:#64748b;--lt:#94a3b8;--ok:#059669;--ok-l:#d1fae5;--ng:#dc2626;--ng-l:#fee2e2;--wn:#d97706;--wn-l:#fef3c7;--radius:10px;--shadow:0 1px 3px rgba(0,0,0,0.06),0 4px 12px rgba(0,0,0,0.06);}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Pretendard','Noto Sans KR',sans-serif;background:var(--bg);color:var(--tx);font-size:11px;display:flex;height:100vh;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;}

#report-area{flex:1;height:100vh;overflow:hidden;display:flex;flex-direction:column;}
.tab-bar{display:flex;gap:0;background:#1e293b;padding:0 20px;flex-shrink:0;}
.tab-btn{padding:10px 24px;font-size:12px;font-weight:700;color:#94a3b8;background:none;border:none;cursor:pointer;border-bottom:3px solid transparent;font-family:inherit;transition:all 0.15s;}
.tab-btn:hover{color:#cbd5e1;background:rgba(255,255,255,0.05);}
.tab-btn.active{color:#fff;border-bottom-color:#3b82f6;background:rgba(255,255,255,0.08);}
.tab-page{flex:1;overflow:auto;padding:20px;background:#cbd5e1;display:none;justify-content:center;align-items:flex-start;}
.tab-page.active{display:flex;}
#report-paper,#stu-paper{background:var(--card);width:297mm;height:420mm;max-height:420mm;overflow:hidden;padding:10mm 12mm;box-shadow:0 8px 32px rgba(0,0,0,0.12);flex-shrink:0;position:relative;}
#settings-panel{width:300px;min-width:260px;height:100vh;overflow-y:auto;padding:16px;background:#fafbfc;border-left:1px solid var(--bdr);}

@media print{
body{display:block;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
#settings-panel{display:none!important;}
.tab-bar{display:none!important;}
#report-area{padding:0;background:#fff;display:block;height:auto;overflow:visible;}
.tab-page{display:block!important;padding:0;background:#fff;overflow:visible;}
#report-paper,#stu-paper{box-shadow:none;max-height:none;overflow:visible;padding:8mm 10mm;}
@page{size:297mm 420mm;margin:0;}
.no-print{display:none!important;}
}

/* === 브랜드 워드마크 === */
.brand{font-family:'Pretendard',sans-serif;font-weight:900;font-size:56px;letter-spacing:-0.04em;line-height:0.9;color:#1e293b;margin:0 0 6px;padding:2px 0;background:linear-gradient(90deg,#0f172a 0%,#1e40af 60%,#3b82f6 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}

/* === 헤더 배너 === */
.banner{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 40%,#1e40af 80%,#3b82f6 100%);color:#fff;padding:20px 24px 16px;border-radius:var(--radius);margin-bottom:14px;position:relative;overflow:hidden;}
.watermark{position:absolute;right:18px;top:50%;transform:translateY(-50%);font-family:'Pretendard',sans-serif;font-weight:900;font-size:80px;color:rgba(255,255,255,0.08);letter-spacing:-0.05em;user-select:none;line-height:1;white-space:nowrap;z-index:1;}
.banner-top,.kpi-row{position:relative;z-index:2;}
.banner::before{content:'';position:absolute;top:-50%;right:-10%;width:50%;height:200%;background:radial-gradient(ellipse,rgba(255,255,255,0.08),transparent 70%);pointer-events:none;}
.banner-top{display:flex;justify-content:space-between;align-items:flex-start;position:relative;}
.banner h1{font-size:22px;font-weight:900;letter-spacing:-0.03em;line-height:1.2;}
.banner .sub{font-size:11px;color:#93c5fd;margin-top:4px;font-weight:400;}
.banner .date-badge{background:rgba(255,255,255,0.15);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;backdrop-filter:blur(4px);}
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;position:relative;}
.kpi{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 12px;text-align:center;backdrop-filter:blur(4px);}
.kpi .kpi-val{font-size:24px;font-weight:900;color:#fff;line-height:1;}
.kpi .kpi-label{font-size:8px;color:#93c5fd;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;font-weight:600;}

/* === 섹션 카드 === */
.card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;box-shadow:var(--shadow);}
.card-title{font-size:15px;font-weight:800;color:var(--tx);margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.card-title .icon{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}
.card-title .icon.blue{background:var(--pri-l);color:var(--pri);}
.card-title .icon.green{background:var(--ok-l);color:var(--ok);}
.card-title .icon.red{background:var(--ng-l);color:var(--ng);}
.card-title .icon.orange{background:var(--wn-l);color:var(--wn);}

/* === 테이블 === */
.tbl{border-collapse:separate;border-spacing:0;width:100%;font-size:9px;}
.tbl th{background:linear-gradient(180deg,#1e293b,#334155);color:#fff;font-weight:600;font-size:11px;padding:6px 6px;text-align:center;cursor:pointer;user-select:none;white-space:nowrap;border:none;}
.tbl th:first-child{border-radius:6px 0 0 0;}.tbl th:last-child{border-radius:0 6px 0 0;}
.tbl th:hover{background:#2563eb;}
.tbl td{padding:5px 6px;text-align:center;border-bottom:1px solid #f1f5f9;border-right:1px solid #f8fafc;}
.tbl td[contenteditable]:hover{background:var(--pri-xl);}
.tbl tbody tr:hover{background:#eff6ff;}
.tbl tbody tr:nth-child(even){background:#fafbfc;}

/* === 차트 (사용자 드래그 리사이즈 가능) === */
.chart-wrap{background:linear-gradient(180deg,#fff,#f8fafc);border:1px solid var(--bdr);border-radius:8px;padding:10px 12px;position:relative;resize:both;overflow:hidden;min-width:280px;min-height:160px;}
.chart-wrap canvas{display:block;}
.chart-title{font-size:11px;font-weight:700;color:var(--tx2);margin-bottom:6px;text-align:center;}
.chart-legend{display:flex;gap:12px;justify-content:center;margin-top:8px;font-size:10px;color:var(--mt);}
.chart-legend span{display:flex;align-items:center;gap:3px;}
.chart-legend .dot{width:8px;height:8px;border-radius:2px;display:inline-block;}

/* === 학생 테이블 다단 (헤더 1줄 + 컬럼별 청크) === */
.stu-section{margin-bottom:14px;}
.stu-tbl th.col-sep,.stu-tbl td.col-sep{width:8px;min-width:8px;max-width:8px;padding:0;background:transparent!important;border:none!important;border-right:2px solid #cbd5e1!important;}
.stu-tbl th.hdr-empty{background:linear-gradient(180deg,#1e293b,#334155);color:transparent;cursor:default;}
.stu-tbl th.hdr-empty:hover{background:linear-gradient(180deg,#1e293b,#334155);}
.stu-tbl th{position:relative;}
.col-resize-handle{position:absolute;top:0;right:-2px;width:6px;height:100%;cursor:col-resize;user-select:none;z-index:5;}
.col-resize-handle:hover,.col-resize-handle.active{background:rgba(59,130,246,0.5);}

/* === 정답률 색상 === */
.cr-low{background:var(--ng-l)!important;color:var(--ng);font-weight:700;}
.cr-high{background:var(--ok-l)!important;color:var(--ok);font-weight:700;}
.tbl-compact th{padding:5px 4px;font-size:12px;font-weight:700;}
.tbl-compact td{padding:2px 3px;font-size:10px;line-height:1.2;}
.tbl-compact th.c-ch,.tbl-compact td.c-ch{width:44px;min-width:44px;max-width:44px;text-align:center;white-space:nowrap;}
.tbl-compact th.c-up,.tbl-compact td.c-up,.tbl-compact th.c-lo,.tbl-compact td.c-lo{width:42px;min-width:42px;max-width:42px;}

/* '?' 포함 셀 — 즉시 교정 안내 */
.stu-tbl td.cell-q{background:#fee2e2!important;color:#b91c1c!important;font-weight:700;}
.masked{filter:blur(5px);user-select:none;transition:filter 0.2s;}

/* 인쇄 시 차트 리사이즈 핸들 숨김 */
@media print{.chart-wrap{resize:none!important;}.col-resize-handle{display:none!important;}}

/* === 서식 툴바 === */
.fmt-bar{display:none;position:fixed;z-index:999;background:#1e293b;color:#fff;padding:5px 10px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);gap:6px;align-items:center;}
.fmt-bar.show{display:flex;}
.fmt-bar button{background:none;border:1px solid #475569;color:#fff;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;}
.fmt-bar button:hover{background:#334155;}
.fmt-bar input[type=color]{width:22px;height:18px;border:none;cursor:pointer;border-radius:3px;}
.fmt-bar select{padding:2px 4px;font-size:10px;border:1px solid #475569;background:#1e293b;color:#fff;border-radius:4px;}

/* === 설정 패널 === */
.sg{margin-bottom:8px;padding:8px 10px;background:#fff;border:1px solid var(--bdr);border-radius:8px;}
.sg h3{font-size:11px;font-weight:700;color:var(--tx2);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;cursor:pointer;}
.sg h3 .arr{font-size:9px;color:var(--mt);transition:transform 0.15s;}
.sg.collapsed h3 .arr{transform:rotate(-90deg);}
.sg.collapsed .sg-body{display:none;}
.sr{display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:11px;flex-wrap:wrap;}
.sr label{font-weight:600;color:#475569;font-size:10px;display:inline-flex;align-items:center;gap:3px;}
.sr label.fixed{min-width:65px;}
.sr input[type=text],.sr input[type=number],.sr select{padding:3px 6px;border:1px solid var(--bdr);border-radius:5px;font-size:11px;flex:1;min-width:0;}
.sr input[type=color]{width:26px;height:20px;border:1px solid var(--bdr);border-radius:4px;cursor:pointer;padding:0;}
.sr button{padding:3px 10px;border:1px solid var(--bdr);border-radius:5px;cursor:pointer;font-size:10px;background:#fff;font-weight:500;}
.sr button:hover{background:#f1f5f9;}
.pbtn{width:100%;padding:8px;background:var(--pri);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.02em;}
.pbtn:hover{background:var(--pri-d);}
.col-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px;font-size:10px;}
.col-grid label{min-width:0;font-weight:500;}
/* 점수 구간 칩 */
.bin-chips{display:flex;flex-wrap:wrap;gap:4px;padding:6px;border:1px solid #f1f5f9;border-radius:4px;background:#fafbfc;}
.bin-chip{display:inline-flex;align-items:center;padding:3px 10px;font-size:10px;border:1px solid #cbd5e1;border-radius:12px;cursor:pointer;user-select:none;background:var(--pri-l);color:var(--pri);font-weight:600;transition:all 0.12s;}
.bin-chip:hover{filter:brightness(1.05);transform:translateY(-1px);}
.bin-chip.off{background:#f1f5f9;color:#94a3b8;border-color:#e2e8f0;text-decoration:line-through;}

[contenteditable]:hover{outline:2px dashed rgba(59,130,246,0.3);outline-offset:1px;border-radius:3px;}
[contenteditable]:focus{outline:2px solid #3b82f6;background:rgba(59,130,246,0.03);border-radius:3px;}
`;
    },

    _bodyHTML(data) {
        // 학생 컬럼 토글 — 기본 ON 셋
        const defaultOn = {
            eno: true, name: false, phone: true, birthday: false,
            scode: false, ssc: true, scorr: false, swrong: false, smax: false, srank: false, spct: false, st: false,
            tot: false, tcorr: false, twrong: false, tmax: false, rk: false, pct: false, t: false,
        };
        // 과목 체크박스
        const subjChecks = data.subjects.map(s =>
            `<label><input type="checkbox" class="scb" value="${this._esc(s)}" checked onchange="rebuild()"> ${this._esc(s)}</label>`
        ).join('');

        // etcFields 컬럼 체크박스 (동적)
        const etcChecks = (data.etcKeys || []).map(k =>
            `<label><input type="checkbox" data-etc="${this._esc(k)}" onchange="rebuild()"> ${this._esc(k)}</label>`
        ).join('');

        return `
<div class="fmt-bar" id="fmt-bar">
<select onchange="fmtSz(this.value)"><option value="">크기</option><option value="8px">8</option><option value="9px">9</option><option value="10px">10</option><option value="11px">11</option><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option><option value="18px">18</option></select>
<button onclick="fmtB()" title="굵게"><b>B</b></button>
<input type="color" id="fmt-fg" value="#000000" onchange="fmtC(this.value)" title="글자색">
<input type="color" id="fmt-bg" value="#ffffff" onchange="fmtBg(this.value)" title="배경색">
</div>

<div id="report-area">
<div class="tab-bar">
<button class="tab-btn active" onclick="switchTab('report')">성적 리포트</button>
<button class="tab-btn" onclick="switchTab('student')">학생 성적표</button>
</div>

<div class="tab-page active" id="tab-report"><div id="report-paper">
<div class="brand" contenteditable="true">HACKERS</div>
<div class="banner">
<div class="watermark" contenteditable="true">HACKERS</div>
<div class="banner-top">
<div>
<h1 contenteditable="true" data-meta="title">${this._esc(data.examName || '')}</h1>
<div class="sub" contenteditable="true" data-meta="sub">${this._esc((data.subjects || []).join(' · '))}</div>
</div>
<div class="date-badge" contenteditable="true" data-meta="date">${this._esc(data.examDate || '')}</div>
</div>
<div class="kpi-row">
<div class="kpi"><div class="kpi-val" data-kpi="n">0</div><div class="kpi-label">응시인원</div></div>
<div class="kpi"><div class="kpi-val" data-kpi="avg">-</div><div class="kpi-label">평균점수</div></div>
<div class="kpi"><div class="kpi-val" data-kpi="avgc">-</div><div class="kpi-label">평균맞은수</div></div>
<div class="kpi"><div class="kpi-val" data-kpi="max">-</div><div class="kpi-label">최고점</div></div>
</div>
</div>

<div class="card">
<div class="card-title"><span class="icon blue">📊</span> 점수대별 응시자 분포</div>
<div style="overflow-x:auto;"><table class="tbl" id="dist-tbl" style="font-size:20px;"></table></div>
<div class="chart-wrap" style="margin-top:8px;">
<canvas id="dist-cv" height="220"></canvas>
</div>
</div>

<div id="item-area"></div>

</div></div>

<div class="tab-page" id="tab-student"><div id="stu-paper">
<div class="brand" contenteditable="true">HACKERS</div>
<div class="banner">
<div class="watermark" contenteditable="true">HACKERS</div>
<div class="banner-top">
<div>
<h1 contenteditable="true" data-meta="title">${this._esc(data.examName || '')}</h1>
<div class="sub" contenteditable="true" data-meta="sub">${this._esc((data.subjects || []).join(' · '))}</div>
</div>
<div class="date-badge" contenteditable="true" data-meta="date">${this._esc(data.examDate || '')}</div>
</div>
<div class="kpi-row">
<div class="kpi"><div class="kpi-val" data-kpi="n">0</div><div class="kpi-label">응시인원</div></div>
<div class="kpi"><div class="kpi-val" data-kpi="avg">-</div><div class="kpi-label">평균점수</div></div>
<div class="kpi"><div class="kpi-val" data-kpi="avgc">-</div><div class="kpi-label">평균맞은수</div></div>
<div class="kpi"><div class="kpi-val" data-kpi="max">-</div><div class="kpi-label">최고점</div></div>
</div>
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 12px;">
<div style="font-size:16px;font-weight:800;color:var(--tx);">학생 성적표</div>
<div style="display:flex;gap:8px;align-items:center;" class="no-print">
<button onclick="window.print()" style="padding:6px 16px;background:var(--pri);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">인쇄</button>
</div>
</div>
<div id="stu-tbl-wrap" style="font-size:11px;"></div>
</div></div>

</div>

<!-- 설정 패널 -->
<div id="settings-panel">
<div style="font-size:14px;font-weight:800;color:var(--tx);margin-bottom:12px;">⚙ 설정</div>

<div class="sg"><h3 onclick="togSg(this)">브랜드 / 헤더<span class="arr">▼</span></h3>
<div class="sg-body">
<div style="font-size:9px;color:var(--mt);margin:2px 0 4px;font-weight:700;">— 워드마크 (상단 큰 텍스트) —</div>
<div style="font-size:9px;color:var(--mt);margin-bottom:4px;">텍스트는 직접 클릭으로 편집</div>
<div class="sr"><label class="fixed">크기</label><input type="number" id="brand-fs" value="56" min="20" max="160" onchange="setBrandStyle()" style="width:60px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">색상</label><input type="color" id="brand-color" value="#1e40af" onchange="setBrandStyle()"></div>
<div class="sr"><label><input type="checkbox" id="brand-grad" checked onchange="setBrandStyle()">그라데이션</label></div>

<div style="font-size:9px;color:var(--mt);margin:8px 0 4px;font-weight:700;">— 워터마크 (배너 우측 거대 텍스트) —</div>
<div class="sr"><label><input type="checkbox" id="wm-show" checked onchange="setWatermarkStyle()">워터마크 표시</label></div>
<div class="sr"><label class="fixed">크기</label><input type="number" id="wm-fs" value="80" min="30" max="200" onchange="setWatermarkStyle()" style="width:60px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">진하기</label><input type="number" id="wm-op" value="8" min="1" max="50" onchange="setWatermarkStyle()" style="width:50px;flex:0 0 auto;">%</div>

<div style="font-size:9px;color:var(--mt);margin:8px 0 4px;font-weight:700;">— 배너 헤더 —</div>
<div class="sr"><label class="fixed">제목 크기</label><input type="number" id="hdr-title-fs" value="22" min="12" max="60" onchange="setHeaderStyle()" style="width:60px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">부제 크기</label><input type="number" id="hdr-sub-fs" value="11" min="8" max="30" onchange="setHeaderStyle()" style="width:60px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">KPI 값</label><input type="number" id="hdr-kpi-fs" value="24" min="12" max="60" onchange="setHeaderStyle()" style="width:60px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">KPI 라벨</label><input type="number" id="hdr-kpi-lf" value="8" min="6" max="20" onchange="setHeaderStyle()" style="width:60px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">배경 시작</label><input type="color" id="hdr-bg-start" value="#0f172a" onchange="setHeaderStyle()"></div>
<div class="sr"><label class="fixed">배경 끝</label><input type="color" id="hdr-bg-end" value="#3b82f6" onchange="setHeaderStyle()"></div>
</div></div>

<div class="sg"><h3 onclick="togSg(this)">과목 선택<span class="arr">▼</span></h3>
<div class="sg-body"><div class="sr" style="flex-direction:column;align-items:flex-start;">${subjChecks}</div></div></div>

<div class="sg"><h3 onclick="togSg(this)">점수 분포 구간<span class="arr">▼</span></h3>
<div class="sg-body">
<div class="sr"><label class="fixed">모드</label>
<select id="bin-mode" onchange="onBinModeChange()" style="flex:1;">
<option value="auto">자동 (0 단독 + 균등 구간)</option>
<option value="manual">수동 (직접 구간 입력)</option>
</select></div>
<div class="sr" id="bin-auto-row"><label class="fixed">구간 크기</label><input type="number" id="s-bin" value="5" min="1" max="50" style="width:60px;flex:0 0 auto;" onchange="rebuild()"><span style="font-size:10px;color:var(--mt);">점</span></div>
<div class="sr" id="bin-manual-row" style="display:none;flex-direction:column;align-items:stretch;"><label style="font-weight:600;color:#475569;font-size:10px;margin-bottom:3px;">상한값들 (쉼표 구분, 마지막=만점)</label>
<input type="text" id="s-bin-manual" placeholder="예: 5,10,20,40,100" onchange="rebuild()"></div>
<div class="sr" style="margin-top:6px;"><button onclick="binAllOn()">전체 표시</button><button onclick="binAllOff()">전체 숨김</button></div>
<div style="font-size:9px;color:var(--mt);margin:6px 0 4px;font-weight:700;">표시 구간 (클릭=토글)</div>
<div id="bin-toggles" class="bin-chips"></div>
</div></div>

<div class="sg"><h3 onclick="togSg(this)">점수 분포 차트<span class="arr">▼</span></h3>
<div class="sg-body">
<div class="sr"><label class="fixed">데이터레이블</label><input type="checkbox" id="s-lbl" checked onchange="rebuild()"></div>
<div class="sr"><label class="fixed">막대 색상</label><input type="color" id="s-clr" value="#1e40af" onchange="rebuild()"></div>
<div class="sr"><label class="fixed">표 글씨</label><input type="number" id="s-tblf" value="20" min="8" max="40" onchange="document.getElementById('dist-tbl').style.fontSize=this.value+'px'" style="width:50px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">축 글씨</label><input type="number" id="s-axf" value="15" min="6" max="40" onchange="rebuild()" style="width:50px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">제목 글씨</label><input type="number" id="s-dtf" value="22" min="8" max="40" onchange="rebuild()" style="width:50px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">눈금선</label><input type="checkbox" id="s-grid" checked onchange="rebuild()"></div>
</div></div>

<div class="sg"><h3 onclick="togSg(this)">문항 정답률 차트<span class="arr">▼</span></h3>
<div class="sg-body">
<div class="sr"><label class="fixed">축 글씨</label><input type="number" id="s-iaxf" value="11" min="6" max="20" onchange="rebuild()" style="width:50px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">제목 글씨</label><input type="number" id="s-itf" value="13" min="8" max="22" onchange="rebuild()" style="width:50px;flex:0 0 auto;">px</div>
<div class="sr"><label class="fixed">눈금선</label><input type="checkbox" id="s-igrid" checked onchange="rebuild()"></div>
</div></div>

<div class="sg"><h3 onclick="togSg(this)">학생 테이블 컬럼<span class="arr">▼</span></h3>
<div class="sg-body">
<div style="font-size:9px;color:var(--mt);margin-bottom:4px;font-weight:700;">— 인적사항 —</div>
<div class="col-grid">
<label><input type="checkbox" data-c="eno" ${defaultOn.eno?'checked':''} onchange="rebuild()">수험번호</label>
<label><input type="checkbox" data-c="name" ${defaultOn.name?'checked':''} onchange="rebuild()">이름</label>
<label><input type="checkbox" data-c="phone" ${defaultOn.phone?'checked':''} onchange="rebuild()">전화번호</label>
<label><input type="checkbox" data-c="birthday" ${defaultOn.birthday?'checked':''} onchange="rebuild()">생년월일</label>
<label><input type="checkbox" data-c="scode" ${defaultOn.scode?'checked':''} onchange="rebuild()">과목코드</label>
</div>
${etcChecks ? `<div style="font-size:9px;color:var(--mt);margin:8px 0 4px;font-weight:700;">— 기타 필드 —</div><div class="col-grid">${etcChecks}</div>` : ''}
<div style="font-size:9px;color:var(--mt);margin:8px 0 4px;font-weight:700;">— 과목별 —</div>
<div class="col-grid">
<label><input type="checkbox" data-c="ssc" ${defaultOn.ssc?'checked':''} onchange="rebuild()">점수</label>
<label><input type="checkbox" data-c="scorr" ${defaultOn.scorr?'checked':''} onchange="rebuild()">맞은수</label>
<label><input type="checkbox" data-c="swrong" ${defaultOn.swrong?'checked':''} onchange="rebuild()">틀린수</label>
<label><input type="checkbox" data-c="smax" ${defaultOn.smax?'checked':''} onchange="rebuild()">만점</label>
<label><input type="checkbox" data-c="srank" ${defaultOn.srank?'checked':''} onchange="rebuild()">석차</label>
<label><input type="checkbox" data-c="spct" ${defaultOn.spct?'checked':''} onchange="rebuild()">백분위</label>
<label><input type="checkbox" data-c="st" ${defaultOn.st?'checked':''} onchange="rebuild()">표준점수</label>
</div>
<div style="font-size:9px;color:var(--mt);margin:8px 0 4px;font-weight:700;">— 종합 —</div>
<div class="col-grid">
<label><input type="checkbox" data-c="tot" ${defaultOn.tot?'checked':''} onchange="rebuild()">총점</label>
<label><input type="checkbox" data-c="tcorr" ${defaultOn.tcorr?'checked':''} onchange="rebuild()">총 맞은수</label>
<label><input type="checkbox" data-c="twrong" ${defaultOn.twrong?'checked':''} onchange="rebuild()">총 틀린수</label>
<label><input type="checkbox" data-c="tmax" ${defaultOn.tmax?'checked':''} onchange="rebuild()">총 만점</label>
<label><input type="checkbox" data-c="rk" ${defaultOn.rk?'checked':''} onchange="rebuild()">종합석차</label>
<label><input type="checkbox" data-c="pct" ${defaultOn.pct?'checked':''} onchange="rebuild()">종합백분위</label>
<label><input type="checkbox" data-c="t" ${defaultOn.t?'checked':''} onchange="rebuild()">종합표준점수</label>
</div>
</div></div>

<div class="sg"><h3 onclick="togSg(this)">학생 테이블 레이아웃<span class="arr">▼</span></h3>
<div class="sg-body">
<div class="sr"><label class="fixed">모드</label>
<select id="stu-mode" onchange="onStuModeChange()" style="flex:0 0 auto;">
<option value="multi" selected>가로 다단 (n명씩 옆으로)</option>
<option value="single">세로 1단 (긴 테이블)</option>
</select></div>
<div class="sr stu-multi-row"><label class="fixed">묶음당 N명</label><input type="number" id="stu-n" value="30" min="1" max="500" style="width:70px;flex:0 0 auto;" onchange="rebuild()"></div>
<div class="sr stu-multi-row"><label class="fixed">컬럼 수</label><input type="number" id="stu-c" value="3" min="1" max="10" style="width:70px;flex:0 0 auto;" onchange="rebuild()"></div>
<div style="font-size:9px;color:var(--mt);">※ 다단 모드: 한 섹션 = N×컬럼 학생. 헤더는 섹션 상단에 1줄. 학생 많으면 섹션이 아래로 쌓임.</div>
</div></div>

<div class="sg"><h3 onclick="togSg(this)">마스킹<span class="arr">▼</span></h3>
<div class="sg-body">
<div class="sr"><label class="fixed">대상</label><select id="s-mmde">
<option value="all">전체</option>
<option value="eno">수험번호</option>
<option value="name">이름</option>
<option value="phone">전화번호</option>
<option value="birthday">생년월일</option>
</select></div>
<div class="sr"><label class="fixed">방식</label><select id="s-msty"><option value="blur">블러</option><option value="star">***</option></select></div>
<div class="sr"><label class="fixed">* 자리</label><input type="text" id="s-mpos" value="3,4,5" style="flex:1;"></div>
<div class="sr"><button onclick="doMask()">적용</button><button onclick="undoMask()">해제</button></div>
</div></div>

<div class="sg"><h3 onclick="togSg(this)">문항분석<span class="arr">▼</span></h3>
<div class="sg-body">
<div class="sr"><label class="fixed">오답기준↓</label><input type="number" id="s-crlo" value="40" min="0" max="100" onchange="recolor()" style="width:55px;flex:0 0 auto;">%</div>
<div class="sr"><label class="fixed">정답기준↑</label><input type="number" id="s-crhi" value="80" min="0" max="100" onchange="recolor()" style="width:55px;flex:0 0 auto;">%</div>
<div class="sr"><label class="fixed">상위그룹</label><input type="number" id="s-upct" value="12" min="1" max="50" onchange="rebuild()" style="width:55px;flex:0 0 auto;">%</div>
<div class="sr"><label class="fixed">하위그룹</label><input type="number" id="s-lpct" value="30" min="1" max="50" onchange="rebuild()" style="width:55px;flex:0 0 auto;">%</div>
<div style="font-size:9px;color:var(--mt);margin:6px 0 4px;font-weight:700;">컬럼 표시</div>
<div class="sr" style="flex-wrap:wrap;gap:6px;">
<label><input type="checkbox" data-itemcol="c-up" checked onchange="togItemCol(this)">상위%</label>
<label><input type="checkbox" data-itemcol="c-lo" checked onchange="togItemCol(this)">하위%</label>
<label><input type="checkbox" data-itemcol="c-disc" onchange="togItemCol(this)">변별도</label>
</div>
<div class="sr"><label><input type="checkbox" id="show-item" checked onchange="document.getElementById('item-area').style.display=this.checked?'':'none'">문항분석 섹션 표시</label></div>
</div></div>

<div class="sg"><button class="pbtn" onclick="window.print()">🖨 인쇄 / PDF 저장</button>
<div style="font-size:9px;color:var(--mt);margin-top:6px;text-align:center;">설정 패널은 인쇄에 포함되지 않습니다</div></div>
</div>
`;
    },

    _clientJS() {
        return `
const Q=s=>document.querySelector(s),QA=s=>document.querySelectorAll(s);

// ── 탭 ──
function switchTab(id){QA('.tab-btn').forEach((b,i)=>b.classList.toggle('active',i===(id==='report'?0:1)));Q('#tab-report').classList.toggle('active',id==='report');Q('#tab-student').classList.toggle('active',id==='student');}

// ── 설정 그룹 토글 ──
function togSg(h){h.parentElement.classList.toggle('collapsed');}

// ── 과목 선택 ──
function ck(){return[...QA('.scb:checked')].map(c=>c.value);}

// ── 컬럼 토글 ──
function colOn(c){const el=Q('input[data-c="'+c+'"]');return el?el.checked:false;}
function etcOn(k){const el=Q('input[data-etc="'+CSS.escape(k)+'"]');return el?el.checked:false;}

// ── 정렬 ──
let sortSt={};
function sortTbl(id,ci){const tbl=Q('#'+id);if(!tbl)return;const tb=tbl.querySelector('tbody');if(!tb)return;const k=id+'_'+ci;const dir=sortSt[k]==='asc'?'desc':'asc';sortSt[k]=dir;const rows=[...tb.querySelectorAll('tr')];rows.sort((a,b)=>{let av=a.children[ci]?.textContent?.trim()||'',bv=b.children[ci]?.textContent?.trim()||'';const an=parseFloat(av),bn=parseFloat(bv);if(!isNaN(an)&&!isNaN(bn))return dir==='asc'?an-bn:bn-an;return dir==='asc'?av.localeCompare(bv):bv.localeCompare(av);});rows.forEach(r=>tb.appendChild(r));}

// ── 서식 툴바 ──
let fmtT=null;
document.addEventListener('click',e=>{const td=e.target.closest('td[contenteditable]');const bar=Q('#fmt-bar');if(td){fmtT=td;const r=td.getBoundingClientRect();bar.style.left=Math.max(8,Math.min(r.left,innerWidth-300))+'px';bar.style.top=Math.max(8,r.top-36)+'px';bar.classList.add('show');}else if(!e.target.closest('#fmt-bar')){bar.classList.remove('show');fmtT=null;}});
function fmtSz(v){if(fmtT&&v)fmtT.style.fontSize=v;}
function fmtB(){if(fmtT)fmtT.style.fontWeight=fmtT.style.fontWeight==='700'?'':'700';}
function fmtC(v){if(fmtT)fmtT.style.color=v;}
function fmtBg(v){if(fmtT)fmtT.style.backgroundColor=v;}

// ── 마스킹 ──
let mBak=[];
let _maskActive=false;
function doMask(){undoMask(true);const mode=Q('#s-mmde').value,sty=Q('#s-msty').value;const pos=Q('#s-mpos').value.split(',').map(s=>parseInt(s.trim())-1).filter(n=>!isNaN(n));const targets=mode==='all'?['eno','name','phone','birthday']:[mode];QA('#stu-tbl-wrap .stu-tbl tbody tr').forEach(tr=>{targets.forEach(cls=>{tr.querySelectorAll('.col-'+cls).forEach(el=>{if(!el||!el.textContent)return;const wasQ=el.classList.contains('cell-q');if(sty==='blur'){mBak.push({el,h:el.innerHTML,cls:'masked',wasQ});el.classList.add('masked');if(wasQ)el.classList.remove('cell-q');}else{const t=el.textContent;const c=[...t];pos.forEach(p=>{if(p>=0&&p<c.length)c[p]='*';});const newT=c.join('');mBak.push({el,h:t,cls:null,wasQ});el.textContent=newT;if(wasQ&&!newT.includes('?'))el.classList.remove('cell-q');}});});});_maskActive=true;}
function undoMask(internal){mBak.forEach(({el,h,cls,wasQ})=>{try{if(cls)el.classList.remove(cls);else el.textContent=h;if(wasQ)el.classList.add('cell-q');}catch(e){}});mBak=[];if(!internal)_maskActive=false;}
function reapplyMaskIfActive(){if(_maskActive)doMask();}

// ── 브랜드 / 헤더 스타일 ──
function _hexLighten(hex){const m=hex.replace('#','').match(/^(..)(..)(..)$/);if(!m)return hex;const r=Math.min(255,parseInt(m[1],16)+60),g=Math.min(255,parseInt(m[2],16)+60),b=Math.min(255,parseInt(m[3],16)+60);return'#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');}
function setBrandStyle(){
  const fs=Q('#brand-fs').value;
  const color=Q('#brand-color').value;
  const grad=Q('#brand-grad').checked;
  QA('.brand').forEach(el=>{
    el.style.fontSize=fs+'px';
    if(grad){
      el.style.backgroundImage='linear-gradient(90deg,#0f172a 0%,'+color+' 60%,'+_hexLighten(color)+' 100%)';
      el.style.webkitBackgroundClip='text';el.style.backgroundClip='text';
      el.style.webkitTextFillColor='transparent';
      el.style.color='';
    }else{
      el.style.backgroundImage='none';
      el.style.webkitTextFillColor='unset';
      el.style.color=color;
    }
  });
}
function setWatermarkStyle(){
  const show=Q('#wm-show').checked;
  const fs=Q('#wm-fs').value;
  const op=parseInt(Q('#wm-op').value)/100;
  QA('.watermark').forEach(el=>{
    el.style.display=show?'':'none';
    el.style.fontSize=fs+'px';
    el.style.color='rgba(255,255,255,'+op+')';
  });
}
function setHeaderStyle(){
  const titleFs=Q('#hdr-title-fs').value;
  const subFs=Q('#hdr-sub-fs').value;
  const kpiFs=Q('#hdr-kpi-fs').value;
  const kpiLf=Q('#hdr-kpi-lf').value;
  const bgStart=Q('#hdr-bg-start').value;
  const bgEnd=Q('#hdr-bg-end').value;
  QA('.banner h1').forEach(el=>el.style.fontSize=titleFs+'px');
  QA('.banner .sub').forEach(el=>el.style.fontSize=subFs+'px');
  QA('.kpi-val').forEach(el=>el.style.fontSize=kpiFs+'px');
  QA('.kpi-label').forEach(el=>el.style.fontSize=kpiLf+'px');
  QA('.banner').forEach(el=>el.style.background='linear-gradient(135deg,'+bgStart+' 0%,#1e3a5f 40%,'+bgEnd+' 100%)');
}

// ── 색상 재계산 (정답률) ──
function recolor(){const lo=parseInt(Q('#s-crlo').value)||40,hi=parseInt(Q('#s-crhi').value)||80;QA('.ia-cr').forEach(c=>{const v=parseFloat(c.textContent);c.className='ia-cr'+(v<lo?' cr-low':v>hi?' cr-high':'');});}

// ── 문항분석 컬럼 토글 ──
function togItemCol(cb){const cls=cb.dataset.itemcol;const show=cb.checked;document.querySelectorAll('.'+cls).forEach(el=>{el.style.display=show?'':'none';});}
function applyItemColState(){QA('input[data-itemcol]').forEach(cb=>togItemCol(cb));}

// ── 점수 구간 계산 ──
// 자동: [0,0], [1,bin], [bin+1, 2*bin], ..., [last+1, max]
// 수동: breakpoints 배열 (오름차순) → [0, bp1], [bp1+1, bp2], ...
function calcBins(maxScore){
  const mode=Q('#bin-mode').value;
  const out=[]; // {lo, hi, label}
  if(mode==='manual'){
    const raw=Q('#s-bin-manual').value.trim();
    if(!raw){return [{lo:0,hi:maxScore,label:'0~'+maxScore}];}
    const bps=raw.split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
    if(bps.length===0)return [{lo:0,hi:maxScore,label:'0~'+maxScore}];
    let prev=-1;
    for(const bp of bps){
      const lo=prev+1, hi=bp;
      if(hi<lo)continue;
      out.push({lo,hi,label:lo===hi?String(lo):lo+'~'+hi});
      prev=bp;
    }
    if(prev<maxScore){const lo=prev+1,hi=maxScore;out.push({lo,hi,label:lo===hi?String(lo):lo+'~'+hi});}
    return out;
  }
  // 자동
  const bin=parseInt(Q('#s-bin').value)||5;
  out.push({lo:0,hi:0,label:'0'});
  let lo=1;
  while(lo<=maxScore){
    let hi=lo+bin-1;
    if(hi>maxScore)hi=maxScore;
    out.push({lo,hi,label:lo===hi?String(lo):lo+'~'+hi});
    lo=hi+1;
  }
  return out;
}

function onBinModeChange(){
  const mode=Q('#bin-mode').value;
  Q('#bin-auto-row').style.display=mode==='auto'?'':'none';
  Q('#bin-manual-row').style.display=mode==='manual'?'':'none';
  rebuild();
}

// 구간별 ON/OFF — 칩 토글
let binShow={}; // {label: bool}  (false면 숨김, undefined/true면 표시)
function binAllOn(){QA('#bin-toggles .bin-chip').forEach(c=>{c.classList.remove('off');binShow[c.dataset.lbl]=true;});rebuild();}
function binAllOff(){QA('#bin-toggles .bin-chip').forEach(c=>{c.classList.add('off');binShow[c.dataset.lbl]=false;});rebuild();}
function onBinChipClick(chip){const lbl=chip.dataset.lbl;const cur=binShow[lbl]!==false;binShow[lbl]=!cur;chip.classList.toggle('off',!binShow[lbl]);rebuild();}

function renderBinToggles(bins){
  let h='';
  bins.forEach(b=>{const on=binShow[b.label]!==false;h+='<span class="bin-chip'+(on?'':' off')+'" data-lbl="'+b.label+'" onclick="onBinChipClick(this)">'+b.label+'</span>';});
  Q('#bin-toggles').innerHTML=h;
}

// ── 메인 재렌더 ──
function rebuild(){
  buildKPI();
  buildDist();
  buildItems();
  buildStudent();
  recolor();
  setupChartResize();
}

// ── 차트 리사이즈 (드래그) ──
let _distState=null,_iaState={};
function _padXY(el){const cs=getComputedStyle(el);return{x:parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight),y:parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)};}
// 인쇄 화질용 DPR — canvas buffer를 3배로 만들고 CSS로 원래 크기 유지
const _DPR=3;
function _setCanvasFromWrap(wrap,cv,reserveBottom=0){
  const p=_padXY(wrap);
  const W=Math.max(200,Math.floor(wrap.clientWidth-p.x));
  const H=Math.max(120,Math.floor(wrap.clientHeight-p.y-reserveBottom));
  cv.style.width=W+'px';cv.style.height=H+'px';
  const tW=W*_DPR,tH=H*_DPR;
  if(cv.width!==tW)cv.width=tW;
  if(cv.height!==tH)cv.height=tH;
  cv.dataset.lw=W;cv.dataset.lh=H;
}
// 그리기 시작 — 논리 좌표계 (W,H) 반환 + setTransform 적용
function _ctxLogical(cv){
  const W=parseInt(cv.dataset.lw)||cv.width;
  const H=parseInt(cv.dataset.lh)||cv.height;
  const dpr=W>0?(cv.width/W):1;
  const ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return{ctx,W,H};
}
function setupChartResize(){
  if(window._chartObs)window._chartObs.disconnect();
  window._chartObs=new ResizeObserver(entries=>{
    entries.forEach(e=>{
      const wrap=e.target;const cv=wrap.querySelector('canvas');if(!cv)return;
      if(cv.id==='dist-cv'){_setCanvasFromWrap(wrap,cv,0);drawDist();}
      else if(cv.classList.contains('ia-cv')){const lg=wrap.querySelector('.chart-legend');const rb=lg?lg.offsetHeight+10:0;_setCanvasFromWrap(wrap,cv,rb);drawItem(cv);}
    });
  });
  QA('.chart-wrap').forEach(w=>window._chartObs.observe(w));
}

function _setKPI(name,val){QA('[data-kpi="'+name+'"]').forEach(el=>el.textContent=val);}
function buildKPI(){
  const ck_=ck();
  const valid=D.students.filter(s=>!s._noOmr);
  if(valid.length===0){_setKPI('n',0);_setKPI('avg','-');_setKPI('avgc','-');_setKPI('max','-');_setKPI('std','-');return;}
  const sums=valid.map(st=>{let sum=0;ck_.forEach(s=>{const sub=st.subjects[s];if(sub&&typeof sub.score==='number')sum+=sub.score;});return sum;});
  const corrs=valid.map(st=>{let c=0;ck_.forEach(s=>{const sub=st.subjects[s];if(sub&&typeof sub.correctCount==='number')c+=sub.correctCount;});return c;});
  const N=valid.length;
  const mean=sums.reduce((a,b)=>a+b,0)/N;
  const meanC=corrs.reduce((a,b)=>a+b,0)/N;
  const variance=sums.reduce((a,b)=>a+(b-mean)**2,0)/N;
  const std=Math.sqrt(variance);
  const mx=Math.max(...sums);
  _setKPI('n',N);
  _setKPI('avg',mean.toFixed(1));
  _setKPI('avgc',meanC.toFixed(1));
  _setKPI('max',mx);
  _setKPI('std',std.toFixed(1));
}

function buildDist(){
  const ck_=ck();
  const valid=D.students.filter(s=>!s._noOmr);
  const sums=valid.map(st=>{let sum=0;ck_.forEach(s=>{const sub=st.subjects[s];if(sub&&typeof sub.score==='number')sum+=sub.score;});return sum;});
  const totalMax=ck_.reduce((acc,s)=>{const sub=valid.find(st=>typeof st.subjects[s]?.totalPossible==='number')?.subjects[s];return acc+(sub?sub.totalPossible:0);},0);
  const mxRaw=Math.max(...sums,10);
  const maxScore=totalMax>0?totalMax:mxRaw;
  const bins=calcBins(maxScore);
  const counts=bins.map(b=>sums.filter(s=>s>=b.lo&&s<=b.hi).length);
  renderBinToggles(bins);
  const visIdx=bins.map((b,i)=>(binShow[b.label]!==false)?i:-1).filter(i=>i>=0);
  const visBins=visIdx.map(i=>bins[i]);
  const visCounts=visIdx.map(i=>counts[i]);

  // 가로 테이블
  let h='<thead><tr><th style="background:#334155;">점수</th>';
  visBins.forEach(b=>{h+='<th>'+b.label+'</th>';});
  h+='</tr></thead><tbody><tr><td style="font-weight:700;background:#f8fafc;">인원</td>';
  visCounts.forEach(c=>{h+='<td contenteditable="true">'+c+'</td>';});
  h+='</tr></tbody>';
  Q('#dist-tbl').innerHTML=h;

  // 차트 데이터 캐시
  _distState={visBins,visCounts};

  // 차트 — wrap width는 컨테이너 자동, height만 초기값. 사용자가 드래그로 변경 가능.
  const cv=Q('#dist-cv');if(!cv)return;
  const wrap=cv.parentElement;
  if(!wrap.style.height){wrap.style.height='280px';}
  _setCanvasFromWrap(wrap,cv,0);
  drawDist();
}

function drawDist(){
  if(!_distState)return;
  const{visBins,visCounts}=_distState;
  const cv=Q('#dist-cv');if(!cv)return;
  const lbl=Q('#s-lbl').checked;const clr=Q('#s-clr').value;
  const axF=parseInt(Q('#s-axf').value)||11;const dtF=parseInt(Q('#s-dtf').value)||13;
  const grid=Q('#s-grid').checked;
  const FN="'Pretendard','Noto Sans KR',sans-serif";
  const{ctx,W,H}=_ctxLogical(cv);
  ctx.clearRect(0,0,W,H);
  if(visBins.length===0){ctx.fillStyle='#94a3b8';ctx.font='14px '+FN;ctx.textAlign='center';ctx.fillText('표시할 구간 없음',W/2,H/2);return;}
  const maxC=Math.max(...visCounts,1);
  const P={l:50,r:16,t:dtF+14,b:axF+34};
  const cW=W-P.l-P.r,cH=H-P.t-P.b;
  const bW=Math.max(8,cW/visBins.length-8);
  ctx.fillStyle='#1e293b';ctx.font='900 '+dtF+'px '+FN;ctx.textAlign='center';ctx.fillText('점수 분포 그래프',W/2,dtF+2);
  ctx.save();ctx.translate(12,P.t+cH/2);ctx.rotate(-Math.PI/2);ctx.fillStyle='#64748b';ctx.font='700 '+(axF-1)+'px '+FN;ctx.textAlign='center';ctx.fillText('(명)',0,0);ctx.restore();
  if(grid){ctx.strokeStyle='#e2e8f0';ctx.lineWidth=0.5;for(let i=0;i<=5;i++){const y=P.t+cH-cH*(i/5);ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(W-P.r,y);ctx.stroke();}}
  ctx.fillStyle='#64748b';ctx.font='600 '+axF+'px '+FN;ctx.textAlign='right';for(let i=0;i<=5;i++){const y=P.t+cH-cH*(i/5);ctx.fillText(Math.round(maxC*i/5),P.l-6,y+4);}
  ctx.strokeStyle='#cbd5e1';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,P.t+cH);ctx.lineTo(W-P.r,P.t+cH);ctx.stroke();ctx.beginPath();ctx.moveTo(P.l,P.t);ctx.lineTo(P.l,P.t+cH);ctx.stroke();
  visBins.forEach((b,i)=>{const x=P.l+i*(bW+8)+4;const c_=visCounts[i];const h_=(c_/maxC)*cH;const y=P.t+cH-h_;
    ctx.fillStyle='rgba(0,0,0,0.06)';if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x+2,y+2,bW,h_,[5,5,0,0]);ctx.fill();}else{ctx.fillRect(x+2,y+2,bW,h_);}
    const g=ctx.createLinearGradient(x,y,x,y+h_);g.addColorStop(0,clr);g.addColorStop(0.6,clr+'dd');g.addColorStop(1,clr+'88');ctx.fillStyle=g;
    if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x,y,bW,h_,[5,5,0,0]);ctx.fill();}else{ctx.fillRect(x,y,bW,h_);}
    ctx.fillStyle='rgba(255,255,255,0.25)';if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x,y,bW*0.4,h_*0.6,[5,0,0,0]);ctx.fill();}
    ctx.fillStyle='#334155';ctx.font='600 '+axF+'px '+FN;ctx.textAlign='center';ctx.fillText(b.label,x+bW/2,P.t+cH+axF+10);
    if(lbl&&c_>0){ctx.fillStyle='#0f172a';ctx.font='900 '+(axF+1)+'px '+FN;ctx.fillText(c_,x+bW/2,y-5);}});
  ctx.fillStyle='#64748b';ctx.font='700 '+(axF-1)+'px '+FN;ctx.textAlign='center';ctx.fillText('(점수)',W/2,H-4);
}

function buildItems(){
  const ck_=ck();
  let h='';
  ck_.forEach(subj=>{const items=D.itemAnalysis[subj]||[];if(!items.length)return;
    const upct=parseInt(Q('#s-upct').value)||12;const lpct=parseInt(Q('#s-lpct').value)||30;
    h+='<div class="card subj-sec" data-s="'+subj+'"><div class="card-title"><span class="icon orange">📈</span>'+subj+' — 문항별 정답분석</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
    h+='<table class="tbl tbl-compact"><thead><tr><th>Q</th><th>정답</th><th>정답률</th><th class="c-up">상위'+upct+'%</th><th class="c-lo">하위'+lpct+'%</th><th class="c-disc">변별도</th><th class="c-ch">①</th><th class="c-ch">②</th><th class="c-ch">③</th><th class="c-ch">④</th><th class="c-ch">⑤</th></tr></thead><tbody>';
    const crLo=parseInt(Q('#s-crlo').value)||40,crHi=parseInt(Q('#s-crhi').value)||80;
    items.forEach(it=>{const cr=it.correctRate!=null?it.correctRate.toFixed(1):'-';const cls=it.correctRate<crLo?'cr-low':it.correctRate>crHi?'cr-high':'';const rowBg=it.correctRate!=null&&it.correctRate<crLo?'background:#fef2f2;':'';const disc=it.discrimination!=null?it.discrimination.toFixed(2):'-';const dcls=it.discrimination<0.2?'cr-low':it.discrimination>0.4?'cr-high':'';const dist=it.distTotal||{};const tot=dist.total||1;let ch='';for(let c=1;c<=5;c++){const p=((dist[c]||0)/tot*100).toFixed(0);ch+='<td class="c-ch" contenteditable="true" style="'+(c===it.correctAnswer?'font-weight:700;color:#059669;':'')+'">'+p+'%</td>';}h+='<tr style="'+rowBg+'"><td>'+it.q+'</td><td contenteditable="true" style="font-weight:700;">'+(it.correctAnswer||'-')+'</td><td class="ia-cr '+cls+'" contenteditable="true">'+cr+'%</td><td class="c-up" contenteditable="true">'+(it.upperCorrectRate!=null?it.upperCorrectRate.toFixed(0):'')+'%</td><td class="c-lo" contenteditable="true">'+(it.lowerCorrectRate!=null?it.lowerCorrectRate.toFixed(0):'')+'%</td><td class="c-disc '+dcls+'" contenteditable="true">'+disc+'</td>'+ch+'</tr>';});
    h+='</tbody></table>';
    h+='<div class="chart-wrap"><canvas class="ia-cv" data-s="'+subj+'"></canvas>';
    h+='<div class="chart-legend ia-legend"><span><span class="dot" style="background:#3b82f6;"></span> 정답률</span><span><span class="dot" style="background:#f59e0b;"></span> 평균</span><span><span class="dot" style="background:#059669;"></span> 상위'+upct+'%</span></div></div></div></div>';
  });
  Q('#item-area').innerHTML=h;
  // 각 차트 wrap — 너비는 grid 셀 자동, 높이만 초기값
  QA('.ia-cv').forEach(cv=>{
    const wrap=cv.parentElement;
    const items=D.itemAnalysis[cv.dataset.s]||[];
    if(!wrap.style.height)wrap.style.height=Math.max(280,items.length*18+80)+'px';
    const lg=wrap.querySelector('.chart-legend');const rb=lg?lg.offsetHeight+10:30;
    _setCanvasFromWrap(wrap,cv,rb);
    drawItem(cv);
  });
  applyItemColState();
}

function drawItem(cv){
  const subj=cv.dataset.s;const items=D.itemAnalysis[subj]||[];if(!items.length)return;
  const axF=parseInt(Q('#s-iaxf').value)||11;const itF=parseInt(Q('#s-itf').value)||13;
  const grid=Q('#s-igrid').checked;const FN="'Pretendard','Noto Sans KR',sans-serif";
  const{ctx,W,H}=_ctxLogical(cv);
  ctx.clearRect(0,0,W,H);
  const P={l:30,r:34,t:itF+12,b:axF+16};const cW=W-P.l-P.r,cH=H-P.t-P.b;const bH=Math.max(4,cH/items.length-3);
  ctx.fillStyle='#334155';ctx.font='800 '+itF+'px '+FN;ctx.textAlign='center';ctx.fillText('문항별 정답률',W/2,itF+2);
  if(grid){ctx.strokeStyle='#f1f5f9';ctx.lineWidth=0.5;for(let i=0;i<=4;i++){const x=P.l+cW*(i/4);ctx.beginPath();ctx.moveTo(x,P.t);ctx.lineTo(x,H-P.b);ctx.stroke();}}
  ctx.fillStyle='#94a3b8';ctx.font=axF+'px '+FN;ctx.textAlign='center';
  for(let i=0;i<=4;i++){ctx.fillText((i*25)+'%',P.l+cW*(i/4),P.t+cH+axF+6);}
  items.forEach((it,i)=>{const y=P.t+i*(bH+3);const cr=it.correctRate||0;const w=(cr/100)*cW;
    ctx.fillStyle=cr<40?'#ef4444':cr>80?'#22c55e':'#3b82f6';
    if(ctx.roundRect){ctx.beginPath();ctx.roundRect(P.l,y,w,bH,[0,3,3,0]);ctx.fill();}else{ctx.fillRect(P.l,y,w,bH);}
    ctx.fillStyle='#334155';ctx.font=(axF-1)+'px '+FN;ctx.textAlign='right';ctx.fillText('Q'+it.q,P.l-3,y+bH-1);
    ctx.fillStyle='#475569';ctx.font=(axF-1)+'px '+FN;ctx.textAlign='left';ctx.fillText(cr.toFixed(0)+'%',P.l+w+3,y+bH-1);
  });
  const avg=items.reduce((s,it)=>s+(it.correctRate||0),0)/items.length;
  const avgX=P.l+(avg/100)*cW;
  ctx.strokeStyle='#f59e0b';ctx.lineWidth=1.5;ctx.setLineDash([4,2]);ctx.beginPath();ctx.moveTo(avgX,P.t);ctx.lineTo(avgX,H-P.b);ctx.stroke();ctx.setLineDash([]);
  const upAvg=items.reduce((s,it)=>s+(it.upperCorrectRate||0),0)/items.length;
  const upX=P.l+(upAvg/100)*cW;
  ctx.strokeStyle='#059669';ctx.lineWidth=1;ctx.setLineDash([3,2]);ctx.beginPath();ctx.moveTo(upX,P.t);ctx.lineTo(upX,H-P.b);ctx.stroke();ctx.setLineDash([]);
}

function _stuColDefs(){
  const ck_=ck();
  const cols=[];
  cols.push({key:'idx',label:'#',cls:'col-idx',get:(st,i)=>String(i+1)});
  if(colOn('eno'))    cols.push({key:'eno',     label:'수험번호',  cls:'col-eno',     get:st=>st.examNo,                                   edit:true});
  if(colOn('name'))   cols.push({key:'name',    label:'이름',      cls:'col-name',    get:st=>st.name,                                     edit:true});
  if(colOn('phone'))  cols.push({key:'phone',   label:'전화번호',  cls:'col-phone',   get:st=>st.phone,                                    edit:true});
  if(colOn('birthday'))cols.push({key:'birthday',label:'생년월일',  cls:'col-birthday',get:st=>st.birthday,                                 edit:true});
  if(colOn('scode'))  cols.push({key:'scode',   label:'과목코드',  cls:'col-scode',   get:st=>st.subjectCode||'',                          edit:true});
  (D.etcKeys||[]).forEach(k=>{if(etcOn(k))cols.push({key:'etc-'+k,label:k,cls:'col-etc',get:st=>(st.etcFields&&st.etcFields[k])||'',edit:true});});
  ck_.forEach(s=>{
    if(colOn('ssc'))   cols.push({key:'ssc-'+s,    label:s+' 점수',    cls:'col-ssc',  get:st=>fmt(st.subjects[s]?.score),         edit:true});
    if(colOn('scorr')) cols.push({key:'scorr-'+s,  label:s+' 맞은',    cls:'col-scorr',get:st=>fmt(st.subjects[s]?.correctCount),  edit:true});
    if(colOn('swrong'))cols.push({key:'swrong-'+s, label:s+' 틀린',    cls:'col-swrong',get:st=>fmt(st.subjects[s]?.wrongCount),    edit:true});
    if(colOn('smax'))  cols.push({key:'smax-'+s,   label:s+' 만점',    cls:'col-smax', get:st=>fmt(st.subjects[s]?.totalPossible), edit:true});
    if(colOn('srank')) cols.push({key:'srank-'+s,  label:s+' 석차',    cls:'col-srank',get:st=>fmt(st.subjects[s]?.rank),          edit:true});
    if(colOn('spct'))  cols.push({key:'spct-'+s,   label:s+' 백분위',  cls:'col-spct', get:st=>fmt1(st.subjects[s]?.percentile),   edit:true});
    if(colOn('st'))    cols.push({key:'st-'+s,     label:s+' 표준',    cls:'col-st',   get:st=>fmt1(st.subjects[s]?.tScore),       edit:true});
  });
  if(colOn('tot'))   cols.push({key:'tot',   label:'총점',        cls:'col-tot',   get:st=>fmt(st.totalScore),    edit:true});
  if(colOn('tcorr')) cols.push({key:'tcorr', label:'총 맞은수',   cls:'col-tcorr', get:st=>fmt(st.totalCorrect),  edit:true});
  if(colOn('twrong'))cols.push({key:'twrong',label:'총 틀린수',   cls:'col-twrong',get:st=>fmt(st.totalWrong),    edit:true});
  if(colOn('tmax'))  cols.push({key:'tmax',  label:'총 만점',     cls:'col-tmax',  get:st=>fmt(st.totalMax),      edit:true});
  if(colOn('rk'))    cols.push({key:'rk',    label:'종합석차',    cls:'col-rk',    get:st=>fmt(st.rank),          edit:true});
  if(colOn('pct'))   cols.push({key:'pct',   label:'종합백분위',  cls:'col-pct',   get:st=>fmt1(st.percentile),   edit:true});
  if(colOn('t'))     cols.push({key:'t',     label:'종합표준',    cls:'col-t',     get:st=>fmt1(st.tScore),       edit:true});
  return cols;
}

function _stuRowCells(cols,st,i){
  let h='';
  cols.forEach(c=>{
    const v=c.get(st,i);
    const sv=v==null?'':String(v);
    const hasQ=sv.includes('?');
    const ed=c.edit?' contenteditable="true"':'';
    const fw=(c.key==='tot'||c.key==='rk')?' style="font-weight:700;"':'';
    const cls=c.cls+(hasQ?' cell-q':'');
    h+='<td class="'+cls+'"'+ed+fw+'>'+sv+'</td>';
  });
  return h;
}
function _stuEmptyCells(cols){let h='';cols.forEach(c=>{h+='<td class="'+c.cls+'"></td>';});return h;}

function _stuHeaderCells(cols){
  let h='';
  cols.forEach(c=>{
    const sortAttr=(c.key==='idx')?'':' onclick="stuSort(\\''+c.key+'\\')"';
    const arrow=(_stuSort&&_stuSort.colKey===c.key)?(_stuSort.dir==='asc'?' ↑':' ↓'):'';
    h+='<th class="'+c.cls+'" data-col-key="'+c.key+'"'+sortAttr+'>'+c.label+arrow+'<div class="col-resize-handle" onmousedown="startColResize(event,this)"></div></th>';
  });
  return h;
}

// ── 학생 정렬 (단일/다단 공통) ──
let _stuSort=null; // {colKey, dir:'asc'|'desc'}
function stuSort(colKey){
  if(_stuSort&&_stuSort.colKey===colKey){_stuSort.dir=(_stuSort.dir==='asc')?'desc':'asc';}
  else{_stuSort={colKey,dir:'asc'};}
  buildStudent();
}
function _stuSorted(students){
  if(!_stuSort)return students;
  const cols=_stuColDefs();
  const col=cols.find(c=>c.key===_stuSort.colKey);
  if(!col)return students;
  const arr=students.map((st,i)=>({st,i,v:col.get(st,i)}));
  arr.sort((a,b)=>{
    const va=a.v==null?'':a.v,vb=b.v==null?'':b.v;
    const na=parseFloat(va),nb=parseFloat(vb);
    let cmp;
    if(!isNaN(na)&&!isNaN(nb))cmp=na-nb;
    else cmp=String(va).localeCompare(String(vb));
    return _stuSort.dir==='asc'?cmp:-cmp;
  });
  return arr.map(x=>x.st);
}

function buildStudent(){
  const sts=_stuSorted(D.students);
  const cols=_stuColDefs();
  const mode=Q('#stu-mode')?Q('#stu-mode').value:'single';

  if(mode==='single'){
    let h='<div style="overflow-x:auto;"><table class="tbl stu-tbl" id="stu-tbl-single">';
    h+='<thead><tr>'+_stuHeaderCells(cols)+'</tr></thead><tbody>';
    sts.forEach((st,i)=>{h+='<tr>'+_stuRowCells(cols,st,i)+'</tr>';});
    h+='</tbody></table></div>';
    Q('#stu-tbl-wrap').innerHTML=h;
    reapplyMaskIfActive();
    return;
  }

  // 다단 모드 (β 헤더 — 모든 청크에 라벨)
  const N=Math.max(1,parseInt(Q('#stu-n').value)||30);
  const C=Math.max(1,parseInt(Q('#stu-c').value)||3);
  const perSec=N*C;
  let h='';
  let secNo=0;
  for(let s=0;s<sts.length;s+=perSec){
    secNo++;
    const sec=sts.slice(s,s+perSec);
    const tblId='stu-sec-'+secNo;
    h+='<div class="stu-section"><table class="tbl stu-tbl" id="'+tblId+'">';
    h+='<thead><tr>';
    for(let c=0;c<C;c++){
      if(c>0)h+='<th class="col-sep"></th>';
      h+=_stuHeaderCells(cols);
    }
    h+='</tr></thead><tbody>';
    for(let r=0;r<N;r++){
      h+='<tr>';
      let hasAny=false;
      for(let c=0;c<C;c++){
        if(c>0)h+='<td class="col-sep"></td>';
        const idxLocal=c*N+r;
        const st=sec[idxLocal];
        if(st){h+=_stuRowCells(cols,st,s+idxLocal);hasAny=true;}
        else h+=_stuEmptyCells(cols);
      }
      h+='</tr>';
      if(!hasAny)break;
    }
    h+='</tbody></table></div>';
  }
  Q('#stu-tbl-wrap').innerHTML=h;
  reapplyMaskIfActive();
}

// ── 컬럼 너비 드래그 ──
let _cr=null;
function startColResize(e,handle){
  e.preventDefault();e.stopPropagation();
  const th=handle.parentElement;
  _cr={th,startX:e.clientX,startW:th.getBoundingClientRect().width,handle};
  handle.classList.add('active');
  document.body.style.cursor='col-resize';document.body.style.userSelect='none';
  document.addEventListener('mousemove',_crMove);
  document.addEventListener('mouseup',_crUp);
}
function _crMove(e){
  if(!_cr)return;
  const dx=e.clientX-_cr.startX;
  const w=Math.max(20,_cr.startW+dx);
  // 같은 컬럼 키를 가진 모든 th(동일 테이블) 동기화 — β 다단 청크 간 정렬 유지
  const tbl=_cr.th.closest('table');
  const colKey=_cr.th.dataset.colKey;
  if(tbl&&colKey){
    tbl.querySelectorAll('th[data-col-key="'+colKey+'"]').forEach(th=>{
      th.style.width=w+'px';th.style.minWidth=w+'px';th.style.maxWidth=w+'px';
    });
  }else{
    _cr.th.style.width=w+'px';_cr.th.style.minWidth=w+'px';_cr.th.style.maxWidth=w+'px';
  }
}
function _crUp(){
  if(!_cr)return;
  document.removeEventListener('mousemove',_crMove);
  document.removeEventListener('mouseup',_crUp);
  document.body.style.cursor='';document.body.style.userSelect='';
  _cr.handle.classList.remove('active');
  _cr=null;
}

// ── 학생 테이블 모드 토글 ──
function onStuModeChange(){
  const mode=Q('#stu-mode').value;
  QA('.stu-multi-row').forEach(el=>el.style.display=mode==='multi'?'':'none');
  rebuild();
}

function fmt(v){if(v==null||v==='')return '';if(typeof v==='number'){return Number.isInteger(v)?String(v):v.toFixed(1);}return String(v);}
function fmt1(v){if(v==null||v==='')return '';if(typeof v==='number')return v.toFixed(1);return String(v);}

window.addEventListener('DOMContentLoaded',()=>{rebuild();});
`;
    },
};
