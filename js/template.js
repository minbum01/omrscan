// ============================================
// template.js - 양식(ROI 템플릿) 저장/불러오기
// ============================================

const TemplateManager = {
    init() {
        document.getElementById('btn-save-template').addEventListener('click', () => this.save());
        document.getElementById('btn-load-template').addEventListener('click', () => this.triggerLoad());
        document.getElementById('template-file-input').addEventListener('change', (e) => this.load(e));
    },

    save() {
        const imgObj = App.getCurrentImage();
        if (!imgObj || imgObj.rois.length === 0) {
            Toast.error('저장할 영역이 없습니다. 먼저 ROI를 설정하세요.');
            return;
        }

        const template = {
            version: '1.0',
            type: 'omr-template',
            savedAt: new Date().toISOString(),
            imageWidth: imgObj.imgElement.width,
            imageHeight: imgObj.imgElement.height,
            rois: imgObj.rois.map(roi => ({
                x: roi.x, y: roi.y, w: roi.w, h: roi.h,
                settings: roi.settings || { startNum: 1, numQuestions: 20, numChoices: 5, orientation: 'vertical' }
            }))
        };

        const json = JSON.stringify(template, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'omr_template.json';
        a.click();
        URL.revokeObjectURL(a.href);
        Toast.success('양식 템플릿 저장 완료');
    },

    triggerLoad() {
        document.getElementById('template-file-input').click();
    },

    load(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const template = JSON.parse(event.target.result);

                if (template.type !== 'omr-template') {
                    Toast.error('유효한 양식 파일이 아닙니다');
                    return;
                }

                const imgObj = App.getCurrentImage();
                if (!imgObj) {
                    Toast.error('먼저 이미지를 선택하세요');
                    return;
                }

                // ROI 적용
                imgObj.rois = template.rois.map(roi => ({
                    x: roi.x, y: roi.y, w: roi.w, h: roi.h,
                    settings: { ...roi.settings }
                }));
                imgObj.results = null;
                imgObj.gradeResult = null;

                CanvasManager.render();
                App.updateStep(App.STEPS.REGION);
                ImageManager.updateList();
                Toast.success(`양식 불러오기 완료 (영역 ${template.rois.length}개)`);
            } catch (err) {
                Toast.error('파일 형식 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }
};
