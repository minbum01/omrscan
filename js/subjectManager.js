// ============================================
// subjectManager.js - 과목 관리 (코드/이름/정답/배점)
// ============================================

const SubjectManager = {
    STORAGE_KEY: 'omr_subjects_v1',

    init() {
        document.getElementById('btn-subject-manager').addEventListener('click', () => this.openModal());
        this.loadFromStorage();
    },

    loadFromStorage() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) App.state.subjects = JSON.parse(raw);
        } catch (e) { console.warn('과목 불러오기 실패:', e); }
    },

    saveToStorage() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(App.state.subjects || []));
        } catch (e) { console.warn('과목 저장 실패:', e); }
    },

    findByName(name) { return (App.state.subjects || []).find(s => s.name === name); },
    findByCode(code) { return (App.state.subjects || []).find(s => s.code === code); },

    getSubjects() {
        if (!App.state.subjects) App.state.subjects = [];
        return App.state.subjects;
    },

    answersToString(arr) { return (arr || []).join(','); },
    answersToArray(str) {
        if (!str) return [];
        return str.indexOf(',') >= 0 ? str.split(',').map(s => s.trim()) : str.split('');
    },

    // ==========================================
    // 모달
    // ==========================================
    openModal() {
        const existing = document.getElementById('subject-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'subject-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:720px; max-height:90vh;">
                <div class="modal-header">
                    <h2>과목 관리</h2>
                    <p>과목별 코드, 이름, 정답, 배점을 관리합니다.</p>
                </div>
                <div class="modal-body" id="subject-list" style="overflow-y:auto; max-height:60vh;"></div>
                <div class="modal-footer">
                    <button class="btn" id="sm-add">+ 과목 추가</button>
                    <label class="btn btn-sm" style="cursor:pointer;">
                        CSV 불러오기
                        <input type="file" id="sm-csv" accept=".csv" style="display:none;">
                    </label>
                    <div style="flex:1;"></div>
                    <button class="btn" id="sm-cancel">닫기</button>
                    <button class="btn btn-primary" id="sm-save">저장</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        document.getElementById('sm-cancel').addEventListener('click', () => overlay.remove());
        document.getElementById('sm-add').addEventListener('click', () => this.addRow());
        document.getElementById('sm-save').addEventListener('click', () => this.save(overlay));
        document.getElementById('sm-csv').addEventListener('change', (e) => this.importCSV(e.target.files[0]));

        this.renderList();
    },

    // ==========================================
    // 렌더링
    // ==========================================
    renderList() {
        const list = document.getElementById('subject-list');
        if (!list) return;
        const subjects = this.getSubjects();

        if (subjects.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">
                과목이 없습니다. "과목 추가" 또는 "CSV 불러오기"를 사용하세요.
            </div>`;
            return;
        }

        let html = '';
        subjects.forEach((subj, idx) => {
            const answers = this.answersToArray(subj.answers);
            const numQ = subj.numQuestions || answers.length || 20;
            const isCustom = subj.useCustomScore || false;
            const scoreMap = subj.scoreMap || [];
            const totalScore = subj.totalScore || 100;
            const baseScore = numQ > 0 ? Math.round((totalScore / numQ) * 100) / 100 : 0;
            const useCode = subj.useCode || (subj.code !== undefined && subj.code !== '');

            // 정답 배열을 numQ에 맞춤
            while (answers.length < numQ) answers.push('');
            if (answers.length > numQ) answers.length = numQ;

            html += `
            <div class="subject-card" data-idx="${idx}" style="border:1px solid var(--border); border-radius:8px; padding:8px; margin-bottom:8px;">
                <!-- 상단: 코드/과목명/선택지/총점/문항수 -->
                <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
                    <span style="font-weight:700; font-size:14px; color:var(--blue); min-width:16px;">${idx + 1}</span>

                    <label style="display:flex; align-items:center; gap:3px; font-size:10px; cursor:pointer;">
                        <input type="checkbox" class="sm-use-code" ${useCode ? 'checked' : ''}
                            onchange="SubjectManager.toggleCode(${idx}, this.checked)">
                        <span>코드</span>
                    </label>
                    ${useCode ? `
                    <input type="text" class="subject-input sm-code" value="${subj.code || ''}"
                        style="width:45px; text-align:center; font-size:12px; padding:3px;">
                    ` : `<input type="hidden" class="sm-code" value="">`}

                    <div style="display:flex; flex-direction:column; gap:1px; flex:1;">
                        <label style="font-size:9px; color:var(--text-muted);">과목명</label>
                        <input type="text" class="subject-input sm-name" value="${subj.name || ''}"
                            style="font-size:12px; padding:3px;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:1px;">
                        <label style="font-size:9px; color:var(--text-muted);">선택지</label>
                        <input type="number" class="subject-input sm-choices" value="${subj.numChoices || 5}" min="2" max="20"
                            style="width:40px; font-size:12px; padding:3px;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:1px;">
                        <label style="font-size:9px; color:var(--text-muted);">문항수</label>
                        <input type="number" class="subject-input sm-numq" value="${numQ}" min="1" max="200"
                            style="width:50px; font-size:12px; padding:3px;"
                            onchange="SubjectManager.onNumQChange(${idx}, this.value)">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:1px;">
                        <label style="font-size:9px; color:var(--text-muted);">총점</label>
                        <input type="number" class="subject-input sm-total" value="${totalScore}" min="1" max="10000"
                            style="width:55px; font-size:12px; padding:3px;"
                            onchange="SubjectManager.onTotalChange(${idx}, this.value)">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:1px;">
                        <label style="font-size:9px; color:var(--text-muted);">기본배점</label>
                        <input type="text" class="subject-input sm-score" value="${baseScore}" readonly
                            style="width:45px; font-size:12px; padding:3px; background:var(--bg-input); color:var(--text-muted); text-align:center;">
                    </div>
                    <button class="roi-delete-btn" onclick="SubjectManager.removeRow(${idx})" title="삭제" style="align-self:center;">✕</button>
                </div>

                <!-- 정답 입력 (개별 셀) -->
                <div style="margin-bottom:4px;">
                    <span style="font-size:10px; font-weight:600;">정답 (${numQ}문항)</span>
                    <div class="sm-answers-grid" data-idx="${idx}" style="display:flex; flex-wrap:wrap; gap:2px; margin-top:3px;">
                        ${answers.map((a, i) => `
                            <div style="display:flex; flex-direction:column; align-items:center; width:28px;">
                                <span style="font-size:8px; color:var(--text-muted);">${i + 1}</span>
                                <input type="text" class="sm-ans-cell" value="${a}" maxlength="5"
                                    style="width:26px; text-align:center; padding:2px; border:1px solid var(--border); border-radius:3px; font-size:11px; font-weight:600;">
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- 차등 배점 -->
                <div style="border-top:1px solid var(--border-light); padding-top:4px;">
                    <label style="display:flex; align-items:center; gap:4px; font-size:10px; cursor:pointer;">
                        <input type="checkbox" class="sm-custom-score" ${isCustom ? 'checked' : ''}
                            onchange="SubjectManager.toggleCustomScore(${idx}, this.checked)">
                        차등 배점
                    </label>
                    ${isCustom ? `
                    <div class="sm-score-grid" data-idx="${idx}" style="display:flex; flex-wrap:wrap; gap:2px; margin-top:4px;">
                        ${answers.map((_, i) => {
                            const sc = scoreMap[i] != null ? scoreMap[i] : baseScore;
                            return `
                            <div style="display:flex; flex-direction:column; align-items:center; width:28px;">
                                <span style="font-size:8px; color:var(--text-muted);">${i + 1}</span>
                                <input type="number" class="sm-score-cell" value="${sc}" min="0" max="100" step="0.5"
                                    style="width:26px; text-align:center; padding:2px; border:1px solid var(--border); border-radius:3px; font-size:10px;"
                                    oninput="SubjectManager.updateScoreSum(${idx})">
                            </div>`;
                        }).join('')}
                    </div>
                    <div class="sm-score-status" data-idx="${idx}" style="font-size:10px; margin-top:4px;"></div>
                    ` : ''}
                </div>
            </div>`;
        });

        list.innerHTML = html;

        // 차등 배점 합계 초기 표시
        subjects.forEach((subj, idx) => {
            if (subj.useCustomScore) this.updateScoreSum(idx);
        });
    },

    // ==========================================
    // 이벤트 핸들러 (DOM 직접 조작 — 리렌더 없이)
    // ==========================================

    // 문항수 변경: 정답 셀 추가/제거 (기존 정답 유지)
    onNumQChange(idx, newVal) {
        const subj = this.getSubjects()[idx]; if (!subj) return;
        const newNumQ = Math.max(1, Math.min(200, parseInt(newVal) || 20));
        const grid = document.querySelector(`.sm-answers-grid[data-idx="${idx}"]`);
        if (!grid) return;

        // 현재 정답 값 보존
        const currentCells = grid.querySelectorAll('.sm-ans-cell');
        const currentAnswers = Array.from(currentCells).map(c => c.value);

        // 부족하면 빈 셀 추가
        while (currentAnswers.length < newNumQ) currentAnswers.push('');
        // 초과하면 자르기
        currentAnswers.length = newNumQ;

        // 그리드 재생성
        grid.innerHTML = currentAnswers.map((a, i) => `
            <div style="display:flex; flex-direction:column; align-items:center; width:28px;">
                <span style="font-size:8px; color:var(--text-muted);">${i + 1}</span>
                <input type="text" class="sm-ans-cell" value="${a}" maxlength="5"
                    style="width:26px; text-align:center; padding:2px; border:1px solid var(--border); border-radius:3px; font-size:11px; font-weight:600;">
            </div>
        `).join('');

        // 라벨 업데이트
        const label = grid.previousElementSibling;
        if (label) label.textContent = `정답 (${newNumQ}문항)`;

        // 기본배점 재계산
        this._updateBaseScore(idx);

        // 차등 배점 셀도 동기화
        const scoreGrid = document.querySelector(`.sm-score-grid[data-idx="${idx}"]`);
        if (scoreGrid) {
            const card = grid.closest('.subject-card');
            const total = parseFloat(card.querySelector('.sm-total').value) || 100;
            const base = Math.round((total / newNumQ) * 100) / 100;
            const currentScores = Array.from(scoreGrid.querySelectorAll('.sm-score-cell')).map(c => parseFloat(c.value) || 0);
            while (currentScores.length < newNumQ) currentScores.push(base);
            currentScores.length = newNumQ;

            scoreGrid.innerHTML = currentScores.map((sc, i) => `
                <div style="display:flex; flex-direction:column; align-items:center; width:28px;">
                    <span style="font-size:8px; color:var(--text-muted);">${i + 1}</span>
                    <input type="number" class="sm-score-cell" value="${sc}" min="0" max="100" step="0.5"
                        style="width:26px; text-align:center; padding:2px; border:1px solid var(--border); border-radius:3px; font-size:10px;"
                        oninput="SubjectManager.updateScoreSum(${idx})">
                </div>
            `).join('');
            this.updateScoreSum(idx);
        }
    },

    // 총점 변경: 기본배점 재계산
    onTotalChange(idx, newVal) {
        this._updateBaseScore(idx);
    },

    // 기본배점 = 총점 / 문항수 (읽기전용 자동 계산)
    _updateBaseScore(idx) {
        const card = document.querySelector(`.subject-card[data-idx="${idx}"]`);
        if (!card) return;
        const numQ = parseInt(card.querySelector('.sm-numq').value) || 1;
        const total = parseFloat(card.querySelector('.sm-total').value) || 100;
        const base = Math.round((total / numQ) * 100) / 100;
        card.querySelector('.sm-score').value = base;
    },

    // 코드 사용 여부 토글
    toggleCode(idx, checked) {
        this._saveCurrentToData();
        const subj = this.getSubjects()[idx]; if (!subj) return;
        subj.useCode = checked;
        if (!checked) subj.code = '';
        this.renderList();
    },

    // 차등 배점 토글
    toggleCustomScore(idx, checked) {
        const subj = this.getSubjects()[idx]; if (!subj) return;
        this._saveCurrentToData();
        subj.useCustomScore = checked;
        if (checked) {
            const numQ = subj.numQuestions || 20;
            const total = subj.totalScore || 100;
            const base = Math.round((total / numQ) * 100) / 100;
            subj.scoreMap = Array(numQ).fill(base);
        }
        this.renderList();
    },

    // 현재 DOM 값을 data에 임시 저장 (리렌더 전에 호출)
    _saveCurrentToData() {
        const cards = document.querySelectorAll('.subject-card');
        const subjects = this.getSubjects();
        cards.forEach((card, i) => {
            if (!subjects[i]) return;
            const s = subjects[i];
            s.code = card.querySelector('.sm-code').value.trim();
            s.name = card.querySelector('.sm-name').value.trim();
            s.numChoices = parseInt(card.querySelector('.sm-choices').value) || 5;
            s.numQuestions = parseInt(card.querySelector('.sm-numq').value) || 20;
            s.totalScore = parseFloat(card.querySelector('.sm-total').value) || 100;

            const ansCells = card.querySelectorAll('.sm-ans-cell');
            s.answers = Array.from(ansCells).map(c => c.value.trim()).join(',');

            if (s.useCustomScore) {
                const scoreCells = card.querySelectorAll('.sm-score-cell');
                s.scoreMap = Array.from(scoreCells).map(c => parseFloat(c.value) || 0);
            }
        });
    },

    updateScoreSum(idx) {
        const status = document.querySelector(`.sm-score-status[data-idx="${idx}"]`);
        if (!status) return;
        const cells = document.querySelectorAll(`.sm-score-grid[data-idx="${idx}"] .sm-score-cell`);
        let sum = 0;
        cells.forEach(c => { sum += parseFloat(c.value) || 0; });
        sum = Math.round(sum * 100) / 100;

        const card = status.closest('.subject-card');
        const expected = parseFloat(card.querySelector('.sm-total').value) || 0;

        if (expected > 0 && sum !== expected) {
            const diff = Math.round((sum - expected) * 100) / 100;
            status.innerHTML = `<span style="color:var(--red);">⚠ 배점 합계 ${sum}점 ≠ 총점 ${expected}점 (${diff > 0 ? '+' : ''}${diff}점)</span>`;
        } else if (expected > 0) {
            status.innerHTML = `<span style="color:var(--green);">✓ 배점 합계 ${sum}점 = 총점 ${expected}점</span>`;
        } else {
            status.innerHTML = `<span style="color:var(--text-muted);">배점 합계: ${sum}점</span>`;
        }
    },

    // ==========================================
    // 추가/삭제
    // ==========================================
    addRow() {
        this.getSubjects().push({
            code: '', name: '',
            numQuestions: 20, numChoices: 5,
            scorePerQuestion: 5,
            totalScore: 100,
            useCustomScore: false, scoreMap: [],
            answers: Array(20).fill('').join(',')
        });
        this.renderList();
    },

    removeRow(idx) {
        this._saveCurrentToData();
        this.getSubjects().splice(idx, 1);
        this.renderList();
    },

    // ==========================================
    // 저장
    // ==========================================
    save(overlay) {
        this._saveCurrentToData();
        const subjects = this.getSubjects();

        // 기본배점 재계산
        subjects.forEach(s => {
            const answers = this.answersToArray(s.answers);
            s.numQuestions = answers.length || s.numQuestions;
            if (!s.totalScore) s.totalScore = 100;
            s.scorePerQuestion = s.numQuestions > 0 ? Math.round((s.totalScore / s.numQuestions) * 100) / 100 : 0;
        });

        this.saveToStorage();

        // 과목코드 영역의 codeList 동기화
        App.state.images.forEach(img => {
            img.rois.forEach(roi => {
                if (roi.settings && roi.settings.type === 'subject_code') {
                    roi.settings.codeList = subjects.map(s => ({ code: s.code, name: s.name, answers: s.answers }));
                }
            });
        });

        // 연결된 ROI answerKey 갱신 + 재채점
        App.state.images.forEach(img => {
            img.rois.forEach(roi => {
                if (roi.settings && roi.settings.type === 'subject_answer' && roi.settings.name) {
                    UI._loadAnswersFromSubject(roi);
                }
            });
            if (img.results) {
                img.gradeResult = Grading.grade(img.results, img);
            }
        });

        ImageManager.updateList();
        CanvasManager.render();
        UI.updateRightPanel();
        Toast.success(`${subjects.length}개 과목 저장 완료`);
        overlay.remove();
    },

    // ==========================================
    // CSV 불러오기
    // ==========================================
    importCSV(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length === 0) { Toast.error('빈 CSV 파일입니다'); return; }

                const firstCells = this._parseCSVLine(lines[0]);
                const hasHeader = isNaN(parseInt(firstCells[0])) && firstCells[0] !== '';
                const dataLines = hasHeader ? lines.slice(1) : lines;

                let imported = 0;
                const subjects = this.getSubjects();

                dataLines.forEach(line => {
                    const cells = this._parseCSVLine(line);
                    if (cells.length < 6) return;

                    const code = cells[0].trim();
                    const name = cells[1].trim();
                    const numChoices = parseInt(cells[2]) || 5;
                    const scoreField = cells[3].trim();
                    const totalScore = parseFloat(cells[4]) || 100;
                    const isCustomScore = (scoreField === '차등');
                    const dataCells = cells.slice(5);

                    let answers, scoreMap = [];
                    if (isCustomScore) {
                        const half = Math.floor(dataCells.length / 2);
                        answers = dataCells.slice(0, half).map(c => c.trim());
                        scoreMap = dataCells.slice(half).map(c => parseFloat(c) || 0);
                    } else {
                        answers = dataCells.map(c => c.trim());
                    }

                    const numQ = answers.length;
                    const baseScore = isCustomScore ? 0 : (parseFloat(scoreField) || (numQ > 0 ? Math.round((totalScore / numQ) * 100) / 100 : 4));

                    const subj = {
                        code, name, numChoices, numQuestions: numQ,
                        scorePerQuestion: isCustomScore ? (totalScore / numQ) : baseScore,
                        totalScore,
                        useCustomScore: isCustomScore, scoreMap,
                        answers: answers.join(',')
                    };

                    const existIdx = subjects.findIndex(s => s.code && s.code === code);
                    if (existIdx >= 0) subjects[existIdx] = subj;
                    else subjects.push(subj);
                    imported++;
                });

                this.saveToStorage();
                this.renderList();
                Toast.success(`CSV에서 ${imported}개 과목 불러옴`);
            } catch (err) {
                console.error('CSV 파싱 오류:', err);
                Toast.error('CSV 파싱 실패: ' + err.message);
            }
        };
        reader.readAsText(file, 'UTF-8');
    },

    _parseCSVLine(line) {
        const result = [];
        let current = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') inQuotes = !inQuotes;
            else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
            else current += ch;
        }
        result.push(current);
        return result;
    }
};
