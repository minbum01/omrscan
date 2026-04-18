// ============================================
// fileBrowser.js - 통합 파일 브라우저 모달
// 세션/양식 공통 UI: 트리 · 그룹 · 이동 · 이름변경 · 정렬
// ============================================

const FileBrowser = {
    // 내부 상태
    _state: null,  // { mode, kind, currentPath, sort, onPick, onSave }

    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
        );
    },

    _api() {
        const k = this._state.kind;
        const api = window.electronAPI;
        if (!api || !api.isElectron) return null;
        return k === 'session' ? {
            tree:        () => api.sessionTree(),
            createGroup: (rel) => api.sessionCreateGroup(rel),
            move:        (s, d) => api.sessionMove(s, d),
            rename:      (o, n) => api.sessionRename(o, n),
            delete:      (rel) => api.deleteSession(rel),
            deleteGroup: (rel) => api.sessionDeleteGroup(rel),
        } : {
            tree:        () => api.templateTree(),
            createGroup: (rel) => api.templateCreateGroup(rel),
            move:        (s, d) => api.templateMove(s, d),
            rename:      (o, n) => api.templateRename(o, n),
            delete:      (rel) => api.templateDelete(rel),
            deleteGroup: (rel) => api.templateDeleteGroup(rel),
        };
    },

    // 진입점: 불러오기 (선택 모드) — onBack 지정 시 "← 뒤로" 버튼 노출
    open({ kind, title, onPick, onBack, backLabel, extraHeader, initialPath }) {
        this._state = {
            mode: 'load', kind, onPick, onBack, backLabel: backLabel || '← 뒤로',
            title: title || (kind === 'session' ? '시험(세션) 불러오기' : '양식 불러오기'),
            currentPath: initialPath || '',
            sort: 'date_desc',
            _tree: null,
            extraHeader: extraHeader || '',
        };
        this._render();
    },

    // 진입점: 저장 (이름 + 그룹 선택)
    openSave({ kind, title, defaultName, onSave, onBack, backLabel, keepOpenAfterSave, extraTopHtml }) {
        this._state = {
            mode: 'save', kind, onSave, onBack, backLabel: backLabel || '← 뒤로',
            title: title || (kind === 'session' ? '시험(세션) 저장' : '양식 저장'),
            currentPath: '',
            defaultName: defaultName || '',
            sort: 'date_desc',
            _tree: null,
            keepOpenAfterSave: !!keepOpenAfterSave,
            extraTopHtml: extraTopHtml || '',
        };
        this._render();
    },

    close() {
        const el = document.getElementById('fb-modal');
        if (el) el.remove();
        document.removeEventListener('keydown', this._escHandler);
        this._state = null;
    },

    _back() {
        const cb = this._state && this._state.onBack;
        this.close();
        if (typeof cb === 'function') cb();
    },

    _escHandler(e) {
        if (e.key === 'Escape') {
            if (FileBrowser._state && typeof FileBrowser._state.onBack === 'function') {
                FileBrowser._back();
            } else {
                FileBrowser.close();
            }
        }
    },

    async _loadTree() {
        const api = this._api();
        if (!api) { this._state._tree = []; return; }
        const res = await api.tree();
        this._state._tree = res.success ? (res.tree || []) : [];
    },

    // 특정 path의 children 가져오기
    _getNodeAt(tree, relPath) {
        if (!relPath) return { children: tree };
        const segs = relPath.split('/');
        let cur = { children: tree };
        for (const s of segs) {
            if (!cur.children) return null;
            const next = cur.children.find(c => c.name === s && c.type === 'folder');
            if (!next) return null;
            cur = next;
        }
        return cur;
    },

    _sortItems(items) {
        const s = this._state.sort;
        const arr = [...items];
        arr.sort((a, b) => {
            // 폴더 우선
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            if (s === 'name_asc')  return (a.name || '').localeCompare(b.name || '');
            if (s === 'name_desc') return (b.name || '').localeCompare(a.name || '');
            if (s === 'date_asc')  return (a.mtime || 0) - (b.mtime || 0);
            if (s === 'date_desc') return (b.mtime || 0) - (a.mtime || 0);
            return 0;
        });
        return arr;
    },

    async _render() {
        if (!this._state) return;
        if (this._state._tree == null) await this._loadTree();

        const existing = document.getElementById('fb-modal');
        if (existing) existing.remove();

        const node = this._getNodeAt(this._state._tree, this._state.currentPath);
        const items = this._sortItems((node && node.children) || []);

        const overlay = document.createElement('div');
        overlay.id = 'fb-modal';
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '10001';
        overlay.innerHTML = `
            <div class="modal" style="width:720px; max-height:85vh; display:flex; flex-direction:column;">
                <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        ${this._state.onBack ? `<button class="btn btn-sm" onclick="FileBrowser._back()" title="뒤로 (ESC)" style="font-size:12px; padding:6px 12px; font-weight:600;">${this._esc(this._state.backLabel)}</button>` : ''}
                        <div>
                            <h2 style="margin:0;">${this._esc(this._state.title)}</h2>
                            <p style="margin:4px 0 0; font-size:12px; color:var(--text-muted);">
                                ${this._state.mode === 'save'
                                    ? '저장할 그룹을 선택하고 이름을 입력하세요.'
                                    : '폴더 더블클릭으로 이동, 항목 더블클릭으로 불러오기. ESC로 ' + (this._state.onBack ? '뒤로' : '닫기') + '.'}
                            </p>
                        </div>
                    </div>
                    <button class="btn btn-sm" onclick="FileBrowser.close()" title="닫기" style="font-size:16px; padding:4px 12px;">✕</button>
                </div>

                ${this._state.extraHeader || ''}
                <div class="fb-extra-top">${this._state.extraTopHtml || ''}</div>

                <!-- 경로 브레드크럼 + 정렬 + 새 폴더 -->
                <div style="padding:8px 16px; border-bottom:1px solid var(--border-light); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <div id="fb-breadcrumb" style="flex:1; font-size:12px; display:flex; gap:4px; align-items:center; flex-wrap:wrap;"></div>
                    <select id="fb-sort" onchange="FileBrowser._onSortChange(this.value)" style="padding:4px 6px; font-size:11px; border:1px solid var(--border); border-radius:4px;">
                        <option value="name_asc"  ${this._state.sort==='name_asc'?'selected':''}>이름↑</option>
                        <option value="name_desc" ${this._state.sort==='name_desc'?'selected':''}>이름↓</option>
                        <option value="date_desc" ${this._state.sort==='date_desc'?'selected':''}>최근순</option>
                        <option value="date_asc"  ${this._state.sort==='date_asc'?'selected':''}>오래된순</option>
                    </select>
                    <button class="btn btn-sm" onclick="FileBrowser._createGroup()" title="현재 폴더 안에 새 그룹 만들기">+ 새 폴더</button>
                </div>

                <div id="fb-list" class="fb-modal-body modal-body" style="overflow-y:auto; flex:1; min-height:200px; max-height:48vh; padding:8px 12px;"></div>

                ${this._state.mode === 'save' && !this._state.extraTopHtml ? `
                <div style="padding:10px 16px; border-top:1px solid var(--border-light); background:var(--bg-input);">
                    <div style="display:flex; gap:6px; align-items:center;">
                        <span style="font-size:12px; font-weight:600; color:var(--text-muted);">이름:</span>
                        <input id="fb-save-name" type="text" value="${this._esc(this._state.defaultName || '')}"
                            placeholder="저장할 이름 입력"
                            style="flex:1; padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                        <span style="font-size:11px; color:var(--text-muted);" id="fb-save-path-preview"></span>
                    </div>
                </div>` : ''}

                ${!this._state.extraTopHtml ? `
                <div class="modal-footer">
                    <button class="btn" onclick="FileBrowser.close()">취소</button>
                    ${this._state.mode === 'save'
                        ? `<button class="btn btn-primary" onclick="FileBrowser._onSaveClick()">저장</button>`
                        : ''}
                </div>` : ''}
            </div>
        `;
        document.body.appendChild(overlay);

        // ESC 핸들러
        document.addEventListener('keydown', this._escHandler);

        // 백드롭 클릭 — onBack 있으면 뒤로, 없으면 닫기
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (this._state && this._state.onBack) this._back();
                else this.close();
            }
        });

        this._renderBreadcrumb();
        this._renderList(items);
        this._updateSavePathPreview();

        if (this._state.mode === 'save') {
            const input = document.getElementById('fb-save-name');
            if (input) {
                input.focus();
                input.addEventListener('input', () => this._updateSavePathPreview());
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') this._onSaveClick();
                });
            }
        }
    },

    _updateSavePathPreview() {
        if (this._state.mode !== 'save') return;
        const el = document.getElementById('fb-save-path-preview');
        const input = document.getElementById('fb-save-name');
        if (!el || !input) return;
        const name = input.value.trim() || '(이름없음)';
        const p = this._state.currentPath ? `${this._state.currentPath}/${name}` : name;
        el.textContent = `→ ${p}`;
    },

    _renderBreadcrumb() {
        const el = document.getElementById('fb-breadcrumb');
        if (!el) return;
        const segs = this._state.currentPath ? this._state.currentPath.split('/') : [];
        let html = `<button class="btn btn-sm" onclick="FileBrowser._goTo('')" style="font-size:11px; padding:3px 8px;">📁 루트</button>`;
        let acc = '';
        segs.forEach((s, i) => {
            acc = acc ? acc + '/' + s : s;
            const pEsc = acc.replace(/'/g, "\\'");
            html += `<span style="color:var(--text-muted); font-size:11px;">/</span>`;
            html += `<button class="btn btn-sm" onclick="FileBrowser._goTo('${pEsc}')" style="font-size:11px; padding:3px 8px;">${this._esc(s)}</button>`;
        });
        el.innerHTML = html;
    },

    _renderList(items) {
        const el = document.getElementById('fb-list');
        if (!el) return;
        if (items.length === 0) {
            el.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:13px;">비어있습니다.</div>`;
            return;
        }
        let html = '';
        items.forEach((it) => {
            const pEsc = it.path.replace(/'/g, "\\'");
            const nameEsc = this._esc(it.name);
            if (it.type === 'folder') {
                html += `<div class="fb-row" data-path="${pEsc}" data-type="folder"
                    style="display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:6px; margin-bottom:4px; cursor:pointer;"
                    ondblclick="FileBrowser._goTo('${pEsc}')">
                    <span style="font-size:16px;">📁</span>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:600;">${nameEsc}</div>
                        <div style="font-size:10px; color:var(--text-muted);">${(it.children||[]).length}개 항목</div>
                    </div>
                    <button class="btn btn-sm" onclick="event.stopPropagation(); FileBrowser._goTo('${pEsc}')" style="font-size:10px;">열기</button>
                    <button class="btn btn-sm" onclick="event.stopPropagation(); FileBrowser._rename('${pEsc}')" style="font-size:10px;">이름변경</button>
                    <button class="btn btn-sm" onclick="event.stopPropagation(); FileBrowser._move('${pEsc}')" style="font-size:10px;">이동</button>
                    <button class="roi-delete-btn" onclick="event.stopPropagation(); FileBrowser._deleteGroup('${pEsc}')" title="폴더 삭제" style="font-size:10px;">✕</button>
                </div>`;
            } else {
                // session or template item
                const meta = it.meta || {};
                // 세션 브라우저에서 양식 항목 숨기기 (양식은 양식끼리만 관리)
                if (this._state.kind === 'session' && meta.isTemplateMode) return;
                const lines = [];
                if (it.type === 'session') {
                    if (meta.lastUsedAt) lines.push(new Date(meta.lastUsedAt).toLocaleString('ko-KR'));
                    if (meta.subjectCount) lines.push(`과목 ${meta.subjectCount}`);
                    if (meta.imageCount) lines.push(`이미지 ${meta.imageCount}`);
                    if (meta.isTemplateMode) lines.push('양식');
                } else if (it.type === 'template') {
                    if (meta.savedAt) lines.push(new Date(meta.savedAt).toLocaleString('ko-KR'));
                    if (meta.roiCount) lines.push(`ROI ${meta.roiCount}`);
                }
                const subLine = lines.join(' · ');
                const icon = it.type === 'session' ? '📘' : '📄';
                // NEW 뱃지: 오늘 생성된 항목
                const todayStr = new Date().toISOString().slice(0, 10);
                const createdAt = (meta.lastUsedAt || meta.savedAt || meta.createdAt || '');
                const isNew = createdAt && createdAt.slice(0, 10) === todayStr;
                const newBadge = isNew ? `<span style="background:#22c55e; color:#fff; font-size:9px; font-weight:700; padding:1px 5px; border-radius:4px; margin-left:6px;">NEW</span>` : '';
                html += `<div class="fb-row" data-path="${pEsc}" data-type="${it.type}"
                    style="display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid ${isNew ? '#86efac' : 'var(--border)'}; border-radius:6px; margin-bottom:4px; cursor:pointer; background:${isNew ? '#f0fdf4' : 'var(--bg-card)'};"
                    ondblclick="FileBrowser._pickItem('${pEsc}')">
                    <span style="font-size:16px;">${icon}</span>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:600;">${nameEsc}${newBadge}</div>
                        <div style="font-size:10px; color:var(--text-muted);">${this._esc(subLine)}</div>
                    </div>
                    ${this._state.mode === 'load' ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); FileBrowser._pickItem('${pEsc}')" style="font-size:10px;">불러오기</button>` : ''}
                    <button class="btn btn-sm" onclick="event.stopPropagation(); FileBrowser._rename('${pEsc}')" style="font-size:10px;">이름변경</button>
                    <button class="btn btn-sm" onclick="event.stopPropagation(); FileBrowser._move('${pEsc}')" style="font-size:10px;">이동</button>
                    <button class="roi-delete-btn" onclick="event.stopPropagation(); FileBrowser._delete('${pEsc}', '${it.type}')" title="삭제" style="font-size:10px;">✕</button>
                </div>`;
            }
        });
        el.innerHTML = html;
    },

    _onSortChange(v) {
        this._state.sort = v;
        const node = this._getNodeAt(this._state._tree, this._state.currentPath);
        this._renderList(this._sortItems((node && node.children) || []));
    },

    _goTo(relPath) {
        this._state.currentPath = relPath || '';
        this._renderBreadcrumb();
        const node = this._getNodeAt(this._state._tree, this._state.currentPath);
        this._renderList(this._sortItems((node && node.children) || []));
        this._updateSavePathPreview();
    },

    async _refresh() {
        this._state._tree = null;
        await this._render();
    },

    // 폴더 선택 다이얼로그 (이동용)
    _pickFolder(title, excludePath) {
        return new Promise(resolve => {
            const allFolders = [];
            const walk = (nodes) => {
                nodes.forEach(n => {
                    if (n.type === 'folder') {
                        allFolders.push(n.path);
                        walk(n.children || []);
                    }
                });
            };
            walk(this._state._tree);
            const candidates = [
                { path: '', label: '📁 (루트)' },
                ...allFolders
                    .filter(p => p !== excludePath && !p.startsWith(excludePath + '/'))
                    .map(p => ({ path: p, label: '📁 ' + p }))
            ];

            const box = document.createElement('div');
            box.className = 'modal-overlay';
            box.style.zIndex = '10002';
            box.innerHTML = `
                <div class="modal" style="width:420px; max-height:70vh;">
                    <div class="modal-header"><h2 style="margin:0; font-size:15px;">${this._esc(title)}</h2></div>
                    <div class="modal-body" style="padding:8px 12px; max-height:50vh; overflow-y:auto;" id="fb-pick-list"></div>
                    <div class="modal-footer">
                        <button class="btn" id="fb-pick-cancel">취소</button>
                    </div>
                </div>`;
            document.body.appendChild(box);
            const list = box.querySelector('#fb-pick-list');
            list.innerHTML = candidates.map((c, i) =>
                `<button class="btn" data-idx="${i}" style="display:block; width:100%; text-align:left; padding:8px 10px; margin-bottom:4px; font-size:13px;">${this._esc(c.label)}</button>`
            ).join('');
            const cleanup = (val) => { box.remove(); resolve(val); };
            list.querySelectorAll('button[data-idx]').forEach(b => {
                b.addEventListener('click', () => cleanup(candidates[parseInt(b.dataset.idx)].path));
            });
            box.querySelector('#fb-pick-cancel').addEventListener('click', () => cleanup(null));
            box.addEventListener('click', (e) => { if (e.target === box) cleanup(null); });
            document.addEventListener('keydown', function onEsc(e) {
                if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); cleanup(null); }
            });
        });
    },

    async _createGroup() {
        const name = await UIDialog.prompt('새 그룹(폴더) 이름', '');
        if (!name || !name.trim()) return;
        if (/[\\\/:*?"<>|.]/.test(name)) { Toast.error('이름에 쓸 수 없는 문자가 있습니다'); return; }
        const rel = this._state.currentPath ? `${this._state.currentPath}/${name.trim()}` : name.trim();
        const res = await this._api().createGroup(rel);
        if (!res.success) { Toast.error('생성 실패: ' + (res.error || '')); return; }
        Toast.success(`폴더 "${name.trim()}" 생성됨`);
        await this._refresh();
    },

    async _rename(oldPath) {
        const oldName = oldPath.split('/').pop();
        const newName = await UIDialog.prompt('새 이름', oldName);
        if (!newName || !newName.trim() || newName.trim() === oldName) return;
        if (/[\\\/:*?"<>|.]/.test(newName)) { Toast.error('이름에 쓸 수 없는 문자가 있습니다'); return; }
        const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
        const newRel = parent ? `${parent}/${newName.trim()}` : newName.trim();
        const res = await this._api().rename(oldPath, newRel);
        if (!res.success) { Toast.error('이름 변경 실패: ' + (res.error || '')); return; }
        Toast.success('이름 변경됨');
        await this._refresh();
    },

    async _move(srcPath) {
        const targetFolder = await this._pickFolder('이동할 폴더 선택', srcPath);
        if (targetFolder === null) return;
        const baseName = srcPath.split('/').pop();
        const destRel = targetFolder ? `${targetFolder}/${baseName}` : baseName;
        if (destRel === srcPath) return;
        const res = await this._api().move(srcPath, destRel);
        if (!res.success) { Toast.error('이동 실패: ' + (res.error || '')); return; }
        Toast.success('이동 완료');
        await this._refresh();
    },

    async _delete(relPath, type) {
        const ok = await UIDialog.confirm(`"${relPath}" 를 휴지통으로 이동합니다. 계속?`, { danger: true, okLabel: '삭제' });
        if (!ok) return;
        const res = await this._api().delete(relPath);
        if (!res.success) { Toast.error('삭제 실패: ' + (res.error || '')); return; }
        Toast.success('삭제됨');
        await this._refresh();
    },

    async _deleteGroup(relPath) {
        const ok = await UIDialog.confirm(`폴더 "${relPath}" 와 내부 전체를 휴지통으로 이동합니다. 계속?`, { danger: true, okLabel: '삭제' });
        if (!ok) return;
        const res = await this._api().deleteGroup(relPath);
        if (!res.success) { Toast.error('폴더 삭제 실패: ' + (res.error || '')); return; }
        Toast.success('폴더 삭제됨');
        await this._refresh();
    },

    _pickItem(relPath) {
        if (this._state.mode !== 'load') return;
        const cb = this._state.onPick;
        this.close();
        if (typeof cb === 'function') cb(relPath);
    },

    async _onSaveClick() {
        // extraTopHtml 모드: 이름을 세션/양식 input에서 가져옴
        let name = '';
        const fbInput = document.getElementById('fb-save-name');
        const sessionInput = document.getElementById('fb-session-name');
        const templateInput = document.getElementById('fb-template-name');

        if (fbInput) {
            name = fbInput.value.trim();
        } else if (sessionInput) {
            name = sessionInput.value.trim();
        } else if (templateInput) {
            name = templateInput.value.trim();
        }

        if (!name) {
            Toast.error('이름을 입력하세요');
            (sessionInput || templateInput || fbInput)?.focus();
            return;
        }
        if (/[\\\/:*?"<>|.]/.test(name)) { Toast.error('이름에 쓸 수 없는 문자가 있습니다'); return; }
        const rel = this._state.currentPath ? `${this._state.currentPath}/${name}` : name;
        const cb = this._state.onSave;
        const keepOpen = this._state && this._state.keepOpenAfterSave;
        if (!keepOpen) this.close();
        if (typeof cb === 'function') cb(rel);
    },
};
