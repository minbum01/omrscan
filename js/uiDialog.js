// ============================================
// uiDialog.js - Electron 호환 prompt / confirm
// window.prompt / window.confirm는 Electron에서 비동작하므로 커스텀 UI 제공
// ============================================

const UIDialog = {
    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
        );
    },

    // 입력 다이얼로그 (prompt 대체) — Promise<string|null>
    prompt(title, defaultValue) {
        return new Promise(resolve => {
            const box = document.createElement('div');
            box.className = 'modal-overlay';
            box.style.zIndex = '10020';
            box.innerHTML = `
                <div class="modal" style="width:380px;">
                    <div class="modal-header"><h2 style="margin:0; font-size:15px; white-space:pre-wrap;">${this._esc(title)}</h2></div>
                    <div class="modal-body" style="padding:12px 16px;">
                        <input id="uid-input" type="text" value="${this._esc(defaultValue || '')}"
                            style="width:100%; padding:8px 10px; border:2px solid var(--blue); border-radius:6px; font-size:14px;">
                    </div>
                    <div class="modal-footer">
                        <button class="btn" id="uid-cancel">취소</button>
                        <button class="btn btn-primary" id="uid-ok">확인</button>
                    </div>
                </div>`;
            document.body.appendChild(box);
            const input = box.querySelector('#uid-input');
            const cleanup = (val) => { box.remove(); resolve(val); };
            input.focus(); input.select();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter')  { e.preventDefault(); cleanup(input.value); }
                if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
            });
            box.querySelector('#uid-ok').addEventListener('click', () => cleanup(input.value));
            box.querySelector('#uid-cancel').addEventListener('click', () => cleanup(null));
            box.addEventListener('click', (e) => { if (e.target === box) cleanup(null); });
        });
    },

    // 3버튼 다이얼로그 — Promise<'save'|'discard'|'cancel'>
    confirmSave(message) {
        return new Promise(resolve => {
            const box = document.createElement('div');
            box.className = 'modal-overlay';
            box.style.zIndex = '10020';
            box.innerHTML = `
                <div class="modal" style="width:420px;">
                    <div class="modal-header"><h2 style="margin:0; font-size:15px;">저장하지 않은 변경사항</h2></div>
                    <div class="modal-body" style="padding:16px; font-size:13px; line-height:1.6; white-space:pre-wrap;">${this._esc(message)}</div>
                    <div class="modal-footer" style="display:flex; gap:8px;">
                        <button class="btn" id="uid-cancel" style="margin-right:auto;">취소</button>
                        <button class="btn btn-danger" id="uid-discard">저장 안 함</button>
                        <button class="btn btn-primary" id="uid-save">저장</button>
                    </div>
                </div>`;
            document.body.appendChild(box);
            const cleanup = (v) => { box.remove(); resolve(v); };
            box.querySelector('#uid-save').addEventListener('click', () => cleanup('save'));
            box.querySelector('#uid-discard').addEventListener('click', () => cleanup('discard'));
            box.querySelector('#uid-cancel').addEventListener('click', () => cleanup('cancel'));
            box.addEventListener('click', (e) => { if (e.target === box) cleanup('cancel'); });
            document.addEventListener('keydown', function onKey(e) {
                if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup('cancel'); }
            });
            box.querySelector('#uid-save').focus();
        });
    },

    // 확인 다이얼로그 (confirm 대체) — Promise<boolean>
    confirm(message, opts) {
        const o = opts || {};
        const okLabel = o.okLabel || '확인';
        const cancelLabel = o.cancelLabel || '취소';
        const danger = !!o.danger;
        return new Promise(resolve => {
            const box = document.createElement('div');
            box.className = 'modal-overlay';
            box.style.zIndex = '10020';
            box.innerHTML = `
                <div class="modal" style="width:400px;">
                    <div class="modal-header"><h2 style="margin:0; font-size:15px;">확인</h2></div>
                    <div class="modal-body" style="padding:16px; font-size:13px; line-height:1.6; white-space:pre-wrap;">${this._esc(message)}</div>
                    <div class="modal-footer">
                        <button class="btn" id="uid-cancel">${this._esc(cancelLabel)}</button>
                        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="uid-ok">${this._esc(okLabel)}</button>
                    </div>
                </div>`;
            document.body.appendChild(box);
            const cleanup = (v) => { box.remove(); resolve(v); };
            box.querySelector('#uid-ok').addEventListener('click', () => cleanup(true));
            box.querySelector('#uid-cancel').addEventListener('click', () => cleanup(false));
            box.addEventListener('click', (e) => { if (e.target === box) cleanup(false); });
            document.addEventListener('keydown', function onKey(e) {
                if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); }
                else if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); cleanup(true); }
            });
            // 포커스
            box.querySelector('#uid-ok').focus();
        });
    },
};
