// ============================================
// subjectManager.js - 시험 관리 (과목/정답/배점/시험인원)
// ============================================

const SubjectManager = {
    STORAGE_KEY: 'omr_subjects_v1',

    init() {
        document.getElementById('btn-subject-manager').addEventListener('click', () => this.openModal());
        this.loadFromStorage();
        this.loadStudents();
    },

    loadFromStorage() {
        // 세션 시스템이 관리하므로 별도 로드 불필요 (세션에서 subjects 복원)
        // 하위 호환: 세션 없으면 기존 키에서 로드
        if (!App.state.subjects || App.state.subjects.length === 0) {
            try {
                const raw = localStorage.getItem(this.STORAGE_KEY);
                if (raw) App.state.subjects = JSON.parse(raw);
            } catch (e) { console.warn('과목 불러오기 실패:', e); }
        }
    },

    saveToStorage() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(App.state.subjects || []));
        } catch (e) { console.warn('과목 저장 실패:', e); }
        // 세션에 변경 알림
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
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
        const activeTab = this._activeTab || 'subjects';
        overlay.innerHTML = `
            <div class="modal" style="width:720px; max-height:90vh;">
                <div class="modal-header">
                    <h2>시험 관리</h2>
                    <div style="display:flex; gap:4px; margin-top:6px;">
                        <button class="btn btn-sm ${activeTab === 'subjects' ? 'btn-primary' : ''}" onclick="SubjectManager.switchTab('subjects')">과목/정답</button>
                        <button class="btn btn-sm ${activeTab === 'students' ? 'btn-primary' : ''}" onclick="SubjectManager.switchTab('students')">시험 인원</button>
                    </div>
                </div>
                <div class="modal-body" style="overflow-y:auto; max-height:60vh;">
                    <div id="subject-list" style="display:${activeTab === 'subjects' ? 'block' : 'none'};"></div>
                    <div id="student-list" style="display:${activeTab === 'students' ? 'block' : 'none'};"></div>
                </div>
                <div class="modal-footer" id="sm-footer"></div>
            </div>
        `;

        document.body.appendChild(overlay);
        this._renderFooter(activeTab, overlay);

        if (activeTab === 'subjects') this.renderList();
        else this.renderStudentList();
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
        this._saveCurrentToData();
        const subj = this.getSubjects()[idx]; if (!subj) return;
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
        this._saveCurrentToData();
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
                const allLines = text.split('\n').map(l => l.trim());
                // 21행 이전은 설명 영역 → 스킵, 빈 줄/주석도 스킵
                const lines = allLines.slice(20).filter(l => l && !l.startsWith('#') && !l.startsWith('='));
                if (lines.length === 0) {
                    // 20행 이하 파일이면 전체에서 데이터 행 찾기 (하위호환)
                    const fallback = allLines.filter(l => l && !l.startsWith('#') && !l.startsWith('=') && l.indexOf(',') >= 0);
                    if (fallback.length === 0) { Toast.error('데이터가 없습니다. 21행부터 입력하세요.'); return; }
                    lines.push(...fallback);
                }

                const firstCells = this._parseCSVLine(lines[0]);
                const hasHeader = isNaN(parseInt(firstCells[0])) && firstCells[0] !== '' && /[가-힣a-zA-Z]/.test(firstCells[0]);
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
    },

    // ==========================================
    // 탭 전환
    // ==========================================
    _activeTab: 'subjects',

    switchTab(tab) {
        this._activeTab = tab;
        const subjDiv = document.getElementById('subject-list');
        const studDiv = document.getElementById('student-list');
        if (subjDiv) subjDiv.style.display = tab === 'subjects' ? 'block' : 'none';
        if (studDiv) studDiv.style.display = tab === 'students' ? 'block' : 'none';

        // 버튼 활성화
        const overlay = document.getElementById('subject-modal');
        if (overlay) {
            overlay.querySelectorAll('.modal-header .btn-sm').forEach(btn => {
                btn.classList.toggle('btn-primary', btn.textContent.includes(tab === 'subjects' ? '과목' : '시험 인원'));
            });
        }
        this._renderFooter(tab, overlay);
        if (tab === 'students') this.renderStudentList();
    },

    _renderFooter(tab, overlay) {
        const footer = document.getElementById('sm-footer');
        if (!footer) return;

        if (tab === 'subjects') {
            footer.innerHTML = `
                <button class="btn" id="sm-add">+ 과목 추가</button>
                <label class="btn btn-sm" style="cursor:pointer;">CSV 불러오기<input type="file" id="sm-csv" accept=".csv" style="display:none;"></label>
                <button class="btn btn-sm" onclick="SubjectManager.downloadCSVTemplate()">CSV 양식</button>
                <div style="flex:1;"></div>
                <button class="btn" onclick="document.getElementById('subject-modal').remove()">닫기</button>
                <button class="btn btn-primary" id="sm-save">저장</button>
            `;
            document.getElementById('sm-add').addEventListener('click', () => this.addRow());
            document.getElementById('sm-save').addEventListener('click', () => this.save(overlay));
            document.getElementById('sm-csv').addEventListener('change', (e) => this.importCSV(e.target.files[0]));
        } else {
            footer.innerHTML = `
                <button class="btn" onclick="SubjectManager.addStudent()">+ 인원 추가</button>
                <label class="btn btn-sm" style="cursor:pointer;">CSV 불러오기<input type="file" id="sm-student-csv" accept=".csv" style="display:none;"></label>
                <button class="btn btn-sm" onclick="SubjectManager.downloadStudentCSVTemplate()">CSV 양식</button>
                <div style="flex:1;"></div>
                <button class="btn" onclick="document.getElementById('subject-modal').remove()">닫기</button>
                <button class="btn btn-primary" onclick="SubjectManager.saveStudents()">저장</button>
            `;
            const csvInput = document.getElementById('sm-student-csv');
            if (csvInput) csvInput.addEventListener('change', (e) => this.importStudentCSV(e.target.files[0]));
        }
    },

    // ==========================================
    // CSV 양식 다운로드 (과목)
    // ==========================================
    downloadCSVTemplate() {
        const lines = [
            '========================================',
            '과목/정답 CSV 양식',
            '========================================',
            '',
            '[열 순서]',
            '과목코드  과목명  선택지수  배점  총점  1번답  2번답  ...',
            '',
            '[배점]',
            '숫자(예:4) = 일괄배점',
            '차등 = 정답 뒤에 문항별 배점이 이어짐',
            '',
            '[참고]',
            '- 과목별 문항수가 달라도 됨 (열 수가 달라도 자동 처리)',
            '- 헤더 행은 불필요 (21행부터 바로 데이터 입력)',
            '- 이 설명 영역(1~20행)은 자동으로 무시됩니다',
            '',
            '=== 일괄배점 예시 (20문항) ===',
            '01,국어,5,5,100,1,2,3,4,5,1,2,3,4,5,1,2,3,4,5,1,2,3,4,5',
            '=== 차등배점 예시 (10문항: 정답10개+배점10개) ===',
            '03,수학,5,차등,100,1,2,3,4,5,1,2,3,4,5,8,8,8,8,8,12,12,12,12,12',
            '========= 21행부터 입력하세요 =========',
        ];
        this._downloadFile(lines.join('\n'), '과목_CSV_양식.csv');
    },

    // ==========================================
    // 시험 인원 관리
    // ==========================================
    getStudents() {
        if (!App.state.students) App.state.students = [];
        return App.state.students;
    },

    // 매칭에 사용할 필드 (사용자 선택)
    getMatchFields() {
        if (!App.state.matchFields) App.state.matchFields = { name: true, birth: false, examNo: false, phone: false };
        return App.state.matchFields;
    },

    renderStudentList() {
        const list = document.getElementById('student-list');
        if (!list) return;
        const students = this.getStudents();
        const mf = this.getMatchFields();

        // 매칭 필드 선택 UI
        let matchHtml = `<div style="padding:6px 8px; margin-bottom:8px; background:var(--bg-input); border-radius:6px;">
            <span style="font-size:11px; font-weight:600;">OMR 매칭 기준 (체크한 항목으로 학생 식별)</span>
            <div style="display:flex; gap:12px; margin-top:4px;">
                <label style="font-size:11px; cursor:pointer;"><input type="checkbox" class="mf-check" data-field="name" ${mf.name ? 'checked' : ''}> 이름</label>
                <label style="font-size:11px; cursor:pointer;"><input type="checkbox" class="mf-check" data-field="birth" ${mf.birth ? 'checked' : ''}> 생년월일</label>
                <label style="font-size:11px; cursor:pointer;"><input type="checkbox" class="mf-check" data-field="examNo" ${mf.examNo ? 'checked' : ''}> 수험번호</label>
                <label style="font-size:11px; cursor:pointer;"><input type="checkbox" class="mf-check" data-field="phone" ${mf.phone ? 'checked' : ''}> 핸드폰</label>
            </div>
        </div>`;

        if (students.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">
                시험 인원이 없습니다. "인원 추가" 또는 "CSV 불러오기"를 사용하세요.
            </div>`;
            return;
        }

        let html = `<table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead><tr style="background:var(--bg-input);">
                <th style="padding:4px 6px; text-align:center; width:30px;">#</th>
                <th style="padding:4px 6px;">이름</th>
                <th style="padding:4px 6px;">생년월일</th>
                <th style="padding:4px 6px;">수험번호</th>
                <th style="padding:4px 6px;">핸드폰</th>
                <th style="padding:4px 6px; width:30px;"></th>
            </tr></thead><tbody>`;

        students.forEach((st, idx) => {
            html += `<tr style="border-bottom:1px solid var(--border-light);">
                <td style="padding:3px 6px; text-align:center; color:var(--text-muted);">${idx + 1}</td>
                <td><input type="text" class="st-name" value="${st.name || ''}" style="width:100%; border:none; padding:3px; font-size:12px;"></td>
                <td><input type="text" class="st-birth" value="${st.birth || ''}" placeholder="YYMMDD" style="width:100%; border:none; padding:3px; font-size:12px; font-family:monospace;"></td>
                <td><input type="text" class="st-examno" value="${st.examNo || ''}" style="width:100%; border:none; padding:3px; font-size:12px; font-family:monospace;"></td>
                <td><input type="text" class="st-phone" value="${st.phone || ''}" placeholder="01012345678" style="width:100%; border:none; padding:3px; font-size:12px; font-family:monospace;"></td>
                <td><button class="roi-delete-btn" onclick="SubjectManager.removeStudent(${idx})" style="font-size:10px;">✕</button></td>
            </tr>`;
        });

        html += `</tbody></table>
            <div style="text-align:right; margin-top:4px; font-size:11px; color:var(--text-muted);">총 ${students.length}명</div>`;
        list.innerHTML = matchHtml + html;

        // 매칭 필드 체크박스 이벤트
        list.querySelectorAll('.mf-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const mf = this.getMatchFields();
                mf[cb.dataset.field] = cb.checked;
            });
        });
    },

    addStudent() {
        this._saveStudentsFromDOM();
        this.getStudents().push({ name: '', birth: '', examNo: '', phone: '' });
        this.renderStudentList();
    },

    removeStudent(idx) {
        this._saveStudentsFromDOM();
        this.getStudents().splice(idx, 1);
        this.renderStudentList();
    },

    _saveStudentsFromDOM() {
        const rows = document.querySelectorAll('#student-list tbody tr');
        const students = [];
        rows.forEach(row => {
            students.push({
                name: (row.querySelector('.st-name') || {}).value || '',
                birth: (row.querySelector('.st-birth') || {}).value || '',
                examNo: (row.querySelector('.st-examno') || {}).value || '',
                phone: (row.querySelector('.st-phone') || {}).value || '',
            });
        });
        App.state.students = students;
    },

    saveStudents() {
        this._saveStudentsFromDOM();
        // 생년월일/핸드폰 앞자리 0 보존 처리
        (App.state.students || []).forEach(st => {
            st.birth = this._normalizeField(st.birth, 'birth');
            st.phone = this._normalizeField(st.phone, 'phone');
            st.examNo = this._normalizeField(st.examNo, 'examNo');
        });
        try {
            localStorage.setItem('omr_students_v1', JSON.stringify(App.state.students));
            localStorage.setItem('omr_match_fields_v1', JSON.stringify(App.state.matchFields));
        } catch (e) { console.warn('인원 저장 실패:', e); }
        Toast.success(`${App.state.students.length}명 인원 저장 완료`);
    },

    loadStudents() {
        try {
            const raw = localStorage.getItem('omr_students_v1');
            if (raw) App.state.students = JSON.parse(raw);
            const mf = localStorage.getItem('omr_match_fields_v1');
            if (mf) App.state.matchFields = JSON.parse(mf);
        } catch (e) { console.warn('인원 불러오기 실패:', e); }
    },

    // 숫자 앞자리 0 보존 (생년월일 6자리, 핸드폰 11자리)
    _normalizeField(value, type) {
        if (!value) return '';
        let v = String(value).trim().replace(/[^0-9]/g, ''); // 숫자만 추출
        if (type === 'birth' && v.length > 0) {
            while (v.length < 6) v = '0' + v; // 6자리 맞춤 (010101)
            return v.substring(0, 6);
        }
        if (type === 'phone' && v.length > 0) {
            if (v.length === 10 && !v.startsWith('0')) v = '0' + v; // 1012345678 → 01012345678
            while (v.length < 11 && v.startsWith('010')) v = v; // 이미 올바른 형태
            return v;
        }
        if (type === 'examNo') {
            return String(value).trim(); // 수험번호는 원본 유지 (문자 포함 가능)
        }
        return String(value).trim();
    },

    // 시험 인원 CSV 양식 다운로드
    downloadStudentCSVTemplate() {
        const lines = [
            '========================================',
            '시험 인원 CSV 양식',
            '========================================',
            '',
            '[열 순서]',
            '이름  생년월일  수험번호  핸드폰번호',
            '',
            '[참고]',
            '- 모든 열을 채우지 않아도 됨 (필요한 것만 입력)',
            '- 생년월일/핸드폰번호 앞자리 0은 자동 보존됨',
            '- 헤더 행은 불필요 (21행부터 바로 데이터 입력)',
            '- 이 설명 영역(1~20행)은 자동으로 무시됩니다',
            '',
            '=== 예시 ===',
            '홍길동,010101,20260001,01012345678',
            '김철수,020202,,01098765432',
            '이영희,030303,20260003,',
            '',
            '',
            '',
            '========= 21행부터 입력하세요 =========',
        ];
        this._downloadFile(lines.join('\n'), '시험인원_CSV_양식.csv');
    },

    // 시험 인원 CSV 불러오기
    importStudentCSV(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const allLines = e.target.result.split('\n').map(l => l.trim());
                // 21행 이전 스킵
                let lines = allLines.slice(20).filter(l => l && !l.startsWith('#') && !l.startsWith('='));
                if (lines.length === 0) {
                    lines = allLines.filter(l => l && !l.startsWith('#') && !l.startsWith('=') && l.indexOf(',') >= 0);
                    if (lines.length === 0) { Toast.error('데이터가 없습니다. 21행부터 입력하세요.'); return; }
                }
                const first = this._parseCSVLine(lines[0]);
                const hasHeader = /[가-힣a-zA-Z]/.test(first[0]) && isNaN(parseInt(first[0]));
                const dataLines = hasHeader ? lines.slice(1) : lines;
                const students = this.getStudents();
                let imported = 0;
                dataLines.forEach(line => {
                    const cells = this._parseCSVLine(line);
                    if (cells.length < 1 || !cells[0].trim()) return;
                    students.push({
                        name: (cells[0] || '').trim(),
                        birth: this._normalizeField(cells[1], 'birth'),
                        examNo: this._normalizeField(cells[2], 'examNo'),
                        phone: this._normalizeField(cells[3], 'phone'),
                    });
                    imported++;
                });
                this.renderStudentList();
                Toast.success(`CSV에서 ${imported}명 불러옴`);
            } catch (err) {
                Toast.error('CSV 파싱 실패: ' + err.message);
            }
        };
        reader.readAsText(file, 'UTF-8');
    },

    // 파일 다운로드 헬퍼
    _downloadFile(content, filename) {
        const bom = '\uFEFF'; // UTF-8 BOM (엑셀 한글 호환)
        const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
