// ============================================
// correction.js - 교정 탭 (4칼럼)
// 1,2칼럼: null (수정중 / 이력)
// 3,4칼럼: 1.5배 자동교정 (수정중 / 이력)
// ============================================

const Correction = {
    collect() {
        const nullPending = [], nullHistory = [];
        const autoPending = [], autoHistory = [];

        (App.state.images || []).forEach((img, imgIdx) => {
            if (!img.results) return;
            img.results.forEach((res, roiIdx) => {
                const roi = img.rois[roiIdx];
                if (!roi || !roi.settings) return;

                res.rows.forEach(row => {
                    // 최초 상태 기록 (한 번만) — 교정 이력 추적용
                    if (row._correctionInitial === undefined) {
                        if (row.markedAnswer === null) row._correctionInitial = 'null';
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

                    if (initial === 'null') {
                        if (row.markedAnswer === null) nullPending.push(entry);
                        else nullHistory.push(entry);
                    } else if (initial === 'auto') {
                        if (row._xvAutoCorrected) autoPending.push(entry);
                        else autoHistory.push(entry);
                    }
                });
            });
        });

        return { nullPending, nullHistory, autoPending, autoHistory };
    },

    render(container) {
        const { nullPending, nullHistory, autoPending, autoHistory } = this.collect();

        const badge = document.getElementById('tab-correction-badge');
        const pending = nullPending.length + autoPending.length;
        if (badge) {
            if (pending > 0) { badge.style.display = ''; badge.textContent = pending; }
            else { badge.style.display = 'none'; }
        }

        let html = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <h1 style="font-size:20px; font-weight:700; color:var(--text);">교정</h1>
                <button class="btn btn-primary" onclick="UI.toggleConfirmCorrection()" style="padding:8px 16px;">
                    교정 확정 (전체 이미지)
                </button>
            </div>
            <div style="padding:8px 12px; margin-bottom:16px; background:rgba(59,130,246,0.08); border-left:3px solid #3b82f6; border-radius:4px; font-size:12px; color:var(--text-secondary);">
                <strong style="color:#3b82f6;">⌨ 키패드 워크플로우:</strong>
                숫자 입력 <kbd style="padding:1px 4px; background:#fff; border:1px solid #ccc; border-radius:3px; font-size:11px;">1~9</kbd>
                → <kbd style="padding:1px 4px; background:#fff; border:1px solid #ccc; border-radius:3px; font-size:11px;">Enter</kbd>
                로 저장, 다음으로 이동. 프리필된 값은 그대로 Enter로 확정.
                <strong style="color:#dc2626;">빈칸은 <kbd style="padding:1px 4px; background:#fff; border:1px solid #dc2626; border-radius:3px; font-size:11px;">-</kbd> + Enter</strong>
                (0은 선택지일 수 있음).
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:12px;">
                <!-- 1칼럼: null 수정중 -->
                <div>
                    <h2 style="font-size:13px; font-weight:700; color:#d97706; margin-bottom:8px; padding-bottom:4px; border-bottom:2px solid #f59e0b;">
                        null 수정중 <span style="background:#f59e0b; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px; margin-left:4px;">${nullPending.length}</span>
                    </h2>
                    <div id="col-null-pending" style="display:flex; flex-direction:column; gap:8px;"></div>
                </div>

                <!-- 2칼럼: null 이력 -->
                <div>
                    <h2 style="font-size:13px; font-weight:700; color:#94a3b8; margin-bottom:8px; padding-bottom:4px; border-bottom:2px solid #cbd5e1;">
                        null 이력 <span style="background:#94a3b8; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px; margin-left:4px;">${nullHistory.length}</span>
                    </h2>
                    <div id="col-null-history" style="display:flex; flex-direction:column; gap:8px;"></div>
                </div>

                <!-- 3칼럼: 1.5배 수정중 -->
                <div>
                    <h2 style="font-size:13px; font-weight:700; color:#16a34a; margin-bottom:8px; padding-bottom:4px; border-bottom:2px solid #22c55e; display:flex; align-items:center; justify-content:space-between; gap:6px;">
                        <span>1.5배 수정중 <span style="background:#22c55e; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px; margin-left:4px;">${autoPending.length}</span></span>
                        ${autoPending.length > 0 ? `<button onclick="Correction.confirmAllAutoPending()" style="padding:3px 8px; font-size:11px; background:#22c55e; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:700;">✓ 전체 확인</button>` : ''}
                    </h2>
                    <div id="col-auto-pending" style="display:flex; flex-direction:column; gap:8px;"></div>
                </div>

                <!-- 4칼럼: 1.5배 이력 -->
                <div>
                    <h2 style="font-size:13px; font-weight:700; color:#94a3b8; margin-bottom:8px; padding-bottom:4px; border-bottom:2px solid #cbd5e1;">
                        1.5배 이력 <span style="background:#94a3b8; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px; margin-left:4px;">${autoHistory.length}</span>
                    </h2>
                    <div id="col-auto-history" style="display:flex; flex-direction:column; gap:8px;"></div>
                </div>
            </div>
        `;
        container.innerHTML = html;

        const slots = {
            'col-null-pending':  { items: nullPending,  type: 'null-pending'  },
            'col-null-history':  { items: nullHistory,  type: 'null-history'  },
            'col-auto-pending':  { items: autoPending,  type: 'auto-pending'  },
            'col-auto-history':  { items: autoHistory,  type: 'auto-history'  },
        };
        Object.entries(slots).forEach(([id, { items, type }]) => {
            const el = document.getElementById(id);
            if (items.length === 0) {
                el.innerHTML = `<div style="padding:12px; background:var(--bg-card); border-radius:6px; color:var(--text-muted); font-size:11px; text-align:center;">없음</div>`;
            } else {
                items.forEach(e => el.appendChild(this._renderItem(e, type)));
            }
        });

        this.focusFirst();
    },

    _renderItem(e, type) {
        const isHistory = type.endsWith('-history');
        const isNull = type.startsWith('null');

        // 이력: 이미지만 보이는 컴팩트 카드 → 클릭 시 팝업
        if (isHistory) {
            const wrap = document.createElement('div');
            wrap.style.cssText = `cursor:pointer; background:var(--bg-card); border:1px solid var(--border); border-radius:4px; padding:4px; transition:transform 0.1s;`;
            wrap.onmouseenter = () => { wrap.style.transform = 'scale(1.03)'; wrap.style.borderColor = '#3b82f6'; };
            wrap.onmouseleave = () => { wrap.style.transform = ''; wrap.style.borderColor = 'var(--border)'; };
            wrap.onclick = () => this._openEditPopup(e, type);

            const zoomEl = this._makeZoomCanvas(e, true); // 이력: 작게 + 교정된 블롭 강조
            if (zoomEl) wrap.appendChild(zoomEl);

            // 작은 라벨 (문항번호 + 교정값)
            const curVal = e.row.markedAnswer
                ? (e.choiceLabels && e.choiceLabels[e.row.markedAnswer - 1] ? e.choiceLabels[e.row.markedAnswer - 1] : String(e.row.markedAnswer))
                : '─';
            const lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:10px; color:var(--text-muted); text-align:center; margin-top:2px;';
            lbl.innerHTML = `Q${e.qNum}: <strong style="color:${isNull ? '#d97706' : '#16a34a'};">${curVal}</strong>`;
            wrap.appendChild(lbl);

            return wrap;
        }

        // 수정중: 2×2 그리드 — 왼쪽(큰 썸네일, 2행 병합) + 오른쪽(1행: 입력칸, 2행: 분석탭)
        const wrap = document.createElement('div');
        wrap.style.cssText = `padding:6px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px;
            display:grid; grid-template-columns:auto 1fr; grid-template-rows:auto auto; gap:6px; align-items:center;`;

        // 왼쪽 (2행 병합): 썸네일
        const imgBox = document.createElement('div');
        imgBox.style.cssText = 'grid-row:1 / span 2; grid-column:1;';
        const zoomEl = this._makeZoomCanvas(e, false);
        if (zoomEl) imgBox.appendChild(zoomEl);
        wrap.appendChild(imgBox);

        // 오른쪽 1행: 입력칸
        const curAnswer = e.row.markedAnswer;
        const preVal = curAnswer
            ? (e.choiceLabels && e.choiceLabels[curAnswer - 1] ? e.choiceLabels[curAnswer - 1] : String(curAnswer))
            : '';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.maxLength = 3;
        textInput.value = preVal;
        textInput.placeholder = preVal ? '' : '숫자/Enter';
        textInput.className = `correction-input correction-input-${type}`;
        textInput.dataset.imgIdx = e.imgIdx;
        textInput.dataset.roiIdx = e.roiIdx;
        textInput.dataset.qNum = e.qNum;
        textInput.dataset.columnType = type;
        const borderColor = isNull ? '#f59e0b' : '#22c55e';
        textInput.style.cssText = `grid-row:1; grid-column:2;
            padding:4px 8px; border:2px solid ${borderColor}; border-radius:4px;
            font-size:14px; font-weight:700; width:100%; text-align:center; box-sizing:border-box;`;
        textInput.onkeydown = (ev) => this._onInputKey(ev, textInput, e);
        textInput.onfocus = () => {
            wrap.style.outline = '3px solid #3b82f6';
            wrap.style.outlineOffset = '-1px';
            wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => textInput.select(), 0);
        };
        textInput.onblur = () => { wrap.style.outline = ''; };
        wrap.appendChild(textInput);

        // 오른쪽 2행: 분석 탭 이동 버튼
        const gotoBtn = document.createElement('button');
        gotoBtn.textContent = '→ 분석 탭';
        gotoBtn.style.cssText = `grid-row:2; grid-column:2;
            padding:4px 8px; font-size:11px; background:var(--bg-input); border:1px solid var(--border); border-radius:3px; cursor:pointer; width:100%;`;
        gotoBtn.onclick = () => this.goTo(e.imgIdx, e.roiIdx, e.qNum);
        wrap.appendChild(gotoBtn);

        return wrap;
    },

    // 이력 항목 클릭 시 수정 팝업
    _openEditPopup(e, type) {
        // 기존 팝업 제거
        const existing = document.getElementById('correction-edit-popup');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'correction-edit-popup';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center;';
        overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };

        const modal = document.createElement('div');
        modal.style.cssText = 'background:var(--bg-card); border-radius:8px; padding:20px; min-width:400px; max-width:90vw; box-shadow:0 10px 40px rgba(0,0,0,0.4);';

        const regionName = e.roi.settings.name || `영역${e.roiIdx + 1}`;
        const title = document.createElement('h3');
        title.style.cssText = 'margin:0 0 12px 0; font-size:16px; color:var(--text);';
        title.textContent = `Q${e.qNum} · ${regionName} 수정`;
        modal.appendChild(title);

        const fileInfo = document.createElement('div');
        fileInfo.style.cssText = 'font-size:11px; color:var(--text-muted); margin-bottom:12px;';
        fileInfo.textContent = e.img.name;
        modal.appendChild(fileInfo);

        // 팝업용 큰 줌 이미지 — 썸네일 클릭으로 답 선택
        // _makeZoomCanvas(e, false, 60)은 클릭 핸들러 포함됨
        const zoomWrap = document.createElement('div');
        zoomWrap.style.cssText = 'margin-bottom:16px;';
        // 팝업에서 썸네일 클릭 시 답 설정 후 팝업 닫기
        const popupClick = (idx) => { this.setAnswer(e.imgIdx, e.roiIdx, e.qNum, idx); overlay.remove(); };

        // 썸네일 생성 후 click을 팝업 전용으로 override
        const zoomEl = this._makeZoomCanvas(e, false, 60);
        if (zoomEl) {
            // 각 canvas 클릭 → popupClick로 대체
            Array.from(zoomEl.querySelectorAll('canvas')).forEach((cv, idx) => {
                cv.onclick = () => popupClick(idx + 1);
            });
            zoomWrap.appendChild(zoomEl);
        }
        modal.appendChild(zoomWrap);

        // 빈칸 버튼만 제공 (숫자는 썸네일 클릭으로)
        const clearRow = document.createElement('div');
        clearRow.style.cssText = 'display:flex; gap:4px; margin-bottom:12px; justify-content:center;';
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '─ 빈칸 처리';
        clearBtn.style.cssText = `padding:8px 16px; border-radius:4px; cursor:pointer;
            font-size:13px; border:2px solid #94a3b8; background:var(--bg-input); color:#64748b;`;
        clearBtn.onclick = () => { this.setAnswer(e.imgIdx, e.roiIdx, e.qNum, null); overlay.remove(); };
        clearRow.appendChild(clearBtn);
        modal.appendChild(clearRow);

        // 하단 버튼
        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '닫기';
        closeBtn.style.cssText = 'padding:6px 14px; font-size:12px; border:1px solid var(--border); background:var(--bg-input); border-radius:4px; cursor:pointer;';
        closeBtn.onclick = () => overlay.remove();
        footer.appendChild(closeBtn);

        const gotoBtn = document.createElement('button');
        gotoBtn.textContent = '→ 분석 탭에서 보기';
        gotoBtn.style.cssText = 'padding:6px 14px; font-size:12px; border:1px solid #3b82f6; background:var(--blue); color:#fff; border-radius:4px; cursor:pointer;';
        gotoBtn.onclick = () => { overlay.remove(); this.goTo(e.imgIdx, e.roiIdx, e.qNum); };
        footer.appendChild(gotoBtn);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    // 각 버블을 개별 썸네일로 잘라 가로로 나열 (진하기 적용, 클릭 가능)
    // isSmall: 이력용 작은 크기  |  thumbOverride: 팝업용 큰 크기
    _makeZoomCanvas(e, isSmall, thumbOverride) {
        const img = e.img;
        const row = e.row;
        if (!img || !img.imgElement || !row.blobs || row.blobs.length === 0) return null;

        // 진하기 적용된 이미지 소스
        let sourceImg = img.imgElement;
        if (typeof CanvasManager !== 'undefined') {
            const prevIntensity = CanvasManager.intensity;
            const imgIntensity = img.intensity || prevIntensity || 100;
            CanvasManager.intensity = imgIntensity;
            const intensified = CanvasManager._getIntensifiedImage(img);
            CanvasManager.intensity = prevIntensity;
            if (intensified) sourceImg = intensified;
        }

        const THUMB_SIZE = thumbOverride || (isSmall ? 28 : 36);
        const PAD = 3;
        const GAP = isSmall ? 2 : 3;

        const container = document.createElement('div');
        container.style.cssText = `display:flex; flex-direction:row; gap:${GAP}px; padding:3px; background:#fff; border:1px solid var(--border); border-radius:4px;`;

        row.blobs.forEach((b, idx) => {
            const cellWrap = document.createElement('div');
            cellWrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:1px;';

            const cx = b.cx !== undefined ? b.cx : (b.x + b.w / 2);
            const cy = b.cy !== undefined ? b.cy : (b.y + b.h / 2);
            const cropSize = Math.max(b.w, b.h) + PAD * 2;
            const sx = Math.max(0, Math.round(cx - cropSize / 2));
            const sy = Math.max(0, Math.round(cy - cropSize / 2));
            const sw = Math.min(sourceImg.width - sx, cropSize);
            const sh = Math.min(sourceImg.height - sy, cropSize);

            const cv = document.createElement('canvas');
            cv.width = THUMB_SIZE;
            cv.height = THUMB_SIZE;
            const bgColor = b.isMarked ? '#dcfce7' : '#fff';
            const borderColor = b.isMarked ? '#22c55e' : '#e4e4e7';
            const borderWidth = b.isMarked ? 2 : 1;
            cv.style.cssText = `border:${borderWidth}px solid ${borderColor}; border-radius:3px; background:${bgColor}; image-rendering:pixelated;`;

            // 수정중 카드: 썸네일 클릭 → 답안 선택
            if (!isSmall) {
                cv.style.cursor = 'pointer';
                cv.title = `클릭 → ${(e.choiceLabels && e.choiceLabels[idx]) || (idx + 1)} 선택`;
                cv.onclick = () => this.setAnswerAndAdvance(e.imgIdx, e.roiIdx, e.qNum, idx + 1);
                cv.onmouseenter = () => { cv.style.outline = '2px solid #3b82f6'; };
                cv.onmouseleave = () => { cv.style.outline = ''; };
            }

            const cvctx = cv.getContext('2d');
            cvctx.imageSmoothingEnabled = false;
            if (sw > 0 && sh > 0) {
                cvctx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, THUMB_SIZE, THUMB_SIZE);
            }
            cellWrap.appendChild(cv);

            const label = (e.choiceLabels && e.choiceLabels[idx]) || String(idx + 1);
            const lbl = document.createElement('div');
            const labelColor = b.isMarked ? '#16a34a' : '#64748b';
            lbl.style.cssText = `font-size:${isSmall ? '9' : '10'}px; font-weight:${b.isMarked ? '800' : '600'}; color:${labelColor}; line-height:1;`;
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
                // 빈칸 처리 = '-'만 (0은 선택지 0번일 수 있음)
                answer = null;
            } else if (val === '') {
                // 공백 Enter → 현재값 그대로 유지 (프리필 시나리오)
                answer = e.row.markedAnswer;
            } else if (e.choiceLabels && e.choiceLabels.indexOf(val) >= 0) {
                answer = e.choiceLabels.indexOf(val) + 1;
            } else {
                // 숫자 파싱: 0도 유효 선택지일 수 있음 (수험번호 0번 등)
                // choiceLabels가 있고 '0'이 라벨에 있으면 이미 위에서 처리됨
                // choiceLabels 없으면 1~numChoices 범위만 허용
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

    setAnswerAndAdvance(imgIdx, roiIdx, qNum, newAnswer) {
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

        if (typeof Grading !== 'undefined') {
            img.gradeResult = Grading.grade(img.results, img);
        }
        if (typeof ImageManager !== 'undefined') ImageManager.updateList();

        // 현재 input의 칼럼 타입 기억 (같은 칼럼에서만 다음으로 이동)
        const curEl = document.activeElement;
        const curColumnType = curEl && curEl.dataset ? curEl.dataset.columnType : null;
        const columnSelector = curColumnType
            ? `.correction-input-${curColumnType}`
            : '.correction-input';
        const allInputs = Array.from(document.querySelectorAll(columnSelector));
        const curIdx = allInputs.indexOf(curEl);

        this.render(document.getElementById('correction-content'));

        // 리렌더 후 같은 칼럼의 다음 input으로 이동
        setTimeout(() => {
            const newInputs = Array.from(document.querySelectorAll(columnSelector));
            if (newInputs.length === 0) {
                // 같은 칼럼은 비었음 → 다른 칼럼에 남은 항목 있는지 확인
                const anyPending = document.querySelector('.correction-input-null-pending, .correction-input-auto-pending');
                if (anyPending) {
                    Toast.info(`${curColumnType === 'null-pending' ? 'null' : '1.5배'} 칼럼 완료. 다른 칼럼으로 이동하려면 클릭하세요.`);
                } else {
                    Toast.success('수정중인 항목을 모두 처리했습니다!');
                }
                return;
            }
            const target = newInputs[Math.min(Math.max(0, curIdx), newInputs.length - 1)];
            if (target) { target.focus(); target.select(); }
        }, 50);
    },

    _focusNextInput(input) {
        // 같은 칼럼 내에서만 이동
        const columnType = input.dataset.columnType;
        const inputs = Array.from(document.querySelectorAll(`.correction-input-${columnType}`));
        const idx = inputs.indexOf(input);
        if (idx >= 0 && idx < inputs.length - 1) {
            inputs[idx + 1].focus();
            inputs[idx + 1].select();
        }
    },
    _focusPrevInput(input) {
        const columnType = input.dataset.columnType;
        const inputs = Array.from(document.querySelectorAll(`.correction-input-${columnType}`));
        const idx = inputs.indexOf(input);
        if (idx > 0) {
            inputs[idx - 1].focus();
            inputs[idx - 1].select();
        }
    },

    focusFirst() {
        setTimeout(() => {
            // 우선순위: null-pending → auto-pending (수정중 먼저)
            const first = document.querySelector('.correction-input-null-pending')
                       || document.querySelector('.correction-input-auto-pending')
                       || document.querySelector('.correction-input');
            if (first) { first.focus(); first.select(); }
        }, 100);
    },

    setAnswer(imgIdx, roiIdx, qNum, newAnswer) {
        this.setAnswerAndAdvance(imgIdx, roiIdx, qNum, newAnswer);
    },

    // 1.5배 수정중 전체 일괄 확인 — 값은 그대로 유지, 확정 처리만
    confirmAllAutoPending() {
        const { autoPending } = this.collect();
        if (autoPending.length === 0) return;

        const count = autoPending.length;
        autoPending.forEach(e => {
            const row = e.row;
            row.corrected = true;
            row._userCorrected = true;
            row._xvAutoCorrected = false; // 이력 칼럼으로 이동시킴
            row.undetected = false;
            // markedAnswer, markedIndices, blobs.isMarked 은 기존 값 그대로 유지
        });

        // 영향받은 이미지들의 채점 재실행
        const affectedImgs = new Set(autoPending.map(e => e.imgIdx));
        affectedImgs.forEach(imgIdx => {
            const img = App.state.images[imgIdx];
            if (img && img.results && typeof Grading !== 'undefined') {
                img.gradeResult = Grading.grade(img.results, img);
            }
        });

        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        this.render(document.getElementById('correction-content'));
        Toast.success(`1.5배 수정중 ${count}개 전체 확인 → 이력으로 이동`);
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
