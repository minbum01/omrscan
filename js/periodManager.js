// ============================================
// periodManager.js - 교시(Period) 탭 관리
// ============================================
//
// UI: [1교시] [2교시] [+]  ← 분석/채점 탭 아래, 이미지 목록 위
//
// 인터랙션:
//   - 클릭: 교시 전환
//   - 더블클릭: 이름 인라인 편집
//   - × 버튼: 교시 삭제 (이미지 → 미할당)
//   - + 버튼: 교시 추가
//   - 드래그: 순서 변경
// ============================================

const PeriodManager = {

    init() {
        // 탭 바는 _initPeriods() 호출 시 render()가 실행됨
        // init은 placeholder 역할만 함
    },

    // ─────────────────────────────────────────
    // 탭 렌더링
    // ─────────────────────────────────────────
    render() {
        const bar = document.getElementById('period-tab-bar');
        if (!bar) return;

        bar.innerHTML = '';

        // 레이블
        const label = document.createElement('span');
        label.className = 'period-tab-label';
        label.textContent = '교시';
        bar.appendChild(label);

        // 탭 스크롤 영역
        const tabsWrap = document.createElement('div');
        tabsWrap.style.cssText = 'display:flex; gap:3px; align-items:center; flex:1; overflow-x:auto;';
        tabsWrap.id = 'period-tabs-wrap';

        (App.state.periods || []).forEach(p => {
            tabsWrap.appendChild(this._createTab(p));
        });

        bar.appendChild(tabsWrap);

        // + 버튼
        const addBtn = document.createElement('button');
        addBtn.className = 'period-tab-add';
        addBtn.title = '교시 추가 (자동 이름)';
        addBtn.textContent = '+';
        addBtn.onclick = () => this.addPeriod();
        bar.appendChild(addBtn);
    },

    _createTab(period) {
        const isActive = period.id === App.state.currentPeriodId;

        const tab = document.createElement('div');
        tab.className = 'period-tab' + (isActive ? ' active' : '');
        tab.dataset.periodId = period.id;
        tab.draggable = true;
        tab.title = `${period.name} — 더블클릭으로 이름 변경`;

        // 이름
        const nameSpan = document.createElement('span');
        nameSpan.className = 'period-tab-name';
        nameSpan.textContent = period.name;
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this._startRename(tab, nameSpan, period.id);
        });
        tab.appendChild(nameSpan);

        // × 삭제 버튼 (2개 이상일 때만)
        if ((App.state.periods || []).length > 1) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'period-tab-close';
            closeBtn.textContent = '×';
            closeBtn.title = '교시 삭제';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deletePeriod(period.id);
            });
            tab.appendChild(closeBtn);
        }

        // 클릭 → 교시 전환
        tab.addEventListener('click', () => {
            // 인라인 편집 중이면 무시
            if (tab.querySelector('.period-tab-rename-input')) return;
            this.switchPeriod(period.id);
        });

        // ── 드래그 앤 드롭 (순서 변경) ──
        tab.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', period.id);
            // 약간 지연 후 클래스 추가 (브라우저 드래그 이미지 캡처 후)
            setTimeout(() => tab.classList.add('dragging'), 10);
        });
        tab.addEventListener('dragend', () => {
            tab.classList.remove('dragging');
            document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('drag-over'));
        });
        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('drag-over'));
            tab.classList.add('drag-over');
        });
        tab.addEventListener('dragleave', (e) => {
            // 자식 요소로 이동할 때 불필요한 leave 방지
            if (!tab.contains(e.relatedTarget)) {
                tab.classList.remove('drag-over');
            }
        });
        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            tab.classList.remove('drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== period.id) {
                this._reorderPeriods(draggedId, period.id);
            }
        });

        return tab;
    },

    // ─────────────────────────────────────────
    // 이름 인라인 편집
    // ─────────────────────────────────────────
    _startRename(tab, nameSpan, periodId) {
        const p = (App.state.periods || []).find(p => p.id === periodId);
        if (!p) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = p.name;
        input.className = 'period-tab-rename-input';

        const finish = () => {
            const newName = input.value.trim();
            if (newName && newName !== p.name) {
                p.name = newName;
                SessionManager.markDirty();
                Toast.info(`교시 이름 변경됨: "${newName}"`);
            }
            this.render();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(); }
            if (e.key === 'Escape') { e.preventDefault(); this.render(); }
            e.stopPropagation();
        });
        input.addEventListener('blur', finish);

        nameSpan.replaceWith(input);
        input.focus();
        input.select();
    },

    // ─────────────────────────────────────────
    // 교시 추가
    // ─────────────────────────────────────────
    addPeriod() {
        const n = (App.state.periods || []).length + 1;
        const newId = 'p_' + Date.now();
        const newPeriod = {
            id: newId,
            name: `${n}교시`,
            images: [],
        };
        App.state.periods.push(newPeriod);
        this.switchPeriod(newId);
        SessionManager.markDirty();
        Toast.success(`${n}교시 추가됨`);
    },

    // ─────────────────────────────────────────
    // 교시 삭제
    // ─────────────────────────────────────────
    deletePeriod(periodId) {
        const periods = App.state.periods || [];
        if (periods.length <= 1) {
            Toast.error('교시가 1개 이하일 때는 삭제할 수 없습니다.');
            return;
        }

        const p = periods.find(p => p.id === periodId);
        if (!p) return;

        const imgCount = p.images ? p.images.length : 0;
        const msg = imgCount > 0
            ? `"${p.name}"을 삭제하시겠습니까?\n\n이미지 ${imgCount}장은 삭제 목록으로 이동되어 채점에서 제외됩니다.`
            : `"${p.name}"을 삭제하시겠습니까?`;

        if (!confirm(msg)) return;

        // 이미지 → 미할당 처리 (periodId = null, deletedImages로 이동)
        if (p.images && p.images.length > 0) {
            if (!App.state.deletedImages) App.state.deletedImages = [];
            p.images.forEach(img => {
                img.periodId = null;
                App.state.deletedImages.push(img);
            });
        }

        // 현재 활성 교시였다면 인접 교시로 전환
        const isActive = App.state.currentPeriodId === periodId;

        App.state.periods = periods.filter(p => p.id !== periodId);

        if (isActive) {
            const fallback = App.state.periods[0];
            if (fallback) {
                // 직접 전환 (switchPeriod 는 render 도 호출하므로)
                App.state.currentPeriodId = fallback.id;
                App.state.images = fallback.images;
                App.state.currentIndex = -1;
            }
        }

        this.render();
        ImageManager.updateList();
        App.updateStatusBar();
        SessionManager.markDirty();

        const msg2 = imgCount > 0
            ? `"${p.name}" 삭제됨 (이미지 ${imgCount}장 삭제 목록으로 이동)`
            : `"${p.name}" 삭제됨`;
        Toast.info(msg2);
    },

    // ─────────────────────────────────────────
    // 교시 전환
    // ─────────────────────────────────────────
    switchPeriod(periodId) {
        if (App.state.currentPeriodId === periodId) return;

        App.setCurrentPeriod(periodId);
        this.render();

        // 이미지 목록 갱신
        if (typeof ImageManager !== 'undefined') {
            ImageManager.updateList();
            if (App.state.images.length > 0) {
                ImageManager.select(0);
            } else {
                // 이미지 없는 교시로 전환
                if (App.els.canvas) App.els.canvas.style.display = 'none';
                if (App.els.canvasEmpty) App.els.canvasEmpty.style.display = '';
                App.updateStep(App.STEPS.UPLOAD);
            }
        }

        App.updateStatusBar();
        if (typeof UI !== 'undefined') UI.updateRightPanel();
    },

    // ─────────────────────────────────────────
    // 드래그 순서 변경
    // ─────────────────────────────────────────
    _reorderPeriods(draggedId, targetId) {
        const periods = App.state.periods;
        const fromIdx = periods.findIndex(p => p.id === draggedId);
        const toIdx   = periods.findIndex(p => p.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        const [moved] = periods.splice(fromIdx, 1);
        periods.splice(toIdx, 0, moved);

        this.render();
        SessionManager.markDirty();
    },
};
