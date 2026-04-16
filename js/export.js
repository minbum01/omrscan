// ============================================
// export.js - CSV / XLSX 내보내기
// Scoring.collectData()로 채점/교정 최신값 사용 + SheetJS로 진짜 xlsx 생성
// ============================================

const ExportManager = {
    init() {
        if (App.els.btnExportCsv) App.els.btnExportCsv.addEventListener('click', () => this.exportCsv());
        if (App.els.btnExportExcel) App.els.btnExportExcel.addEventListener('click', () => this.exportExcel());
    },

    // Scoring의 최신 collectData를 호출해 OMR 결과표를 2D 배열로 변환
    _buildRows() {
        if (typeof Scoring === 'undefined' || !Scoring.collectData) {
            Toast.error('Scoring 모듈 필요');
            return null;
        }
        const rows = Scoring.collectData();
        if (!rows || rows.length === 0) {
            Toast.error('채점된 데이터가 없습니다');
            return null;
        }
        const subjects = Scoring.getSubjectList ? Scoring.getSubjectList(rows) : [];

        // 헤더
        const header = ['파일명', '응시번호', '성명', '생년월일', '전화번호'];
        // 과목별 맞은수/점수/만점 + 문항별 마킹/정오
        subjects.forEach(subjectName => {
            header.push(`${subjectName}_맞은수`);
            header.push(`${subjectName}_점수`);
            header.push(`${subjectName}_만점`);
        });
        header.push('총점', '총맞은수', '총만점');

        // 과목별 문항 마킹/정오 (과목명_Q1_마킹, 과목명_Q1_정오, ...)
        const subjectMaxQ = {};
        subjects.forEach(s => {
            const maxQ = rows.reduce((m, r) => {
                const sub = r.subjects && r.subjects[s];
                if (!sub || !sub.answers) return m;
                return Math.max(m, sub.answers.length);
            }, 0);
            subjectMaxQ[s] = maxQ;
            for (let q = 1; q <= maxQ; q++) {
                header.push(`${s}_Q${q}_마킹`);
                header.push(`${s}_Q${q}_정답`);
                header.push(`${s}_Q${q}_정오`);
            }
        });

        const result = [header];

        rows.forEach(r => {
            const row = [
                r.filename || '',
                r.examNo || '',
                r.name || '',
                r.birthday || '',
                r.phone || '',
            ];

            // 과목별 요약
            subjects.forEach(s => {
                const sub = (r.subjects && r.subjects[s]) || {};
                row.push(sub.correctCount != null ? sub.correctCount : '');
                row.push(sub.score != null ? sub.score : '');
                row.push(sub.totalPossible != null ? sub.totalPossible : '');
            });

            // 총점
            row.push(r.totalScore != null ? r.totalScore : (r.score || 0));
            row.push(r.totalCorrect != null ? r.totalCorrect : (r.correctCount || 0));
            row.push(r.totalMax != null ? r.totalMax : (r.totalPossible || 0));

            // 과목별 문항 마킹/정답/정오
            subjects.forEach(s => {
                const sub = (r.subjects && r.subjects[s]) || {};
                const answers = sub.answers || [];
                for (let q = 1; q <= subjectMaxQ[s]; q++) {
                    const a = answers.find(x => x.q === q);
                    if (a) {
                        row.push(a.markedLabel || (a.marked != null ? String(a.marked) : '미기입'));
                        row.push(a.correctAnswer != null ? String(a.correctAnswer) : '');
                        row.push(a.isCorrect ? 'O' : (a.marked != null ? 'X' : ''));
                    } else {
                        row.push('', '', '');
                    }
                }
            });

            result.push(row);
        });

        return result;
    },

    exportCsv() {
        const data = this._buildRows();
        if (!data) return;

        const bom = '\uFEFF';
        const csv = data.map(row =>
            row.map(cell => {
                const s = String(cell == null ? '' : cell);
                return (s.includes(',') || s.includes('"') || s.includes('\n'))
                    ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',')
        ).join('\n');

        this._download(bom + csv, this._filename('csv'), 'text/csv;charset=utf-8');
        Toast.success('CSV 다운로드 완료');
    },

    exportExcel() {
        const data = this._buildRows();
        if (!data) return;

        if (typeof XLSX === 'undefined') {
            Toast.error('XLSX 라이브러리 로드 실패 — 인터넷 연결 확인');
            return;
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);

        // 열 폭 자동 설정 (파일명 길게)
        const colWidths = data[0].map((h, i) => {
            const maxLen = Math.max(
                String(h).length,
                ...data.slice(1).map(r => String(r[i] == null ? '' : r[i]).length)
            );
            return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'OMR 채점 결과');
        XLSX.writeFile(wb, this._filename('xlsx'));
        Toast.success('Excel (xlsx) 다운로드 완료');
    },

    _filename(ext) {
        const now = new Date();
        const ts = now.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
        const examName = (App.state.examName || (typeof SessionManager !== 'undefined' && SessionManager.currentExamName) || 'OMR결과');
        return `${examName}_${ts}.${ext}`;
    },

    _download(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }
};
