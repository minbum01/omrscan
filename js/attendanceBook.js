// ============================================
// attendanceBook.js - 출석부(반/선생님별 인원 명단) 영속 저장소
// ============================================
// 시험을 새로 만들 때마다 같은 반의 인원을 다시 입력하지 않도록
// 학생 명단 + 매칭필드 묶음을 이름으로 저장하고 불러오기

const AttendanceBook = {
    STORAGE_KEY: 'omr_attendance_books_v1',

    // ---------- Store ----------
    list() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            console.warn('출석부 불러오기 실패:', e);
            return [];
        }
    },

    get(id) {
        return this.list().find(b => b.id === id) || null;
    },

    _write(books) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(books));
            return true;
        } catch (e) {
            Toast.error('출석부 저장 실패: ' + e.message);
            return false;
        }
    },

    _newId() {
        return 'ab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    },

    _cloneStudents(students) {
        return (students || []).map(s => ({
            name: s.name || '',
            birth: s.birth || '',
            examNo: s.examNo || '',
            phone: s.phone || '',
        }));
    },

    _cloneMatchFields(mf) {
        return {
            name: !!(mf && mf.name),
            birth: !!(mf && mf.birth),
            examNo: !!(mf && mf.examNo),
            phone: !!(mf && mf.phone),
            _noMatch: !!(mf && mf._noMatch),
        };
    },

    create(name, students, matchFields) {
        const trimmed = (name || '').trim();
        if (!trimmed) { Toast.error('출석부 이름을 입력하세요'); return null; }
        const books = this.list();
        if (books.some(b => b.name === trimmed)) {
            Toast.error(`"${trimmed}" 이름의 출석부가 이미 존재합니다`);
            return null;
        }
        const now = new Date().toISOString();
        const book = {
            id: this._newId(),
            name: trimmed,
            students: this._cloneStudents(students),
            matchFields: this._cloneMatchFields(matchFields),
            createdAt: now,
            updatedAt: now,
        };
        books.push(book);
        if (!this._write(books)) return null;
        return book;
    },

    update(id, students, matchFields) {
        const books = this.list();
        const idx = books.findIndex(b => b.id === id);
        if (idx < 0) { Toast.error('출석부를 찾을 수 없습니다'); return null; }
        books[idx].students = this._cloneStudents(students);
        books[idx].matchFields = this._cloneMatchFields(matchFields);
        books[idx].updatedAt = new Date().toISOString();
        if (!this._write(books)) return null;
        return books[idx];
    },

    rename(id, newName) {
        const trimmed = (newName || '').trim();
        if (!trimmed) { Toast.error('이름을 입력하세요'); return false; }
        const books = this.list();
        if (books.some(b => b.id !== id && b.name === trimmed)) {
            Toast.error(`"${trimmed}" 이름의 출석부가 이미 존재합니다`);
            return false;
        }
        const idx = books.findIndex(b => b.id === id);
        if (idx < 0) return false;
        books[idx].name = trimmed;
        books[idx].updatedAt = new Date().toISOString();
        return this._write(books);
    },

    delete(id) {
        const books = this.list().filter(b => b.id !== id);
        return this._write(books);
    },

    // ---------- 현재 시험에 적용 ----------
    loadIntoCurrent(id) {
        const book = this.get(id);
        if (!book) { Toast.error('출석부를 찾을 수 없습니다'); return false; }
        App.state.students = this._cloneStudents(book.students).map(s => ({ ...s, _source: 'attendance' }));
        App.state.matchFields = this._cloneMatchFields(book.matchFields);
        if (typeof SessionManager !== 'undefined') SessionManager._hasUnsavedChanges = true;
        Toast.success(`출석부 "${book.name}" 불러옴 (${book.students.length}명)`);
        return true;
    },

    // ---------- UI: 관리 모달 ----------
    openManageModal() {
        const existing = document.getElementById('attendance-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'attendance-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:640px; max-height:80vh;">
                <div class="modal-header">
                    <h2>출석부 관리</h2>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                        선생님/반별로 인원 명단을 저장해두고 시험마다 불러올 수 있습니다.
                    </div>
                </div>
                <div class="modal-body" style="overflow-y:auto; max-height:55vh;">
                    <div id="attendance-list-body"></div>
                </div>
                <div class="modal-footer" style="flex-direction:column; align-items:stretch; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <input type="text" id="ab-new-name" placeholder="새 출석부 이름 (예: 강남 주중반)"
                            style="flex:1; padding:6px 10px; font-size:13px; border:1px solid var(--border); border-radius:6px;">
                        <button class="btn btn-primary btn-sm" onclick="AttendanceBook._saveCurrentAsNew()">
                            현재 인원을 새 출석부로 저장
                        </button>
                    </div>
                    <div style="display:flex; justify-content:flex-end;">
                        <button class="btn" onclick="document.getElementById('attendance-modal').remove()">닫기</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this._renderList();
    },

    _renderList() {
        const body = document.getElementById('attendance-list-body');
        if (!body) return;
        const books = this.list().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

        if (books.length === 0) {
            body.innerHTML = `<div style="text-align:center; padding:32px 16px; color:var(--text-muted); font-size:13px;">
                저장된 출석부가 없습니다.<br>
                <span style="font-size:12px;">아래 입력란에 이름을 적고 "현재 인원을 새 출석부로 저장"을 눌러주세요.</span>
            </div>`;
            return;
        }

        let html = `<table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead><tr style="background:var(--bg-input); border-bottom:1px solid var(--border);">
                <th style="padding:8px 10px; text-align:left;">이름</th>
                <th style="padding:8px 10px; text-align:center; width:70px;">인원</th>
                <th style="padding:8px 10px; text-align:center; width:110px;">마지막 수정</th>
                <th style="padding:8px 10px; text-align:right; width:220px;">작업</th>
            </tr></thead><tbody>`;

        books.forEach(b => {
            const dateStr = b.updatedAt ? b.updatedAt.slice(0, 10) : '-';
            html += `<tr style="border-bottom:1px solid var(--border-light);">
                <td style="padding:8px 10px; font-weight:600;">
                    <span class="ab-name" data-id="${b.id}">${_esc(b.name)}</span>
                </td>
                <td style="padding:8px 10px; text-align:center; color:var(--text-muted);">${(b.students || []).length}명</td>
                <td style="padding:8px 10px; text-align:center; color:var(--text-muted); font-size:11px;">${dateStr}</td>
                <td style="padding:8px 10px; text-align:right;">
                    <button class="btn btn-sm btn-primary" onclick="AttendanceBook._handleLoad('${b.id}')" title="이 출석부를 현재 시험 인원으로 적용">
                        불러오기
                    </button>
                    <button class="btn btn-sm" onclick="AttendanceBook._handleOverwrite('${b.id}')" title="현재 인원으로 이 출석부 덮어쓰기">
                        덮어쓰기
                    </button>
                    <button class="btn btn-sm" onclick="AttendanceBook._handleRename('${b.id}')" title="이름 변경">
                        ✎
                    </button>
                    <button class="btn btn-sm" onclick="AttendanceBook._handleDelete('${b.id}')" title="삭제" style="color:#dc2626;">
                        ✕
                    </button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        body.innerHTML = html;
    },

    // ---------- 핸들러 ----------
    _saveCurrentAsNew() {
        const input = document.getElementById('ab-new-name');
        const name = input ? input.value.trim() : '';
        if (!name) { Toast.error('이름을 입력하세요'); if (input) input.focus(); return; }

        // 현재 인원 모달이 떠 있으면 DOM 값 먼저 sync
        if (typeof SubjectManager !== 'undefined' && SubjectManager._saveStudentsFromDOM
                && document.getElementById('student-list')) {
            SubjectManager._saveStudentsFromDOM();
        }

        const students = (App.state.students || []);
        if (students.length === 0) {
            UIDialog.confirm('현재 등록된 인원이 없습니다. 빈 출석부로 만들까요?').then(ok => {
                if (ok) this._doCreate(name);
            });
            return;
        }
        this._doCreate(name);
    },

    _doCreate(name) {
        const book = this.create(name, App.state.students, App.state.matchFields);
        if (book) {
            Toast.success(`출석부 "${book.name}" 저장됨 (${book.students.length}명)`);
            const input = document.getElementById('ab-new-name');
            if (input) input.value = '';
            this._renderList();
        }
    },

    async _handleLoad(id) {
        const book = this.get(id);
        if (!book) return;
        const ok = await UIDialog.confirm(
            `출석부 "${book.name}" (${book.students.length}명) 을 현재 시험 인원으로 불러옵니다.\n\n현재 입력된 인원은 모두 교체됩니다. 계속하시겠습니까?`,
            { okLabel: '불러오기' }
        );
        if (!ok) return;
        if (this.loadIntoCurrent(id)) {
            // 인원 모달이 열려있으면 즉시 리렌더
            if (typeof SubjectManager !== 'undefined' && SubjectManager.renderStudentList
                    && document.getElementById('student-list')) {
                SubjectManager.renderStudentList();
            }
            // 출석부 모달은 닫기 (작업 완료 시그널)
            const m = document.getElementById('attendance-modal');
            if (m) m.remove();
        }
    },

    async _handleOverwrite(id) {
        const book = this.get(id);
        if (!book) return;
        // DOM에서 현재 상태 먼저 sync
        if (typeof SubjectManager !== 'undefined' && SubjectManager._saveStudentsFromDOM
                && document.getElementById('student-list')) {
            SubjectManager._saveStudentsFromDOM();
        }
        const currentCount = (App.state.students || []).length;
        const ok = await UIDialog.confirm(
            `출석부 "${book.name}" 을(를) 현재 인원(${currentCount}명)으로 덮어씁니다.\n\n기존 출석부 내용(${book.students.length}명)은 사라집니다. 계속하시겠습니까?`,
            { okLabel: '덮어쓰기', danger: true }
        );
        if (!ok) return;
        const updated = this.update(id, App.state.students, App.state.matchFields);
        if (updated) {
            Toast.success(`출석부 "${updated.name}" 업데이트됨 (${updated.students.length}명)`);
            this._renderList();
        }
    },

    async _handleRename(id) {
        const book = this.get(id);
        if (!book) return;
        const newName = await UIDialog.prompt('새 이름을 입력하세요', book.name);
        if (!newName || newName === book.name) return;
        if (this.rename(id, newName)) {
            Toast.success(`출석부 이름 변경됨`);
            this._renderList();
        }
    },

    async _handleDelete(id) {
        const book = this.get(id);
        if (!book) return;
        const ok = await UIDialog.confirm(
            `출석부 "${book.name}" 을 삭제합니다. 되돌릴 수 없습니다.`,
            { okLabel: '삭제', danger: true }
        );
        if (!ok) return;
        if (this.delete(id)) {
            Toast.success(`출석부 "${book.name}" 삭제됨`);
            this._renderList();
        }
    },
};
