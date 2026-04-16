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

        // ROI별 블롭 "상대 규격" 추출 (좌표가 아니라 거리·크기만)
        // - 새 OMR 분석 시 BFS가 찾은 블롭이 부족/이상할 때 이 규격으로 빈 자리 보간
        // - 절대 좌표가 아니므로 ROI 크기가 달라도 비율로 확장됨
        const extractBlobPattern = (roi, roiIdx) => {
            const res = imgObj.results && imgObj.results[roiIdx];
            if (!res || !res.rows || res.rows.length === 0) return null;

            // 모든 blob의 cx, cy, w, h 수집
            const allBlobs = [];
            res.rows.forEach((row, rowIdx) => {
                if (!row.blobs) return;
                row.blobs.forEach((b, colIdx) => {
                    if (b.cx === undefined || b.cy === undefined) return;
                    allBlobs.push({ rowIdx, colIdx, cx: b.cx, cy: b.cy, w: b.w, h: b.h });
                });
            });
            if (allBlobs.length < 2) return null;

            // 평균 버블 크기
            const avgBubbleW = allBlobs.reduce((s, b) => s + b.w, 0) / allBlobs.length;
            const avgBubbleH = allBlobs.reduce((s, b) => s + b.h, 0) / allBlobs.length;

            // 열 간격 (같은 행 내 인접 열 간 거리)
            const colSpacings = [];
            res.rows.forEach((row, rowIdx) => {
                const inRow = allBlobs.filter(b => b.rowIdx === rowIdx).sort((a, b) => a.cx - b.cx);
                for (let i = 1; i < inRow.length; i++) colSpacings.push(inRow[i].cx - inRow[i - 1].cx);
            });
            const avgColSpacing = colSpacings.length > 0
                ? colSpacings.reduce((s, v) => s + v, 0) / colSpacings.length : 0;

            // 행 간격 (같은 열 내 인접 행 간 거리)
            const rowSpacings = [];
            const numC = (roi.settings && roi.settings.numChoices) || 5;
            for (let c = 0; c < numC; c++) {
                const inCol = allBlobs.filter(b => b.colIdx === c).sort((a, b) => a.cy - b.cy);
                for (let i = 1; i < inCol.length; i++) rowSpacings.push(inCol[i].cy - inCol[i - 1].cy);
            }
            const avgRowSpacing = rowSpacings.length > 0
                ? rowSpacings.reduce((s, v) => s + v, 0) / rowSpacings.length : 0;

            return {
                savedAt: new Date().toISOString(),
                numRows: res.rows.length,
                numCols: numC,
                orientation: (roi.settings && roi.settings.orientation) || 'vertical',
                // 상대 규격 (ROI 크기 대비 비율로 저장 → 다른 ROI 크기에도 스케일링 가능)
                bubbleWRatio: avgBubbleW / roi.w,     // 버블 폭 / ROI 폭
                bubbleHRatio: avgBubbleH / roi.h,     // 버블 높이 / ROI 높이
                colSpacingRatio: avgColSpacing / roi.w, // 열 간격 / ROI 폭
                rowSpacingRatio: avgRowSpacing / roi.h, // 행 간격 / ROI 높이
                // 샘플 수 (신뢰도 참고)
                sampleBlobCount: allBlobs.length,
            };
        };

        const template = {
            version: '1.1',
            type: 'omr-template',
            savedAt: new Date().toISOString(),
            imageWidth: imgObj.imgElement.width,
            imageHeight: imgObj.imgElement.height,
            // 진하기 — 양식 제작 당시 사용자가 맞춘 값
            intensity: imgObj.intensity || CanvasManager.intensity || 115,
            rois: imgObj.rois.map((roi, idx) => ({
                x: roi.x, y: roi.y, w: roi.w, h: roi.h,
                settings: roi.settings || { startNum: 1, numQuestions: 20, numChoices: 5, orientation: 'vertical' },
                blobPattern: extractBlobPattern(roi, idx),
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

                // ROI 적용 (blobPattern 포함)
                imgObj.rois = template.rois.map(roi => ({
                    x: roi.x, y: roi.y, w: roi.w, h: roi.h,
                    settings: { ...roi.settings },
                    blobPattern: roi.blobPattern || null,
                }));
                imgObj.results = null;
                imgObj.gradeResult = null;

                // 진하기 복원 — 양식 제작 당시 값
                if (template.intensity) {
                    imgObj.intensity = template.intensity;
                    CanvasManager.intensity = template.intensity;
                    // 전체 이미지에 적용 (같은 OMR 폼이면 같은 진하기)
                    (App.state.images || []).forEach(i => { i.intensity = template.intensity; });
                    const intInput = document.getElementById('adj-intensity');
                    const intVal = document.getElementById('adj-intensity-val');
                    if (intInput) intInput.value = template.intensity;
                    if (intVal) intVal.textContent = template.intensity;
                    CanvasManager._intensityCache && CanvasManager._intensityCache.clear();
                }

                CanvasManager.render();
                App.updateStep(App.STEPS.REGION);
                ImageManager.updateList();
                const msg = `양식 불러오기 완료 (영역 ${template.rois.length}개${template.intensity ? `, 진하기 ${template.intensity}%` : ''})`;
                Toast.success(msg);
            } catch (err) {
                Toast.error('파일 형식 오류: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }
};
