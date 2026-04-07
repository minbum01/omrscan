// ============================================
// session.js - 세션(전체 작업 상태) 저장/불러오기
// ============================================

const SessionManager = {
    init() {
        document.getElementById('btn-save-session').addEventListener('click', () => this.save());
        document.getElementById('btn-load-session').addEventListener('click', () => this.triggerLoad());
        document.getElementById('session-file-input').addEventListener('change', (e) => this.load(e));
    },

    save() {
        if (App.state.images.length === 0) {
            Toast.error('저장할 데이터가 없습니다');
            return;
        }

        Toast.info('세션 저장 준비 중...');

        // 이미지를 base64로 변환하여 저장
        const session = {
            version: '1.0',
            type: 'omr-session',
            savedAt: new Date().toISOString(),
            answerKey: App.state.answerKey,
            images: App.state.images.map(img => {
                // 이미지를 캔버스로 base64 추출
                const c = document.createElement('canvas');
                c.width = img.imgElement.width;
                c.height = img.imgElement.height;
                c.getContext('2d').drawImage(img.imgElement, 0, 0);
                const dataUrl = c.toDataURL('image/jpeg', 0.85);

                return {
                    name: img.name,
                    dataUrl: dataUrl,
                    rois: img.rois.map(r => ({
                        x: r.x, y: r.y, w: r.w, h: r.h,
                        settings: r.settings || { startNum: 1, numQuestions: 20, numChoices: 5, orientation: 'vertical' }
                    })),
                    // results는 재분석으로 복원 가능하므로 저장하지 않음 (파일 크기 절약)
                };
            })
        };

        const json = JSON.stringify(session);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `omr_session_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        Toast.success('세션 저장 완료');
    },

    triggerLoad() {
        if (App.state.images.length > 0) {
            if (!confirm('현재 작업이 있습니다. 덮어쓰시겠습니까?')) return;
        }
        document.getElementById('session-file-input').click();
    },

    load(e) {
        const file = e.target.files[0];
        if (!file) return;

        Toast.info('세션 불러오는 중...');

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const session = JSON.parse(event.target.result);

                if (session.type !== 'omr-session') {
                    Toast.error('유효한 세션 파일이 아닙니다');
                    return;
                }

                // 상태 초기화
                App.state.images = [];
                App.state.currentIndex = -1;
                App.state.answerKey = session.answerKey || null;

                let loaded = 0;
                const total = session.images.length;

                if (total === 0) {
                    Toast.info('빈 세션입니다');
                    return;
                }

                session.images.forEach((imgData, idx) => {
                    const img = new Image();
                    img.onload = () => {
                        const thumb = ImageManager.createThumbnail(img);
                        App.state.images[idx] = {
                            name: imgData.name,
                            imgElement: img,
                            thumb: thumb,
                            rois: imgData.rois.map(r => ({
                                x: r.x, y: r.y, w: r.w, h: r.h,
                                settings: { ...r.settings }
                            })),
                            results: null,
                            gradeResult: null
                        };

                        loaded++;
                        if (loaded === total) {
                            ImageManager.updateList();
                            ImageManager.select(0);
                            App.updateStatusBar();
                            Toast.success(`세션 불러오기 완료 (${total}장)`);
                        }
                    };
                    img.src = imgData.dataUrl;
                });
            } catch (err) {
                Toast.error('세션 파일 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }
};
