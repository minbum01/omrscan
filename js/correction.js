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
                    <h2 style="font-size:13px; font-weight:700; color:#16a34a; margin-bottom:8px; padding-bottom:4px; border-bottom:2px solid #22c55e;">
                        1.5배 수정중 <span style="background:#22c55e; color:#fff; padding:1px 6px; border-radius:8px; font-size:10px; margin-left:4px;">${autoPending.length}</span>
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
        // 세로형박스 = orientation='vertical' = 한 문항 이미지가 가로로 김 → 가로 레이아웃
        const isWideImage = e.roi.settings.orientation === 'vertical';

        const wrap = document.createElement('div');
        wrap.style.cssText = `padding:8px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; ${isHistory ? 'opacity:0.75;' : ''}`;

        // 메인 컨테이너 (이미지 + 컨트롤 배치 결정)
        const main = document.createElement('div');
        main.style.cssText = isWideImage
            ? 'display:flex; flex-direction:row; gap:10px; align-items:center;'
            : 'display:flex; flex-direction:column; gap:6px; align-items:center;';
        wrap.appendChild(main);

        // ─── 이미지 박스
        const imgBox = document.createElement('div');
        imgBox.style.cssText = 'display:flex; flex-direction:column; gap:3px; align-items:center; flex-shrink:0;';
        const canvas = this._makeZoomCanvas(e);
        if (canvas) imgBox.appendChild(canvas);

        const meta = document.createElement('div');
        const regionName = e.roi.settings.name || `영역${e.roiIdx + 1}`;
        const shortName = (e.img.name.length > 18) ? e.img.name.substring(0, 18) + '…' : e.img.name;
        meta.style.cssText = 'font-size:10px; color:var(--text-muted); text-align:center;';
        meta.innerHTML = `<strong style="color:var(--text);">Q${e.qNum}</strong> · ${regionName}<br><span title="${e.img.name}">${shortName}</span>`;
        imgBox.appendChild(meta);
        main.appendChild(imgBox);

        // ─── 컨트롤 박스
        const ctrl = document.createElement('div');
        ctrl.style.cssText = 'display:flex; flex-direction:column; gap:4px; flex:1;';

        // 선택지 버튼 + 빈칸 + 입력칸 (한 줄)
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:2px; align-items:center;';
        for (let i = 1; i <= e.numChoices; i++) {
            const label = (e.choiceLabels && e.choiceLabels[i - 1]) || String(i);
            const active = e.row.markedAnswer === i;
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.style.cssText = `min-width:26px; padding:3px 6px; border-radius:3px; cursor:pointer;
                font-size:12px; font-weight:${active ? '800' : '500'};
                border:1px solid ${active ? '#3b82f6' : 'var(--border)'};
                background:${active ? 'var(--blue)' : 'var(--bg-input)'};
                color:${active ? '#fff' : 'var(--text)'};`;
            btn.onclick = () => this.setAnswerAndAdvance(e.imgIdx, e.roiIdx, e.qNum, i);
            btnRow.appendChild(btn);
        }
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '─';
        clearBtn.title = '빈칸';
        clearBtn.style.cssText = `min-width:26px; padding:3px 6px; border-radius:3px; cursor:pointer;
            font-size:12px; border:1px solid #94a3b8; background:var(--bg-input); color:#64748b;`;
        clearBtn.onclick = () => this.setAnswerAndAdvance(e.imgIdx, e.roiIdx, e.qNum, null);
        btnRow.appendChild(clearBtn);

        // 텍스트 입력 (현재값 프리필)
        const curAnswer = e.row.markedAnswer;
        const preVal = curAnswer
            ? (e.choiceLabels && e.choiceLabels[curAnswer - 1] ? e.choiceLabels[curAnswer - 1] : String(curAnswer))
            : '';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.maxLength = 3;
        textInput.value = preVal;
        textInput.placeholder = preVal ? '' : '숫자 → Enter';
        textInput.className = isHistory ? 'correction-input-history' : 'correction-input';
        textInput.dataset.imgIdx = e.imgIdx;
        textInput.dataset.roiIdx = e.roiIdx;
        textInput.dataset.qNum = e.qNum;
        const borderColor = isHistory ? 'var(--border)' : (isNull ? '#f59e0b' : '#22c55e');
        textInput.style.cssText = `padding:4px 8px; border:2px solid ${borderColor}; border-radius:4px; font-size:14px; font-weight:700; width:70px; text-align:center; box-sizing:border-box;`;
        textInput.onkeydown = (ev) => this._onInputKey(ev, textInput, e);
        textInput.onfocus = () => {
            wrap.style.outline = '3px solid #3b82f6';
            wrap.style.outlineOffset = '-1px';
            wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 프리필된 값 전체 선택 → 숫자 입력 시 바로 대체됨
            setTimeout(() => textInput.select(), 0);
        };
        textInput.onblur = () => { wrap.style.outline = ''; };
        btnRow.appendChild(textInput);

        ctrl.appendChild(btnRow);

        // 하단: 분석 탭 이동 버튼
        const gotoBtn = document.createElement('button');
        gotoBtn.textContent = '→ 분석 탭';
        gotoBtn.style.cssText = 'padding:3px 8px; font-size:10px; background:var(--bg-input); border:1px solid var(--border); border-radius:3px; cursor:pointer; align-self:flex-start;';
        gotoBtn.onclick = () => this.goTo(e.imgIdx, e.roiIdx, e.qNum);
        ctrl.appendChild(gotoBtn);

        main.appendChild(ctrl);
        return wrap;
    },

    _makeZoomCanvas(e) {
        const img = e.img;
        const row = e.row;
        if (!img || !img.imgElement || !row.blobs || row.blobs.length === 0) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        row.blobs.forEach(b => {
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.x + b.w > maxX) maxX = b.x + b.w;
            if (b.y + b.h > maxY) maxY = b.y + b.h;
        });
        const pad = 6;
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(img.imgElement.width, maxX + pad);
        maxY = Math.min(img.imgElement.height, maxY + pad);

        const cropW = maxX - minX, cropH = maxY - minY;
        if (cropW < 5 || cropH < 5) return null;

        const maxDim = 180; // 4칼럼이라 작게
        const scale = Math.min(maxDim / Math.max(cropW, cropH), 4);
        const outW = Math.round(cropW * scale), outH = Math.round(cropH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        canvas.style.cssText = 'border:1px solid var(--border); border-radius:3px; background:#fff;';
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img.imgElement, minX, minY, cropW, cropH, 0, 0, outW, outH);

        row.blobs.forEach(b => {
            if (!b.isMarked) return;
            const bx = (b.x - minX) * scale;
            const by = (b.y - minY) * scale;
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, b.w * scale, b.h * scale);
        });
        return canvas;
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

        // 현재 input 위치 기억 (수정중 칼럼 기준)
        const allInputs = Array.from(document.querySelectorAll('.correction-input'));
        const curIdx = allInputs.indexOf(document.activeElement);

        this.render(document.getElementById('correction-content'));

        // 다음 수정중 칼럼의 input으로 이동
        setTimeout(() => {
            const newInputs = Array.from(document.querySelectorAll('.correction-input'));
            if (newInputs.length === 0) {
                Toast.success('수정중인 항목을 모두 처리했습니다!');
                return;
            }
            const target = newInputs[Math.min(Math.max(0, curIdx), newInputs.length - 1)];
            if (target) { target.focus(); target.select(); }
        }, 50);
    },

    _focusNextInput(input) {
        // 같은 클래스(수정중 vs 이력)끼리 순회
        const cls = input.className;
        const inputs = Array.from(document.querySelectorAll('.' + cls));
        const idx = inputs.indexOf(input);
        if (idx >= 0 && idx < inputs.length - 1) {
            inputs[idx + 1].focus();
            inputs[idx + 1].select();
        }
    },
    _focusPrevInput(input) {
        const cls = input.className;
        const inputs = Array.from(document.querySelectorAll('.' + cls));
        const idx = inputs.indexOf(input);
        if (idx > 0) {
            inputs[idx - 1].focus();
            inputs[idx - 1].select();
        }
    },

    focusFirst() {
        setTimeout(() => {
            const first = document.querySelector('.correction-input');
            if (first) { first.focus(); first.select(); }
        }, 100);
    },

    setAnswer(imgIdx, roiIdx, qNum, newAnswer) {
        this.setAnswerAndAdvance(imgIdx, roiIdx, qNum, newAnswer);
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
