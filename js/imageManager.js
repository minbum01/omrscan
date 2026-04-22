// ============================================
// imageManager.js - 이미지 업로드 및 목록 관리
// 큰 이미지는 리사이즈하여 사용, 원본 불변
// ============================================

const ImageManager = {
    MAX_SIZE: 2000, // 가로 또는 세로 최대 px
    _loadedImgCache: new Map(), // imgIdx → true (현재 로드된 이미지 추적)
    _MAX_LOADED: 3, // 동시에 메모리에 유지할 최대 이미지 수

    init() {
        App.els.fileUpload.addEventListener('change', (e) => this.handleUpload(e));
    },

    // blob: URL이면 해제 (file:, data: 는 무시)
    _revokeBlobUrl(url) {
        if (typeof url === 'string' && url.startsWith('blob:')) {
            try { URL.revokeObjectURL(url); } catch (_) {}
        }
    },

    // 이미지 배열 일괄 정리 (세션 전환/종료 시)
    releaseImageResources(images) {
        if (!images) return;
        images.forEach(img => {
            if (img && img._imgSrc) this._revokeBlobUrl(img._imgSrc);
        });
    },

    handleUpload(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        // 중복 업로드 가드 — 진행 중에 추가 호출 방지
        if (this._uploading) {
            console.warn('[handleUpload] 업로드 진행 중 — 중복 호출 무시');
            e.target.value = '';
            return;
        }
        this._uploading = true;
        console.log(`[handleUpload] ${files.length}개 업로드 시작`);

        // 로딩 오버레이 표시
        this.showLoading(`이미지 처리 중... (0/${files.length})`);

        let loaded = 0;
        const total = files.length;

        // 병렬 처리 (최대 4스트림, 딜레이 없음)
        const PARALLEL = 4;
        let nextIdx = 0;
        let completed = 0;

        const onAllDone = () => {
            this._uploading = false;
            console.log(`[handleUpload] ${total}개 업로드 완료 (현재 state.images: ${App.state.images.length}장)`);
            this.hideLoading();
            this.invalidateStatus();
            this.updateList();
            if (App.state.currentIndex === -1) this.select(0);
            App.updateStatusBar();
            if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
            if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
            Toast.success(`${total}장 업로드 완료`);
        };

        const processOne = () => {
            if (nextIdx >= total) return;
            const myIdx = nextIdx++;
            const file = files[myIdx];

            const originalUrl = URL.createObjectURL(file);
            const originalImg = new Image();
            let handled = false;

            const finish = () => {
                completed++;
                // 10장마다 UI 갱신 (매번 하면 렉)
                if (completed % 10 === 0 || completed === total) {
                    this.updateLoading(`이미지 처리 중... (${completed}/${total})`);
                }
                if (completed >= total) { onAllDone(); return; }
                processOne(); // 다음 파일 즉시 시작
            };

            originalImg.onload = () => {
                if (handled) return;
                handled = true;
                this.processImage(originalImg, (resized, resizedUrl) => {
                    if (resizedUrl && resizedUrl !== originalUrl) {
                        URL.revokeObjectURL(originalUrl);
                    }
                    const finalUrl = resizedUrl || originalUrl;
                    App.state.images.push({
                        name: file.name,
                        _originalName: file.name,
                        _pristineName: file.name,
                        imgElement: resized,
                        _imgSrc: finalUrl,
                        _id: (typeof UI !== 'undefined') ? UI._genRoiId() : ('img_' + Date.now().toString(36)),
                        rois: [],
                        results: null,
                        gradeResult: null,
                        periodId: App.state.currentPeriodId || 'p1',
                    });
                    finish();
                });
            };
            originalImg.onerror = () => {
                if (handled) return;
                handled = true;
                URL.revokeObjectURL(originalUrl);
                console.warn(`이미지 로드 실패: ${file.name}`);
                finish();
            };
            originalImg.src = originalUrl;
        };

        // 최대 PARALLEL개 동시 시작
        for (let i = 0; i < Math.min(PARALLEL, total); i++) processOne();
        e.target.value = '';
    },

    showLoading(text) {
        let overlay = document.getElementById('upload-loading');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'upload-loading';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-box">
                    <div class="loading-spinner"></div>
                    <p class="loading-text"></p>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        overlay.querySelector('.loading-text').textContent = text;
        overlay.style.display = 'flex';
    },

    updateLoading(text) {
        const overlay = document.getElementById('upload-loading');
        if (overlay) overlay.querySelector('.loading-text').textContent = text;
    },

    hideLoading() {
        const overlay = document.getElementById('upload-loading');
        if (overlay) overlay.style.display = 'none';
    },

    // 이미지가 MAX_SIZE 초과 시 비율 유지하며 리사이즈 (색상 보정 없음)
    // callback(resultImg, resultUrl) — resultUrl은 리사이즈된 경우 새 blob URL, 아니면 null
    processImage(img, callback) {
        // 콜백 단일 호출 보장
        let called = false;
        const safeCb = (resultImg, resultUrl) => {
            if (called) { console.warn('[processImage] 중복 콜백 무시'); return; }
            called = true;
            callback(resultImg, resultUrl);
        };

        const w = img.width;
        const h = img.height;

        if (w <= this.MAX_SIZE && h <= this.MAX_SIZE) {
            safeCb(img, null);
            return;
        }

        const ratio = Math.min(this.MAX_SIZE / w, this.MAX_SIZE / h);
        const newW = Math.round(w * ratio);
        const newH = Math.round(h * ratio);

        const c = document.createElement('canvas');
        c.width = newW;
        c.height = newH;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, newW, newH);

        // toDataURL 대신 toBlob + createObjectURL (메모리·CPU 절약)
        c.toBlob((blob) => {
            if (!blob) { safeCb(img, null); return; }
            const blobUrl = URL.createObjectURL(blob);
            const result = new Image();
            let r_handled = false;
            result.onload = () => {
                if (r_handled) return;
                r_handled = true;
                safeCb(result, blobUrl);
            };
            result.onerror = () => {
                if (r_handled) return;
                r_handled = true;
                URL.revokeObjectURL(blobUrl);
                safeCb(img, null);
            };
            result.src = blobUrl;
        }, 'image/jpeg', 0.92);
    },

    createThumbnail(img) {
        const size = 120;
        const c = document.createElement('canvas');
        const cropSize = Math.min(img.width, img.height);
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img,
            0, 0, cropSize, cropSize,
            0, 0, size, size
        );
        return c.toDataURL('image/jpeg', 0.8);
    },

    // 검색어
    _searchQuery: '',
    // 필터 모드: 'all' | 'normal' | 'error'
    _filterMode: 'all',

    setFilterMode(mode) {
        if (this._filterMode === mode) return;
        this._filterMode = mode;
        this.updateList();
    },

    // 상태 캐시 무효화 (특정 이미지 또는 전체)
    _statusCache: new WeakMap(),
    invalidateStatus(imgObj) {
        if (imgObj) this._statusCache.delete(imgObj);
        else this._statusCache = new WeakMap();
    },

    // 이미지별 상태 요약 (태그/정렬용) — 캐시 사용
    _computeItemStatus(imgObj) {
        const cached = this._statusCache.get(imgObj);
        if (cached) return cached;
        const result = this._computeItemStatusImpl(imgObj);
        this._statusCache.set(imgObj, result);
        return result;
    },

    _computeItemStatusImpl(imgObj) {
        let hasMulti = false, hasBlank = false, hasCorrected = false, hasMissing = false;
        let multiCount = 0, blankCount = 0, missingCount = 0;
        if (imgObj.results) {
            for (const res of imgObj.results) {
                for (const r of res.rows) {
                    if (r.multiMarked) { hasMulti = true; multiCount++; }
                    // undetected 행이라도 사용자가 교정해 markedAnswer가 있으면 해결된 것으로 본다
                    if (r.undetected && (r.markedAnswer === null || r.markedAnswer === undefined)) {
                        hasMissing = true; missingCount++;
                    }
                    // 정상 감지 행인데 빈 마킹 + 교정 안 된 상태
                    if (!r.undetected && r.markedAnswer === null && !r.corrected) {
                        hasBlank = true; blankCount++;
                    }
                    if (r._userCorrected) hasCorrected = true;
                }
            }
        }
        // choice_mismatch 같은 특수 경고는 여전히 validationErrors에서 가져옴 (현재 상태만으론 판별 어려움)
        let hasChoiceMismatch = false;
        if (imgObj.validationErrors) {
            for (const e of imgObj.validationErrors) {
                if (e.type === 'choice_mismatch' || e.type === 'process_error') {
                    hasChoiceMismatch = true; break;
                }
            }
        }
        const hasWarning = hasMissing || hasChoiceMismatch;
        const hasIssue = hasWarning || hasMulti || hasBlank;
        return { hasWarning, hasMulti, hasBlank, hasCorrected, hasIssue, multiCount, blankCount, missingCount };
    },

    _buildItemHtml(imgObj, status) {
        const { hasIssue, hasCorrected, hasWarning, hasMulti, hasBlank, multiCount, blankCount, missingCount } = status;
        let tag = '';
        if (hasCorrected && imgObj._correctionConfirmed) {
            tag = `<span class="image-tag" style="background:#166534;color:#4ade80;">확정</span>`;
        } else if (hasCorrected) {
            tag = `<span class="image-tag tag-corrected">교정됨</span>`;
        } else if (hasIssue) {
            const parts = [];
            if (hasWarning && missingCount > 0) parts.push(`누락${missingCount}`);
            if (hasMulti) parts.push(`중복${multiCount}`);
            if (hasBlank) parts.push(`미기입${blankCount}`);
            tag = `<span class="image-tag tag-error">${parts.join('·')}</span>`;
        } else if (imgObj.results) {
            tag = `<span class="image-tag tag-ok">분석됨</span>`;
        }
        const maxLen = 20;
        const displayName = imgObj.name.length > maxLen ? imgObj.name.substring(0, maxLen) + '...' : imgObj.name;
        return `<div class="image-info-line">${tag}<span class="image-name">${displayName}</span></div>`;
    },

    _ensureSearchWrap(list) {
        let searchWrap = list.querySelector('.image-search-wrap');
        if (searchWrap) return searchWrap;
        list.innerHTML = '';
        searchWrap = document.createElement('div');
        searchWrap.className = 'image-search-wrap';

        // 필터 탭 (전체/정상/오류)
        const tabBar = document.createElement('div');
        tabBar.className = 'image-filter-tabs';
        tabBar.style.cssText = 'display:flex;gap:2px;margin-bottom:4px;';
        const tabs = [
            { mode: 'all',    label: '전체' },
            { mode: 'normal', label: '정상' },
            { mode: 'error',  label: '오류' },
        ];
        tabs.forEach(t => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'image-filter-tab' + (this._filterMode === t.mode ? ' active' : '');
            btn.dataset.filterMode = t.mode;
            btn.textContent = t.label;
            btn.style.cssText = `flex:1;padding:4px 0;font-size:11px;border:1px solid var(--border);background:${this._filterMode === t.mode ? 'var(--blue)' : 'var(--bg-input)'};color:${this._filterMode === t.mode ? '#fff' : 'var(--text-secondary)'};cursor:pointer;border-radius:3px;`;
            btn.addEventListener('click', () => this.setFilterMode(t.mode));
            tabBar.appendChild(btn);
        });
        searchWrap.appendChild(tabBar);

        // 오류 탭 액션 영역 (오류 모드에서만 표시)
        const errorActions = document.createElement('div');
        errorActions.className = 'image-filter-error-actions';
        errorActions.style.cssText = 'display:none;margin-bottom:4px;';
        searchWrap.appendChild(errorActions);

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'image-search';
        searchInput.className = 'image-search-input';
        searchInput.placeholder = '이미지 검색...';
        searchInput.value = this._searchQuery;
        searchInput.addEventListener('input', () => {
            this._searchQuery = searchInput.value;
            this.updateList();
        });
        searchWrap.appendChild(searchInput);
        list.appendChild(searchWrap);
        return searchWrap;
    },

    // 오류 탭 액션 버튼 업데이트 (필터가 'error'일 때만 표시)
    _updateErrorActions(errorCount) {
        const wrap = App.els.imageList.querySelector('.image-filter-error-actions');
        if (!wrap) return;
        if (this._filterMode !== 'error' || errorCount === 0) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        wrap.style.display = '';
        wrap.innerHTML = `
            <button type="button" id="btn-apply-roi-to-errors"
                style="width:100%;padding:6px 8px;font-size:11px;font-weight:700;background:#3b82f6;color:#fff;border:none;border-radius:3px;cursor:pointer;"
                title="현재 보고 있는 이미지의 박스(ROI)를 오류 탭에 있는 모든 이미지에 복사 후 재분석">
                현재 박스를 오류 ${errorCount}장에 적용 + 재분석
            </button>`;
        const btn = wrap.querySelector('#btn-apply-roi-to-errors');
        if (btn) btn.addEventListener('click', () => this.applyRoiToErrorImages());
    },

    // 현재 이미지의 ROI를 오류 탭의 모든 이미지에 복사 + 재분석
    async applyRoiToErrorImages() {
        const srcImg = App.getCurrentImage();
        if (!srcImg || !srcImg.rois || srcImg.rois.length === 0) {
            Toast.error('현재 이미지에 박스(ROI)가 없습니다');
            return;
        }
        const errorImgs = App.state.images.filter(img => {
            const s = this._computeItemStatus(img);
            return s.hasIssue;
        });
        if (errorImgs.length === 0) { Toast.info('오류 이미지가 없습니다'); return; }

        const confirmed = await UIDialog.confirm(
            `오류 이미지 ${errorImgs.length}장에 현재 박스를 적용하고 재분석합니다. 계속?`
        );
        if (!confirmed) return;

        // ROI 복사 (현재 이미지 자신은 제외)
        errorImgs.forEach(img => {
            if (img === srcImg) return;
            img.rois = srcImg.rois.map(r => ({
                x: r.x, y: r.y, w: r.w, h: r.h,
                settings: r.settings
                    ? { ...r.settings,
                        choiceLabels: r.settings.choiceLabels ? [...r.settings.choiceLabels] : undefined,
                        codeList: r.settings.codeList ? [...r.settings.codeList] : [] }
                    : UI.defaultSettings(),
                blobPattern: r.blobPattern || null,
            }));
            img.results = null;
            img.gradeResult = null;
            img.validationErrors = [];
        });

        if (typeof BatchProcess !== 'undefined' && typeof BatchProcess.runForImages === 'function') {
            BatchProcess.runForImages(errorImgs);
        } else {
            Toast.error('일괄 재분석 엔진을 찾을 수 없습니다');
        }
    },

    // 선택 상태만 빠르게 갱신 (DOM 재생성 없음)
    updateListSelection() {
        const list = App.els.imageList;
        if (!list) return;
        const items = list.querySelectorAll('li.image-list-item[data-img-idx]');
        const curIdx = App.state.currentIndex;
        items.forEach(li => {
            const idx = parseInt(li.dataset.imgIdx, 10);
            const isActive = idx === curIdx;
            if (isActive) li.classList.add('active');
            else li.classList.remove('active');
        });
    },

    updateList() {
        const list = App.els.imageList;
        const searchWrap = this._ensureSearchWrap(list);
        // 검색창 이후 요소만 제거
        while (searchWrap.nextSibling) list.removeChild(searchWrap.nextSibling);

        if (App.state.images.length === 0) {
            if (!App.state.deletedImages || App.state.deletedImages.length === 0) {
                list.insertAdjacentHTML('beforeend', '<div class="image-list-empty">이미지를 업로드하세요.</div>');
                return;
            }
            list.insertAdjacentHTML('beforeend', '<div class="image-list-empty" style="padding:8px 12px;">활성 이미지 없음 (아래에서 복원)</div>');
        }

        const query = this._searchQuery.toLowerCase();

        // 각 이미지의 상태를 1회만 계산 (정렬·태그에서 공유)
        const statusByIdx = new Array(App.state.images.length);
        for (let i = 0; i < App.state.images.length; i++) {
            statusByIdx[i] = this._computeItemStatus(App.state.images[i]);
        }

        // 오류 있는 이미지를 상단에 정렬 (원본 배열은 유지, 표시 순서만 변경)
        const indices = App.state.images.map((_, i) => i);
        indices.sort((a, b) => {
            const aErr = statusByIdx[a].hasIssue;
            const bErr = statusByIdx[b].hasIssue;
            if (aErr && !bErr) return -1;
            if (!aErr && bErr) return 1;
            return a - b;
        });

        // DocumentFragment로 한번에 삽입 (reflow 최소화)
        const frag = document.createDocumentFragment();
        const curIdx = App.state.currentIndex;
        let errorCount = 0;
        indices.forEach(index => {
            const imgObj = App.state.images[index];
            if (query && !imgObj.name.toLowerCase().includes(query)) return;

            const status = statusByIdx[index];
            if (status.hasIssue) errorCount++;

            // 필터 모드 적용
            if (this._filterMode === 'normal' && status.hasIssue) return;
            if (this._filterMode === 'error' && !status.hasIssue) return;

            const li = document.createElement('li');
            li.className = `image-list-item${index === curIdx ? ' active' : ''}${status.hasIssue ? ' has-error' : ''}`;
            li.dataset.imgIdx = index;
            li.onclick = () => this.select(index);
            li.innerHTML = this._buildItemHtml(imgObj, status);
            frag.appendChild(li);
        });
        list.appendChild(frag);

        // 오류 탭 액션 영역 갱신
        this._updateErrorActions(errorCount);

        // 삭제된 목록 표시
        if (App.state.deletedImages && App.state.deletedImages.length > 0) {
            const divider = document.createElement('li');
            divider.className = 'image-list-divider';
            divider.textContent = `삭제됨 (${App.state.deletedImages.length})`;
            list.appendChild(divider);

            const delFrag = document.createDocumentFragment();
            App.state.deletedImages.forEach((imgObj, dIdx) => {
                const li = document.createElement('li');
                li.className = 'image-list-item image-list-deleted';

                const dName = imgObj.name.length > 12 ? imgObj.name.substring(0, 12) + '...' : imgObj.name;
                li.innerHTML = `
                    <div class="image-info">
                        <div class="image-name">${dName}</div>
                    </div>
                    <button class="img-restore-btn" data-didx="${dIdx}" title="복원">↩</button>
                `;

                li.querySelector('.img-restore-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.restoreImage(parseInt(e.target.dataset.didx));
                });

                delFrag.appendChild(li);
            });
            list.appendChild(delFrag);
        }
    },

    _selectGen: 0, // select() stale 요청 방지
    select(index) {
        if (index < 0 || index >= App.state.images.length) return;
        App.state.currentIndex = index;
        const imgObj = App.state.images[index];
        if (!imgObj) return;

        // 이 호출의 세대 번호 — 이후 select() 호출 시 무효화
        const myGen = ++this._selectGen;

        // 멀리 있는 이미지 메모리 해제 (Lazy Unload)
        this._evictDistantImages(index);

        // 선택 하이라이트는 즉시 반영 (DOM 재생성 없음)
        this.updateListSelection();

        const setCanvas = () => {
            if (myGen !== this._selectGen) return; // stale guard
            if (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0) return;

            App.els.canvas.width = imgObj.imgElement.width;
            App.els.canvas.height = imgObj.imgElement.height;
            App.els.canvasEmpty.style.display = 'none';
            App.els.canvas.style.display = 'block';

            const imgIntensity = imgObj.intensity || 115;
            CanvasManager.intensity = imgIntensity;
            const intInput = document.getElementById('adj-intensity');
            const intVal = document.getElementById('adj-intensity-val');
            if (intInput) { intInput.value = imgIntensity; }
            if (intVal) { intVal.textContent = imgIntensity; }

            CanvasManager._intensityCache.clear();
            CanvasManager.zoomFit();
            CanvasManager.render();
            CanvasManager.setMode('draw');
            UI.updateRightPanel();

            if (imgObj.gradeResult) {
                App.updateStep(App.STEPS.GRADE);
            } else if (imgObj.results) {
                App.updateStep(App.STEPS.ANALYZE);
            } else {
                App.updateStep(App.STEPS.REGION);
            }
        };

        // imgElement가 해제된 상태면 다시 로드 — 로드 완료까지 기존 캔버스 유지
        if (!imgObj.imgElement || !imgObj.imgElement.complete || imgObj.imgElement.width === 0) {
            const src = imgObj._imgSrc;
            if (src) {
                const newImg = new Image();
                newImg.onload = () => {
                    if (myGen !== this._selectGen) return; // 다른 이미지가 선택됨 → 폐기
                    imgObj.imgElement = newImg;
                    setCanvas();
                };
                newImg.onerror = () => {
                    if (myGen !== this._selectGen) return;
                    Toast.error('이미지 로드 실패');
                };
                newImg.src = src;
            }
        } else {
            setCanvas();
        }
    },

    // 이미지 로드 보장 (Lazy Loading 복원) — Promise 반환
    ensureLoaded(imgObj) {
        return new Promise((resolve) => {
            if (imgObj.imgElement && imgObj.imgElement.complete && imgObj.imgElement.width > 0) {
                resolve(imgObj.imgElement);
                return;
            }
            const src = imgObj._imgSrc;
            if (!src) { resolve(null); return; }
            const newImg = new Image();
            newImg.onload = () => { imgObj.imgElement = newImg; resolve(newImg); };
            newImg.onerror = () => { resolve(null); };
            newImg.src = src;
        });
    },

    // 현재 선택 이미지에서 먼 이미지의 imgElement 해제 (메모리 절약)
    _evictDistantImages(currentIdx) {
        const images = App.state.images;
        if (images.length <= this._MAX_LOADED) return;

        const keep = new Set();
        for (let d = 0; d < Math.ceil(this._MAX_LOADED / 2); d++) {
            if (currentIdx - d >= 0) keep.add(currentIdx - d);
            if (currentIdx + d < images.length) keep.add(currentIdx + d);
        }

        images.forEach((img, idx) => {
            if (keep.has(idx)) return;
            if (!img.imgElement || img.imgElement.width === 0) return;

            // _imgSrc가 없으면 해제하지 않음 (복원 불가)
            if (!img._imgSrc) return;

            // 해제
            img.imgElement.src = '';
            img.imgElement = new Image(); // 빈 Image 객체로 교체
        });
    },

    deleteImage(index) {
        if (!App.state.deletedImages) App.state.deletedImages = [];
        const removed = App.state.images.splice(index, 1)[0];
        if (removed) App.state.deletedImages.push(removed);

        if (App.state.images.length === 0) {
            App.state.currentIndex = -1;
            App.els.canvas.style.display = 'none';
            App.els.canvasEmpty.style.display = '';
            App.updateStep(App.STEPS.UPLOAD);
        } else if (index === App.state.currentIndex) {
            const newIdx = Math.min(index, App.state.images.length - 1);
            App.state.currentIndex = -1;
            this.select(newIdx);
        } else if (index < App.state.currentIndex) {
            App.state.currentIndex--;
        }

        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        if (typeof Correction !== 'undefined' && Correction.invalidate) Correction.invalidate();
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
        this.updateList();
        App.updateStatusBar();
        Toast.info('이미지가 삭제 목록으로 이동됨');
    },

    // 분석 후 수험번호/전화번호/이름으로 파일명 자동 변경
    // 형식: 이름_수험번호OR전화번호_원본파일명
    applyPhonePrefix(imgObj) {
        if (!imgObj || !imgObj.results || !imgObj.rois) return;

        // 순수 원본 파일명 (_pristineName > _originalName > name, 최초 1회 확보)
        if (!imgObj._pristineName) imgObj._pristineName = imgObj._originalName || imgObj.name;
        if (!imgObj._originalName) imgObj._originalName = imgObj.name;
        const baseName = imgObj._pristineName;

        // 각 타입별 감지값 추출
        let detectedName = '', detectedExamNo = '', detectedPhone = '';

        imgObj.rois.forEach((roi, idx) => {
            if (!roi.settings) return;
            const res = imgObj.results[idx];
            if (!res || !res.rows) return;

            const digits = res.rows.map(r => {
                if (r.markedAnswer !== null) {
                    const labels = roi.settings.choiceLabels;
                    return labels && labels[r.markedAnswer - 1] ? labels[r.markedAnswer - 1] : `${r.markedAnswer}`;
                }
                return '?';
            }).join('');

            const rType = roi.settings.type;
            if ((rType === 'exam_no' || rType === 'phone_exam') && digits.length > 0) {
                detectedExamNo = digits;
            } else if (rType === 'phone' && digits.length > 0) {
                detectedPhone = digits;
            }
        });

        // 시험인원에서 이름 매칭 시도 — 정확 일치만 (수험번호/이름은 1:1 대응)
        // ? (감지 실패) 포함 시 매칭 불가 — 사용자가 교정탭에서 채워야 함
        if (App.state.students && App.state.students.length > 0 && App.state.matchFields) {
            const mf = App.state.matchFields;

            const tryMatch = (detected, getter) => {
                if (!detected) return null;
                if (detected.includes('?')) return null; // 불완전 감지 → 매칭 불가
                return App.state.students.find(st => {
                    const v = getter(st);
                    return v && v === detected;
                }) || null;
            };

            let matched = null;
            if (mf.examNo && detectedExamNo) {
                matched = tryMatch(detectedExamNo, st => st.examNo);
            }
            if (!matched && mf.phone && detectedPhone) {
                matched = tryMatch(detectedPhone, st => st.phone);
            }
            if (matched && matched.name) {
                detectedName = matched.name;
            } else if ((mf.examNo && detectedExamNo) || (mf.phone && detectedPhone)) {
                const incomplete = (detectedExamNo && detectedExamNo.includes('?')) || (detectedPhone && detectedPhone.includes('?'));
                console.log(`[매칭] 실패 imgName=${imgObj.name} detectedExamNo=${detectedExamNo} detectedPhone=${detectedPhone}${incomplete ? ' (감지 불완전 — 교정 필요)' : ''}`);
            }
        }

        // 파일명 생성: (이름)홍길동_(수험)12345_원본파일명 (항상 _pristineName 기준으로 재조합)
        const idPart = detectedExamNo || detectedPhone || '';
        if (!idPart && !detectedName) return; // 식별 정보 없으면 변경 안 함

        const parts = [];
        if (detectedName) parts.push(`(이름)${detectedName}`);
        if (detectedExamNo) parts.push(`(수험)${detectedExamNo}`);
        else if (detectedPhone) parts.push(`(전화)${detectedPhone}`);
        parts.push(baseName);
        imgObj.name = parts.join('_');
    },

    restoreImage(deletedIdx) {
        if (!App.state.deletedImages) return;
        const restored = App.state.deletedImages.splice(deletedIdx, 1)[0];
        if (!restored) return;

        App.state.images.push(restored);
        this.updateList();
        App.updateStatusBar();
        Toast.info('이미지 복원됨');
    }
};
