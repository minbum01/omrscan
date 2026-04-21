// ============================================
// correction.js - 교정 탭 (6칼럼)
// 1,2: null 수정중/이력
// 3,4: 1.5배 수정중/이력
// 5,6: 중복의심/이력
// ============================================

const Correction = {
    PAGE_SIZE: 30,
    _pages: {}, // { 'col-null-pending': 0, 'col-null-history': 0, ... }
    _renderGen: 0, // 현재 render() 세대. 비동기 콜백의 stale 여부 판정
    _cachedCollection: null, // collect() 결과 캐시
    _cacheDirty: true, // 상태 변경 시 true로 설정 → 다음 collect() 재계산

    // 캐시 무효화 — 외부/내부 mutation 후 호출
    invalidate() {
        this._cacheDirty = true;
        this._cachedCollection = null;
    },

    _getPage(colId) { return this._pages[colId] || 0; },
    _setPage(colId, page) {
        this._pages[colId] = page;
        this.render(document.getElementById('correction-content'));
    },

    // 교정 탭이 현재 보이는지 여부
    _isVisible() {
        const view = document.getElementById('correction-view');
        return !!(view && view.style.display !== 'none');
    },

    collect() {
        // 캐시 hit
        if (!this._cacheDirty && this._cachedCollection) {
            return this._cachedCollection;
        }

        const nullPending = [], nullHistory = [];
        const autoPending = [], autoHistory = [];
        const multiPending = [], multiHistory = [];

        (App.state.images || []).forEach((img, imgIdx) => {
            if (!img.results) return;
            img.results.forEach((res, roiIdx) => {
                const roi = img.rois[roiIdx];
                if (!roi || !roi.settings) return;

                res.rows.forEach(row => {
                    if (row._correctionInitial === undefined) {
                        if (row.multiMarked) row._correctionInitial = 'multi';
                        else if (row.markedAnswer === null) row._correctionInitial = 'null';
                        else if (row._xvAutoCorrected) row._correctionInitial = 'auto';
                        else row._correctionInitial = 'normal';
                    }

                    const initial = row._correctionInitial;
                    if (initial === 'normal') return;

                    const entry = {
                        imgIdx, roiIdx, qNum: row.questionNumber,
                        row, roi, img,
                        numChoices: roi.settings.numChoices || 5,
                        choiceLabels: roi.settings.choiceLabels || null,
                    };

                    if (initial === 'multi') {
                        if (row.multiMarked) multiPending.push(entry);
                        else multiHistory.push(entry);
                    } else if (initial === 'null') {
                        if (row.markedAnswer === null && !row.corrected) nullPending.push(entry);
                        else nullHistory.push(entry);
                    } else if (initial === 'auto') {
                        if (row._xvAutoCorrected) autoPending.push(entry);
                        else autoHistory.push(entry);
                    }
                });
            });
        });

        const result = { nullPending, nullHistory, autoPending, autoHistory, multiPending, multiHistory };
        this._cachedCollection = result;
        this._cacheDirty = false;
        return result;
    },

    _applyBadge(nullPendingLen, autoPendingLen, multiPendingLen) {
        const badge = document.getElementById('tab-correction-badge');
        if (!badge) return;
        const pending = nullPendingLen + autoPendingLen + multiPendingLen;
        if (pending > 0) { badge.style.display = ''; badge.textContent = pending; }
        else { badge.style.display = 'none'; }
    },

    updateBadge() {
        const { nullPending, autoPending, multiPending } = this.collect();
        this._applyBadge(nullPending.length, autoPending.length, multiPending.length);
    },

    render(container) {
        if (!container) return;
        // 렌더 세대 증가 — 이전 pending 콜백은 모두 stale 처리
        const myGen = ++this._renderGen;
        this._activeRenderGen = myGen;
        const { nullPending, nullHistory, autoPending, autoHistory, multiPending, multiHistory } = this.collect();
        // collect() 결과를 재사용 — updateBadge()의 중복 순회 제거
        this._applyBadge(nullPending.length, autoPending.length, multiPending.length);

        const anyConfirmed = (App.state.images || []).some(img => img._correctionConfirmed);
        const hasPending = nullPending.length + autoPending.length + multiPending.length > 0;
        const hasAny = nullHistory.length + autoHistory.length + multiHistory.length + nullPending.length + autoPending.length + multiPending.length > 0;

        let statusHtml = '';
        if (anyConfirmed) {
            statusHtml = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:8px;background:#f0fdf4;border:2px solid #22c55e;border-radius:6px;">
                <span style="font-size:16px;">✅</span>
                <div style="flex:1;font-size:12px;"><strong style="color:#16a34a;">교정 확정 완료</strong><br><span style="color:var(--text-muted);font-size:10px;">수험번호/이름 매칭 및 채점 반영됨</span></div>
                <button class="btn btn-sm" onclick="UI.toggleConfirmCorrection()" style="padding:4px 10px;font-size:11px;">확정 해제</button>
            </div>`;
        } else if (hasAny) {
            statusHtml = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:8px;background:#fef3c7;border:2px solid #f59e0b;border-radius:6px;">
                <span style="font-size:16px;">⚠</span>
                <div style="flex:1;font-size:12px;"><strong style="color:#d97706;">교정 확정 전</strong><br><span style="color:var(--text-muted);font-size:10px;">교정 확정을 눌러야 채점에 반영됩니다</span></div>
                <button class="btn btn-primary" onclick="UI.toggleConfirmCorrection()" style="padding:5px 12px;font-size:12px;font-weight:700;">교정 확정</button>
            </div>`;
        }

        const colHdr = (label, count, color, btnHtml) => {
            const badge = `<span style="background:${color};color:#fff;padding:0 5px;border-radius:6px;font-size:9px;margin-left:3px;">${count}</span>`;
            return `<div style="font-size:11px;font-weight:700;color:${color};margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid ${color};display:flex;align-items:center;justify-content:space-between;white-space:nowrap;">
                <span>${label}${badge}</span>${btnHtml || ''}
            </div>`;
        };
        const histHdr = (label, count) => colHdr(label, count, '#94a3b8');

        let html = `
            <div style="display:flex;align-items:center;margin-bottom:6px;">
                <h1 style="font-size:18px;font-weight:700;color:var(--text);margin:0;">교정</h1>
            </div>
            ${statusHtml}
            <div style="padding:6px 10px;margin-bottom:10px;background:rgba(59,130,246,0.08);border-left:3px solid #3b82f6;border-radius:4px;font-size:10px;color:var(--text-secondary);">
                <strong style="color:#3b82f6;">⌨</strong>
                숫자 → <kbd style="padding:0 3px;background:#fff;border:1px solid #ccc;border-radius:2px;font-size:9px;">Enter</kbd> 저장+다음 |
                빈칸: <kbd style="padding:0 3px;background:#fff;border:1px solid #dc2626;border-radius:2px;font-size:9px;">-</kbd>+Enter
            </div>

            <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;">
                <div>${colHdr('null 수정중', nullPending.length, '#d97706')}<div id="col-null-pending" style="display:flex;flex-direction:column;gap:4px;"></div></div>
                <div>${histHdr('null 이력', nullHistory.length)}<div id="col-null-history" style="display:flex;flex-direction:column;gap:4px;"></div></div>
                <div>${colHdr('1.5배 수정중', autoPending.length, '#16a34a',
                    autoPending.length > 0 ? `<button onclick="Correction.confirmAllAutoPending()" style="padding:1px 5px;font-size:9px;background:#22c55e;color:#fff;border:none;border-radius:3px;cursor:pointer;font-weight:700;">전체확인</button>` : ''
                )}<div id="col-auto-pending" style="display:flex;flex-direction:column;gap:4px;"></div></div>
                <div>${histHdr('1.5배 이력', autoHistory.length)}<div id="col-auto-history" style="display:flex;flex-direction:column;gap:4px;"></div></div>
                <div>${colHdr('중복의심', multiPending.length, '#dc2626',
                    multiPending.length > 0 ? `<button onclick="Correction.confirmAllMultiPending()" style="padding:1px 5px;font-size:9px;background:#ef4444;color:#fff;border:none;border-radius:3px;cursor:pointer;font-weight:700;">전체확인</button>` : ''
                )}<div id="col-multi-pending" style="display:flex;flex-direction:column;gap:4px;"></div></div>
                <div>${histHdr('중복이력', multiHistory.length)}<div id="col-multi-history" style="display:flex;flex-direction:column;gap:4px;"></div></div>
            </div>
        `;
        container.innerHTML = html;

        const slots = {
            'col-null-pending':   { items: nullPending,   type: 'null-pending'   },
            'col-null-history':   { items: nullHistory,   type: 'null-history'   },
            'col-auto-pending':   { items: autoPending,   type: 'auto-pending'   },
            'col-auto-history':   { items: autoHistory,   type: 'auto-history'   },
            'col-multi-pending':  { items: multiPending,  type: 'multi-pending'  },
            'col-multi-history':  { items: multiHistory,  type: 'multi-history'  },
        };
        const PS = this.PAGE_SIZE;
        Object.entries(slots).forEach(([id, { items, type }]) => {
            const el = document.getElementById(id);
            if (items.length === 0) {
                el.innerHTML = `<div style="padding:8px;background:var(--bg-card);border-radius:4px;color:var(--text-muted);font-size:10px;text-align:center;">없음</div>`;
                return;
            }

            const page = this._getPage(id);
            const totalPages = Math.ceil(items.length / PS);
            const start = page * PS;
            const pageItems = items.slice(start, start + PS);

            pageItems.forEach(e => el.appendChild(this._renderItem(e, type)));

            // 페이지네이션 버튼 (2페이지 이상일 때)
            if (totalPages > 1) {
                const nav = document.createElement('div');
                nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:4px;margin-top:6px;padding:4px 0;';
                nav.innerHTML = `
                    <button onclick="Correction._setPage('${id}',${Math.max(0, page - 1)})" ${page === 0 ? 'disabled' : ''}
                        style="padding:2px 6px;font-size:9px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:var(--bg-input);">◀</button>
                    <span style="font-size:9px;color:var(--text-muted);">${page + 1}/${totalPages}</span>
                    <button onclick="Correction._setPage('${id}',${Math.min(totalPages - 1, page + 1)})" ${page >= totalPages - 1 ? 'disabled' : ''}
                        style="padding:2px 6px;font-size:9px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:var(--bg-input);">▶</button>
                `;
                el.appendChild(nav);
            }
        });

        this.focusFirst();
    },

    _renderItem(e, type) {
        const isHistory = type.endsWith('-history');
        const isNull = type.startsWith('null');
        const isMulti = type.startsWith('multi');

        if (isHistory) {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'cursor:pointer;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:3px;transition:transform 0.1s;';
            wrap.onmouseenter = () => { wrap.style.transform = 'scale(1.02)'; wrap.style.borderColor = '#3b82f6'; };
            wrap.onmouseleave = () => { wrap.style.transform = ''; wrap.style.borderColor = 'var(--border)'; };
            wrap.onclick = () => this._openEditPopup(e, type);

            const zoomEl = this._makeZoomCanvas(e, true);
            if (zoomEl) wrap.appendChild(zoomEl);

            const curVal = e.row.markedAnswer
                ? (e.choiceLabels && e.choiceLabels[e.row.markedAnswer - 1] ? e.choiceLabels[e.row.markedAnswer - 1] : String(e.row.markedAnswer))
                : '─';
            const lblColor = isMulti ? '#dc2626' : isNull ? '#d97706' : '#16a34a';
            const lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:9px;color:var(--text-muted);text-align:center;margin-top:1px;';
            lbl.innerHTML = `Q${e.qNum}:<strong style="color:${lblColor};">${curVal}</strong>`;
            wrap.appendChild(lbl);
            return wrap;
        }

        // 수정중 카드 — 컴팩트
        const wrap = document.createElement('div');
        wrap.style.cssText = 'padding:4px;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;';

        // 썸네일 (5열 그리드)
        const zoomEl = this._makeZoomCanvas(e, false);
        if (zoomEl) wrap.appendChild(zoomEl);

        // 입력행: Q번호 + input + 분석탭
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:3px;margin-top:3px;';

        const qLabel = document.createElement('span');
        qLabel.style.cssText = 'font-size:9px;font-weight:700;color:var(--text-muted);white-space:nowrap;';
        qLabel.textContent = `Q${e.qNum}`;
        row.appendChild(qLabel);

        const curAnswer = e.row.markedAnswer;
        const preVal = curAnswer
            ? (e.choiceLabels && e.choiceLabels[curAnswer - 1] ? e.choiceLabels[curAnswer - 1] : String(curAnswer))
            : '';
        let placeholder = preVal ? '' : '-';
        if (isMulti && e.row.multiMarked && e.row.markedIndices && e.row.markedIndices.length > 1) {
            placeholder = e.row.markedIndices.map(i => e.choiceLabels && e.choiceLabels[i - 1] ? e.choiceLabels[i - 1] : String(i)).join(',');
        }

        const borderColor = isMulti ? '#ef4444' : isNull ? '#f59e0b' : '#22c55e';
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.maxLength = 3;
        textInput.value = preVal;
        textInput.placeholder = placeholder;
        textInput.className = `correction-input correction-input-${type}`;
        textInput.dataset.imgIdx = e.imgIdx;
        textInput.dataset.roiIdx = e.roiIdx;
        textInput.dataset.qNum = e.qNum;
        textInput.dataset.columnType = type;
        textInput.style.cssText = `flex:1;min-width:0;padding:2px 4px;border:2px solid ${borderColor};border-radius:3px;font-size:12px;font-weight:700;text-align:center;box-sizing:border-box;`;
        textInput.onkeydown = (ev) => this._onInputKey(ev, textInput, e);
        textInput.onmousedown = () => { Correction._skipScrollOnce = true; };
        textInput.onfocus = () => {
            wrap.style.outline = '2px solid #3b82f6';
            wrap.style.outlineOffset = '-1px';
            if (Correction._skipScrollOnce) { Correction._skipScrollOnce = false; }
            else { wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            setTimeout(() => textInput.select(), 0);
        };
        textInput.onblur = () => { wrap.style.outline = ''; };
        row.appendChild(textInput);

        const gotoBtn = document.createElement('button');
        gotoBtn.textContent = '→';
        gotoBtn.title = '분석 탭에서 보기';
        gotoBtn.style.cssText = 'padding:2px 5px;font-size:10px;background:var(--bg-input);border:1px solid var(--border);border-radius:3px;cursor:pointer;flex-shrink:0;';
        gotoBtn.onclick = () => this.goTo(e.imgIdx, e.roiIdx, e.qNum);
        row.appendChild(gotoBtn);

        wrap.appendChild(row);
        return wrap;
    },

    _openEditPopup(e, type) {
        const existing = document.getElementById('correction-edit-popup');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'correction-edit-popup';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
        overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };

        const modal = document.createElement('div');
        modal.style.cssText = 'background:var(--bg-card);border-radius:8px;padding:16px;min-width:320px;max-width:90vw;box-shadow:0 10px 40px rgba(0,0,0,0.4);';

        const regionName = e.roi.settings.name || `영역${e.roiIdx + 1}`;
        const title = document.createElement('h3');
        title.style.cssText = 'margin:0 0 8px 0;font-size:14px;color:var(--text);';
        title.textContent = `Q${e.qNum} · ${regionName} 수정`;
        modal.appendChild(title);

        const fileInfo = document.createElement('div');
        fileInfo.style.cssText = 'font-size:10px;color:var(--text-muted);margin-bottom:10px;';
        fileInfo.textContent = e.img.name;
        modal.appendChild(fileInfo);

        const popupClick = (idx) => { this.setAnswer(e.imgIdx, e.roiIdx, e.qNum, idx); overlay.remove(); };
        const zoomWrap = document.createElement('div');
        zoomWrap.style.cssText = 'margin-bottom:12px;';
        const zoomEl = this._makeZoomCanvas(e, false, 50);
        if (zoomEl) {
            Array.from(zoomEl.querySelectorAll('canvas')).forEach((cv, idx) => {
                cv.onclick = () => popupClick(idx + 1);
            });
            zoomWrap.appendChild(zoomEl);
        }
        modal.appendChild(zoomWrap);

        const clearRow = document.createElement('div');
        clearRow.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;justify-content:center;';
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '─ 빈칸';
        clearBtn.style.cssText = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;border:2px solid #94a3b8;background:var(--bg-input);color:#64748b;';
        clearBtn.onclick = () => { this.setAnswer(e.imgIdx, e.roiIdx, e.qNum, null); overlay.remove(); };
        clearRow.appendChild(clearBtn);
        modal.appendChild(clearRow);

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '닫기';
        closeBtn.style.cssText = 'padding:4px 10px;font-size:11px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;';
        closeBtn.onclick = () => overlay.remove();
        footer.appendChild(closeBtn);
        const gotoBtn = document.createElement('button');
        gotoBtn.textContent = '→ 분석탭';
        gotoBtn.style.cssText = 'padding:4px 10px;font-size:11px;border:1px solid #3b82f6;background:var(--blue);color:#fff;border-radius:4px;cursor:pointer;';
        gotoBtn.onclick = () => { overlay.remove(); this.goTo(e.imgIdx, e.roiIdx, e.qNum); };
        footer.appendChild(gotoBtn);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    // 썸네일 그리드 — 가로 최대 5열, 세로는 필요한 만큼
    _makeZoomCanvas(e, isSmall, thumbOverride) {
        const img = e.img;
        const row = e.row;
        if (!img || !row.blobs || row.blobs.length === 0) return null;

        // Lazy Loading: 이미지가 해제된 상태면 placeholder 표시
        if (!img.imgElement || !img.imgElement.complete || img.imgElement.width === 0) {
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'padding:8px;background:#f1f5f9;border-radius:4px;font-size:9px;color:var(--text-muted);text-align:center;';
            placeholder.textContent = '이미지 미로드';
            // 비동기로 로드 후 갱신 — 탭 전환/후속 render 시 stale 방지
            if (typeof ImageManager !== 'undefined' && img._imgSrc) {
                const capturedGen = this._activeRenderGen;
                ImageManager.ensureLoaded(img).then(() => {
                    // 이미 새 render가 시작되었거나 탭이 닫혔으면 무시
                    if (capturedGen !== this._activeRenderGen) return;
                    if (!this._isVisible()) return;
                    const container = document.getElementById('correction-content');
                    if (container) this.render(container);
                });
            }
            return placeholder;
        }

        let sourceImg = img.imgElement;
        if (typeof CanvasManager !== 'undefined') {
            const prevIntensity = CanvasManager.intensity;
            const imgIntensity = img.intensity || prevIntensity || 100;
            CanvasManager.intensity = imgIntensity;
            const intensified = CanvasManager._getIntensifiedImage(img);
            CanvasManager.intensity = prevIntensity;
            if (intensified) sourceImg = intensified;
        }

        const THUMB_SIZE = thumbOverride || (isSmall ? 22 : 28);
        const PAD = 3;
        const GAP = isSmall ? 1 : 2;
        const MAX_COLS = 5;

        const container = document.createElement('div');
        container.style.cssText = `display:grid;grid-template-columns:repeat(${Math.min(row.blobs.length, MAX_COLS)},auto);gap:${GAP}px;padding:2px;background:#fff;border:1px solid var(--border);border-radius:3px;justify-content:start;`;

        row.blobs.forEach((b, idx) => {
            const cellWrap = document.createElement('div');
            cellWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0px;';

            const cx = b.cx !== undefined ? b.cx : (b.x + b.w / 2);
            const cy = b.cy !== undefined ? b.cy : (b.y + b.h / 2);
            const cropSize = Math.max(b.w || 10, b.h || 10) + PAD * 2;
            const sx = Math.max(0, Math.round(cx - cropSize / 2));
            const sy = Math.max(0, Math.round(cy - cropSize / 2));
            const sw = Math.min(sourceImg.width - sx, cropSize);
            const sh = Math.min(sourceImg.height - sy, cropSize);

            const cv = document.createElement('canvas');
            cv.width = THUMB_SIZE;
            cv.height = THUMB_SIZE;
            const bgColor = b.isMarked ? '#dcfce7' : '#fff';
            const bdrColor = b.isMarked ? '#22c55e' : '#e4e4e7';
            const bdrW = b.isMarked ? 2 : 1;
            cv.style.cssText = `border:${bdrW}px solid ${bdrColor};border-radius:2px;background:${bgColor};image-rendering:pixelated;`;

            if (!isSmall) {
                cv.style.cursor = 'pointer';
                cv.title = `${(e.choiceLabels && e.choiceLabels[idx]) || (idx + 1)}`;
                cv.onmousedown = (ev) => ev.preventDefault();
                cv.onclick = () => this.setAnswerAndAdvance(e.imgIdx, e.roiIdx, e.qNum, idx + 1, { fromThumbnail: true });
                cv.onmouseenter = () => { cv.style.outline = '2px solid #3b82f6'; };
                cv.onmouseleave = () => { cv.style.outline = ''; };
            }

            const cvctx = cv.getContext('2d');
            cvctx.imageSmoothingEnabled = false;
            if (sw > 0 && sh > 0) cvctx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, THUMB_SIZE, THUMB_SIZE);
            cellWrap.appendChild(cv);

            const label = (e.choiceLabels && e.choiceLabels[idx]) || String(idx + 1);
            const lbl = document.createElement('div');
            const labelColor = b.isMarked ? '#16a34a' : '#64748b';
            lbl.style.cssText = `font-size:${isSmall ? '7' : '8'}px;font-weight:${b.isMarked ? '800' : '600'};color:${labelColor};line-height:1;`;
            lbl.textContent = label;
            cellWrap.appendChild(lbl);

            container.appendChild(cellWrap);
        });

        return container;
    },

    _onInputKey(ev, input, e) {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            const val = input.value.trim();
            let answer = null;
            if (val === '-') {
                answer = null;
            } else if (val === '') {
                answer = e.row.markedAnswer;
            } else if (e.choiceLabels && e.choiceLabels.indexOf(val) >= 0) {
                answer = e.choiceLabels.indexOf(val) + 1;
            } else {
                const num = parseInt(val);
                if (!isNaN(num) && num >= 1 && num <= e.numChoices) answer = num;
                else { Toast.error(`1~${e.numChoices} 범위 숫자 또는 '-' (빈칸)`); return; }
            }
            this.setAnswerAndAdvance(e.imgIdx, e.roiIdx, e.qNum, answer);
        } else if (ev.key === 'Escape') {
            input.blur();
        } else if (ev.key === 'ArrowDown' || (ev.key === 'Tab' && !ev.shiftKey)) {
            ev.preventDefault();
            this._focusNextInput(input);
        } else if (ev.key === 'ArrowUp' || (ev.key === 'Tab' && ev.shiftKey)) {
            ev.preventDefault();
            this._focusPrevInput(input);
        }
    },

    setAnswerAndAdvance(imgIdx, roiIdx, qNum, newAnswer, opts) {
        const fromThumbnail = !!(opts && opts.fromThumbnail);
        const img = App.state.images[imgIdx];
        if (!img || !img.results || !img.results[roiIdx]) return;
        const row = img.results[roiIdx].rows.find(r => r.questionNumber === qNum);
        if (!row) return;

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
        row._xvAutoCorrected = false;
        row.undetected = false;
        this.invalidate();

        if (typeof Grading !== 'undefined') {
            img.gradeResult = Grading.grade(img.results, img);
        }
        // 수험번호/전화번호 ROI를 교정했을 수 있으므로 이름 재매칭
        if (typeof ImageManager !== 'undefined' && ImageManager.applyPhonePrefix) {
            ImageManager.applyPhonePrefix(img);
        }
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();

        const curEl = document.activeElement;
        const curIsInput = curEl && curEl.classList && curEl.classList.contains('correction-input');
        const curColumnType = curIsInput ? curEl.dataset.columnType : null;
        const columnSelector = curColumnType ? `.correction-input-${curColumnType}` : '.correction-input';
        const allInputs = Array.from(document.querySelectorAll(columnSelector));
        const curIdx = curIsInput ? allInputs.indexOf(curEl) : -1;

        this.render(document.getElementById('correction-content'));

        setTimeout(() => {
            const colSel = curColumnType
                ? `.correction-input-${curColumnType}`
                : (document.querySelector('.correction-input-null-pending') ? '.correction-input-null-pending'
                   : (document.querySelector('.correction-input-auto-pending') ? '.correction-input-auto-pending'
                   : '.correction-input'));
            const newInputs = Array.from(document.querySelectorAll(colSel));
            if (newInputs.length === 0) {
                const anyPending = document.querySelector('.correction-input-null-pending, .correction-input-auto-pending, .correction-input-multi-pending');
                if (!anyPending) Toast.success('수정중인 항목을 모두 처리했습니다!');
                return;
            }
            const targetIdx = Math.min(Math.max(0, curIdx >= 0 ? curIdx : 0), newInputs.length - 1);
            const target = newInputs[targetIdx];
            if (target) {
                if (fromThumbnail) Correction._skipScrollOnce = true;
                target.focus();
                target.select();
            }
        }, 50);
    },

    _focusNextInput(input) {
        const columnType = input.dataset.columnType;
        const inputs = Array.from(document.querySelectorAll(`.correction-input-${columnType}`));
        const idx = inputs.indexOf(input);
        if (idx >= 0 && idx < inputs.length - 1) { inputs[idx + 1].focus(); inputs[idx + 1].select(); }
    },
    _focusPrevInput(input) {
        const columnType = input.dataset.columnType;
        const inputs = Array.from(document.querySelectorAll(`.correction-input-${columnType}`));
        const idx = inputs.indexOf(input);
        if (idx > 0) { inputs[idx - 1].focus(); inputs[idx - 1].select(); }
    },

    focusFirst() {
        setTimeout(() => {
            const first = document.querySelector('.correction-input-null-pending')
                       || document.querySelector('.correction-input-auto-pending')
                       || document.querySelector('.correction-input-multi-pending')
                       || document.querySelector('.correction-input');
            if (first) { first.focus(); first.select(); }
        }, 100);
    },

    setAnswer(imgIdx, roiIdx, qNum, newAnswer) {
        this.setAnswerAndAdvance(imgIdx, roiIdx, qNum, newAnswer, { fromThumbnail: true });
    },

    confirmAllAutoPending() {
        const { autoPending } = this.collect();
        if (autoPending.length === 0) return;
        const count = autoPending.length;
        autoPending.forEach(e => {
            const row = e.row;
            row.corrected = true;
            row._userCorrected = true;
            row._xvAutoCorrected = false;
            row.undetected = false;
        });
        this.invalidate();
        const affectedImgs = new Set(autoPending.map(e => e.imgIdx));
        affectedImgs.forEach(imgIdx => {
            const img = App.state.images[imgIdx];
            if (img && img.results && typeof Grading !== 'undefined') img.gradeResult = Grading.grade(img.results, img);
            if (img && typeof ImageManager !== 'undefined' && ImageManager.applyPhonePrefix) ImageManager.applyPhonePrefix(img);
        });
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        this.render(document.getElementById('correction-content'));
        Toast.success(`1.5배 수정중 ${count}개 전체 확인`);
    },

    confirmAllMultiPending() {
        const { multiPending } = this.collect();
        if (multiPending.length === 0) return;
        const count = multiPending.length;
        multiPending.forEach(e => {
            const row = e.row;
            const firstAnswer = row.markedIndices && row.markedIndices.length > 0 ? row.markedIndices[0] : null;
            row.markedAnswer = firstAnswer;
            row.multiMarked = false;
            row.markedIndices = firstAnswer ? [firstAnswer] : [];
            row.corrected = true;
            row._userCorrected = true;
            row.undetected = false;
            if (row.blobs) {
                row.blobs.forEach(b => b.isMarked = false);
                if (firstAnswer && row.blobs[firstAnswer - 1]) row.blobs[firstAnswer - 1].isMarked = true;
            }
        });
        this.invalidate();
        const affectedImgs = new Set(multiPending.map(e => e.imgIdx));
        affectedImgs.forEach(imgIdx => {
            const img = App.state.images[imgIdx];
            if (img && img.results && typeof Grading !== 'undefined') img.gradeResult = Grading.grade(img.results, img);
            if (img && typeof ImageManager !== 'undefined' && ImageManager.applyPhonePrefix) ImageManager.applyPhonePrefix(img);
        });
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        this.render(document.getElementById('correction-content'));
        Toast.success(`중복의심 ${count}개 전체 확인 (1등 값으로)`);
    },

    goTo(imgIdx, roiIdx, qNum) {
        if (typeof switchMainTab === 'function') switchMainTab('analysis');
        if (App.state.currentIndex !== imgIdx) ImageManager.select(imgIdx);
        setTimeout(() => {
            const cell = document.querySelector(`.grid-cell[data-roi="${roiIdx}"][data-q="${qNum}"]`);
            if (cell) {
                cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                cell.style.outline = '3px solid #3b82f6';
                setTimeout(() => { cell.style.outline = ''; }, 2000);
            }
        }, 200);
    },
};
