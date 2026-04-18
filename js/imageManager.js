// ============================================
// imageManager.js - 이미지 업로드 및 목록 관리
// 큰 이미지는 리사이즈하여 사용, 원본 불변
// ============================================

const ImageManager = {
    MAX_SIZE: 1600, // 가로 또는 세로 최대 px

    init() {
        App.els.fileUpload.addEventListener('change', (e) => this.handleUpload(e));
    },

    handleUpload(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        // 로딩 오버레이 표시
        this.showLoading(`이미지 처리 중... (0/${files.length})`);

        let loaded = 0;
        const total = files.length;

        // 순차 처리 (UI 블로킹 방지)
        const processFile = (index) => {
            if (index >= total) {
                this.hideLoading();
                this.updateList();
                if (App.state.currentIndex === -1) this.select(0);
                App.updateStatusBar();
                Toast.success(`${total}장 업로드 완료`);
                return;
            }

            const file = files[index];
            const reader = new FileReader();
            reader.onload = (event) => {
                const originalImg = new Image();
                originalImg.onload = () => {
                    this.updateLoading(`이미지 처리 중... (${index + 1}/${total}) - ${file.name}`);

                    setTimeout(() => {
                        this.processImage(originalImg, (resized) => {
                            const thumb = this.createThumbnail(resized);

                            App.state.images.push({
                                name: file.name,
                                _originalName: file.name,
                                _pristineName: file.name,
                                imgElement: resized,
                                thumb,
                                rois: [],
                                results: null,
                                gradeResult: null,
                                periodId: App.state.currentPeriodId || 'p1',
                            });
                            if (typeof SessionManager !== 'undefined') SessionManager.markDirty();

                            processFile(index + 1);
                        });
                    }, 30);
                };
                originalImg.src = event.target.result;
            };
            reader.readAsDataURL(file);
        };

        processFile(0);
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
    processImage(img, callback) {
        const w = img.width;
        const h = img.height;

        if (w <= this.MAX_SIZE && h <= this.MAX_SIZE) {
            callback(img);
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

        const result = new Image();
        result.onload = () => callback(result);
        result.src = c.toDataURL('image/jpeg', 0.92);
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

    updateList() {
        const list = App.els.imageList;
        // 검색창은 유지, 나머지만 재생성
        let searchWrap = list.querySelector('.image-search-wrap');
        if (!searchWrap) {
            list.innerHTML = '';
            searchWrap = document.createElement('div');
            searchWrap.className = 'image-search-wrap';
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
        }
        // 검색창 이후 요소만 제거
        while (searchWrap.nextSibling) list.removeChild(searchWrap.nextSibling);

        if (App.state.images.length === 0) {
            // 활성 이미지가 없을 때도 삭제됨 섹션은 계속 렌더링
            // (deletedImages도 비어 있을 때만 안내 문구 후 종료)
            if (!App.state.deletedImages || App.state.deletedImages.length === 0) {
                list.innerHTML += '<div class="image-list-empty">이미지를 업로드하세요.</div>';
                return;
            }
            list.innerHTML += '<div class="image-list-empty" style="padding:8px 12px;">활성 이미지 없음 (아래에서 복원)</div>';
        }

        const query = this._searchQuery.toLowerCase();

        // 오류 있는 이미지를 상단에 정렬 (원본 배열은 유지, 표시 순서만 변경)
        const indices = App.state.images.map((_, i) => i);
        indices.sort((a, b) => {
            const imgA = App.state.images[a];
            const imgB = App.state.images[b];
            const aErr = (imgA.validationErrors && imgA.validationErrors.length > 0)
                || (imgA.results && imgA.results.some(r => r.rows.some(row => row.multiMarked || (!row.undetected && row.markedAnswer === null))));
            const bErr = (imgB.validationErrors && imgB.validationErrors.length > 0)
                || (imgB.results && imgB.results.some(r => r.rows.some(row => row.multiMarked || (!row.undetected && row.markedAnswer === null))));
            if (aErr && !bErr) return -1;
            if (!aErr && bErr) return 1;
            return a - b;
        });

        indices.forEach(index => {
            const imgObj = App.state.images[index];

            // 검색 필터
            if (query && !imgObj.name.toLowerCase().includes(query)) return;

            // 오류/중복 체크 (먼저 계산)
            const hasWarning = imgObj.validationErrors && imgObj.validationErrors.length > 0;
            let hasMulti = false, hasBlank = false;
            if (imgObj.results) {
                hasMulti = imgObj.results.some(res => res.rows.some(r => r.multiMarked));
                hasBlank = imgObj.results.some(res => res.rows.some(r => !r.undetected && r.markedAnswer === null));
            }
            const hasIssue = hasWarning || hasMulti || hasBlank;

            const li = document.createElement('li');
            li.className = `image-list-item${index === App.state.currentIndex ? ' active' : ''}${hasIssue ? ' has-error' : ''}`;
            li.onclick = () => this.select(index);

            // 수기 교정 여부
            let hasCorrected = false;
            if (imgObj.results) {
                hasCorrected = imgObj.results.some(res => res.rows.some(r => r._userCorrected));
            }

            // 상태 태그 (파일명 앞에 붙임) — 점수는 표시하지 않음
            let tag = '';
            if (hasCorrected && imgObj._correctionConfirmed) {
                tag = `<span class="image-tag" style="background:#166534;color:#4ade80;">확정</span>`;
            } else if (hasCorrected) {
                tag = `<span class="image-tag tag-corrected">교정됨</span>`;
            } else if (hasIssue) {
                let parts = [];
                if (hasWarning) {
                    const mc = imgObj.validationErrors.filter(e => e.type === 'missing_questions').reduce((s, e) => s + e.missing, 0);
                    if (mc > 0) parts.push(`누락${mc}`);
                }
                if (hasMulti) {
                    const mc = imgObj.results.reduce((s, res) => s + res.rows.filter(r => r.multiMarked).length, 0);
                    parts.push(`중복${mc}`);
                }
                if (hasBlank) {
                    const bc = imgObj.results.reduce((s, res) => s + res.rows.filter(r => !r.undetected && r.markedAnswer === null).length, 0);
                    parts.push(`미기입${bc}`);
                }
                tag = `<span class="image-tag tag-error">${parts.join('·')}</span>`;
            } else if (imgObj.results) {
                tag = `<span class="image-tag tag-ok">분석됨</span>`;
            }

            const maxLen = 20;
            const displayName = imgObj.name.length > maxLen ? imgObj.name.substring(0, maxLen) + '...' : imgObj.name;

            li.innerHTML = `<div class="image-info-line">${tag}<span class="image-name">${displayName}</span></div>`;

            list.appendChild(li);
        });

        // 삭제된 목록 표시
        if (App.state.deletedImages && App.state.deletedImages.length > 0) {
            const divider = document.createElement('li');
            divider.className = 'image-list-divider';
            divider.textContent = `삭제됨 (${App.state.deletedImages.length})`;
            list.appendChild(divider);

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

                list.appendChild(li);
            });
        }
    },

    select(index) {
        if (index < 0 || index >= App.state.images.length) return;
        App.state.currentIndex = index;
        const imgObj = App.state.images[index];
        if (!imgObj) return;

        // imgElement가 아직 로드 안 됐을 수 있으므로 확인
        const setCanvas = () => {
            App.els.canvas.width = imgObj.imgElement.width;
            App.els.canvas.height = imgObj.imgElement.height;
            App.els.canvasEmpty.style.display = 'none';
            App.els.canvas.style.display = 'block';

            this.updateList();
            // 이미지별 진하기 복원
            const imgIntensity = imgObj.intensity || 115;
            CanvasManager.intensity = imgIntensity;
            const intInput = document.getElementById('adj-intensity');
            const intVal = document.getElementById('adj-intensity-val');
            if (intInput) { intInput.value = imgIntensity; }
            if (intVal) { intVal.textContent = imgIntensity; }

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

        if (imgObj.imgElement.complete && imgObj.imgElement.width > 0) {
            setCanvas();
        } else {
            imgObj.imgElement.onload = setCanvas;
        }
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

        // 시험인원에서 이름 매칭 시도
        if (App.state.students && App.state.students.length > 0 && App.state.matchFields) {
            const mf = App.state.matchFields;
            const matched = App.state.students.find(st => {
                if (mf.examNo && detectedExamNo && st.examNo) {
                    return st.examNo === detectedExamNo;
                }
                if (mf.phone && detectedPhone && st.phone) {
                    return st.phone === detectedPhone;
                }
                return false;
            });
            if (matched && matched.name) detectedName = matched.name;
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
