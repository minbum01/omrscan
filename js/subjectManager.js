// ============================================
// subjectManager.js - 과목 관리 (코드/이름/정답)
// ============================================

const SubjectManager = {
    init() {
        document.getElementById('btn-subject-manager').addEventListener('click', () => this.openModal());
    },

    // 과목 목록은 App.state에 저장
    getSubjects() {
        if (!App.state.subjects) App.state.subjects = [];
        return App.state.subjects;
    },

    openModal() {
        const existing = document.getElementById('subject-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'subject-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:640px; max-height:85vh;">
                <div class="modal-header">
                    <h2>과목 관리</h2>
                    <p>과목별 코드, 이름, 정답을 관리합니다.</p>
                </div>
                <div class="modal-body" id="subject-list" style="overflow-y:auto;"></div>
                <div class="modal-footer">
                    <button class="btn" id="sm-add">+ 과목 추가</button>
                    <div style="flex:1;"></div>
                    <button class="btn" id="sm-cancel">닫기</button>
                    <button class="btn btn-primary" id="sm-save">저장</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('sm-cancel').addEventListener('click', () => overlay.remove());
        document.getElementById('sm-add').addEventListener('click', () => this.addRow());
        document.getElementById('sm-save').addEventListener('click', () => this.save(overlay));

        this.renderList();
    },

    renderList() {
        const list = document.getElementById('subject-list');
        const subjects = this.getSubjects();

        if (subjects.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">
                과목이 없습니다. "과목 추가" 버튼을 눌러주세요.
            </div>`;
            return;
        }

        let html = '';
        subjects.forEach((subj, idx) => {
            html += `
            <div class="subject-card" data-idx="${idx}">
                <div class="subject-card-header">
                    <span class="subject-card-num">${idx + 1}</span>
                    <div class="subject-card-fields">
                        <div class="subject-field">
                            <label>코드</label>
                            <input type="text" class="subject-input sm-code" value="${subj.code || ''}" placeholder="1" style="width:50px; text-align:center;">
                        </div>
                        <div class="subject-field" style="flex:1;">
                            <label>과목명</label>
                            <input type="text" class="subject-input sm-name" value="${subj.name || ''}" placeholder="경찰학">
                        </div>
                        <div class="subject-field">
                            <label>문항수</label>
                            <input type="number" class="subject-input sm-count" value="${subj.numQuestions || 20}" min="1" max="100" style="width:60px;">
                        </div>
                        <div class="subject-field">
                            <label>배점</label>
                            <input type="number" class="subject-input sm-score" value="${subj.scorePerQuestion || 5}" min="1" max="100" style="width:50px;">
                        </div>
                    </div>
                    <button class="roi-delete-btn" onclick="SubjectManager.removeRow(${idx})" title="삭제">✕</button>
                </div>
                <div class="subject-answer-row">
                    <label>정답</label>
                    <input type="text" class="subject-input sm-answers" value="${subj.answers || ''}" placeholder="31423142... (숫자 연속 입력)"
                        style="flex:1; font-family:monospace; letter-spacing:2px; font-size:14px; font-weight:600;">
                    <span class="subject-answer-count">${(subj.answers || '').length}/${subj.numQuestions || 20}</span>
                </div>
            </div>`;
        });

        list.innerHTML = html;

        // 정답 입력 시 실시간 카운트 갱신
        list.querySelectorAll('.sm-answers').forEach(input => {
            input.addEventListener('input', (e) => {
                const card = e.target.closest('.subject-card');
                const count = card.querySelector('.sm-count').value || 20;
                card.querySelector('.subject-answer-count').textContent = `${e.target.value.length}/${count}`;
            });
        });
    },

    addRow() {
        this.getSubjects().push({
            code: String(this.getSubjects().length + 1),
            name: '',
            numQuestions: 20,
            scorePerQuestion: 5,
            answers: ''
        });
        this.renderList();
    },

    removeRow(idx) {
        this.getSubjects().splice(idx, 1);
        this.renderList();
    },

    save(overlay) {
        const cards = document.querySelectorAll('.subject-card');
        const subjects = [];

        cards.forEach(card => {
            subjects.push({
                code: card.querySelector('.sm-code').value.trim(),
                name: card.querySelector('.sm-name').value.trim(),
                numQuestions: parseInt(card.querySelector('.sm-count').value) || 20,
                scorePerQuestion: parseInt(card.querySelector('.sm-score').value) || 5,
                answers: card.querySelector('.sm-answers').value.trim()
            });
        });

        App.state.subjects = subjects;

        // 과목코드 영역의 codeList도 동기화
        App.state.images.forEach(img => {
            img.rois.forEach(roi => {
                if (roi.settings && roi.settings.type === 'subject_code') {
                    roi.settings.codeList = subjects.map(s => ({
                        code: s.code,
                        name: s.name,
                        answers: s.answers
                    }));
                }
            });
        });

        // 재채점
        App.state.images.forEach(img => {
            if (img.results) {
                img.gradeResult = Grading.grade(img.results, img);
            }
        });

        ImageManager.updateList();
        CanvasManager.render();
        UI.updateRightPanel();
        Toast.success(`${subjects.length}개 과목 저장 완료`);
        overlay.remove();
    }
};
