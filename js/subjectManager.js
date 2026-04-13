// ============================================
// subjectManager.js - 과목 관리 (코드/이름/정답/배점)
// 중앙 저장소: App.state.subjects + localStorage
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

    findByName(name) {
        return (App.state.subjects || []).find(s => s.name === name);
    },

    findByCode(code) {
        return (App.state.subjects || []).find(s => s.code === code);
    },

    getSubjects() {
        if (!App.state.subjects) App.state.subjects = [];
        return App.state.subjects;
    },

    // 정답 배열 → 쉼표 문자열
    answersToString(arr) {
        return (arr || []).join(',');
    },

    // 쉼표 문자열 → 정답 배열
    answersToArray(str) {
        if (!str) return [];
        return str.indexOf(',') >= 0
            ? str.split(',').map(s => s.trim())
            : str.split('');
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
            const numQ = answers.length || subj.numQuestions || 20;
            const isCustom = subj.useCustomScore || false;
            const scoreMap = subj.scoreMap || [];
            const totalExpected = subj.totalScore || (numQ * (subj.scorePerQuestion || 4));

            // 배점 합계 계산
            let scoreSum = 0;
            if (isCustom && scoreMap.length > 0) {
                scoreSum = scoreMap.reduce((s, v) => s + (parseFloat(v) || 0), 0);
            } else {
                scoreSum = numQ * (subj.scorePerQuestion || 4);
            }

            html += `
            <div class="subject-card" data-idx="${idx}" style="border:1px solid var(--border); border-radius:8px; padding:8px; margin-bottom:8px;">
                <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
                    <span style="font-weight:700; font-size:14px; color:var(--blue);">${idx + 1}</span>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <label style="font-size:9px; color:var(--text-muted);">코드</label>
                        <input type="text" class="subject-input sm-code" value="${subj.code || ''}" placeholder="01" style="width:45px; text-align:center; font-size:12px; padding:3px;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px; flex:1;">
                        <label style="font-size:9px; color:var(--text-muted);">과목명</label>
                        <input type="text" class="subject-input sm-name" value="${subj.name || ''}" placeholder="국어" style="font-size:12px; padding:3px;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <label style="font-size:9px; color:var(--text-muted);">선택지</label>
                        <input type="number" class="subject-input sm-choices" value="${subj.numChoices || 5}" min="2" max="20" style="width:40px; font-size:12px; padding:3px;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <label style="font-size:9px; color:var(--text-muted);">기본배점</label>
                        <input type="number" class="subject-input sm-score" value="${subj.scorePerQuestion || 4}" min="1" max="100" step="0.5" style="width:45px; font-size:12px; padding:3px;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <label style="font-size:9px; color:var(--text-muted);">총점</label>
                        <input type="number" class="subject-input sm-total" value="${subj.totalScore || ''}" placeholder="${scoreSum}" min="1" max="1000" style="width:50px; font-size:12px; padding:3px;">
                    </div>
                    <button class="roi-delete-btn" onclick="SubjectManager.removeRow(${idx})" title="삭제" style="align-self:center;">✕</button>
                </div>

                <!-- 정답 입력 (개별 셀) -->
                <div style="margin-bottom:4px;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                        <span style="font-size:10px; font-weight:600;">정답 (${answers.length}문항)</span>
                        <button class="btn btn-sm" style="font-size:9px; padding:1px 6px;" onclick="SubjectManager.addAnswerCells(${idx}, 5)">+5문항</button>
                        <button class="btn btn-sm" style="font-size:9px; padding:1px 6px;" onclick="SubjectManager.removeAnswerCells(${idx}, 5)">-5문항</button>
                    </div>
                    <div class="sm-answers-grid" data-idx="${idx}" style="display:flex; flex-wrap:wrap; gap:2px;">
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
                            const sc = scoreMap[i] != null ? scoreMap[i] : (subj.scorePerQuestion || 4);
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

    addRow() {
        this.getSubjects().push({
            code: '',
            name: '',
            numQuestions: 20,
            numChoices: 5,
            scorePerQuestion: 4,
            totalScore: 80,
            useCustomScore: false,
            scoreMap: [],
            answers: Array(20).fill('').join(',')
        });
        this.renderList();
    },

    removeRow(idx) {
        this.getSubjects().splice(idx, 1);
        this.renderList();
    },

    addAnswerCells(idx, count) {
        const subj = this.getSubjects()[idx]; if (!subj) return;
        const arr = this.answersToArray(subj.answers);
        for (let i = 0; i < count; i++) arr.push('');
        subj.answers = this.answersToString(arr);
        subj.numQuestions = arr.length;
        if (subj.useCustomScore) {
            if (!subj.scoreMap) subj.scoreMap = [];
            while (subj.scoreMap.length < arr.length) subj.scoreMap.push(subj.scorePerQuestion || 4);
        }
        this.renderList();
    },

    removeAnswerCells(idx, count) {
        const subj = this.getSubjects()[idx]; if (!subj) return;
        const arr = this.answersToArray(subj.answers);
        if (arr.length <= count) return;
        arr.length = arr.length - count;
        subj.answers = this.answersToString(arr);
        subj.numQuestions = arr.length;
        if (subj.scoreMap) subj.scoreMap.length = arr.length;
        this.renderList();
    },

    toggleCustomScore(idx, checked) {
        const subj = this.getSubjects()[idx]; if (!subj) return;
        subj.useCustomScore = checked;
        if (checked) {
            const numQ = this.answersToArray(subj.answers).length || subj.numQuestions || 20;
            const base = subj.scorePerQuestion || 4;
            subj.scoreMap = Array(numQ).fill(base);
            if (!subj.totalScore) subj.totalScore = numQ * base;
        }
        this.renderList();
    },

    updateScoreSum(idx) {
        const status = document.querySelector(`.sm-score-status[data-idx="${idx}"]`);
        if (!status) return;
        const cells = document.querySelectorAll(`.sm-score-grid[data-idx="${idx}"] .sm-score-cell`);
        let sum = 0;
        cells.forEach(c => { sum += parseFloat(c.value) || 0; });

        const card = status.closest('.subject-card');
        const totalInput = card ? card.querySelector('.sm-total') : null;
        const expected = totalInput ? (parseFloat(totalInput.value) || 0) : 0;

        if (expected > 0 && sum !== expected) {
            const diff = sum - expected;
            status.innerHTML = `<span style="color:var(--red);">⚠ 배점 합계 ${sum}점 ≠ 총점 ${expected}점 (${diff > 0 ? '+' : ''}${diff}점)</span>`;
        } else if (expected > 0) {
            status.innerHTML = `<span style="color:var(--green);">✓ 배점 합계 ${sum}점 = 총점 ${expected}점</span>`;
        } else {
            status.innerHTML = `<span style="color:var(--text-muted);">배점 합계: ${sum}점 (총점을 입력하면 검증됩니다)</span>`;
        }
    },

    // ==========================================
    // 저장
    // ==========================================
    save(overlay) {
        const cards = document.querySelectorAll('.subject-card');
        const subjects = [];

        cards.forEach(card => {
            const idx = parseInt(card.dataset.idx);
            const ansCells = card.querySelectorAll('.sm-ans-cell');
            const answers = Array.from(ansCells).map(c => c.value.trim());
            const isCustom = card.querySelector('.sm-custom-score').checked;

            let scoreMap = [];
            if (isCustom) {
                const scoreCells = card.querySelectorAll('.sm-score-cell');
                scoreMap = Array.from(scoreCells).map(c => parseFloat(c.value) || 0);
            }

            subjects.push({
                code: card.querySelector('.sm-code').value.trim(),
                name: card.querySelector('.sm-name').value.trim(),
                numQuestions: answers.length,
                numChoices: parseInt(card.querySelector('.sm-choices').value) || 5,
                scorePerQuestion: parseFloat(card.querySelector('.sm-score').value) || 4,
                totalScore: parseFloat(card.querySelector('.sm-total').value) || 0,
                useCustomScore: isCustom,
                scoreMap: scoreMap,
                answers: answers.join(',')
            });
        });

        App.state.subjects = subjects;
        this.saveToStorage();

        // 과목코드 영역의 codeList 동기화
        App.state.images.forEach(img => {
            img.rois.forEach(roi => {
                if (roi.settings && roi.settings.type === 'subject_code') {
                    roi.settings.codeList = subjects.map(s => ({
                        code: s.code, name: s.name, answers: s.answers
                    }));
                }
            });
        });

        // 연결된 ROI의 answerKey 갱신 + 재채점
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

                // 첫 행이 헤더인지 판단 (첫 셀이 숫자가 아니면 헤더)
                const firstCells = this._parseCSVLine(lines[0]);
                const hasHeader = isNaN(parseInt(firstCells[0])) && firstCells[0] !== '';
                const dataLines = hasHeader ? lines.slice(1) : lines;

                let imported = 0;
                const subjects = this.getSubjects();

                dataLines.forEach(line => {
                    const cells = this._parseCSVLine(line);
                    if (cells.length < 6) return; // 최소: 코드, 이름, 선택지, 배점, 총점, 1번답

                    const code = cells[0].trim();
                    const name = cells[1].trim();
                    const numChoices = parseInt(cells[2]) || 5;
                    const scoreField = cells[3].trim();
                    const totalScore = parseFloat(cells[4]) || 0;

                    const isCustomScore = (scoreField === '차등');
                    const baseScore = isCustomScore ? 0 : (parseFloat(scoreField) || 4);

                    // 5번째 셀 이후 = 정답 (+ 차등이면 배점)
                    const dataCells = cells.slice(5);

                    let answers, scoreMap = [];
                    if (isCustomScore) {
                        // 전반부: 정답, 후반부: 배점
                        const half = Math.floor(dataCells.length / 2);
                        answers = dataCells.slice(0, half).map(c => c.trim());
                        scoreMap = dataCells.slice(half).map(c => parseFloat(c) || 0);
                    } else {
                        answers = dataCells.map(c => c.trim());
                    }

                    const subj = {
                        code, name, numChoices,
                        numQuestions: answers.length,
                        scorePerQuestion: isCustomScore ? (scoreMap[0] || 4) : baseScore,
                        totalScore,
                        useCustomScore: isCustomScore,
                        scoreMap,
                        answers: answers.join(',')
                    };

                    // 같은 코드가 있으면 덮어쓰기
                    const existIdx = subjects.findIndex(s => s.code && s.code === code);
                    if (existIdx >= 0) {
                        subjects[existIdx] = subj;
                    } else {
                        subjects.push(subj);
                    }
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

    // CSV 한 줄 파싱 (큰따옴표 처리)
    _parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }
};
