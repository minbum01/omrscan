// ============================================
// ui.js - 우측 패널 (탭: 영역설정 / 결과)
// ============================================

const UI = {
    // 영역 타입
    ROI_TYPES: {
        'subject_answer': { label: '과목 답안', icon: '📝' },
        'birthday':       { label: '생년월일', icon: '📅' },
        'exam_no':        { label: '수험번호', icon: '🔢' },
        'phone':          { label: '전화번호', icon: '📞' },
        'subject_code':   { label: '과목 코드', icon: '📋' },
        'etc':            { label: '기타', icon: '📎' },
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

    _genRoiId() {
        return 'roi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    // ID로 ROI 찾기 (인덱스 반환)
    _findRoiByIdIndex(imgObj, id) {
        if (!imgObj || !imgObj.rois || !id) return -1;
        return imgObj.rois.findIndex(r => r._id === id);
    },

    defaultSettings() {
        return {
            name: '', startNum: 1, numQuestions: 20, numChoices: 5,
            orientation: 'vertical',
            choiceLabels: ['1','2','3','4','5'],
            elongatedMode: false,
            type: 'subject_answer',
            answerKey: null,
            answerSource: 'direct',
            linkedCodeRoiId: null, // 과목코드 ROI의 _id (고유ID 기반)
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

        // 제목 + 교정확정 큰 버튼
        const _anyConfirmedT = (App.state.images || []).some(img => img._correctionConfirmed);
        title.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                <span>OMR 판독</span>
                <button onclick="UI.toggleConfirmCorrection()"
                    style="padding:10px 18px; font-size:14px; font-weight:800; letter-spacing:0.5px;
                           border-radius:10px; cursor:pointer; white-space:nowrap;
                           border:2px solid ${_anyConfirmedT ? '#166534' : '#ca8a04'};
                           background:${_anyConfirmedT ? 'linear-gradient(135deg,#166534,#15803d)' : 'linear-gradient(135deg,#eab308,#f59e0b)'};
                           color:${_anyConfirmedT ? '#fff' : '#000'}; box-shadow:0 2px 8px rgba(0,0,0,0.15);">
                    ${_anyConfirmedT ? '✓ 확정됨 — 재확정' : '★ 교정확정 및 내용반영 ★'}
                </button>
            </div>`;

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

        // 채점 탭 버튼 (채점된 이미지가 있을 때)
        const hasAnyGrade = App.state.images.some(img => img.gradeResult);
        if (hasAnyGrade) {
            html += `<div style="margin-bottom:8px;">
                <button class="btn btn-sm" style="width:100%; font-size:11px; padding:5px; background:var(--blue-light); color:var(--blue); font-weight:600;"
                    onclick="switchMainTab('scoring')">채점 결과 보기</button>
            </div>`;
        }

        // 채점 요약 (있으면)
        if (hasGrade) {
            const gr = imgObj.gradeResult;
            const pct = Math.round((gr.score / gr.totalPossible) * 100);
            let sc = pct >= 90 ? 'perfect' : pct >= 60 ? 'good' : 'bad';
            html += `<div class="score-summary ${sc}">
                <div class="score-big ${sc}">${(typeof Scoring !== 'undefined' ? Scoring._fmtScore(gr.score) : gr.score)} <span class="score-total">/ ${(typeof Scoring !== 'undefined' ? Scoring._fmtMax(gr.totalPossible) : gr.totalPossible)}</span></div>
                <div class="score-detail">맞음 ${(typeof Scoring !== 'undefined' ? Scoring._fmtScore(gr.correctCount) : gr.correctCount)} ✓ · 틀림 ${(typeof Scoring !== 'undefined' ? Scoring._fmtScore(gr.wrongCount) : gr.wrongCount)} ✗ · ${pct}%</div>
            </div>`;
        }

        // 상단 버튼 (영역 추가 / 영역 목록 / 양식 불러오기) — sticky로 고정 · 교정확정은 헤더의 큰 버튼으로 이동
        const listOpen = this._roiListTabOpen;
        html += `<div style="display:flex; gap:6px; margin:-16px -16px 8px; padding:12px 16px 8px; position:sticky; top:-16px; background:var(--bg-card, #fff); z-index:10; border-bottom:1px solid var(--border-light);">
            <button class="btn btn-primary btn-sm" onclick="UI.addRegionManually()" style="flex:1;">+ 영역 추가</button>
            <button class="btn btn-sm ${listOpen ? 'btn-primary' : ''}" onclick="UI.toggleRoiListTab()" style="flex:1;">
                영역 목록 ${imgObj.rois.length > 0 ? `(${imgObj.rois.length})` : ''}
            </button>
            <button class="btn btn-sm" onclick="TemplateManager.triggerLoad()" style="flex:1;">양식 불러오기</button>
        </div>`;

        // 영역 목록 탭 펼침 시 내용 표시 — sticky로 상단 고정
        // 다른 ROI에 연결된 코드 ROI ID 수집 (목록에서 숨김)
        const _linkedCodeIds = new Set();
        imgObj.rois.forEach(r => {
            const ids = r.settings && r.settings.linkedCodeRoiIds;
            if (ids) ids.forEach(id => _linkedCodeIds.add(id));
            if (r.settings && r.settings.linkedCodeRoiId) _linkedCodeIds.add(r.settings.linkedCodeRoiId);
        });

        if (listOpen && imgObj.rois.length > 0) {
            html += `<div style="margin:-1px -16px 12px; padding:6px 16px; background:var(--bg-input); border-top:1px solid var(--border-light); border-bottom:1px solid var(--border-light); position:sticky; top:44px; z-index:9; max-height:40vh; overflow-y:auto;">`;
            imgObj.rois.forEach((roi, idx) => {
                // 연결된 과목코드 ROI는 목록에서 숨김
                if (roi._id && _linkedCodeIds.has(roi._id)) return;
                this.ensureSettings(roi);
                const s = roi.settings;
                const name = s.name || `영역 ${idx + 1}`;
                const typeInfo = this.ROI_TYPES[s.type] || this.ROI_TYPES['subject_answer'];
                const orient = s.orientation === 'horizontal' ? '가로' : '세로';
                const isActive = idx === (typeof CanvasManager !== 'undefined' ? CanvasManager.selectedRoiIdx : -1);
                // 과목답안이면 시작~끝 문항 범위 표시 (동일 이름 구분용)
                let qRangeHtml = '';
                if (s.type === 'subject_answer') {
                    const startN = s.startNum || 1;
                    const endN = startN + (s.numQuestions || 0) - 1;
                    qRangeHtml = `<span class="roi-list-qrange" style="font-size:10px; color:var(--blue); font-weight:700; background:var(--blue-light); padding:1px 5px; border-radius:3px; margin-left:4px; white-space:nowrap;">${startN}~${endN}번</span>`;
                }
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
                    ${qRangeHtml}
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
            // 과목명 자동완성 datalist
            const subjectNames = new Set();
            (App.state.subjects || []).forEach(s => { if (s.name) subjectNames.add(s.name); });
            imgObj.rois.forEach(r => { if (r.settings && r.settings.name) subjectNames.add(r.settings.name); });
            html += `<datalist id="subject-name-list">${[...subjectNames].map(n => `<option value="${this.esc(n)}">`).join('')}</datalist>`;

            // 영역별로 설정 + 결과를 묶어서 표시
            imgObj.rois.forEach((roi, idx) => {
                // 연결된 과목코드 ROI는 카드 숨김
                if (roi._id && _linkedCodeIds.has(roi._id)) return;

                this.ensureSettings(roi);
                const s = roi.settings;
                const isVert = s.orientation === 'vertical';
                const isSelected = idx === (typeof CanvasManager !== 'undefined' ? CanvasManager.selectedRoiIdx : -1);

                html += `<div class="roi-card ${isSelected ? 'roi-card-selected' : ''}" data-roi-index="${idx}">`;

                // 헤더: 순서 이동 + 삭제
                html += `<div class="roi-card-header">
                    <div class="roi-order-btns">
                        <button class="roi-order-btn" onclick="UI.moveRoi(${idx},-1)" ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
                        <button class="roi-order-btn" onclick="UI.moveRoi(${idx},1)" ${idx === imgObj.rois.length - 1 ? 'disabled' : ''} title="아래로">▼</button>
                    </div>
                    <div class="roi-card-num">${idx + 1}</div>
                    <span class="roi-card-size" style="margin-left:auto;">${Math.round(roi.w)}×${Math.round(roi.h)}</span>
                    ${s.bubbleSize ? `<span style="color:#22c55e;font-size:10px;font-weight:700;margin-left:4px;">버블${s.bubbleSize}px</span>` : ''}
                    <button class="roi-delete-btn" onclick="CanvasManager.deleteRoi(${idx}); UI.updateRightPanel();">✕</button>
                </div>`;

                // 과목 식별 영역: 과목명 직접입력 vs 과목코드 연동 (택1)
                const _cIds = s.linkedCodeRoiIds || (s.linkedCodeRoiId ? [s.linkedCodeRoiId] : []);
                const _hasCode = _cIds.length > 0;
                if (s.type === 'subject_answer') {
                    if (_hasCode) {
                        // 코드 연동 모드 — 합산 코드 + 매칭 과목명 표시
                        let _codeStr = '';
                        _cIds.forEach(id => {
                            const ci = imgObj.rois.findIndex(r => r._id === id);
                            if (ci >= 0 && hasResults && imgObj.results[ci] && imgObj.results[ci].rows) {
                                imgObj.results[ci].rows.forEach(r => {
                                    if (r.markedAnswer != null) {
                                        const cl = imgObj.rois[ci].settings.choiceLabels;
                                        _codeStr += cl && cl[r.markedAnswer - 1] ? cl[r.markedAnswer - 1] : String(r.markedAnswer);
                                    } else { _codeStr += '?'; }
                                });
                            } else { _codeStr += '?'; }
                        });
                        const _gSubj = (App.state.subjects || []).find(sub => sub.code === _codeStr);
                        html += `<div style="padding:5px 8px;margin:0 0 4px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:5px;">
                            <div style="display:flex;align-items:center;gap:6px;">
                                <span style="font-size:9px;color:#0369a1;font-weight:700;background:#dbeafe;padding:1px 5px;border-radius:3px;">코드연동</span>
                                <span style="font-size:18px;font-weight:800;font-family:monospace;color:#1e3a5f;letter-spacing:3px;">${_codeStr}</span>
                                ${_gSubj ? `<span style="font-size:13px;font-weight:700;color:#16a34a;">${_gSubj.name}</span>` : `<span style="font-size:10px;color:#dc2626;">미매칭</span>`}
                                <button class="btn btn-sm" onclick="UI._unlinkCodeRoi(${idx})" style="font-size:9px;padding:1px 5px;color:#dc2626;margin-left:auto;" title="과목코드 연동 해제">해제</button>
                            </div>
                        </div>`;
                    } else {
                        // 직접입력 모드 — 과목명 + 코드연동 버튼
                        html += `<div style="padding:4px 8px;margin:0 0 4px;background:var(--bg-input);border:1px solid var(--border);border-radius:5px;">
                            <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
                                <input class="roi-name-input" type="text" value="${this.esc(s.name)}"
                                    placeholder="과목/영역명" data-roi="${idx}" onchange="UI.onNameChange(this)"
                                    list="subject-name-list"
                                    style="flex:1;min-width:0;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-weight:600;">
                            </div>
                            <div style="display:flex;align-items:center;gap:4px;">
                                <span style="font-size:9px;color:var(--text-muted);">또는</span>
                                <label style="font-size:9px;color:var(--text-muted);display:flex;align-items:center;gap:2px;">
                                    자리수 <input type="number" id="roi-code-digits-${idx}" value="2" min="1" max="5" style="width:30px;padding:1px 2px;font-size:10px;border:1px solid var(--border);border-radius:3px;text-align:center;">
                                </label>
                                <button class="btn btn-sm" onclick="UI._startCodeBoxDrawFromCard(${idx})" style="font-size:9px;padding:2px 6px;background:#0369a1;color:#fff;border:none;border-radius:3px;">과목코드 연동</button>
                            </div>
                        </div>`;
                    }
                } else {
                    // 과목답안 외 타입은 기존 이름 input
                    html += `<div style="padding:2px 8px;margin:0 0 4px;">
                        <input class="roi-name-input" type="text" value="${this.esc(s.name)}"
                            placeholder="영역명" data-roi="${idx}" onchange="UI.onNameChange(this)"
                            list="subject-name-list"
                            style="width:100%;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;">
                    </div>`;
                }

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

                // 과목 선택 버튼 (기존 과목명 + 새 과목)
                if (s.type === 'subject_answer') {
                    html += this._renderSubjectButtons(idx, s.name, imgObj);
                }

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
                } else if (s.type === 'exam_no' || s.type === 'phone') {
                    html += `<div class="roi-fields">
                        <div class="roi-field" style="flex:1;">
                            <span class="roi-field-label">자릿수</span>
                            <input type="number" class="roi-field-input" value="${s.numQuestions}" min="1" max="20"
                                data-roi="${idx}" data-field="numQuestions" onchange="UI.onSettingChange(this)">
                        </div>
                    </div>`;
                    html += this.renderChoicesUI(idx, s);
                } else if (s.type === 'subject_code') {
                    // 시험관리에서 과목코드 목록 자동 로드
                    const globalSubjects = App.state.subjects || [];
                    const codeListFromSubjects = globalSubjects.filter(sub => sub.code).map(sub => sub.code + ':' + sub.name);
                    const currentCodes = (s.codeList || []).map(c => c.code + ':' + c.name);
                    const displayCodes = currentCodes.length > 0 ? currentCodes : codeListFromSubjects;

                    html += `<div class="roi-fields">
                        <div class="roi-field">
                            <span class="roi-field-label">코드 자리수</span>
                            <input type="number" class="roi-field-input" value="${s.numQuestions}" min="1" max="20"
                                data-roi="${idx}" data-field="numQuestions" onchange="UI.onSettingChange(this)">
                        </div>
                    </div>`;
                    if (globalSubjects.length > 0 && globalSubjects.some(sub => sub.code)) {
                        html += `<div class="roi-choice-section" style="margin-top:4px;">
                            <span class="roi-field-label">시험관리 과목코드 (참고용)</span>
                            <div style="font-size:10px; color:var(--text-muted); background:var(--bg-input); padding:4px 6px; border-radius:4px; max-height:80px; overflow-y:auto; user-select:none;">
                                ${globalSubjects.filter(sub => sub.code).map(sub =>
                                    `<div><strong>${sub.code}</strong> → ${sub.name}</div>`
                                ).join('')}
                            </div>
                        </div>`;
                    } else {
                        html += `<div class="roi-choice-section" style="margin-top:4px;">
                            <span class="roi-field-label" style="color:#d97706;">시험관리에 과목코드가 없습니다</span>
                            <div style="font-size:10px; color:var(--text-muted);">시험관리에서 과목코드를 먼저 등록하세요.</div>
                        </div>`;
                    }
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

                    // 과목 매칭 힌트 (영역 이름 = 과목 이름 또는 omrSubjectName 매핑)
                    const subjName = s.name || '';
                    const matchedSubj = subjName && typeof SubjectManager !== 'undefined'
                        ? SubjectManager.findByRoiName(subjName) : null;
                    if (subjName) {
                        const viaMapping = matchedSubj && matchedSubj.omrSubjectName === subjName && matchedSubj.name !== subjName;
                        html += `<div style="padding:4px 8px; font-size:10px; color:${matchedSubj ? 'var(--green)' : 'var(--text-muted)'}; border-top:1px solid var(--border-light);">
                            ${matchedSubj ? `✓ 과목 "${this.esc(matchedSubj.name)}"${viaMapping ? ` (양식 "${this.esc(subjName)}")` : ''} 매칭됨` : `• 시험관리에서 "양식 과목" 드롭다운으로 매칭하세요`}
                        </div>`;
                    }

                    // 정답 표시 + 수정 버튼
                    const answerDisplay = s.answerKey || '(없음)';
                    const isEditing = roi._editingAnswer || false;
                    html += `<div class="roi-choice-section" style="border-top:1px solid var(--border-light);">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="roi-field-label">정답</span>
                            <button class="btn btn-sm" style="font-size:9px; padding:1px 6px;"
                                onclick="UI.toggleAnswerEdit(${idx})">${isEditing ? '완료' : '수정'}</button>
                        </div>
                        ${isEditing ? `
                            <input type="text" class="roi-answer-input" data-roi="${idx}" onchange="UI.onDirectAnswerChange(this)"
                                value="${this.esc(s.answerKey || '')}" placeholder="쉼표 구분: 1,2,3,4 또는 ㄱ,ㄴ,ㄷ"
                                style="width:100%; margin-top:4px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-size:13px; font-family:monospace;">
                        ` : `
                            <div style="font-size:11px; font-family:monospace; color:var(--text-secondary); padding:4px 0; word-break:break-all;">${this.esc(answerDisplay)}</div>
                        `}
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
                            <input type="range" min="0.05" max="0.9" step="0.01" value="${t.minFill}"
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

                    if (s.type === 'birthday' || s.type === 'exam_no' || s.type === 'phone' || s.type === 'subject_code' || s.type === 'etc') {
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

                        // 과목코드: 시험관리 매칭 표시
                        if (s.type === 'subject_code') {
                            const globalSubjects = App.state.subjects || [];
                            const matchedSubj = globalSubjects.find(sub => sub.code === digits);
                            if (matchedSubj) {
                                html += `<div style="text-align:center; font-size:13px; font-weight:700; color:var(--green); padding-bottom:4px;">${matchedSubj.name}</div>`;
                            } else if (s.codeList && s.codeList.length > 0) {
                                const matchedCode = s.codeList.find(c => c.code === digits);
                                if (matchedCode) html += `<div style="text-align:center; font-size:13px; font-weight:700; color:var(--green); padding-bottom:4px;">${matchedCode.name}</div>`;
                            }
                            // 과목코드는 개별 셀 그리드 없이 합쳐진 값만 표시
                        } else {
                            // 생년월일/수험번호/전화 등: 수정 가능한 셀 그리드
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
                        }
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
                    <div class="score-big ${sc}">${(typeof Scoring !== 'undefined' ? Scoring._fmtScore(gr.score) : gr.score)} <span class="score-total">/ ${(typeof Scoring !== 'undefined' ? Scoring._fmtMax(gr.totalPossible) : gr.totalPossible)}</span></div>
                    <div class="score-detail">맞음 ${(typeof Scoring !== 'undefined' ? Scoring._fmtScore(gr.correctCount) : gr.correctCount)} ✓ · 틀림 ${(typeof Scoring !== 'undefined' ? Scoring._fmtScore(gr.wrongCount) : gr.wrongCount)} ✗ · ${pct}%</div>
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
            if (hasGrade && imgObj.gradeResult && imgObj.gradeResult.details) {
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

                if (row.corrected && !row._xvAutoCorrected) cellClass += ' grid-cell-corrected';
                // 1.5배 교차 검증 결과
                if (row._xvMatch === 'conflict') cellClass += ' grid-cell-xv-conflict';
                else if (row._xvMatch === 'bubble_only') cellClass += ' grid-cell-xv-warn';
                else if (row._xvAutoCorrected) cellClass += ' grid-cell-xv-auto';

                html += `
                    <div class="grid-cell ${cellClass}" data-roi="${resIdx}" data-q="${row.questionNumber}" data-choices="${numC}"
                         onclick="UI.selectCell(this)" title="${row._xvMatch === 'conflict' ? '⚠ 1.5배 검증 불일치' : row._xvMatch === 'bubble_only' ? '△ 확장 검증 미감지' : ''}">
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

        // subject_answer 타입이고 이름이 비어있으면 [과목N] 자동 부여
        if (settings.type === 'subject_answer' && !settings.name) {
            settings.name = this._nextAutoSubjectName(imgObj);
        }

        imgObj.rois.push({ x, y, w, h, _id: this._genRoiId(), settings });
        imgObj.results = null; imgObj.gradeResult = null;
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
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

        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
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
        } else if (s.type === 'exam_no' || s.type === 'phone') {
            // numQuestions는 기존값 유지 (사용자가 자릿수 지정)
            s.choiceLabels = ['0','1','2','3','4','5','6','7','8','9'];
            s.numChoices = 10; s.orientation = 'horizontal';
        } else if (s.type === 'subject_code') {
            s.numQuestions = 1;
            s.choiceLabels = ['1','2','3','4','5']; s.numChoices = 5;
        }

        // subject_answer로 변경 시 이름이 없으면 [과목N] 자동 부여
        if (s.type === 'subject_answer' && !s.name) {
            s.name = this._nextAutoSubjectName(imgObj);
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

    // [과목N] 자동 이름 생성 — 기존 ROI에서 사용 중인 번호 다음 번호 반환
    _nextAutoSubjectName(imgObj) {
        const used = new Set();
        if (imgObj) {
            imgObj.rois.forEach(r => {
                if (r.settings && r.settings.type === 'subject_answer' && r.settings.name) {
                    used.add(r.settings.name);
                }
            });
        }
        for (let n = 1; n <= 100; n++) {
            const candidate = `[과목${n}]`;
            if (!used.has(candidate)) return candidate;
        }
        return '[과목1]';
    },

    // 과목 버튼 행 렌더 (카드 + 팝업 공용)
    _renderSubjectButtons(roiIdx, currentName, imgObj) {
        const subjSet = new Set();
        // 시험관리에 등록된 과목명
        (App.state.subjects || []).forEach(sub => { if (sub.name) subjSet.add(sub.name); });
        // 현재 이미지의 ROI에 이미 부여된 과목명 ([과목N] 포함)
        if (imgObj) imgObj.rois.forEach(r => { if (r.settings && r.settings.type === 'subject_answer' && r.settings.name) subjSet.add(r.settings.name); });

        let html = `<div style="padding:4px 8px; display:flex; flex-wrap:wrap; gap:3px; align-items:center; border-bottom:1px solid var(--border-light);">`;
        if (subjSet.size > 0) {
            [...subjSet].forEach(name => {
                const isActive = currentName === name;
                html += `<button class="btn btn-sm" style="font-size:10px; padding:2px 8px; ${isActive ? 'background:var(--blue); color:#fff;' : ''}"
                    onclick="UI.selectSubjectForRoi(${roiIdx}, '${this.esc(name)}')">${this.esc(name)}</button>`;
            });
        } else {
            html += `<span style="font-size:10px; color:var(--text-muted);">과목 없음 — 이름 입력 시 자동 등록</span>`;
        }
        html += `</div>`;
        return html;
    },

    // 과목 버튼 클릭 → 이름 설정 + startNum 자동 계산
    selectSubjectForRoi(idx, subjectName) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[idx]) return;
        const s = imgObj.rois[idx].settings;
        s.name = subjectName;

        // 같은 과목의 기존 영역 중 가장 뒤 번호 찾기 → 이어서 시작
        let maxEnd = 0;
        imgObj.rois.forEach((r, i) => {
            if (i !== idx && r.settings && r.settings.type === 'subject_answer'
                && (r.settings.name || '').trim() === subjectName) {
                const end = (r.settings.startNum || 1) + (r.settings.numQuestions || 0);
                if (end > maxEnd) maxEnd = end;
            }
        });
        if (maxEnd > 0) s.startNum = maxEnd;

        // 과목 정답 자동 로드
        this._loadAnswersFromSubject(imgObj.rois[idx]);

        // 팝업이 열려있으면 팝업 필드도 갱신
        const rpName = document.getElementById('rp-name');
        if (rpName) rpName.value = subjectName;
        const rpStart = document.getElementById('rp-start');
        if (rpStart) rpStart.value = s.startNum;
        const rpBtns = document.getElementById('rp-subject-btns');
        if (rpBtns) rpBtns.innerHTML = this._renderSubjectButtons(idx, subjectName, imgObj);

        imgObj.results = null; imgObj.gradeResult = null;
        CanvasManager.render();
        ImageManager.updateList();
        // 팝업이 없을 때만 패널 전체 리렌더 (팝업 있으면 팝업 유지)
        if (!document.getElementById('roi-settings-popup')) this.updateRightPanel();
        Toast.info(`"${subjectName}" 선택됨 (시작번호: ${s.startNum})`);
    },

    openScoringPanel() {
        const existing = document.getElementById('scoring-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'scoring-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:90vw; max-width:1200px; max-height:90vh;">
                <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <h2>채점 통계</h2>
                    <button class="btn btn-sm" onclick="document.getElementById('scoring-modal').remove()">닫기</button>
                </div>
                <div class="modal-body" id="scoring-content" style="overflow-y:auto; max-height:75vh;"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        if (typeof Scoring !== 'undefined') {
            Scoring.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    toggleAnswerEdit(idx) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[idx]) return;
        imgObj.rois[idx]._editingAnswer = !imgObj.rois[idx]._editingAnswer;
        this.updateRightPanel();
    },

    onDirectAnswerChange(input) {
        const imgObj = App.getCurrentImage(); if (!imgObj) return;
        const idx = parseInt(input.dataset.roi);
        const roi = imgObj.rois[idx];
        roi.settings.answerKey = input.value.trim();

        // 전역 과목에 슬라이스 저장 + 같은 이름 ROI에 전파
        this._saveRoiAnswersToSubject(roi);
        const name = (roi.settings.name || '').trim();
        if (name) {
            App.state.images.forEach(img => {
                img.rois.forEach(r => {
                    if (r !== roi && r.settings && r.settings.type === 'subject_answer'
                        && (r.settings.name || '').trim() === name) {
                        this._loadAnswersFromSubject(r);
                        img.gradeResult = null;
                    }
                });
            });
        }

        imgObj.gradeResult = null;
        ImageManager.updateList();
        this.updateRightPanel();
    },

    // ROI → 과목: ROI의 answerKey를 전역 과목의 해당 슬라이스에 저장
    _saveRoiAnswersToSubject(roi) {
        const s = roi.settings;
        const name = (s.name || '').trim();
        if (!name || s.type !== 'subject_answer' || !s.answerKey) return;
        if (typeof SubjectManager === 'undefined') return;

        const roiAnswers = s.answerKey.indexOf(',') >= 0
            ? s.answerKey.split(',').map(t => t.trim())
            : s.answerKey.split('');
        const startIdx = (s.startNum || 1) - 1;

        const subjects = SubjectManager.getSubjects();
        let subj = subjects.find(x => x.name === name);

        if (!subj) {
            // 신규 과목 생성
            const full = new Array(startIdx + roiAnswers.length).fill('');
            for (let i = 0; i < roiAnswers.length; i++) full[startIdx + i] = roiAnswers[i];
            subjects.push({
                code: '', name,
                numQuestions: full.length,
                scorePerQuestion: 5,
                answers: full.join(',')
            });
        } else {
            // 기존 과목에 슬라이스 업데이트
            const subjArray = subj.answers
                ? (subj.answers.indexOf(',') >= 0 ? subj.answers.split(',') : subj.answers.split(''))
                : [];
            while (subjArray.length < startIdx + roiAnswers.length) subjArray.push('');
            for (let i = 0; i < roiAnswers.length; i++) subjArray[startIdx + i] = roiAnswers[i];
            subj.answers = subjArray.join(',');
            subj.numQuestions = Math.max(subj.numQuestions || 0, subjArray.length);
        }
        SubjectManager.saveToStorage();
    },

    // 과목 → ROI: 전역 과목에서 startNum 기반 슬라이스를 ROI.answerKey에 로드
    _loadAnswersFromSubject(roi) {
        const s = roi.settings;
        const name = (s.name || '').trim();
        if (!name || typeof SubjectManager === 'undefined') return false;
        const subj = SubjectManager.findByRoiName(name); // ROI 이름 → 매핑된 CSV 과목
        if (!subj || !subj.answers) return false;

        // 과목 정답은 항상 쉼표 구분으로 저장됨 (subjectManager.save에서 보장)
        const subjArray = subj.answers.split(',').map(t => t.trim());
        const startIdx = (s.startNum || 1) - 1;
        const endIdx = startIdx + (s.numQuestions || 20);
        const slice = subjArray.slice(startIdx, endIdx);

        if (slice.length > 0 && slice.some(x => x)) {
            s.answerKey = slice.join(',');
            return true;
        }
        return false;
    },

    // subject_answer ROI 이름 변경 시 과목 매칭/자동 로드
    _syncRoiNameAsSubject(roi) {
        const s = roi.settings;
        if (!s || s.type !== 'subject_answer') return;
        const name = (s.name || '').trim();
        if (!name) return;
        if (this._loadAnswersFromSubject(roi)) {
            Toast.info(`과목 "${name}" 정답 자동 로드됨`);
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

        // 과목코드 박스 치기 모드인지 판별
        const _isCodeBoxMode = !!roi._isPendingCodeBox;
        const _codeDrawn = this._pendingCodeDrawnIds ? this._pendingCodeDrawnIds.length : 0;
        const _codeTotal = this._pendingCodeTotalDigits || 0;
        const _answerRoiIdx = this._pendingCodeLinkRoiIdx;
        const _popupTitle = _isCodeBoxMode
            ? `영역 ${(_answerRoiIdx != null ? _answerRoiIdx + 1 : '?')}의 과목코드 설정중 (${_codeDrawn + 1}/${_codeTotal})`
            : `영역 ${roiIdx + 1} 설정`;

        const overlay = document.createElement('div');
        overlay.id = 'roi-settings-popup';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:340px;">
                <div class="modal-header">
                    <h2>${_popupTitle}</h2>
                </div>
                <div class="modal-body">
                    <div class="roi-popup-field">
                        <label>타입</label>
                        <select id="rp-type">${Object.entries(this.ROI_TYPES).map(([k, t]) =>
                            `<option value="${k}" ${s.type === k ? 'selected' : ''}>${t.icon} ${t.label}</option>`
                        ).join('')}</select>
                    </div>
                    ${(() => {
                        const hasCodeLink = !!(s.linkedCodeRoiIds && s.linkedCodeRoiIds.length > 0) || !!s.linkedCodeRoiId;
                        if (hasCodeLink) {
                            return `<input type="hidden" id="rp-name" value="">`;
                        }
                        return `<div id="rp-subject-btns">${this._renderSubjectButtons(roiIdx, s.name, imgObj)}</div>
                    <div class="roi-popup-field">
                        <label>과목/영역명</label>
                        <input type="text" id="rp-name" value="${this.esc(s.name)}" placeholder="과목명 입력 또는 선택"
                            list="rp-subject-list">
                        <datalist id="rp-subject-list">
                            ${(App.state.subjects || []).map(subj => `<option value="${this.esc(subj.name)}">${subj.code ? `[${this.esc(subj.code)}]` : ''}</option>`).join('')}
                        </datalist>
                    </div>`;
                    })()}
                    <!-- 과목코드 연동 (타입→과목명 바로 아래, 코드박스 모드일 땐 숨김) -->
                    <div id="rp-code-link-section" style="padding:6px 8px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:5px; margin-bottom:4px; ${_isCodeBoxMode ? 'display:none;' : ''}">
                        <div style="font-size:10px; font-weight:700; color:#0369a1; margin-bottom:3px;">과목코드 연동</div>
                        ${(() => {
                            const ids = s.linkedCodeRoiIds || (s.linkedCodeRoiId ? [s.linkedCodeRoiId] : []);
                            if (ids.length > 0) {
                                let codeDigits = '';
                                const boxes = ids.map((id, di) => {
                                    const ci = imgObj.rois.findIndex(r => r._id === id);
                                    if (ci < 0) return `<span style="color:#dc2626;font-size:10px;">${di+1}자리: 삭제됨</span>`;
                                    const cRes = imgObj.results && imgObj.results[ci];
                                    let digit = '?';
                                    if (cRes && cRes.rows && cRes.rows[0] && cRes.rows[0].markedAnswer != null) {
                                        const cl = imgObj.rois[ci].settings.choiceLabels;
                                        digit = cl && cl[cRes.rows[0].markedAnswer - 1] ? cl[cRes.rows[0].markedAnswer - 1] : String(cRes.rows[0].markedAnswer);
                                    }
                                    codeDigits += digit;
                                    return `<span style="font-size:9px;color:#0369a1;">${di+1}자리:<strong>${digit}</strong></span>`;
                                });
                                const globalSubjects = App.state.subjects || [];
                                const matchedSubj = globalSubjects.find(sub => sub.code === codeDigits);
                                return `<div style="display:flex;align-items:center;gap:6px;">
                                    <span style="font-size:14px;font-weight:800;font-family:monospace;color:#1e3a5f;letter-spacing:2px;">${codeDigits}</span>
                                    ${matchedSubj ? `<span style="font-size:11px;font-weight:700;color:#16a34a;">${matchedSubj.name}</span>` : ''}
                                    <button class="btn btn-sm" onclick="UI._unlinkCodeRoi(${roiIdx})" style="font-size:9px;padding:1px 4px;color:#dc2626;margin-left:auto;">해제</button>
                                </div>
                                <div style="font-size:8px;color:var(--text-muted);margin-top:2px;">${boxes.join(' · ')}</div>`;
                            } else {
                                return `<div style="display:flex;align-items:center;gap:6px;">
                                    <span style="font-size:9px;color:var(--text-muted);">연결 없음</span>
                                    <label style="font-size:9px;color:var(--text-muted);display:flex;align-items:center;gap:2px;">
                                        자리수 <input type="number" id="rp-code-digits" value="2" min="1" max="5" style="width:32px;padding:1px;font-size:10px;border:1px solid var(--border);border-radius:3px;text-align:center;">
                                    </label>
                                    <button class="btn btn-sm btn-primary" onclick="UI._startCodeBoxDraw(${roiIdx})" style="font-size:9px;padding:2px 6px;">과목코드 박스 치기</button>
                                </div>`;
                            }
                        })()}
                    </div>
                    <div class="roi-popup-field">
                        <label>방향</label>
                        <div class="roi-popup-orient">
                            <button id="rp-vert" class="${s.orientation === 'vertical' ? 'active' : ''}" onclick="document.getElementById('rp-vert').classList.add('active');document.getElementById('rp-horiz').classList.remove('active');UI.onPopupOrientChange(${roiIdx},'vertical');">⬇ 세로</button>
                            <button id="rp-horiz" class="${s.orientation === 'horizontal' ? 'active' : ''}" onclick="document.getElementById('rp-horiz').classList.add('active');document.getElementById('rp-vert').classList.remove('active');UI.onPopupOrientChange(${roiIdx},'horizontal');">➡ 가로</button>
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
                        <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span style="font-size:11px; color:var(--text-muted); white-space:nowrap;">첫 번호</span>
                                <input type="text" id="rp-label-start" value="${(s.choiceLabels && s.choiceLabels[0]) || '1'}" maxlength="5"
                                    style="width:50px; text-align:center; padding:4px; border:1px solid var(--border); border-radius:4px; font-size:12px; font-weight:700;"
                                    oninput="UI.onPopupLabelStartChange(${roiIdx})"
                                    title="여기 숫자를 적으면 나머지가 자동으로 채워짐 (예: 0 → 0,1,2,3...)">
                                <span style="font-size:10px; color:var(--text-muted);">→ 자동 채움</span>
                            </div>
                            <div id="rp-labels" style="display:flex; gap:3px; flex-wrap:wrap;">
                                ${(s.choiceLabels || []).slice(0, s.numChoices || 5).map((lbl, i) =>
                                    `<input type="text" class="rp-label-input" data-idx="${i}" value="${this.esc(lbl)}" maxlength="10" style="width:36px; text-align:center; padding:4px; border:1px solid var(--border); border-radius:4px; font-size:12px;">`
                                ).join('')}
                            </div>
                        </div>
                    </div>
                    <!-- 버블 형태 선택 — 영역 설정과 분리된 단 -->
                    <div style="margin-top:8px; padding-top:8px; border-top:2px solid var(--border-light);">
                        <div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:6px;">버블 형태</div>
                        <div style="display:flex; gap:8px;">
                            <button id="rp-bubble-circle" onclick="UI._setBubbleType(false)"
                                style="flex:1; padding:10px; border:2px solid ${!s.elongatedMode ? '#22c55e' : 'var(--border)'}; border-radius:8px; cursor:pointer;
                                       background:${!s.elongatedMode ? '#dcfce7' : 'var(--bg-input)'}; display:flex; flex-direction:column; align-items:center; gap:6px; transition:all 0.15s;">
                                <svg width="32" height="32" viewBox="0 0 32 32">
                                    <circle cx="16" cy="16" r="12" fill="none" stroke="${!s.elongatedMode ? '#16a34a' : '#94a3b8'}" stroke-width="2.5"/>
                                    <circle cx="16" cy="16" r="5" fill="${!s.elongatedMode ? '#16a34a' : '#d4d4d8'}"/>
                                </svg>
                                <span style="font-size:12px; font-weight:700; color:${!s.elongatedMode ? '#16a34a' : 'var(--text-muted)'};">원형 버블</span>
                            </button>
                            <button id="rp-bubble-elongated" onclick="UI._setBubbleType(true)"
                                style="flex:1; padding:10px; border:2px solid ${s.elongatedMode ? '#22c55e' : 'var(--border)'}; border-radius:8px; cursor:pointer;
                                       background:${s.elongatedMode ? '#dcfce7' : 'var(--bg-input)'}; display:flex; flex-direction:column; align-items:center; gap:6px; transition:all 0.15s;">
                                <svg width="32" height="32" viewBox="0 0 32 32">
                                    <ellipse cx="16" cy="16" rx="7" ry="13" fill="none" stroke="${s.elongatedMode ? '#16a34a' : '#94a3b8'}" stroke-width="2.5"/>
                                    <ellipse cx="16" cy="16" rx="3" ry="6" fill="${s.elongatedMode ? '#16a34a' : '#d4d4d8'}"/>
                                </svg>
                                <span style="font-size:12px; font-weight:700; color:${s.elongatedMode ? '#16a34a' : 'var(--text-muted)'};">세로 길쭉 버블</span>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-sm" onclick="UI.cancelRoiSettingsPopup(${roiIdx})">취소</button>
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

    // 과목코드 박스 치기 — 자리수만큼 순차 드래그
    _pendingCodeLinkRoiIdx: null,
    _pendingCodeTotalDigits: 0,
    _pendingCodeDrawnIds: [],

    // 카드에서 직접 과목코드 연동 시작 (카드에는 팝업 input이 없으므로 저장 불필요)
    _startCodeBoxDrawFromCard(answerRoiIdx) {
        const digitsInput = document.getElementById(`roi-code-digits-${answerRoiIdx}`);
        const totalDigits = digitsInput ? Math.max(1, Math.min(5, parseInt(digitsInput.value) || 2)) : 2;
        const imgObj = App.getCurrentImage();

        this._pendingCodeLinkRoiIdx = answerRoiIdx;
        this._pendingCodeAnswerRoiId = imgObj && imgObj.rois[answerRoiIdx] ? imgObj.rois[answerRoiIdx]._id : null;
        this._pendingCodeTotalDigits = totalDigits;
        this._pendingCodeDrawnIds = [];

        Toast.canvasGuide(`과목코드 ${totalDigits}자리 — 1자리째 영역을 드래그하세요`);
        CanvasManager.setMode('draw');
    },

    // 팝업에서 코드박스 치기 시작 전 답안 ROI의 현재 팝업 값 임시 저장
    _savePopupValuesToRoi(roiIdx) {
        const imgObj = App.getCurrentImage();
        if (!imgObj || !imgObj.rois[roiIdx]) return;
        const s = imgObj.rois[roiIdx].settings;
        const nq = document.getElementById('rp-numq');
        const nc = document.getElementById('rp-numc');
        const st = document.getElementById('rp-start');
        const nm = document.getElementById('rp-name');
        if (nq) s.numQuestions = parseInt(nq.value) || s.numQuestions;
        if (nc) s.numChoices = parseInt(nc.value) || s.numChoices;
        if (st) s.startNum = parseInt(st.value) || s.startNum;
        if (nm) s.name = nm.value;
        const vBtn = document.getElementById('rp-vert');
        const hBtn = document.getElementById('rp-horiz');
        if (vBtn && hBtn) s.orientation = vBtn.classList.contains('active') ? 'vertical' : 'horizontal';
        const labelInputs = document.querySelectorAll('.rp-label-input');
        if (labelInputs.length > 0) s.choiceLabels = Array.from(labelInputs).map(inp => inp.value);
        const elongBtn = document.getElementById('rp-bubble-elongated');
        if (elongBtn) s.elongatedMode = elongBtn.classList.contains('active');
    },

    _startCodeBoxDraw(answerRoiIdx) {
        // 답안 ROI의 현재 팝업 값 저장 (확인 안 누른 상태에서 이탈하므로)
        this._savePopupValuesToRoi(answerRoiIdx);

        const digitsInput = document.getElementById('rp-code-digits');
        const totalDigits = digitsInput ? Math.max(1, Math.min(5, parseInt(digitsInput.value) || 2)) : 2;
        const imgObj = App.getCurrentImage();

        this._pendingCodeLinkRoiIdx = answerRoiIdx;
        this._pendingCodeAnswerRoiId = imgObj && imgObj.rois[answerRoiIdx] ? imgObj.rois[answerRoiIdx]._id : null;
        this._pendingCodeTotalDigits = totalDigits;
        this._pendingCodeDrawnIds = [];
        this.closeRoiSettingsPopup();

        Toast.canvasGuide(`과목코드 ${totalDigits}자리 — 1자리째 영역을 드래그하세요`);
        CanvasManager.setMode('draw');
    },


    // 과목코드 연결 해제 — 연결된 코드 박스도 삭제
    _unlinkCodeRoi(answerRoiIdx) {
        const imgObj = App.getCurrentImage();
        if (!imgObj || !imgObj.rois[answerRoiIdx]) return;
        const s = imgObj.rois[answerRoiIdx].settings;
        const ids = s.linkedCodeRoiIds || (s.linkedCodeRoiId ? [s.linkedCodeRoiId] : []);
        // 코드 박스들 삭제 (뒤에서부터 삭제해야 인덱스 안 밀림)
        const codeIndices = ids.map(id => imgObj.rois.findIndex(r => r._id === id)).filter(i => i >= 0).sort((a, b) => b - a);
        codeIndices.forEach(ci => imgObj.rois.splice(ci, 1));
        // answerRoiIdx 재계산 (앞에서 삭제된 것 감안)
        const deleted = codeIndices.filter(ci => ci < answerRoiIdx).length;
        const newIdx = answerRoiIdx - deleted;
        const newS = imgObj.rois[newIdx] ? imgObj.rois[newIdx].settings : null;
        if (newS) {
            newS.linkedCodeRoiIds = null;
            newS.linkedCodeRoiId = null;
            newS.answerSource = 'direct';
        }
        imgObj.results = null; imgObj.gradeResult = null;
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        CanvasManager.render();
        this.closeRoiSettingsPopup();
        setTimeout(() => this.openRoiSettingsPopup(newIdx), 100);
    },

    // 팝업 "첫 번호" 변경 → 나머지 라벨 자동 채움
    // 빈칸이면 아래 개별 라벨 건드리지 않음 (사용자가 직접 입력)
    onPopupLabelStartChange(roiIdx) {
        const startInput = document.getElementById('rp-label-start');
        if (!startInput) return;
        const startVal = startInput.value.trim();
        if (startVal === '') return; // 빈칸이면 아무것도 안 함

        const numC = parseInt(document.getElementById('rp-numc')?.value) || 5;
        const labelsDiv = document.getElementById('rp-labels');
        if (!labelsDiv) return;

        const startNum = parseInt(startVal);
        const isNumeric = !isNaN(startNum) && String(startNum) === startVal;

        let html = '';
        for (let i = 0; i < numC; i++) {
            const val = isNumeric ? String(startNum + i) : (i === 0 ? startVal : String(i + 1));
            html += `<input type="text" class="rp-label-input" data-idx="${i}" value="${val}" maxlength="10" style="width:36px; text-align:center; padding:4px; border:1px solid var(--border); border-radius:4px; font-size:12px;">`;
        }
        labelsDiv.innerHTML = html;
    },

    // 팝업에서 방향(세로/가로) 변경 시 문항수/선택지수 재할당
    onPopupOrientChange(roiIdx, orient) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[roiIdx]) return;
        const roi = imgObj.rois[roiIdx];
        roi.settings.orientation = orient;
        const isElong = !!roi.settings.elongatedMode;
        try {
            const imageData = CanvasManager.getAdjustedImageData(imgObj, roi.x, roi.y, roi.w, roi.h);
            const detected = OmrEngine.autoDetect(imageData, roi.x, roi.y, 0, isElong);
            if (detected) {
                // autoDetect는 자체 방향 추정을 하지만,
                // 사용자가 직접 방향을 지정했으므로 그 방향에 맞춰 numQ/numC 결정
                // BFS가 찾은 행/열 수는 grid.numRows × grid.numCols
                // vertical: 행=문항, 열=선택지
                // horizontal: 열=문항, 행=선택지
                let numQ, numC;
                if (orient === detected.orientation) {
                    // 같은 방향 → autoDetect 결과 그대로
                    numQ = detected.numQuestions;
                    numC = detected.numChoices;
                } else {
                    // 다른 방향 → 뒤집기
                    numQ = detected.numChoices;
                    numC = detected.numQuestions;
                }

                const nqInput = document.getElementById('rp-numq');
                if (nqInput) nqInput.value = numQ;
                const ncInput = document.getElementById('rp-numc');
                if (ncInput) ncInput.value = numC;

                // 라벨 재생성
                const labelsDiv = document.getElementById('rp-labels');
                if (labelsDiv) {
                    let newHtml = '';
                    for (let i = 0; i < numC; i++) {
                        newHtml += `<input type="text" class="rp-label-input" data-idx="${i}" value="${i + 1}" maxlength="10" style="width:36px; text-align:center; padding:4px; border:1px solid var(--border); border-radius:4px; font-size:12px;">`;
                    }
                    labelsDiv.innerHTML = newHtml;
                }
                // 첫 번호 입력칸도 리셋
                const startInput = document.getElementById('rp-label-start');
                if (startInput) startInput.value = '1';

                console.log(`[팝업 방향변경] ${orient} → 문항=${numQ} 선택지=${numC}`);
            }
        } catch (e) {
            console.warn('팝업 방향 재감지 실패:', e);
        }
    },

    // 팝업에서 길쭉 모드 토글 시 임계값 리셋 + 자동감지 재실행
    _setBubbleType(isElongated) {
        const circleBtn = document.getElementById('rp-bubble-circle');
        const elongBtn = document.getElementById('rp-bubble-elongated');
        if (!circleBtn || !elongBtn) return;

        // 원형 버튼 스타일
        circleBtn.style.border = `2px solid ${!isElongated ? '#22c55e' : 'var(--border)'}`;
        circleBtn.style.background = !isElongated ? '#dcfce7' : 'var(--bg-input)';
        const cSvg = circleBtn.querySelector('svg');
        if (cSvg) {
            cSvg.querySelector('circle:first-child').setAttribute('stroke', !isElongated ? '#16a34a' : '#94a3b8');
            cSvg.querySelector('circle:last-child').setAttribute('fill', !isElongated ? '#16a34a' : '#d4d4d8');
        }
        const cSpan = circleBtn.querySelector('span');
        if (cSpan) cSpan.style.color = !isElongated ? '#16a34a' : 'var(--text-muted)';

        // 길쭉 버튼 스타일
        elongBtn.style.border = `2px solid ${isElongated ? '#22c55e' : 'var(--border)'}`;
        elongBtn.style.background = isElongated ? '#dcfce7' : 'var(--bg-input)';
        const eSvg = elongBtn.querySelector('svg');
        if (eSvg) {
            eSvg.querySelector('ellipse:first-child').setAttribute('stroke', isElongated ? '#16a34a' : '#94a3b8');
            eSvg.querySelector('ellipse:last-child').setAttribute('fill', isElongated ? '#16a34a' : '#d4d4d8');
        }
        const eSpan = elongBtn.querySelector('span');
        if (eSpan) eSpan.style.color = isElongated ? '#16a34a' : 'var(--text-muted)';

        // active 클래스
        circleBtn.classList.toggle('active', !isElongated);
        elongBtn.classList.toggle('active', isElongated);

        // 로직 호출 (roiIdx는 팝업 DOM에서 추출)
        const popup = document.getElementById('roi-settings-popup');
        if (popup) {
            const applyBtn = popup.querySelector('[onclick*="applyRoiSettingsPopup"]');
            if (applyBtn) {
                const m = applyBtn.getAttribute('onclick').match(/applyRoiSettingsPopup\((\d+)\)/);
                if (m) this.onPopupElongatedToggle(parseInt(m[1]), isElongated);
            }
        }
    },

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
                // 문항수
                const nqInput = document.getElementById('rp-numq');
                if (nqInput) nqInput.value = detected.numQuestions;
                // 선택지 수
                const ncInput = document.getElementById('rp-numc');
                if (ncInput) ncInput.value = detected.numChoices;
                // 라벨 재생성 (1~N 기본값)
                const labelsDiv = document.getElementById('rp-labels');
                if (labelsDiv) {
                    let newHtml = '';
                    for (let i = 0; i < detected.numChoices; i++) {
                        newHtml += `<input type="text" class="rp-label-input" data-idx="${i}" value="${i + 1}" maxlength="10" style="width:36px; text-align:center; padding:4px; border:1px solid var(--border); border-radius:4px; font-size:12px;">`;
                    }
                    labelsDiv.innerHTML = newHtml;
                }
                // 방향
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

    // 팝업 취소 — 새 박스(_isNewRoi)이면 삭제
    cancelRoiSettingsPopup(roiIdx) {
        const imgObj = App.getCurrentImage();
        const isPendingCode = imgObj && imgObj.rois[roiIdx] && imgObj.rois[roiIdx]._isPendingCodeBox;

        if (imgObj && imgObj.rois[roiIdx] && imgObj.rois[roiIdx]._isNewRoi) {
            this.closeRoiSettingsPopup();
            CanvasManager.deleteRoi(roiIdx);
            this.updateRightPanel();
            Toast.info('영역 추가 취소됨');
        } else {
            this.closeRoiSettingsPopup();
        }

        // 과목코드 박스 치기 취소 → 이전에 그린 코드박스들도 전부 롤백 → 답안 팝업 복귀
        Toast.canvasGuideClear();
        if (isPendingCode && this._pendingCodeLinkRoiIdx != null) {
            // 이미 그린 코드박스들 삭제 (뒤에서부터)
            if (imgObj && this._pendingCodeDrawnIds.length > 0) {
                const delIndices = this._pendingCodeDrawnIds
                    .map(id => imgObj.rois.findIndex(r => r._id === id))
                    .filter(i => i >= 0)
                    .sort((a, b) => b - a);
                delIndices.forEach(ci => imgObj.rois.splice(ci, 1));
                imgObj.results = null; imgObj.gradeResult = null;
                CanvasManager.render();
            }
            const answerIdx = this._pendingCodeLinkRoiIdx;
            // answerIdx 재계산 (삭제로 인덱스 밀렸을 수 있음)
            const answerId = this._pendingCodeAnswerRoiId;
            const newAnswerIdx = answerId ? imgObj.rois.findIndex(r => r._id === answerId) : answerIdx;

            this._pendingCodeLinkRoiIdx = null;
            this._pendingCodeDrawnIds = [];
            this._pendingCodeTotalDigits = 0;
            this._pendingCodeAnswerRoiId = null;
            setTimeout(() => this.openRoiSettingsPopup(newAnswerIdx >= 0 ? newAnswerIdx : 0), 200);
        }
    },

    deleteRoiFromPopup(roiIdx) {
        const imgObj = App.getCurrentImage();
        // 연결된 과목코드 박스들도 함께 삭제
        if (imgObj && imgObj.rois[roiIdx]) {
            const s = imgObj.rois[roiIdx].settings;
            const ids = s.linkedCodeRoiIds || (s.linkedCodeRoiId ? [s.linkedCodeRoiId] : []);
            const codeIndices = ids.map(id => imgObj.rois.findIndex(r => r._id === id)).filter(i => i >= 0).sort((a, b) => b - a);
            codeIndices.forEach(ci => imgObj.rois.splice(ci, 1));
            const deleted = codeIndices.filter(ci => ci < roiIdx).length;
            roiIdx = roiIdx - deleted;
        }
        this.closeRoiSettingsPopup();
        CanvasManager.deleteRoi(roiIdx);
        this.updateRightPanel();
    },

    applyRoiSettingsPopup(roiIdx) {
        const imgObj = App.getCurrentImage(); if (!imgObj || !imgObj.rois[roiIdx]) return;
        const s = imgObj.rois[roiIdx].settings;

        const newOrient = document.getElementById('rp-vert').classList.contains('active') ? 'vertical' : 'horizontal';
        const orientChanged = s.orientation !== newOrient;

        const newType = document.getElementById('rp-type').value;
        const newName = document.getElementById('rp-name').value;

        // 과목 답안인데 이름 비었으면 경고 (과목코드 연동 시 이름 불필요)
        const hasCodeLink = !!(s.linkedCodeRoiIds && s.linkedCodeRoiIds.length > 0) || !!s.linkedCodeRoiId;
        if (newType === 'subject_answer' && !newName.trim() && !hasCodeLink) {
            Toast.error('과목/영역명을 입력하거나 과목코드 박스를 연결하세요');
            const nameInput = document.getElementById('rp-name');
            if (nameInput) { nameInput.focus(); nameInput.style.borderColor = '#ef4444'; }
            return;
        }

        s.type = newType;
        const nameChanged = s.name !== newName;
        s.name = newName;
        s.orientation = newOrient;
        s.startNum = parseInt(document.getElementById('rp-start').value) || 1;
        s.numQuestions = parseInt(document.getElementById('rp-numq').value) || 0;
        const elongBtn = document.getElementById('rp-bubble-elongated');
        const newElongated = elongBtn ? elongBtn.classList.contains('active') : false;
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

        // 이름 변경 시 과목 매칭/자동 로드
        if (nameChanged) this._syncRoiNameAsSubject(imgObj.rois[roiIdx]);

        // 신규 박스 플래그 해제 (확인 완료)
        delete imgObj.rois[roiIdx]._isNewRoi;

        // 과목코드 박스 치기로 만들어진 경우 → 답안 ROI에 연결 + 답안 팝업 재오픈
        const isPendingCode = imgObj.rois[roiIdx]._isPendingCodeBox;
        delete imgObj.rois[roiIdx]._isPendingCodeBox;

        imgObj.results = null; imgObj.gradeResult = null;
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        this.closeRoiSettingsPopup();

        if (isPendingCode && this._pendingCodeLinkRoiIdx != null) {
            const codeRoi = imgObj.rois[roiIdx];
            if (codeRoi) {
                codeRoi.settings.numQuestions = 1;
                codeRoi.settings.orientation = 'horizontal'; // 과목코드는 항상 가로 판별
                this._pendingCodeDrawnIds.push(codeRoi._id);
            }

            const drawn = this._pendingCodeDrawnIds.length;
            const total = this._pendingCodeTotalDigits;

            CanvasManager.render();

            if (drawn < total) {
                // 다음 자리 드래그 — setMode를 setTimeout으로 확실히 적용
                setTimeout(() => {
                    Toast.canvasGuide(`과목코드 ${total}자리 중 ${drawn}자리 완료 — ${drawn + 1}자리째를 드래그하세요`);
                    CanvasManager.setMode('draw');
                }, 50);
            } else {
                // 전체 완료 → 답안 ROI에 연결 (_id 기반으로 찾기)
                const answerId = this._pendingCodeAnswerRoiId;
                const answerIdx = answerId ? imgObj.rois.findIndex(r => r._id === answerId) : this._pendingCodeLinkRoiIdx;
                this._pendingCodeLinkRoiIdx = null;
                this._pendingCodeAnswerRoiId = null;
                const answerRoi = answerIdx >= 0 ? imgObj.rois[answerIdx] : null;
                if (answerRoi) {
                    answerRoi.settings.linkedCodeRoiIds = [...this._pendingCodeDrawnIds];
                    answerRoi.settings.linkedCodeRoiId = null;
                    answerRoi.settings.answerSource = 'code';
                    Toast.canvasGuideClear();
                    Toast.success(`과목코드 ${total}자리 연결 완료`);
                }
                this._pendingCodeDrawnIds = [];
                this._pendingCodeTotalDigits = 0;
                setTimeout(() => this.openRoiSettingsPopup(answerIdx >= 0 ? answerIdx : 0), 200);
            }
        } else {
            CanvasManager.render();
            ImageManager.updateList();
            this.updateRightPanel();
            setTimeout(() => CanvasManager.runAnalysis(), 100);
        }
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
            const bx = b.x != null ? b.x : (b.cx - (b.w || 0) / 2);
            const by = b.y != null ? b.y : (b.cy - (b.h || 0) / 2);
            if (bx < minX) minX = bx;
            if (by < minY) minY = by;
            if (bx + (b.w || 0) > maxX) maxX = bx + (b.w || 0);
            if (by + (b.h || 0) > maxY) maxY = by + (b.h || 0);
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

        // 확대 배율: 가로형(수험번호 등 0~9 세로 배열)은 세로로 너무 길어지므로 절반
        const roi = imgObj.rois[roiIdx];
        const isHorizontal = roi && roi.settings && roi.settings.orientation === 'horizontal';
        const scale = isHorizontal ? 1.5 : 3;
        const popupW = Math.round(cropW * scale);
        const popupH = Math.round(cropH * scale);

        // 임시 캔버스에서 해당 영역 잘라내기 + 1.5배 검증 시각화
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = popupW;
        tempCanvas.height = popupH;
        const tctx = tempCanvas.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(imgObj.imgElement, minX, minY, cropW, cropH, 0, 0, popupW, popupH);

        // 1.5배 확장 영역 오버레이 그리기
        const _xvRes = imgObj.results && imgObj.results[roiIdx];
        const qRow = _xvRes && _xvRes.rows.find(r => r.questionNumber === qNum);
        if (qRow && qRow._xvScores) {
            qRow._xvScores.forEach((xv, ci) => {
                const orig = xv.origRect;
                const exp = xv.expandRect;
                if (!orig || !exp) return;

                // 좌표를 팝업 기준으로 변환
                const toX = (px) => (px - minX) * scale;
                const toY = (py) => (py - minY) * scale;

                // 1배 영역 (파란 실선)
                tctx.strokeStyle = 'rgba(59,130,246,0.7)';
                tctx.lineWidth = 1;
                tctx.strokeRect(toX(orig.x), toY(orig.y), orig.w * scale, orig.h * scale);

                // 1.5배 영역 (주황 점선)
                tctx.strokeStyle = 'rgba(245,158,11,0.8)';
                tctx.lineWidth = 1.5;
                tctx.setLineDash([4, 3]);
                tctx.strokeRect(toX(exp.x), toY(exp.y), exp.w * scale, exp.h * scale);
                tctx.setLineDash([]);

                // 확장 comp 값 표시
                const compText = (xv.ringMax !== undefined ? xv.ringMax : xv.comp).toFixed(2);
                const tx = toX(exp.x + exp.w / 2);
                const ty = toY(exp.y) - 3;
                tctx.font = `bold ${Math.max(9, Math.round(scale * 4))}px sans-serif`;
                tctx.fillStyle = xv.col + 1 === qRow._xvAnswer ? '#22c55e' : '#94a3b8';
                tctx.textAlign = 'center';
                tctx.fillText(compText, tx, ty);
            });

            // 검증 결과 배지
            const matchLabel = {
                'match': '✓ 일치', 'conflict': '⚠ 불일치',
                'bubble_only': '△ 확장미감지', 'xv_only': '▽ BFS미감지', 'both_null': '○ 미기입'
            }[qRow._xvMatch] || '';
            const matchColor = {
                'match': '#22c55e', 'conflict': '#f59e0b',
                'bubble_only': '#fb923c', 'xv_only': '#3b82f6', 'both_null': '#64748b'
            }[qRow._xvMatch] || '#94a3b8';
            if (matchLabel) {
                tctx.font = `bold ${Math.max(10, Math.round(scale * 4))}px sans-serif`;
                tctx.fillStyle = matchColor;
                tctx.textAlign = 'right';
                tctx.fillText(matchLabel, popupW - 4, popupH - 4);
            }
        }

        // 팝업 생성
        const popup = document.createElement('div');
        popup.id = 'zoom-popup';
        popup.className = 'zoom-popup';

        const img = document.createElement('img');
        img.src = tempCanvas.toDataURL();
        img.style.width = popupW + 'px';
        img.style.height = popupH + 'px';
        popup.appendChild(img);

        // Q번호 라벨 + 검증 상태
        const xvInfo = qRow && qRow._xvMatch ? ` [${qRow._xvMatch === 'match' ? '✓' : qRow._xvMatch === 'conflict' ? '⚠' : '△'}]` : '';
        const label = document.createElement('div');
        label.className = 'zoom-popup-label';
        label.textContent = `Q${qNum}${xvInfo}`;
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
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
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
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();

        // 로컬 자동 저장
        this.autoSaveLocal();
    },

    // ==========================================
    // 교정 확정 (전체 이미지 대상)
    // ==========================================
    toggleConfirmCorrection() {
        const images = App.state.images || [];
        if (images.length === 0) return;

        // 현재 상태 확인: 하나라도 확정이면 → 전체 해제, 아니면 → 전체 확정
        const anyConfirmed = images.some(img => img._correctionConfirmed);

        if (anyConfirmed) {
            // 전체 해제
            images.forEach(img => { img._correctionConfirmed = false; });
            ImageManager.updateList();
            this.updateRightPanel();
            Toast.info('전체 교정 확정 해제');

            // 교정 탭이 열려있으면 즉시 재렌더링
            const cv1 = document.getElementById('correction-view');
            if (cv1 && cv1.style.display !== 'none' && typeof Correction !== 'undefined') {
                Correction.render(document.getElementById('correction-content'));
            }
        } else {
            // 전체 확정: 모든 이미지에 대해 수험번호 재매칭 + 재채점
            let updated = 0;
            images.forEach(img => {
                img._correctionConfirmed = true;

                // 수험번호/이름 재매칭 (교정된 값으로 갱신)
                if (img.results) {
                    ImageManager.applyPhonePrefix(img);
                    img.gradeResult = Grading.grade(img.results, img);
                    updated++;
                }
            });

            CanvasManager.render();
            ImageManager.updateList();
            this.updateRightPanel();
            Toast.success(`전체 교정 확정 — ${updated}장 수험번호/채점 갱신됨`);

            // 교정 탭이 열려있으면 즉시 재렌더링
            const cv2 = document.getElementById('correction-view');
            if (cv2 && cv2.style.display !== 'none' && typeof Correction !== 'undefined') {
                Correction.render(document.getElementById('correction-content'));
            }
        }
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
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
