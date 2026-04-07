// ============================================
// export.js - CSV / Excel 내보내기
// ============================================

const ExportManager = {
    init() {
        App.els.btnExportCsv.addEventListener('click', () => this.exportCsv());
        App.els.btnExportExcel.addEventListener('click', () => this.exportExcel());
    },

    collectData() {
        const ak = App.state.answerKey;
        const images = App.state.images.filter(img => img.results);

        if (images.length === 0) {
            Toast.error('분석된 이미지가 없습니다');
            return null;
        }

        const maxQ = ak ? ak.numQuestions : Math.max(
            ...images.map(img => img.results.reduce((s, r) => s + r.rows.length, 0))
        );

        const rows = [];
        const header = ['파일명'];
        for (let i = 1; i <= maxQ; i++) {
            header.push(`Q${i}_마킹`);
            if (ak) { header.push(`Q${i}_정답`); header.push(`Q${i}_정오`); }
        }
        if (ak) header.push('맞은수', '틀린수', '점수', '총점');
        rows.push(header);

        images.forEach(img => {
            const row = [img.name];
            const allMarked = [];
            img.results.forEach(r => r.rows.forEach(rr => allMarked.push(rr.markedAnswer)));

            for (let i = 0; i < maxQ; i++) {
                row.push(allMarked[i] || '미기입');
                if (ak) {
                    row.push(ak.answers[i] || '');
                    if (img.gradeResult && img.gradeResult.details[i]) {
                        row.push(img.gradeResult.details[i].isCorrect ? 'O' : 'X');
                    } else { row.push(''); }
                }
            }

            if (ak && img.gradeResult) {
                row.push(img.gradeResult.correctCount, img.gradeResult.wrongCount,
                         img.gradeResult.score, img.gradeResult.totalPossible);
            }
            rows.push(row);
        });

        return rows;
    },

    exportCsv() {
        const data = this.collectData();
        if (!data) return;

        const bom = '\uFEFF';
        const csv = data.map(row =>
            row.map(cell => {
                const s = String(cell);
                return (s.includes(',') || s.includes('"') || s.includes('\n'))
                    ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',')
        ).join('\n');

        this.download(bom + csv, 'omr_results.csv', 'text/csv;charset=utf-8');
        Toast.success('CSV 다운로드 완료');
    },

    exportExcel() {
        const data = this.collectData();
        if (!data) return;

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n';
        xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
        xml += '<Worksheet ss:Name="OMR 채점 결과"><Table>\n';

        data.forEach(row => {
            xml += '<Row>\n';
            row.forEach(cell => {
                const v = String(cell).replace(/&/g, '&amp;').replace(/</g, '&lt;');
                const t = typeof cell === 'number' ? 'Number' : 'String';
                xml += `<Cell><Data ss:Type="${t}">${v}</Data></Cell>\n`;
            });
            xml += '</Row>\n';
        });

        xml += '</Table></Worksheet></Workbook>';
        this.download(xml, 'omr_results.xls', 'application/vnd.ms-excel');
        Toast.success('Excel 다운로드 완료');
    },

    download(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }
};
