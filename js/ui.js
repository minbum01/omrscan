// ============================================
// ui.js - 우측 패널 (탭: 영역설정 / 결과)
// ============================================

const UI = {
    // 영역 타입
    ROI_TYPES: {
        'subject_answer': { label: '과목 답안', icon: '📝' },
        'birthday':       { label: '생년월일', icon: '📅' },
        'phone_exam':     { label: '수험번호/전화번호', icon: '🔢' },
        'subject_code':   { label: '과목 코드', icon: '📋' },
    },

    // 모드별 기본 임계값 (단일 진실 소스)
    THRESHOLDS_DEFAULT: {
        circular: { minHW: 0.7, maxHW: 1.4, minFill: 0.3, maxFill: 1.0 },
        elongated: { minHW: 1.4, maxHW: 5.0, minFill: 0.15, maxFill: 1.0 },
    },

    // 현재 모드에 맞는 임계값 반환 (저장된 값 > 기본값)
    getThresholds(s) {
        const mode = s.elongatedMode ? 'elongated' : 'circular';
        const d = this.THRESHOLDS_DEFAULT[mode];
        return {
            minHW: s.elongatedMinHW != null ? s.elongatedMinHW : d.minHW,
            maxHW: s.elongatedMaxHW != null ? s.elongatedMaxHW : d.maxHW,
            minFill: s.elongatedMinFill != null ? s.elongatedMinFill : d.minFill,
            maxFill: 1.0,
        };
    },

    // 모드 전환 시 해당 모드의 기본값으로 강제 리셋
    resetThresholdsForMode(s) {
        const mode = s.elongatedMode ? 'elongated' : 'circular';
        const d = this.THRESHOLDS_DEFAULT[mode];
        s.elongatedMinHW = d.minHW;
        s.elongatedMaxHW = d.maxHW;
        s.elongatedMinFill = d.minFill;
        s.elongatedMaxFill = d.maxFill;
    },

    defaultSettings() {
        return {
            name: '', startNum: 1, numQuestions: 20, numChoices: 5,
            orientation: 'vertical',
            choiceLabels: ['1','2','3','4','5'],
            elongatedMode: false,
            // 임계값은 getThresholds()가 모드별 기본값 반환 (필드 미포함)
            type: 'subject_answer',
            answerKey: null,
            answerSource: 'direct',
            linkedCodeRoi: null,
            codeList: [],
        };
    },

    selectedCell: null,

    // =========================================
    // 선택지 입력 UI (직접 입력, 프리셋 없음)
    // =========================================
    renderChoicesUI(idx, s) {
        const numC = s.numChoices || 5;
        let html = `<div class="roi-choice-section">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                <span class="roi-field-label">선택지 개수</span>
                <input type="number" class="roi-field-input" value="${numC}" min="2" max="20"
                    data-roi="${idx}" onchange="UI.onNumChoicesChange(this)" style="width:55px; text-align:center;">
            </div>
            <div style="display:flex; gap:3px; flex-wrap:wrap; padding:4px 0;">`;
        for (let i = 0; i < numC; i++) {
            const label = (s.choiceLabels && s.choiceLabels[i] != null) ? s.choiceLabels[i] : String(i + 1);
            html += `<input type="text" value="${this.esc(label)}" maxlength="10"
                data-roi="${idx}" data-idx="${i}" onchange="UI.onChoiceLabelChange(this)"
                style="width:36px; text-align:center; padding:4px 2px; border:1px solid var(--border); border-radius:4px; font-size:12px; font-weight:600;">`;
        }
        html += `</div></div>`;
        return html;
    },

    onNumChoicesChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        const s = imgObj.rois[idx].settings;
        const newNum = Math.max(2, Math.min(20, parseInt(input.value) || 5));
        s.numChoices = newNum;
        // choiceLabels 길이 조정
        if (!s.choiceLabels) s.choiceLabels = [];
        while (s.choiceLabels.length < newNum) s.choiceLabels.push(String(s.choiceLabels.length + 1));
        if (s.choiceLabels.length > newNum) s.choiceLabels.length = newNum;
        imgObj.results = null; imgObj.gradeResult = null;
        ImageManager.updateList();
        this.updateRightPanel();
    },

    onChoiceLabelChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        const lblIdx = parseInt(input.dataset.idx);
        const s = imgObj.rois[idx].settings;
        if (!s.choiceLabels) s.choiceLabels = [];
        s.choiceLabels[lblIdx] = input.value;
        imgObj.results = null; imgObj.gradeResult = null;
        ImageManager.updateList();
    },

    // =========================================
    // 패널 업데이트 (통합 뷰)
    // =========================================
    updateRightPanel() {
        const panel = App.els.rightPanel;
        const title = App.els.rightPanelTitle;
        const imgObj = App.getCurrentImage();

        if (!imgObj) {
            title.textContent = '시작하기';
            panel.innerHTML = `<div class="guide-text">
                <div style="font-size:40px; opacity:0.2; margin-bottom:12px;">📄</div>
                <strong>1. 이미지 업로드</strong><br>OMR 답안지 이미지를 불러오세요.<br><br>
                <strong>2. 영역 지정</strong><br>박스 모드(D)로 영역을 드래그<br><br>
                <strong>3. 분석 → 채점</strong><br>분석 실행(Enter) 후 결과 확인
            </div>`;
            return;
        }

        title.textContent = 'OMR 판독';

        // 영역 목록 상단 패널 제거 (이제 탭으로 이동)
        const oldListPanel = document.getElementById('roi-list-panel');
        if (oldListPanel) oldListPanel.remove();

        this.renderCombinedPanel(panel, imgObj);
    },

    // 영역 목록 탭 펼침 상태
    _roiListTabOpen: false,
    toggleRoiListTab() {
        this._roiListTabOpen = !this._roiListTabOpen;
        this.updateRightPanel();
    },

    // =========================================
    // 통합 패널: 영역 설정 + 결과를 영역별로 묶어서 표시
    // =========================================
    renderCombinedPanel(panel, imgObj) {
        const hasResults = imgObj.results && imgObj.results.length > 0;
        const hasGrade = imgObj.gradeResult !== null;

        let html = '';

        // 채점 요약 (있으면)
        if (hasGrade) {
            const gr = imgObj.gradeResult;
            const pct = Math.round((gr.score / gr.totalPossible) * 100);
            let sc = pct >= 90 ? 'perfect' : pct >= 60 ? 'good' : 'bad';
            html += `<div class="score-summary ${sc}">
                <div class="score-big ${sc}">${gr.score} <span class="score-total">/ ${gr.totalPossible}</span></div>
                <div class="score-detail">맞음 ${gr.correctCount} ✓ · 틀림 ${gr.wrongCount} ✗ · ${pct}%</div>
            </div>`;
        }

        // 상단 버튼 (영역 추가 / 영역 목록 / 양식 불러오기)
        const listOpen = this._roiListTabOpen;
        html += `<div style="display:flex; gap:6px; margin-bottom:8px;">
            <button class="btn btn-primary btn-sm" onclick="UI.addRegionManually()" style="flex:1;">+ 영역 추가</button>
            <button class="btn btn-sm ${listOpen ? 'btn-primary' : ''}" onclick="UI.toggleRoiListTab()" style="flex:1;">
                영역 목록 ${imgObj.rois.length > 0 ? `(${imgObj.rois.length})` : ''}
            </button>
            <button class="btn btn-sm" onclick="TemplateManager.triggerLoad()" style="flex:1;">양식 불러오기</button>
        </div>`;

        // 영역 목록 탭 펼침 시 내용 표시
        if (listOpen && imgObj.rois.length > 0) {
            html += `<div style="margin-bottom:12px; padding:6px; background:var(--bg-input); border-radius:6px;">`;
            imgObj.rois.forEach((roi, idx) => {
                this.ensureSettings(roi);
                const s = roi.settings;
                const name = s.name || `영역 ${idx + 1}`;
                const typeInfo = this.ROI_TYPES[s.type] || this.ROI_TYPES['subject_answer'];
                const orient = s.orientation === 'horizontal' ? '가로' : '세로';
                const isActive = idx === (typeof CanvasManager !== 'undefined' ? CanvasManager.selectedRoiIdx : -1);
                html += `<div class="roi-list-item ${isActive ? 'active' : ''}" data-roi-idx="${idx}"
                    draggable="true"
                    ondragstart="UI.onRoiDragStart(event, ${idx})"
                    ondragover="UI.onRoiDragOver(event, ${idx})"
                    ondragleave="UI.onRoiDragLeave(event)"
                    ondrop="UI.onRoiDrop(event, ${idx})">
                    <span class="drag-handle">☰</span>
                    <span class="roi-list-num">${idx + 1}</span>
                    <input class="roi-list-name-input" type="text" value="${this.esc(s.name)}"
                        placeholder="영역 ${idx + 1}" data-roi="${idx}"
                        onclick="event.stopPropagation()"
                        onchange="UI.onRoiListNameChange(this)">
                    <span class="roi-list-meta" onclick="UI.onRoiListClick(${idx})">${typeInfo.icon} ${orient}·${s.numQuestions}</span>
                </div>`;
            });
            html += `</div>`;
        }

        if (imgObj.rois.length === 0) {
            html += `<div class="guide-text" style="padding:20px 16px;">
                위의 <strong>"영역 추가"</strong> 버튼을 누르거나<br>
                <strong>박스 모드(D)</strong>로 직접 드래그하세요.
            </div>`;
        } else {
            // 영역별로 설정 + 결과를 묶어서 표시
            imgObj.rois.forEach((roi, idx) => {
                this.ensureSettings(roi);
                const s = roi.settings;
                const isVert = s.orientation === 'vertical';
                const isSelected = idx === (typeof CanvasManager !== 'undefined' ? CanvasManager.selectedRoiIdx : -1);

                html += `<div class="roi-card ${isSelected ? 'roi-card-selected' : ''}" data-roi-index="${idx}">`;

                // 헤더: 순서 이동 + 이름 편집
                html += `<div class="roi-card-header">
                    <div class="roi-order-btns">
                        <button class="roi-order-btn" onclick="UI.moveRoi(${idx},-1)" ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
                        <button class="roi-order-btn" onclick="UI.moveRoi(${idx},1)" ${idx === imgObj.rois.length - 1 ? 'disabled' : ''} title="아래로">▼</button>
                    </div>
                    <div class="roi-card-num">${idx + 1}</div>
                    <input class="roi-name-input" type="text" value="${this.esc(s.name)}"
                        placeholder="영역 ${idx + 1}" data-roi="${idx}" onchange="UI.onNameChange(this)">
                    <span class="roi-card-size">${Math.round(roi.w)}×${Math.round(roi.h)}</span>
                    ${s.bubbleSize ? `<span style="color:#22c55e;font-size:10px;font-weight:700;margin-left:4px;">버블${s.bubbleSize}px</span>` : ''}
                    <button class="roi-delete-btn" onclick="CanvasManager.deleteRoi(${idx}); UI.updateRightPanel();">✕</button>
                </div>`;

                // 좌우 분할 시작
                html += `<div class="roi-card-body">`;

                // 왼쪽: 설정
                html += `<div class="roi-card-settings">`;

                // 타입 선택
                let typeOptions = '';
                for (const [key, t] of Object.entries(this.ROI_TYPES)) {
                    typeOptions += `<option value="${key}" ${s.type === key ? 'selected' : ''}>${t.icon} ${t.label}</option>`;
                }
                html += `<div style="padding:6px 8px; border-bottom:1px solid var(--border-light);">
                    <select class="roi-choice-select" data-roi="${idx}" onchange="UI.onTypeChange(this)" style="font-size:12px; font-weight:600;">
                        ${typeOptions}
                    </select>
                </div>`;

                // 방향 토글 (모든 타입 공통)
                html += `<div class="roi-orient-toggle">
                    <button class="roi-orient-btn ${isVert ? 'active' : ''}" onclick="UI.setOrientation(${idx},'vertical')">
                        <span class="roi-orient-icon">⬇</span><span>세로</span>
                    </button>
                    <button class="roi-orient-btn ${!isVert ? 'active' : ''}" onclick="UI.setOrientation(${idx},'horizontal')">
                        <span class="roi-orient-icon">➡</span><span>가로</span>
                    </button>
                </div>`;

                // 타입별 설정
                if (s.type === 'birthday') {
                    html += `<div class="roi-fields">
                        <div class="roi-field" style="flex:1;">
                            <span class="roi-field-label">자릿수</span>
                            <input type="number" class="roi-field-input" value="${s.numQuestions}" min="1" max="10"
                                data-roi="${idx}" data-field="numQuestions" onchange="UI.onSettingChange(this)">
                        </div>
                    </div>`;
                    html += this.renderChoicesUI(idx, s);
                } else if (s.type === 'phone_exam') {
                    html += `<div class="roi-fields">
                        <div class="roi-field" style="flex:1;">
                            <span class="roi-field-label">자릿수</span>
                            <input type="number" class="roi-field-input" value="${s.numQuestions}" min="1" max="20"
                                data-roi="${idx}" data-field="numQuestions" onchange="UI.onSettingChange(this)">
                        </div>
                    </div>`;
                    html += this.renderChoicesUI(idx, s);
                } else if (s.type === 'subject_code') {
                    html += `<div class="roi-fields">
                        <div class="roi-field">
                            <span class="roi-field-label">코드 수</span>
                            <input type="number" class="roi-field-input" value="${s.numQuestions}" min="1" max="20"
                                data-roi="${idx}" data-field="numQuestions" onchange="UI.onSettingChange(this)">
                        </div>
                    </div>`;
                    html += `<div class="roi-choice-section">
                        <span class="roi-field-label">코드 목록</span>
                        <textarea class="roi-code-list" data-roi="${idx}" onchange="UI.onCodeListChange(this)"
                            placeholder="한 줄에 하나씩:&#10;1:경찰학&#10;2:행정법&#10;3:형법"
                            style="width:100%; height:60px; font-size:11px; padding:4px 6px; border:1px solid var(--border); border-radius:6px; resize:vertical;"
                        >${(s.codeList || []).map(c => c.code + ':' + c.name).join('\n')}</textarea>
                    </div>`;
                } else {
                    // subject_answer (기본)
                    html += `<div class="roi-fields">
                        <div class="roi-field">
                            <span class="roi-field-label">시작 문항</span>
                            <input type="number" class="roi-field-input" value="${s.startNum}" min="1" max="200"
                                data-roi="${idx}" data-field="startNum" onchange="UI.onSettingChange(this)">
                        </div>
                        <div class="roi-field">
                            <span class="roi-field-label">문항 수</span>
                            <input type="number" class="roi-field-input" value="${s.numQuestions}" min="1" max="100"
                                data-roi="${idx}" data-field="numQuestions" onchange="UI.onSettingChange(this)">
                        </div>
                    </div>`;
                    html += this.renderChoicesUI(idx, s);

                    // 과목 매칭 힌트 (영역 이름 = 과목 이름)
                    const subjName = s.name || '';
                    const matchedSubj = subjName && typeof SubjectManager !== 'undefined'
                        ? SubjectManager.findByName(subjName) : null;
                    if (subjName) {
                        html += `<div style="padding:4px 8px; font-size:10px; color:${matchedSubj ? 'var(--green)' : 'var(--text-muted)'}; border-top:1px solid var(--border-light);">
                            ${matchedSubj ? `✓ 과목 "${this.esc(subjName)}" 매칭됨 (${matchedSubj.answers ? '정답 ' + matchedSubj.answers.length + '자' : '정답 없음'})` : `• 이 영역 이름이 과목명으로 등록됩니다`}
                        </div>`;
                    }

                    // 정답 소스
                    const codeRois = imgObj.rois.map((r, i) => ({ i, s: r.settings })).filter(r => r.s && r.s.type === 'subject_code');
                    html += `<div class="roi-choice-section" style="border-top:1px solid var(--border-light);">
                        <span class="roi-field-label">정답 소스</span>
                        <select class="roi-choice-select" data-roi="${idx}" onchange="UI.onAnswerSourceChange(this)">
                            <option value="direct" ${s.answerSource === 'direct' ? 'selected' : ''}>직접 입력</option>
                            ${codeRois.map(cr => `<option value="code_${cr.i}" ${s.answerSource === 'code_'+cr.i ? 'selected' : ''}>과목코드 (${cr.s.name || '영역'+(cr.i+1)})</option>`).join('')}
                        </select>
                        ${s.answerSource === 'direct' ? `
                            <input type="text" class="roi-answer-input" data-roi="${idx}" onchange="UI.onDirectAnswerChange(this)"
                                value="${this.esc(s.answerKey || '')}" placeholder="정답 입력 (쉼표로 구분: 1,2,3,4 또는 ㄱ,ㄴ,ㄷ)"
                                style="width:100%; margin-top:4px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-size:13px; font-family:monospace;">
                        ` : ''}
                    </div>`;
                }

                // 길쭉 버블 분석 모드 + 버블 감지 설정 (접기/펼치기)
                const sliderOpen = roi._sliderOpen || false;
                const t = this.getThresholds(s); // 현재 모드 기준의 유효 임계값
                const modeLabel = s.elongatedMode ? '길쭉 버블 모드' : '원형 버블 모드';
                html += `<div style="padding:4px 8px; border-top:1px solid var(--border-light);">
                    <label style="display:flex; align-items:center; gap:4px; font-size:11px; cursor:pointer;">
                        <input type="checkbox" ${s.elongatedMode ? 'checked' : ''}
                            data-roi="${idx}" onchange="UI.onElongatedModeChange(this)">
                        길쭉 버블 분석
                    </label>
                    <div style="margin-top:4px; display:flex; align-items:center; gap:4px; cursor:pointer; font-size:11px; color:var(--text-muted);"
                        onclick="UI.toggleSliderPanel(${idx})">
                        <span>${sliderOpen ? '▼' : '▶'}</span>
                        <span>버블 감지 설정 (${modeLabel})</span>
                    </div>
                    ${sliderOpen ? `
                    <div style="margin-top:4px; padding:6px; background:var(--bg-input); border-radius:4px;">
                        <div style="display:flex; align-items:center; gap:4px; font-size:10px; margin-bottom:3px;">
                            <span style="width:60px;">h/w 하한</span>
                            <input type="range" min="0.3" max="3.0" step="0.05" value="${t.minHW}"
                                style="flex:1;" data-roi="${idx}" data-field="elongatedMinHW" oninput="UI.onThresholdChange(this)">
                            <span style="width:30px; text-align:right; font-family:monospace;">${t.minHW.toFixed(2)}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:4px; font-size:10px; margin-bottom:3px;">
                            <span style="width:60px;">h/w 상한</span>
                            <input type="range" min="1.0" max="8.0" step="0.1" value="${t.maxHW}"
                                style="flex:1;" data-roi="${idx}" data-field="elongatedMaxHW" oninput="UI.onThresholdChange(this)">
                            <span style="width:30px; text-align:right; font-family:monospace;">${t.maxHW.toFixed(1)}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:4px; font-size:10px;">
                            <span style="width:60px;">채움 하한</span>
                            <input type="range" min="0.05" max="0.5" step="0.01" value="${t.minFill}"
                                style="flex:1;" data-roi="${idx}" data-field="elongatedMinFill" oninput="UI.onThresholdChange(this)">
                            <span style="width:30px; text-align:right; font-family:monospace;">${t.minFill.toFixed(2)}</span>
                        </div>
                        <button class="btn btn-sm" style="width:100%; margin-top:4px; font-size:10px; padding:2px;"
                            onclick="UI.runAnalysisNow()">재분석</button>
                    </div>
                    ` : ''}
                </div>`;


                html += `</div>`; // roi-card-settings 닫기

                // 오른쪽: 결과
                html += `<div class="roi-card-results">`;
                if (hasResults) {
                    html += `<div style="text-align:right;margin-bottom:4px;">
                        <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;color:var(--red);"
                            onclick="UI.markAllBlank(${idx})">전체 빈칸 처리</button>
                    </div>`;
                }
                const res = hasResults ? imgObj.results[idx] : null;
                if (res && res.rows.length > 0) {
                    const labels = s.choiceLabels || null;
                    const numC = s.numChoices || res.numChoices || 5;

                    if (s.type === 'birthday' || s.type === 'phone_exam' || s.type === 'subject_code') {
                        // 숫자 판독 결과 (그리드 대신 문자열)
                        const digits = res.rows.map(r => {
                            if (r.markedAnswer !== null) {
                                return labels && labels[r.markedAnswer - 1] ? labels[r.markedAnswer - 1] : `${r.markedAnswer}`;
                            }
                            return '?';
                        }).join('');

                        const typeLabel = this.ROI_TYPES[s.type].label;
                        html += `<div style="padding:12px; text-align:center;">
                            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">${typeLabel}</div>
                            <div style="font-size:24px; font-weight:800; font-family:monospace; letter-spacing:4px; color:var(--blue);">${digits}</div>
                        </div>`;

                        // 과목코드면 코드명 표시
                        if (s.type === 'subject_code' && s.codeList && s.codeList.length > 0) {
                            const matched = s.codeList.find(c => c.code === digits);
                            if (matched) {
                                html += `<div style="text-align:center; font-size:13px; font-weight:700; color:var(--green); padding-bottom:8px;">${matched.name}</div>`;
                            }
                        }

                        // 수정 가능한 셀 그리드 (작게)
                        html += `<div class="result-grid" style="gap:2px;">`;
                        res.rows.forEach(row => {
                            const ansText = row.markedAnswer !== null
                                ? (labels && labels[row.markedAnswer-1] ? labels[row.markedAnswer-1] : `${row.markedAnswer}`)
                                : '?';
                            const cellClass = row.markedAnswer !== null ? 'grid-cell-ok' : 'grid-cell-empty';
                            html += `<div class="grid-cell ${cellClass}" data-roi="${idx}" data-q="${row.questionNumber}" data-choices="${numC}" onclick="UI.selectCell(this)" style="min-height:32px;">
                                <span class="grid-cell-num">${row.questionNumber}</span>
                                <span class="grid-cell-ans" style="font-size:12px;">${ansText}</span>
                                <input class="grid-cell-input" type="text" maxlength="2" data-roi="${idx}" data-q="${row.questionNumber}" data-choices="${numC}" oninput="UI.onCellInput(this)" onkeydown="UI.onCellKeydown(event, this)">
                            </div>`;
                        });
                        html += `</div>`;
                    } else {
                        // 과목답안: 기존 결과 그리드
                        const errs = (imgObj.validationErrors || []).filter(e => e.roiIndex === res.roiIndex);
                        let warnings = errs.map(e => {
                            if (e.type === 'missing_questions') return `${e.detected}/${e.expected} (${e.missing}누락)`;
                            return '';
                        }).filter(w => w);
                        const multiCount = res.rows.filter(r => r.multiMarked).length;
                        if (multiCount > 0) warnings.push(`중복${multiCount}`);
                        if (warnings.length) html += `<div class="roi-warning" style="margin:0 0 4px;">${warnings.join(' · ')}</div>`;

                        const gradeMap = {};
                        if (hasGrade && imgObj.gradeResult && imgObj.gradeResult.details) {
                            imgObj.gradeResult.details.forEach(d => { gradeMap[d.questionNumber] = d; });
                        }

                        html += `<div class="result-grid">`;
                        res.rows.forEach(row => {
                            const gd = gradeMap[row.questionNumber];
                            let ansText, cellClass;
                            if (row.undetected) { ansText = '—'; cellClass = 'grid-cell-undetected'; }
                            else if (row.multiMarked) { ansText = row.markedIndices.map(i => labels && labels[i-1] ? labels[i-1] : i).join(','); cellClass = 'grid-cell-multi'; }
                            else if (row.markedAnswer !== null) {
                                ansText = labels && labels[row.markedAnswer - 1] ? labels[row.markedAnswer - 1] : `${row.markedAnswer}`;
                                cellClass = (hasGrade && gd) ? (gd.isCorrect ? 'grid-cell-correct' : 'grid-cell-wrong') : 'grid-cell-ok';
                            } else { ansText = '·'; cellClass = 'grid-cell-empty'; }
                            if (row.corrected) cellClass += ' grid-cell-corrected';
                            html += `<div class="grid-cell ${cellClass}" data-roi="${idx}" data-q="${row.questionNumber}" data-choices="${numC}" onclick="UI.selectCell(this)">
                                <span class="grid-cell-num">${row.questionNumber}</span>
                                <span class="grid-cell-ans">${ansText}</span>
                                <input class="grid-cell-input" type="text" maxlength="2" data-roi="${idx}" data-q="${row.questionNumber}" data-choices="${numC}" oninput="UI.onCellInput(this)" onkeydown="UI.onCellKeydown(event, this)">
                            </div>`;
                        });
                        html += `</div>`;
                    }
                } else {
                    html += `<div class="guide-text" style="padding:16px; font-size:11px;">분석 대기</div>`;
                }
                html += `</div>`; // roi-card-results 닫기

                html += `</div>`; // roi-card-body 닫기
                html += `</div>`; // roi-card 닫기
            });

            // 하단
            html += `<div class="roi-actions">`;

            const hasAnyAnswers = App.state.answerKey ||
                imgObj.rois.some(r => r.settings && r.settings.type === 'subject_answer' && r.settings.answerKey);

            if (!hasResults) {
                html += `<button class="btn btn-primary roi-analyze-btn" onclick="CanvasManager.runAnalysis()">
                    OMR 분석 <span class="kbd" style="background:rgba(255,255,255,0.2);">Enter</span>
                </button>`;
            } else if (!hasGrade && hasAnyAnswers) {
                html += `<button class="btn btn-primary" onclick="
                    var img=App.getCurrentImage();
                    if(img&&img.results){img.gradeResult=Grading.grade(img.results, img);UI.updateRightPanel();CanvasManager.render();ImageManager.updateList();}
                " style="width:100%;">채점하기</button>`;
            } else if (!hasGrade) {
                html += `<p style="font-size:11px; color:var(--text-muted); margin-bottom:8px; text-align:center;">영역별 정답을 입력하거나 전역 정답을 설정하세요.</p>`;
            }

            if (hasResults) {
                html += `<div style="display:flex; gap:6px; margin-top:8px;">
                    <button class="btn btn-export" onclick="ExportManager.exportCsv()" style="flex:1;">CSV</button>
                    <button class="btn btn-export" onclick="ExportManager.exportExcel()" style="flex:1;">Excel</button>
                </div>`;
            }

            html += `<div class="roi-actions-sub" style="margin-top:8px;">
                <button class="btn btn-sm" onclick="TemplateManager.save()">양식 저장</button>
            </div></div>`;
        }

        panel.innerHTML = html;
    },

    // =========================================
    // (하위 호환) 기존 탭 함수는 통합 패널로 리다이렉트
    // =========================================
    renderSettingsTab(panel, imgObj) { this.renderCombinedPanel(panel, imgObj); },
    renderResultsTab(panel, imgObj) { this.renderCombinedPanel(panel, imgObj); },

    // =========================================
    // 탭 2: 결과 (분석 + 채점) — 내부적으로 사용됨
    // =========================================
    _legacyRenderResultsTab(panel, imgObj) {
        if (!imgObj || !imgObj.results) {
            panel.innerHTML = '<div class="guide-text">분석을 먼저 실행하세요.</div>';
            return;
        }

        let html = '';
        const hasGrade = imgObj.gradeResult !== null;

        // 채점 요약
        if (hasGrade) {
            const gr = imgObj.gradeResult;
            const pct = Math.round((gr.score / gr.totalPossible) * 100);
            let sc = pct >= 90 ? 'perfect' : pct >= 60 ? 'good' : 'bad';
            html += `
                <div class="score-summary ${sc}">
                    <div class="score-big ${sc}">${gr.score} <span class="score-total">/ ${gr.totalPossible}</span></div>
                    <div class="score-detail">맞음 ${gr.correctCount} ✓ · 틀림 ${gr.wrongCount} ✗ · ${pct}%</div>
                </div>`;
        }

        html += '<div class="result-edit-hint">셀 클릭 → 숫자/문자 입력으로 교정 · 화살표로 이동</div>';

        // 영역별 결과 그리드
        imgObj.results.forEach((res, resIdx) => {
            const roi = imgObj.rois[resIdx];
            const s = roi ? roi.settings : null;
            const regionName = (s && s.name) || `영역 ${res.roiIndex}`;
            const labels = (s && s.choiceLabels) || null;
            const numC = (s && s.numChoices) || res.numChoices || 5;

            // 경고
            const errs = (imgObj.validationErrors || []).filter(e => e.roiIndex === res.roiIndex);
            let warnings = errs.map(e => {
                if (e.type === 'missing_questions') return `${e.detected}/${e.expected}문항 (${e.missing}개 누락)`;
                if (e.type === 'extra_questions') return `${e.detected}/${e.expected}문항 (${e.extra}개 초과)`;
                return '';
            }).filter(w => w);

            const multiCount = res.rows.filter(r => r.multiMarked).length;
            if (multiCount > 0) warnings.push(`중복마킹 ${multiCount}개`);

            html += `
                <div class="result-card">
                    <div class="result-card-header">
                        <span class="result-card-title">${this.esc(regionName)}</span>
                        <span class="result-card-badge">${res.numQuestions}문항</span>
                    </div>
                    ${warnings.length ? `<div class="roi-warning">${warnings.join(' · ')}</div>` : ''}
                    <div class="result-grid">`;

            // 채점 상세 맵
            const gradeMap = {};
            if (hasGrade && imgObj.gradeResult.details) {
                imgObj.gradeResult.details.forEach(d => { gradeMap[d.questionNumber] = d; });
            }

            res.rows.forEach(row => {
                const gd = gradeMap[row.questionNumber];
                let ansText, cellClass;

                if (row.undetected) {
                    ansText = '—'; cellClass = 'grid-cell-undetected';
                } else if (row.multiMarked) {
                    ansText = row.markedIndices.map(i => labels && labels[i-1] ? labels[i-1] : i).join(',');
                    cellClass = 'grid-cell-multi';
                } else if (row.markedAnswer !== null) {
                    ansText = labels && labels[row.markedAnswer - 1] ? labels[row.markedAnswer - 1] : `${row.markedAnswer}`;
                    if (hasGrade && gd) {
                        cellClass = gd.isCorrect ? 'grid-cell-correct' : 'grid-cell-wrong';
                    } else {
                        cellClass = 'grid-cell-ok';
                    }
                } else {
                    ansText = '·'; cellClass = 'grid-cell-empty';
                }

                if (row.corrected) cellClass += ' grid-cell-corrected';

                html += `
                    <div class="grid-cell ${cellClass}" data-roi="${resIdx}" data-q="${row.questionNumber}" data-choices="${numC}"
                         onclick="UI.selectCell(this)">
                        <span class="grid-cell-num">${row.questionNumber}</span>
                        <span class="grid-cell-ans">${ansText}</span>
                        <input class="grid-cell-input" type="text" maxlength="2"
                            data-roi="${resIdx}" data-q="${row.questionNumber}" data-choices="${numC}"
                            oninput="UI.onCellInput(this)" onkeydown="UI.onCellKeydown(event, this)">
                    </div>`;
            });

            html += '</div></div>';
        });

        // 하단 버튼
        if (!hasGrade) {
            if (!App.state.answerKey) {
                html += `<div style="text-align:center; margin-top:12px;">
                    <p style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">정답을 입력하면 자동 채점됩니다.</p>
                    <button class="btn btn-primary" onclick="Grading.openModal()" style="width:100%;">정답 입력하기</button>
                </div>`;
            } else {
                html += `<div style="text-align:center; margin-top:12px;">
                    <button class="btn btn-primary" onclick="
                        var img=App.getCurrentImage();
                        if(img&&img.results){img.gradeResult=Grading.grade(img.results, img);UI.updateRightPanel();CanvasManager.render();ImageManager.updateList();}
                    " style="width:100%;">채점하기</button>
                </div>`;
            }
        } else {
            html += `<div style="display:flex; gap:8px; margin-top:12px;">
                <button class="btn btn-export" onclick="ExportManager.exportCsv()" style="flex:1;">CSV</button>
                <button class="btn btn-export" onclick="ExportManager.exportExcel()" style="flex:1;">Excel</button>
            </div>`;
        }

        panel.innerHTML = html;
    },

    // =========================================
    // 헬퍼 함수들
    // =========================================
    // =========================================
    // 영역 목록 패널 (우측 상단 고정)
    // =========================================
    _roiListCollapsed: false,

    renderRoiListPanel(imgObj) {
        let container = document.getElementById('roi-list-panel');
        if (!container) {
            container = document.createElement('div');
            container.id = 'roi-list-panel';
            container.className = 'roi-list-panel';
            // panel-right-content 앞에 삽입
            const parent = App.els.rightPanel.parentElement;
            parent.insertBefore(container, App.els.rightPanel);
        }

        if (!imgObj || imgObj.rois.length === 0) {
            container.innerHTML = '';
            return;
        }

        const collapsed = this._roiListCollapsed;
        let html = `<div class="roi-list-header" onclick="UI.toggleRoiList()">
            <span>영역 목록 (${imgObj.rois.length})</span>
            <span class="roi-list-toggle ${collapsed ? 'collapsed' : ''}">▼</span>
        </div>`;

        html += `<div class="roi-list-items ${collapsed ? 'collapsed' : ''}" id="roi-list-items">`;

        imgObj.rois.forEach((roi, idx) => {
            this.ensureSettings(roi);
            const s = roi.settings;
            const name = s.name || `영역 ${idx + 1}`;
            const typeInfo = this.ROI_TYPES[s.type] || this.ROI_TYPES['subject_answer'];
            const orient = s.orientation === 'horizontal' ? '가로' : '세로';
            const isActive = idx === (typeof CanvasManager !== 'undefined' ? CanvasManager.selectedRoiIdx : -1);

            html += `<div class="roi-list-item ${isActive ? 'active' : ''}" data-roi-idx="${idx}"
                draggable="true"
                ondragstart="UI.onRoiDragStart(event, ${idx})"
                ondragover="UI.onRoiDragOver(event, ${idx})"
                ondragleave="UI.onRoiDragLeave(event)"
                ondrop="UI.onRoiDrop(event, ${idx})">
                <span class="drag-handle">☰</span>
                <span class="roi-list-num">${idx + 1}</span>
                <input class="roi-list-name-input" type="text" value="${this.esc(s.name)}"
                    placeholder="영역 ${idx + 1}" data-roi="${idx}"
                    onclick="event.stopPropagation()"
                    onchange="UI.onRoiListNameChange(this)"
                    onfocus="this.parentElement.click()">
                <span class="roi-list-meta" onclick="UI.onRoiListClick(${idx})">${typeInfo.icon} ${orient}·${s.numQuestions}</span>
            </div>`;
        });

        html += '</div>';
        container.innerHTML = html;
    },

    toggleRoiList() {
        this._roiListCollapsed = !this._roiListCollapsed;
        const items = document.getElementById('roi-list-items');
        const toggle = document.querySelector('.roi-list-toggle');
        if (items) items.classList.toggle('collapsed', this._roiListCollapsed);
        if (toggle) toggle.classList.toggle('collapsed', this._roiListCollapsed);
    },

    onRoiListClick(idx) {
        CanvasManager.selectedRoiIdx = idx;
        CanvasManager.render();
        this.updateRightPanel();
        this.scrollToRoiCard(idx);
    },

    // 우측 패널에서 해당 ROI 카드로 스크롤
    scrollToRoiCard(idx) {
        setTimeout(() => {
            const card = document.querySelector(`.roi-card[data-roi-index="${idx}"]`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    },

    // 드래그 앤 드롭
    _dragRoiIdx: -1,

    onRoiDragStart(e, idx) {
        this._dragRoiIdx = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
    },

    onRoiDragOver(e, idx) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // 시각적 피드백
        document.querySelectorAll('.roi-list-item').forEach(el => el.classList.remove('drag-over'));
        const target = document.querySelector(`.roi-list-item[data-roi-idx="${idx}"]`);
        if (target && idx !== this._dragRoiIdx) target.classList.add('drag-over');
    },

    onRoiDragLeave(e) {
        e.target.closest('.roi-list-item')?.classList.remove('drag-over');
    },

    onRoiDrop(e, dropIdx) {
        e.preventDefault();
        document.querySelectorAll('.roi-list-item').forEach(el => el.classList.remove('drag-over'));

        const dragIdx = this._dragRoiIdx;
        if (dragIdx === -1 || dragIdx === dropIdx) return;

        const imgObj = App.getCurrentImage();
        if (!imgObj) return;

        // 배열에서 제거 후 새 위치에 삽입
        const [movedRoi] = imgObj.rois.splice(dragIdx, 1);
        imgObj.rois.splice(dropIdx, 0, movedRoi);

        // results도 이동
        if (imgObj.results) {
            const [movedRes] = imgObj.results.splice(dragIdx, 1);
            imgObj.results.splice(dropIdx, 0, movedRes);
        }

        // 선택 인덱스 갱신
        if (CanvasManager.selectedRoiIdx === dragIdx) CanvasManager.selectedRoiIdx = dropIdx;

        this._dragRoiIdx = -1;
        CanvasManager.render();
        this.updateRightPanel();
        Toast.info(`영역 ${dragIdx + 1} → ${dropIdx + 1} 이동`);
    },

    onElongatedModeChange(checkbox) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(checkbox.dataset.roi);
        const s = imgObj.rois[idx].settings;
        s.elongatedMode = checkbox.checked;
        // 모드에 맞는 기본 임계값으로 리셋
        this.resetThresholdsForMode(s);
        imgObj.results = null; imgObj.gradeResult = null;
        ImageManager.updateList(); this.updateRightPanel();
    },

    // 슬라이더 패널 접기/펼치기 (ROI별 상태)
    toggleSliderPanel(idx) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[idx]) return;
        imgObj.rois[idx]._sliderOpen = !imgObj.rois[idx]._sliderOpen;
        this.updateRightPanel();
    },

    onThresholdChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        const field = input.dataset.field;
        const val = parseFloat(input.value);
        if (imgObj.rois[idx] && imgObj.rois[idx].settings) {
            imgObj.rois[idx].settings[field] = val;
            // 값 표시만 업데이트 (리렌더 최소화)
            const valueSpan = input.parentElement.querySelector('span:last-child');
            if (valueSpan) {
                valueSpan.textContent = field.includes('HW') ? val.toFixed(field === 'elongatedMinHW' ? 2 : 1) : val.toFixed(2);
            }
        }
    },

    runAnalysisNow() {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        imgObj.results = null; imgObj.gradeResult = null;
        CanvasManager.runAnalysis();
    },

    ensureSettings(roi) {
        if (!roi.settings) roi.settings = this.defaultSettings();
        const s = roi.settings;
        if (!s.orientation) s.orientation = 'vertical';
        if (!s.choiceLabels) s.choiceLabels = ['1','2','3','4','5'];
        if (!s.numChoices) s.numChoices = s.choiceLabels.length || 5;
        if (s.name === undefined) s.name = '';
        if (!s.type) s.type = 'subject_answer';
        if (!s.answerSource) s.answerSource = 'direct';
        // 채움 상한은 항상 1.0 고정
        s.elongatedMaxFill = 1.0;
        // 프리셋 관련 레거시 필드 제거
        delete s.choicePreset;
        delete s.customLabels;
    },

    esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    },

    addRegionManually() {
        const imgObj = App.getCurrentImage();
        if (!imgObj) { Toast.error('먼저 이미지를 선택하세요'); return; }
        const w = Math.min(400, imgObj.imgElement.width * 0.8);
        const h = Math.min(600, imgObj.imgElement.height * 0.8);
        const x = (imgObj.imgElement.width - w) / 2;
        const y = (imgObj.imgElement.height - h) / 2;

        const settings = this.defaultSettings();

        // 자동 감지
        try {
            const ctx = App.els.ctx;
            ctx.drawImage(imgObj.imgElement, 0, 0);
            const imageData = ctx.getImageData(x, y, w, h);
            const detected = OmrEngine.autoDetect(imageData, x, y);
            if (detected) {
                settings.numQuestions = detected.numQuestions;
                settings.numChoices = detected.numChoices;
                settings.orientation = detected.orientation;
                // 자동감지된 선택지 수에 맞춰 기본 라벨 (1, 2, 3, ...)
                settings.choiceLabels = Array.from({ length: detected.numChoices }, (_, i) => String(i + 1));
                Toast.info(`자동 감지: ${detected.numQuestions}문항 × ${detected.numChoices}지선다 (${detected.orientation === 'vertical' ? '세로' : '가로'})`);
            }
        } catch (e) { console.warn('자동 감지 실패:', e); }

        imgObj.rois.push({ x, y, w, h, settings });
        imgObj.results = null; imgObj.gradeResult = null;
        CanvasManager.render(); ImageManager.updateList(); this.updateRightPanel();
    },

    // ROI 순서 이동
    moveRoi(idx, dir) {
        const imgObj = App.getCurrentImage();
        if (!imgObj) return;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= imgObj.rois.length) return;

        // rois 배열 스왑
        const temp = imgObj.rois[idx];
        imgObj.rois[idx] = imgObj.rois[newIdx];
        imgObj.rois[newIdx] = temp;

        // results도 스왑 (있으면)
        if (imgObj.results && imgObj.results[idx] && imgObj.results[newIdx]) {
            const tempR = imgObj.results[idx];
            imgObj.results[idx] = imgObj.results[newIdx];
            imgObj.results[newIdx] = tempR;
        }

        // 선택 인덱스 갱신
        if (typeof CanvasManager !== 'undefined') {
            if (CanvasManager.selectedRoiIdx === idx) CanvasManager.selectedRoiIdx = newIdx;
            else if (CanvasManager.selectedRoiIdx === newIdx) CanvasManager.selectedRoiIdx = idx;
        }

        CanvasManager.render();
        this.updateRightPanel();
    },

    // 타입 변경
    onTypeChange(select) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(select.dataset.roi);
        const s = imgObj.rois[idx].settings;
        s.type = select.value;

        // 타입별 기본값
        if (s.type === 'birthday') {
            s.numQuestions = 6;
            s.choiceLabels = ['0','1','2','3','4','5','6','7','8','9'];
            s.numChoices = 10; s.orientation = 'horizontal';
        } else if (s.type === 'phone_exam') {
            s.numQuestions = 11;
            s.choiceLabels = ['0','1','2','3','4','5','6','7','8','9'];
            s.numChoices = 10; s.orientation = 'horizontal';
        } else if (s.type === 'subject_code') {
            s.numQuestions = 1;
            s.choiceLabels = ['1','2','3','4','5']; s.numChoices = 5;
        }

        imgObj.results = null; imgObj.gradeResult = null;
        CanvasManager.render(); ImageManager.updateList(); this.updateRightPanel();
    },

    // 과목코드 목록 변경
    onCodeListChange(textarea) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(textarea.dataset.roi);
        const s = imgObj.rois[idx].settings;

        s.codeList = textarea.value.split('\n').map(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
                return { code: parts[0].trim(), name: parts.slice(1).join(':').trim(), answers: '' };
            }
            return null;
        }).filter(c => c !== null);
    },

    // 정답 소스 변경
    onAnswerSourceChange(select) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(select.dataset.roi);
        const s = imgObj.rois[idx].settings;
        s.answerSource = select.value;

        if (select.value.startsWith('code_')) {
            s.linkedCodeRoi = parseInt(select.value.split('_')[1]);
        } else {
            s.linkedCodeRoi = null;
        }

        imgObj.gradeResult = null;
        this.updateRightPanel();
    },

    // 직접 정답 입력
    onDirectAnswerChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        const roi = imgObj.rois[idx];
        const s = roi.settings;
        s.answerKey = input.value.trim();

        // 영역 이름이 있으면 전역 과목으로 자동 저장/업데이트
        if (s.name && s.name.trim() && typeof SubjectManager !== 'undefined') {
            const name = s.name.trim();
            const subjects = SubjectManager.getSubjects();
            let subj = subjects.find(x => x.name === name);
            if (subj) {
                subj.answers = s.answerKey;
                subj.numQuestions = s.numQuestions || subj.numQuestions;
            } else {
                subjects.push({
                    code: '',
                    name: name,
                    numQuestions: s.numQuestions || 20,
                    scorePerQuestion: 5,
                    answers: s.answerKey
                });
            }
            SubjectManager.saveToStorage();
            // 같은 이름의 다른 ROI에도 전파
            App.state.images.forEach(img => {
                img.rois.forEach(r => {
                    if (r !== roi && r.settings && r.settings.type === 'subject_answer' && r.settings.name === name) {
                        r.settings.answerKey = s.answerKey;
                        img.gradeResult = null;
                    }
                });
            });
        }

        imgObj.gradeResult = null;
        ImageManager.updateList();
        this.updateRightPanel();
    },

    // subject_answer ROI 이름 변경 시 과목 매칭/자동 로드
    _syncRoiNameAsSubject(roi) {
        const s = roi.settings;
        if (!s || s.type !== 'subject_answer') return;
        const name = (s.name || '').trim();
        if (!name) return;
        if (typeof SubjectManager === 'undefined') return;
        const matched = SubjectManager.findByName(name);
        if (matched) {
            // 기존 과목이면 정답/문항수 자동 로드 (choiceLabels는 ROI 고유값 유지)
            if (matched.answers) s.answerKey = matched.answers;
            if (matched.numQuestions) s.numQuestions = matched.numQuestions;
            Toast.info(`과목 "${name}" 자동 매칭됨`);
        }
    },

    onNameChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        if (imgObj.rois[idx]) {
            imgObj.rois[idx].settings.name = input.value;
            this._syncRoiNameAsSubject(imgObj.rois[idx]);
            imgObj.results = null; imgObj.gradeResult = null;
            CanvasManager.render();
            ImageManager.updateList();
            this.updateRightPanel();
        }
    },

    onRoiListNameChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        if (imgObj.rois[idx]) {
            imgObj.rois[idx].settings.name = input.value;
            this._syncRoiNameAsSubject(imgObj.rois[idx]);
            imgObj.gradeResult = null;
            CanvasManager.render();
            // 상세 카드의 이름도 동기화
            const cardInput = document.querySelector(`.roi-card[data-roi-index="${idx}"] .roi-name-input`);
            if (cardInput && cardInput !== input) cardInput.value = input.value;
        }
    },

    // ==========================================
    // 영역 설정 팝업
    // ==========================================
    openRoiSettingsPopup(roiIdx) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[roiIdx]) return;
        const roi = imgObj.rois[roiIdx];
        const s = roi.settings || UI.defaultSettings();

        // 기존 팝업 제거
        const old = document.getElementById('roi-settings-popup');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'roi-settings-popup';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:340px;">
                <div class="modal-header">
                    <h2>영역 ${roiIdx + 1} 설정</h2>
                </div>
                <div class="modal-body">
                    <div class="roi-popup-field">
                        <label>타입</label>
                        <select id="rp-type">${Object.entries(this.ROI_TYPES).map(([k, t]) =>
                            `<option value="${k}" ${s.type === k ? 'selected' : ''}>${t.icon} ${t.label}</option>`
                        ).join('')}</select>
                    </div>
                    <div class="roi-popup-field">
                        <label>이름</label>
                        <input type="text" id="rp-name" value="${this.esc(s.name)}" placeholder="영역 ${roiIdx + 1}">
                    </div>
                    <div class="roi-popup-field">
                        <label>방향</label>
                        <div class="roi-popup-orient">
                            <button id="rp-vert" class="${s.orientation === 'vertical' ? 'active' : ''}" onclick="document.getElementById('rp-vert').classList.add('active');document.getElementById('rp-horiz').classList.remove('active');">⬇ 세로</button>
                            <button id="rp-horiz" class="${s.orientation === 'horizontal' ? 'active' : ''}" onclick="document.getElementById('rp-horiz').classList.add('active');document.getElementById('rp-vert').classList.remove('active');">➡ 가로</button>
                        </div>
                    </div>
                    <div class="roi-popup-field">
                        <label>시작번호</label>
                        <input type="number" id="rp-start" value="${s.startNum || 1}" min="1" max="200" style="width:70px;flex:none;">
                    </div>
                    <div class="roi-popup-field">
                        <label>문항수</label>
                        <input type="number" id="rp-numq" value="${s.numQuestions || 20}" min="1" max="100" style="width:70px;flex:none;">
                    </div>
                    <div class="roi-popup-field">
                        <label>선택지 수</label>
                        <input type="number" id="rp-numc" value="${s.numChoices || 5}" min="2" max="20" style="width:70px;flex:none;">
                    </div>
                    <div class="roi-popup-field" id="rp-labels-field">
                        <label>선택지</label>
                        <div id="rp-labels" style="display:flex; gap:3px; flex-wrap:wrap; flex:1;">
                            ${(s.choiceLabels || []).slice(0, s.numChoices || 5).map((lbl, i) =>
                                `<input type="text" class="rp-label-input" data-idx="${i}" value="${this.esc(lbl)}" maxlength="10" style="width:36px; text-align:center; padding:4px; border:1px solid var(--border); border-radius:4px; font-size:12px;">`
                            ).join('')}
                        </div>
                    </div>
                    <div class="roi-popup-field">
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                            <input type="checkbox" id="rp-elongated" ${s.elongatedMode ? 'checked' : ''} onchange="UI.onPopupElongatedToggle(${roiIdx}, this.checked)">
                            길쭉 버블 분석
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-sm" onclick="UI.closeRoiSettingsPopup()">취소</button>
                    <button class="btn btn-sm" style="color:var(--red);" onclick="UI.deleteRoiFromPopup(${roiIdx})">삭제</button>
                    <button class="btn btn-sm btn-primary" onclick="UI.applyRoiSettingsPopup(${roiIdx})">확인</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        // 배경 클릭으로는 닫히지 않음 (취소/확인/ESC 만 허용)

        // 팝업에서 선택지 수 변경 시 텍스트박스 재생성
        const numcInput = document.getElementById('rp-numc');
        if (numcInput) {
            numcInput.addEventListener('input', () => {
                const newNum = Math.max(2, Math.min(20, parseInt(numcInput.value) || 5));
                // 현재 입력값 보존
                const current = Array.from(document.querySelectorAll('.rp-label-input')).map(inp => inp.value);
                const labelsDiv = document.getElementById('rp-labels');
                if (labelsDiv) {
                    let newHtml = '';
                    for (let i = 0; i < newNum; i++) {
                        const val = current[i] != null ? current[i] : (s.choiceLabels[i] != null ? s.choiceLabels[i] : String(i + 1));
                        newHtml += `<input type="text" class="rp-label-input" data-idx="${i}" value="${this.esc(val)}" maxlength="10" style="width:36px; text-align:center; padding:4px; border:1px solid var(--border); border-radius:4px; font-size:12px;">`;
                    }
                    labelsDiv.innerHTML = newHtml;
                }
            });
        }
    },

    closeRoiSettingsPopup() {
        const el = document.getElementById('roi-settings-popup');
        if (el) el.remove();
    },

    // 팝업에서 길쭉 모드 토글 시 임계값 리셋 + 자동감지 재실행
    onPopupElongatedToggle(roiIdx, checked) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[roiIdx]) return;
        const roi = imgObj.rois[roiIdx];
        // 모드 전환 시 해당 모드의 기본 임계값으로 리셋
        roi.settings.elongatedMode = checked;
        this.resetThresholdsForMode(roi.settings);
        try {
            const imageData = CanvasManager.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h);
            const detected = OmrEngine.autoDetect(imageData, roi.x, roi.y, 0, checked);
            if (detected) {
                const nqInput = document.getElementById('rp-numq');
                if (nqInput) nqInput.value = detected.numQuestions;
                // 선택지 수는 preset에 따라 결정되므로 자동으로 안 건드림
                const vertBtn = document.getElementById('rp-vert');
                const horizBtn = document.getElementById('rp-horiz');
                if (detected.orientation === 'vertical') {
                    vertBtn.classList.add('active');
                    horizBtn.classList.remove('active');
                } else {
                    horizBtn.classList.add('active');
                    vertBtn.classList.remove('active');
                }
                console.log(`[팝업 재감지] 길쭉=${checked} → 문항=${detected.numQuestions} 선택지=${detected.numChoices} 방향=${detected.orientation}`);
            }
        } catch (e) {
            console.warn('팝업 재감지 실패:', e);
        }
    },

    deleteRoiFromPopup(roiIdx) {
        this.closeRoiSettingsPopup();
        CanvasManager.deleteRoi(roiIdx);
        this.updateRightPanel();
    },

    applyRoiSettingsPopup(roiIdx) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[roiIdx]) return;
        const s = imgObj.rois[roiIdx].settings;

        const newOrient = document.getElementById('rp-vert').classList.contains('active') ? 'vertical' : 'horizontal';
        const orientChanged = s.orientation !== newOrient;

        s.type = document.getElementById('rp-type').value;
        s.name = document.getElementById('rp-name').value;
        s.orientation = newOrient;
        s.startNum = parseInt(document.getElementById('rp-start').value) || 1;
        s.numQuestions = parseInt(document.getElementById('rp-numq').value) || 0;
        const newElongated = document.getElementById('rp-elongated').checked;
        const elongatedChanged = s.elongatedMode !== newElongated;
        s.elongatedMode = newElongated;
        if (elongatedChanged) this.resetThresholdsForMode(s);

        // 선택지 수 + 라벨 읽기
        const numc = parseInt(document.getElementById('rp-numc').value) || 5;
        s.numChoices = Math.max(2, Math.min(20, numc));
        const labelInputs = document.querySelectorAll('.rp-label-input');
        const newLabels = Array.from(labelInputs).map(inp => inp.value);
        // 부족하면 기존값 또는 기본값으로 채움
        while (newLabels.length < s.numChoices) newLabels.push(String(newLabels.length + 1));
        newLabels.length = s.numChoices;
        s.choiceLabels = newLabels;

        // 방향이 바뀌어도 사용자가 입력한 문항수/선택지수는 유지
        imgObj.results = null; imgObj.gradeResult = null;
        this.closeRoiSettingsPopup();
        CanvasManager.render();
        ImageManager.updateList();
        this.updateRightPanel();
        setTimeout(() => CanvasManager.runAnalysis(), 100);
    },

    setOrientation(roiIdx, value) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[roiIdx]) return;
        const s = imgObj.rois[roiIdx].settings;

        // 방향만 변경, 문항수/선택지수는 유지 (사용자 입력값 보존)
        s.orientation = value;
        imgObj.results = null; imgObj.gradeResult = null;
        CanvasManager.render(); ImageManager.updateList(); this.updateRightPanel();
        setTimeout(() => CanvasManager.runAnalysis(), 100);
    },

    onSettingChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        const field = input.dataset.field;
        if (imgObj.rois[idx] && imgObj.rois[idx].settings) {
            imgObj.rois[idx].settings[field] = parseInt(input.value) || 1;
        }
        imgObj.results = null; imgObj.gradeResult = null; ImageManager.updateList();
    },

    _unused_legacy_handlers_removed() {
        // onPresetChange, onCustomChange 함수는 제거됨 (프리셋 시스템 폐기)
    },

    // =========================================
    // 수기 교정 (직접 입력)
    // =========================================
    selectCell(cell) {
        // 이전 선택 해제 (리렌더링 없이)
        document.querySelectorAll('.grid-cell.selected').forEach(c => {
            c.classList.remove('selected');
            const oldAns = c.querySelector('.grid-cell-ans');
            const oldInput = c.querySelector('.grid-cell-input');
            if (oldInput && oldAns) oldInput.style.opacity = '0';
        });

        cell.classList.add('selected');
        const input = cell.querySelector('.grid-cell-input');
        if (input) {
            input.value = '';
            input.style.opacity = '';
            input.focus();

            const blurHandler = () => {
                input.removeEventListener('blur', blurHandler);
                if (input.value.trim() === '') {
                    cell.classList.remove('selected');
                    input.style.opacity = '0';
                    this.closeZoomPopup();
                }
            };
            input.addEventListener('blur', blurHandler);
        }

        this.showZoomPopup(cell);
    },

    // OMR 확대 팝업
    showZoomPopup(cell) {
        this.closeZoomPopup();

        const imgObj = App.getCurrentImage();
        if (!imgObj || !imgObj.results) return;

        const roiIdx = parseInt(cell.dataset.roi);
        const qNum = parseInt(cell.dataset.q);
        const res = imgObj.results[roiIdx];
        if (!res) return;

        const row = res.rows.find(r => r.questionNumber === qNum);
        if (!row || !row.blobs || row.blobs.length === 0) return;

        // 해당 행 블롭들의 바운딩 박스
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        row.blobs.forEach(b => {
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.x + b.w > maxX) maxX = b.x + b.w;
            if (b.y + b.h > maxY) maxY = b.y + b.h;
        });

        // 패딩 추가
        const pad = 10;
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(imgObj.imgElement.width, maxX + pad);
        maxY = Math.min(imgObj.imgElement.height, maxY + pad);

        const cropW = maxX - minX;
        const cropH = maxY - minY;
        if (cropW < 5 || cropH < 5) return;

        // 확대 배율
        const scale = 3;
        const popupW = Math.round(cropW * scale);
        const popupH = Math.round(cropH * scale);

        // 임시 캔버스에서 해당 영역 잘라내기
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = popupW;
        tempCanvas.height = popupH;
        const tctx = tempCanvas.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(imgObj.imgElement, minX, minY, cropW, cropH, 0, 0, popupW, popupH);

        // 팝업 생성
        const popup = document.createElement('div');
        popup.id = 'zoom-popup';
        popup.className = 'zoom-popup';

        const img = document.createElement('img');
        img.src = tempCanvas.toDataURL();
        img.style.width = popupW + 'px';
        img.style.height = popupH + 'px';
        popup.appendChild(img);

        // Q번호 라벨
        const label = document.createElement('div');
        label.className = 'zoom-popup-label';
        label.textContent = `Q${qNum}`;
        popup.appendChild(label);

        // 셀 위치 기준으로 팝업 배치
        const cellRect = cell.getBoundingClientRect();
        popup.style.left = (cellRect.left - popupW - 12) + 'px';
        popup.style.top = (cellRect.top + cellRect.height / 2 - popupH / 2) + 'px';

        // 화면 밖으로 나가면 오른쪽에 배치
        document.body.appendChild(popup);
        const popupRect = popup.getBoundingClientRect();
        if (popupRect.left < 0) {
            popup.style.left = (cellRect.right + 12) + 'px';
        }
        if (popupRect.top < 0) {
            popup.style.top = '8px';
        }
    },

    closeZoomPopup() {
        const popup = document.getElementById('zoom-popup');
        if (popup) popup.remove();
    },

    onCellInput(input) {
        const val = input.value.trim().toUpperCase();
        if (!val) return;

        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const roiIdx = parseInt(input.dataset.roi);
        const qNum = parseInt(input.dataset.q);
        const numC = parseInt(input.dataset.choices) || 5;
        const roi = imgObj.rois[roiIdx];
        const labels = (roi && roi.settings && roi.settings.choiceLabels) || null;

        let newAnswer = null;
        if (val === '-') {
            newAnswer = null; // 값 없음
        } else if (labels) {
            const idx = labels.findIndex(l => l.toUpperCase() === val);
            if (idx !== -1) newAnswer = idx + 1;
            else { const n = parseInt(val); if (!isNaN(n) && n >= 0 && n <= numC) newAnswer = n; }
        } else {
            const n = parseInt(val); if (!isNaN(n) && n >= 0 && n <= numC) newAnswer = n;
        }

        this.applyCorrection(roiIdx, qNum, newAnswer);

        // 다음 오류/미기입 셀로 이동 (없으면 다음 일반 셀)
        setTimeout(() => {
            const cells = Array.from(document.querySelectorAll('.grid-cell'));
            const curIdx = cells.indexOf(input.closest('.grid-cell'));
            if (curIdx < 0) return;

            // 현재 위치 이후에서 오류 셀 찾기 (중복, 미기입, 미인식)
            let nextError = -1;
            for (let i = curIdx + 1; i < cells.length; i++) {
                if (cells[i].classList.contains('grid-cell-multi') ||
                    cells[i].classList.contains('grid-cell-empty') ||
                    cells[i].classList.contains('grid-cell-undetected')) {
                    nextError = i;
                    break;
                }
            }
            // 현재 위치 이전(처음부터)에서도 찾기 (순환)
            if (nextError === -1) {
                for (let i = 0; i < curIdx; i++) {
                    if (cells[i].classList.contains('grid-cell-multi') ||
                        cells[i].classList.contains('grid-cell-empty') ||
                        cells[i].classList.contains('grid-cell-undetected')) {
                        nextError = i;
                        break;
                    }
                }
            }

            if (nextError !== -1) {
                this.selectCell(cells[nextError]);
                cells[nextError].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                // 현재 이미지에 오류 없음 → 다음 이미지에서 오류 찾기
                this.moveToNextImageError();
            }
        }, 50);
    },

    // 다음 이미지의 오류로 이동
    moveToNextImageError() {
        const images = App.state.images;
        const startIdx = App.state.currentIndex;

        for (let offset = 1; offset <= images.length; offset++) {
            const idx = (startIdx + offset) % images.length;
            const img = images[idx];
            if (!img.results) continue;

            // 오류 있는 이미지인지 확인
            const hasError = img.results.some(res =>
                res.rows.some(r => r.multiMarked || r.markedAnswer === null)
            );

            if (hasError) {
                ImageManager.select(idx);
                Toast.info(`${img.name} → 오류 항목으로 이동`);
                // 해당 이미지 로드 후 첫 오류 셀로 이동
                setTimeout(() => {
                    const cells = Array.from(document.querySelectorAll('.grid-cell'));
                    for (let i = 0; i < cells.length; i++) {
                        if (cells[i].classList.contains('grid-cell-multi') ||
                            cells[i].classList.contains('grid-cell-empty') ||
                            cells[i].classList.contains('grid-cell-undetected')) {
                            this.selectCell(cells[i]);
                            cells[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            return;
                        }
                    }
                }, 200);
                return;
            }
        }

        // 모든 이미지에 오류 없음
        Toast.success('모든 이미지의 교정이 완료되었습니다!');
    },

    onCellKeydown(e, input) {
        const cells = Array.from(document.querySelectorAll('.grid-cell'));
        const cur = cells.indexOf(input.closest('.grid-cell'));
        let target = -1;

        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            target = Math.min(cur + 1, cells.length - 1);
        } else if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            target = Math.max(cur - 1, 0);
        } else if (e.key === 'ArrowRight') target = Math.min(cur + 1, cells.length - 1);
        else if (e.key === 'ArrowLeft') target = Math.max(cur - 1, 0);
        else if (e.key === 'ArrowDown') target = Math.min(cur + 5, cells.length - 1);
        else if (e.key === 'ArrowUp') target = Math.max(cur - 5, 0);
        else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.applyCorrection(parseInt(input.dataset.roi), parseInt(input.dataset.q), null);
            return;
        } else if (e.key === 'Escape') { input.blur(); return; }
        else return;

        e.preventDefault();
        if (target >= 0) this.selectCell(cells[target]);
    },

    // 영역 전체를 빈칸(미기입) 처리
    markAllBlank(roiIdx) {
        const imgObj = App.getCurrentImage();
        if (!imgObj || !imgObj.results || !imgObj.results[roiIdx]) return;
        imgObj.results[roiIdx].rows.forEach(row => {
            if (row.blobs) row.blobs.forEach(b => { b.isMarked = false; });
            row.markedAnswer = null;
            row.multiMarked = false;
            row.markedIndices = [];
            row.corrected = true;
            row._userCorrected = true;
        });
        imgObj.gradeResult = null;
        CanvasManager.render();
        ImageManager.updateList();
        this.updateRightPanel();
        Toast.info('전체 빈칸 처리됨');
    },

    applyCorrection(roiIdx, qNum, newAnswer) {
        const imgObj = App.getCurrentImage();
        if (!imgObj || !imgObj.results || !imgObj.results[roiIdx]) return;
        const row = imgObj.results[roiIdx].rows.find(r => r.questionNumber === qNum);
        if (!row) return;

        // 블롭 마킹 갱신: 기존 마킹 해제 → 새 답에 마킹
        if (row.blobs) {
            row.blobs.forEach(b => { b.isMarked = false; });
            if (newAnswer !== null && newAnswer >= 1 && newAnswer <= row.blobs.length) {
                row.blobs[newAnswer - 1].isMarked = true;
            }
        }

        row.markedAnswer = newAnswer;
        row.multiMarked = false;
        row.markedIndices = newAnswer ? [newAnswer] : [];
        row.corrected = true;
        row._userCorrected = true;
        row.undetected = false;

        imgObj.gradeResult = null;
        this.closeZoomPopup();
        CanvasManager.render();

        // 스크롤 위치 유지 (updateRightPanel 호출 안 함)
        // 대신 해당 셀만 DOM에서 직접 업데이트
        const cell = document.querySelector(`.grid-cell[data-roi="${roiIdx}"][data-q="${qNum}"]`);
        if (cell) {
            const labels = imgObj.rois[roiIdx]?.settings?.choiceLabels || null;
            const ansText = newAnswer !== null
                ? (labels && labels[newAnswer - 1] ? labels[newAnswer - 1] : `${newAnswer}`)
                : '·';
            const ansEl = cell.querySelector('.grid-cell-ans');
            if (ansEl) ansEl.textContent = ansText;

            // 셀 클래스 갱신
            cell.className = cell.className.replace(/grid-cell-(ok|empty|correct|wrong|multi|undetected|corrected)/g, '');
            cell.classList.add(newAnswer !== null ? 'grid-cell-ok' : 'grid-cell-empty');
            if (row.corrected) cell.classList.add('grid-cell-corrected');
        }

        ImageManager.updateList();

        // 로컬 자동 저장
        this.autoSaveLocal();
    },

    // 로컬스토리지 자동 저장 (수기 교정 데이터)
    autoSaveLocal() {
        try {
            const saveData = {
                timestamp: new Date().toISOString(),
                corrections: []
            };
            App.state.images.forEach((img, imgIdx) => {
                if (!img.results) return;
                img.results.forEach((res, roiIdx) => {
                    res.rows.forEach(row => {
                        if (row.corrected) {
                            saveData.corrections.push({
                                imgIdx, imgName: img.name, roiIdx,
                                questionNumber: row.questionNumber,
                                markedAnswer: row.markedAnswer
                            });
                        }
                    });
                });
            });
            if (saveData.corrections.length > 0) {
                localStorage.setItem('omr_autosave', JSON.stringify(saveData));
            }
        } catch (e) { /* 무시 */ }
    },

    buildLabelMap(imgObj) {
        const map = {};
        if (!imgObj.rois) return map;
        imgObj.rois.forEach(roi => {
            if (!roi.settings) return;
            const s = roi.settings;
            for (let i = 0; i < (s.numQuestions || 20); i++) {
                map[(s.startNum || 1) + i] = s.choiceLabels || null;
            }
        });
        return map;
    }
};
