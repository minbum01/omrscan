// ============================================
// scoring.js - 채점 통계 엔진 + 채점 탭 UI
// ============================================

const Scoring = {
    _activeTab: 'omr',
    _defaultMaxQ: 40,
    _showColumnSettings: false,
    _cachedData: null, // collectData() 결과 캐시
    _cacheDirty: true, // 상태 변경 시 true → 다음 collectData() 재계산

    // 캐시 무효화 — 외부/내부 mutation 후 호출
    invalidate() {
        this._cacheDirty = true;
        this._cachedData = null;
    },

    _sortMode: 'student', // 'student' = 인원명단순, 'score_desc' = 총점 내림차순, 'subject_desc' = 과목별 내림차순
    _subjectSortName: null, // 'subject_desc' 시 정렬 기준 과목명
    _currentSubject: null,   // OMR 결과표: 선택된 과목 (null = 자동으로 첫 과목 사용)
    _itemSubject: null,      // 문항분석표: 선택된 과목
    _periodFilter: null,     // 교시 필터 (null = 전체)
    _personalIdx: 0,         // 개인별 성적표: 현재 학생 인덱스
    // 문항분석 그룹 비율 (사용자 커스터마이징)
    _upperPct: 27,
    _lowerPct: 27,
    // 별색 처리
    _manualHL: {},     // 수동 클릭: { 'q1_rate': '#fecaca' }
    _selectedColor: '#fecaca',
    _colors: [
        { c: '#fecaca', l: '빨강' }, { c: '#fed7aa', l: '주황' },
        { c: '#fef08a', l: '노랑' }, { c: '#bbf7d0', l: '초록' },
        { c: '#bfdbfe', l: '파랑' }, { c: '#e9d5ff', l: '보라' },
    ],
    // 규칙 기반 별색
    _hlRules: [
        { id: 'rate_low', label: '정답률 이하', type: 'rate', op: '<=', value: 40, color: '#fecaca', on: false },
        { id: 'rate_high', label: '정답률 이상', type: 'rate', op: '>=', value: 80, color: '#bbf7d0', on: false },
        { id: 'disc_low', label: '변별도 이하', type: 'disc', op: '<=', value: 0.1, color: '#fef08a', on: false },
        { id: 'disc_neg', label: '변별도 음수', type: 'disc', op: '<', value: 0, color: '#fecaca', on: false },
        { id: 'attractive', label: '매력적 오답', type: 'attractive', color: '#fed7aa', on: false, desc: '정답보다 많이 선택된 오답 선택지' },
    ],

    // 점수 표기 포맷 — 정수는 정수, 소수점 있으면 2자리까지(셋째 자리에서 반올림)
    _fmtScore(v) {
        if (v == null || v === '') return '';
        const n = typeof v === 'number' ? v : Number(v);
        if (!isFinite(n)) return v;
        if (Number.isInteger(n)) return String(n);
        return String(Math.round(n * 100) / 100);
    },

    // 만점 표기 포맷 — 1째자리 반올림하여 항상 정수 표시
    _fmtMax(v) {
        if (v == null || v === '') return '';
        const n = typeof v === 'number' ? v : Number(v);
        if (!isFinite(n)) return v;
        return String(Math.round(n));
    },

    // OMR 결과표 열 설정 (사용자 커스터마이징)
    _omrColumns: null, // null이면 기본값 사용
    _getOMRColumns() {
        if (this._omrColumns) return this._omrColumns;

        // 기본 열 (디폴트 표시)
        const cols = [
            { id: 'examNo', label: '응시번호', type: 'info', visible: true },
            { id: 'name', label: '성명', type: 'info', visible: true },
            { id: 'score', label: '점수', type: 'info', visible: true },
        ];

        // OMR 영역에서 가져올 수 있는 추가 열 (디폴트 비표시)
        const roiCols = [
            { id: 'birthday', label: '생년월일', type: 'info', visible: false },
            { id: 'phone', label: '전화번호', type: 'info', visible: false },
            { id: 'subjectCode', label: '과목코드', type: 'info', visible: false },
            { id: 'correctCount', label: '맞은개수', type: 'info', visible: false },
            { id: 'wrongCount', label: '틀린개수', type: 'info', visible: false },
            { id: 'totalPossible', label: '만점', type: 'info', visible: false },
            { id: 'rank', label: '석차', type: 'info', visible: false },
            { id: 'tScore', label: '표준점수', type: 'info', visible: false },
            { id: 'percentile', label: '백분위', type: 'info', visible: false },
            { id: 'filename', label: '파일명', type: 'info', visible: false },
        ];

        // 기타(etc) ROI 영역들도 추가
        const etcNames = new Set();
        (App.state.images || []).forEach(img => {
            (img.rois || []).forEach(roi => {
                if (roi.settings && roi.settings.type === 'etc' && roi.settings.name) {
                    etcNames.add(roi.settings.name);
                }
            });
        });
        etcNames.forEach(name => {
            roiCols.push({ id: 'etc_' + name, label: name, type: 'info', visible: false, etcName: name });
        });

        cols.push(...roiCols);

        // 마킹 + 정오
        for (let i = 1; i <= this._defaultMaxQ; i++) {
            cols.push({ id: `q${i}`, label: `${i}번`, type: 'answer', qNum: i, visible: true });
        }
        for (let i = 1; i <= this._defaultMaxQ; i++) {
            cols.push({ id: `ox${i}`, label: `${i}번`, type: 'ox', qNum: i, visible: true });
        }
        this._omrColumns = cols;
        return cols;
    },

    // 열 토글
    toggleColumn(colId) {
        const cols = this._getOMRColumns();
        const col = cols.find(c => c.id === colId);
        if (col) col.visible = !col.visible;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 열 이름 변경
    renameColumn(colId, newLabel) {
        const cols = this._getOMRColumns();
        const col = cols.find(c => c.id === colId);
        if (col) col.label = newLabel;
    },

    // 열 순서 이동
    moveColumn(colId, direction) {
        const cols = this._getOMRColumns();
        const idx = cols.findIndex(c => c.id === colId);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= cols.length) return;
        [cols[idx], cols[newIdx]] = [cols[newIdx], cols[idx]];
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 열 추가
    addColumn(afterColId, label) {
        const cols = this._getOMRColumns();
        const idx = afterColId ? cols.findIndex(c => c.id === afterColId) : cols.length - 1;
        const newId = 'custom_' + Date.now();
        cols.splice(idx + 1, 0, { id: newId, label: label || '새 열', type: 'custom', visible: true });
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 열 삭제
    removeColumn(colId) {
        const cols = this._getOMRColumns();
        const idx = cols.findIndex(c => c.id === colId);
        if (idx >= 0) cols.splice(idx, 1);
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 문항수 변경
    setMaxQ(n) {
        this._defaultMaxQ = Math.max(1, Math.min(100, parseInt(n) || 40));
        this._omrColumns = null; // 리셋
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // ==========================================
    // 데이터 수집 (시험인원 등록 순서 기준)
    // ==========================================
    collectData() {
        // 캐시 hit
        if (!this._cacheDirty && this._cachedData) {
            return this._cachedData;
        }
        const result = this._collectDataUncached();
        this._cachedData = result;
        this._cacheDirty = false;
        return result;
    },

    _collectDataUncached() {
        // 다교시 모드: 모든 교시 이미지를 수험번호 기준으로 통합
        const allPeriods = App.state.periods || [];

        // 교시 필터 적용 (특정 교시 선택 시)
        if (this._periodFilter) {
            const p = allPeriods.find(x => x.id === this._periodFilter);
            if (p) return this._collectDataMultiPeriod([p]);
            // 필터 대상 없음 → 필터 해제 취급하고 계속 진행
        }

        if (allPeriods.length > 1) {
            return this._collectDataMultiPeriod(allPeriods);
        }

        // 단일 교시 (기존 로직)
        const images = App.state.images || [];
        const students = App.state.students || [];
        const currentPeriod = App.getCurrentPeriod();

        // 1단계: 이미지에서 OMR 데이터 추출 (과목별 분리)
        // 채점(gradeResult) 없이 교정만 해도 내보낼 수 있도록 results만 있으면 포함
        const omrRows = [];
        images.forEach((img, imgIdx) => {
            if (!img.results) return;

            const gr = img.gradeResult || {};
            const row = {
                imgIdx, filename: img._originalName || img.name || '',
                examNo: '', name: '', birthday: '', phone: '', subjectCode: '',
                etcFields: {},
                // 하위호환: 전체 합산 값
                score: gr.score || 0,
                totalPossible: gr.totalPossible || 0,
                correctCount: gr.correctCount || 0,
                wrongCount: gr.wrongCount || 0,
                answers: [], _matched: false,
                // 다과목 구조
                subjects: {},          // { 국어: {score, correctCount, wrongCount, totalPossible, answers}, ... }
                totalScore: 0,
                totalCorrect: 0,
                totalWrong: 0,
                totalMax: 0,
            };

            // ROI별 정답 영역 순회 — details와 순서 일치
            const details = gr.details || [];
            let detailCursor = 0;
            const scorePerQ = (App.state.answerKey && App.state.answerKey.scorePerQuestion) || 5;

            img.rois.forEach((roi, roiIdx) => {
                if (!roi.settings) return;
                const res = img.results[roiIdx];
                if (!res) return;
                const type = roi.settings.type;
                const digits = (res.rows || []).map(r => {
                    if (r.markedAnswer !== null) {
                        const labels = roi.settings.choiceLabels;
                        return labels && labels[r.markedAnswer - 1] ? labels[r.markedAnswer - 1] : String(r.markedAnswer);
                    }
                    return '?';
                }).join('');

                if (type === 'exam_no' || type === 'phone_exam') row.examNo = digits;
                else if (type === 'phone') row.phone = digits;
                else if (type === 'birthday') row.birthday = digits;
                else if (type === 'subject_code') row.subjectCode = digits;
                else if (type === 'etc') row.etcFields[roi.settings.name || '기타'] = digits;
                else if (type === 'subject_answer') {
                    // 과목명 결정: 과목코드 연동 → 코드 감지 후 매칭, 아니면 ROI 이름
                    let rawName = (roi.settings.name && roi.settings.name.trim()) || '';
                    const _codeIds = roi.settings.linkedCodeRoiIds || (roi.settings.linkedCodeRoiId ? [roi.settings.linkedCodeRoiId] : []);
                    if (_codeIds.length > 0 && img.results) {
                        let detCode = '';
                        _codeIds.forEach(id => {
                            const ci = img.rois.findIndex(r => r._id === id);
                            if (ci >= 0 && img.results[ci] && img.results[ci].rows) {
                                img.results[ci].rows.forEach(r => {
                                    if (r.markedAnswer !== null) {
                                        const cl = img.rois[ci].settings.choiceLabels;
                                        detCode += cl && cl[r.markedAnswer - 1] ? cl[r.markedAnswer - 1] : String(r.markedAnswer);
                                    } else { detCode += '?'; }
                                });
                            } else { detCode += '?'; }
                        });
                        if (!detCode.includes('?')) {
                            const matchedSubj = (App.state.subjects || []).find(s => s.code === detCode);
                            if (matchedSubj && matchedSubj.name) rawName = matchedSubj.name;
                            else rawName = rawName || `코드${detCode}`;
                        }
                    }
                    if (!rawName) rawName = `과목${roiIdx + 1}`;
                    const mapped = typeof SubjectManager !== 'undefined' ? SubjectManager.findByRoiName(rawName) : null;
                    const subjectName = (mapped && mapped.name) || rawName;
                    if (!row.subjects[subjectName]) {
                        row.subjects[subjectName] = {
                            score: 0, correctCount: 0, wrongCount: 0, totalPossible: 0, answers: [],
                            // 교시 정보 (툴팁에 표시)
                            periodId:   currentPeriod ? currentPeriod.id   : null,
                            periodName: currentPeriod ? currentPeriod.name : null,
                        };
                    }
                    const sub = row.subjects[subjectName];
                    const labels = roi.settings.choiceLabels;

                    (res.rows || []).forEach(r => {
                        const markedLabel = r.markedAnswer !== null && labels
                            ? (labels[r.markedAnswer - 1] || String(r.markedAnswer))
                            : (r.markedAnswer !== null ? String(r.markedAnswer) : '');

                        const detail = details[detailCursor++] || null;
                        const ans = {
                            q: r.questionNumber,
                            marked: r.markedAnswer,
                            markedLabel,
                            isCorrect: detail ? !!detail.isCorrect : false,
                            correctAnswer: detail ? detail.correctAnswer : null,
                            subject: subjectName,
                        };
                        sub.answers.push(ans);
                        row.answers.push(ans); // 하위호환: 전체 합쳐서도 제공

                        if (detail && detail.correctAnswer !== null && detail.correctAnswer !== undefined) {
                            sub.totalPossible += (detail.maxScore != null ? detail.maxScore : scorePerQ);
                            if (detail.isCorrect) {
                                sub.correctCount++;
                                sub.score += detail.score != null ? detail.score : scorePerQ;
                            } else {
                                sub.wrongCount++;
                            }
                        }
                    });
                }
            });

            // 전체 합산 (다과목일 때는 subjects의 합계 == gradeResult 값)
            Object.values(row.subjects).forEach(s => {
                row.totalScore += s.score;
                row.totalCorrect += s.correctCount;
                row.totalWrong += s.wrongCount;
                row.totalMax += s.totalPossible;
            });

            omrRows.push(row);
        });

        // 2단계: 시험인원 등록 순서 기준으로 정렬
        if (students.length === 0) return omrRows; // 인원 미등록 시 이미지 순

        const rows = [];
        const usedOmr = new Set();

        students.forEach(st => {
            // 인원 → OMR 매칭
            const matched = omrRows.find((r, i) => {
                if (usedOmr.has(i)) return false;
                if (st.examNo && r.examNo && st.examNo === r.examNo) return true;
                if (st.phone && r.phone && st.phone === r.phone) return true;
                if (st.birth && r.birthday && st.birth === r.birthday) return true;
                return false;
            });

            if (matched) {
                const idx = omrRows.indexOf(matched);
                usedOmr.add(idx);
                // 인원 정보로 보완
                matched.name = st.name || matched.name;
                if (!matched.birthday && st.birth) matched.birthday = st.birth;
                if (!matched.phone && st.phone) matched.phone = st.phone;
                if (!matched.examNo && st.examNo) matched.examNo = st.examNo;
                matched._matched = true;
                rows.push(matched);
            } else {
                // OMR 없는 인원 → 공란 행
                rows.push({
                    imgIdx: -1, filename: '',
                    examNo: st.examNo || '', name: st.name || '',
                    birthday: st.birth || '', phone: st.phone || '',
                    subjectCode: '', etcFields: {},
                    score: '', totalPossible: '', correctCount: '', wrongCount: '',
                    answers: [], subjects: {},
                    totalScore: '', totalCorrect: '', totalWrong: '', totalMax: '',
                    _matched: false, _noOmr: true,
                });
            }
        });

        // 매칭 안 된 OMR도 추가 (미등록 인원)
        omrRows.forEach((r, i) => {
            if (!usedOmr.has(i)) rows.push(r);
        });

        // 정렬 적용
        if (this._sortMode === 'score_desc') {
            rows.sort((a, b) => {
                if (a._noOmr && !b._noOmr) return 1;
                if (!a._noOmr && b._noOmr) return -1;
                if (a._noOmr && b._noOmr) return 0;
                return (b.score || 0) - (a.score || 0);
            });
        } else if (this._sortMode === 'subject_desc' && this._subjectSortName) {
            const sn = this._subjectSortName;
            rows.sort((a, b) => {
                if (a._noOmr && !b._noOmr) return 1;
                if (!a._noOmr && b._noOmr) return -1;
                if (a._noOmr && b._noOmr) return 0;
                const aS = (a.subjects && a.subjects[sn] && a.subjects[sn].score) || 0;
                const bS = (b.subjects && b.subjects[sn] && b.subjects[sn].score) || 0;
                return bS - aS;
            });
        }
        // 'student' = 기본 (인원명단 순서, 이미 정렬됨)

        return rows;
    },

    // ==========================================
    // 다교시 수집 (교시 간 학생 매칭 + subjects 병합)
    // ==========================================
    _collectDataMultiPeriod(periods) {
        const students = App.state.students || [];

        // ── Phase 1: 각 교시의 이미지에서 omrRow 추출 ──
        const allOmrRows = [];

        periods.forEach(period => {
            const images   = period.images || [];
            const scorePerQ = (period.answerKey && period.answerKey.scorePerQuestion) || 5;

            images.forEach((img, localIdx) => {
                if (!img.results) return;

                const gr = img.gradeResult || {};
                const row = {
                    periodId: period.id, periodName: period.name,
                    _localIdx: localIdx,
                    imgIdx: -1,
                    filename: img._originalName || img.name || '',
                    examNo: '', name: '', birthday: '', phone: '',
                    subjectCode: '', etcFields: {},
                    score: gr.score || 0,
                    totalPossible: gr.totalPossible || 0,
                    correctCount:  gr.correctCount  || 0,
                    wrongCount:    gr.wrongCount     || 0,
                    answers: [],
                    subjects: {},
                    totalScore: 0, totalCorrect: 0, totalWrong: 0, totalMax: 0,
                    _matched: false,
                };

                const details      = gr.details || [];
                let   detailCursor = 0;

                img.rois.forEach((roi, roiIdx) => {
                    if (!roi.settings) return;
                    const res  = img.results[roiIdx];
                    if (!res)  return;
                    const type = roi.settings.type;
                    const digits = (res.rows || []).map(r => {
                        if (r.markedAnswer !== null) {
                            const lb = roi.settings.choiceLabels;
                            return lb && lb[r.markedAnswer - 1] ? lb[r.markedAnswer - 1] : String(r.markedAnswer);
                        }
                        return '?';
                    }).join('');

                    if      (type === 'exam_no' || type === 'phone_exam') row.examNo   = digits;
                    else if (type === 'phone')    row.phone    = digits;
                    else if (type === 'birthday') row.birthday = digits;
                    else if (type === 'subject_code') row.subjectCode = digits;
                    else if (type === 'etc')      row.etcFields[roi.settings.name || '기타'] = digits;
                    else if (type === 'subject_answer') {
                        let rawName2 = (roi.settings.name && roi.settings.name.trim()) || '';
                        const _cIds2 = roi.settings.linkedCodeRoiIds || (roi.settings.linkedCodeRoiId ? [roi.settings.linkedCodeRoiId] : []);
                        if (_cIds2.length > 0 && img.results) {
                            let dc = '';
                            _cIds2.forEach(id => {
                                const ci = img.rois.findIndex(r => r._id === id);
                                if (ci >= 0 && img.results[ci] && img.results[ci].rows) {
                                    img.results[ci].rows.forEach(r => {
                                        if (r.markedAnswer !== null) { const cl = img.rois[ci].settings.choiceLabels; dc += cl && cl[r.markedAnswer-1] ? cl[r.markedAnswer-1] : String(r.markedAnswer); }
                                        else { dc += '?'; }
                                    });
                                } else { dc += '?'; }
                            });
                            if (!dc.includes('?')) {
                                const ms = (App.state.subjects || []).find(s => s.code === dc);
                                if (ms && ms.name) rawName2 = ms.name;
                                else rawName2 = rawName2 || `코드${dc}`;
                            }
                        }
                        if (!rawName2) rawName2 = `과목${roiIdx + 1}`;
                        const rawName = rawName2;
                        const mapped = typeof SubjectManager !== 'undefined' ? SubjectManager.findByRoiName(rawName) : null;
                        const subjectName = (mapped && mapped.name) || rawName;
                        if (!row.subjects[subjectName]) {
                            row.subjects[subjectName] = {
                                score: 0, correctCount: 0, wrongCount: 0, totalPossible: 0,
                                answers: [],
                                periodId:   period.id,
                                periodName: period.name,
                            };
                        }
                        const sub    = row.subjects[subjectName];
                        const labels = roi.settings.choiceLabels;

                        (res.rows || []).forEach(r => {
                            const markedLabel = r.markedAnswer !== null && labels
                                ? (labels[r.markedAnswer - 1] || String(r.markedAnswer))
                                : (r.markedAnswer !== null ? String(r.markedAnswer) : '');
                            const detail = details[detailCursor++] || null;
                            const ans = {
                                q: r.questionNumber, marked: r.markedAnswer, markedLabel,
                                isCorrect: detail ? !!detail.isCorrect : false,
                                correctAnswer: detail ? detail.correctAnswer : null,
                                subject: subjectName,
                            };
                            sub.answers.push(ans);
                            row.answers.push(ans);
                            if (detail && detail.correctAnswer !== null && detail.correctAnswer !== undefined) {
                                sub.totalPossible += (detail.maxScore != null ? detail.maxScore : scorePerQ);
                                if (detail.isCorrect) { sub.correctCount++; sub.score += detail.score != null ? detail.score : scorePerQ; }
                                else { sub.wrongCount++; }
                            }
                        });
                    }
                });

                Object.values(row.subjects).forEach(s => {
                    row.totalScore   += s.score;
                    row.totalCorrect += s.correctCount;
                    row.totalWrong   += s.wrongCount;
                    row.totalMax     += s.totalPossible;
                });
                allOmrRows.push(row);
            });
        });

        // ── Phase 2: 학생별 매칭 및 교시 간 subjects 병합 ──
        if (students.length === 0) return allOmrRows; // 인원 미등록

        const rows       = [];
        const usedIndices = new Set();

        const _matchRow = (st, r) =>
            (st.examNo && r.examNo && st.examNo === r.examNo) ||
            (st.phone  && r.phone  && st.phone  === r.phone)  ||
            (st.birth  && r.birthday && st.birth === r.birthday);

        students.forEach(st => {
            // 이 학생과 매칭되는 모든 교시 rows
            const matchedPairs = [];
            allOmrRows.forEach((r, i) => {
                if (!usedIndices.has(i) && _matchRow(st, r)) matchedPairs.push({ r, i });
            });

            if (matchedPairs.length === 0) {
                // 어느 교시에도 OMR 없음
                rows.push({
                    imgIdx: -1, filename: '',
                    examNo: st.examNo || '', name: st.name || '',
                    birthday: st.birth || '', phone: st.phone || '',
                    subjectCode: '', etcFields: {},
                    score: '', totalPossible: '', correctCount: '', wrongCount: '',
                    answers: [], subjects: {},
                    totalScore: '', totalCorrect: '', totalWrong: '', totalMax: '',
                    _matched: false, _noOmr: true,
                });
                return;
            }

            matchedPairs.forEach(({ i }) => usedIndices.add(i));

            // 교시별 rows 병합
            const primary = matchedPairs[0].r;
            const merged  = {
                imgIdx: primary._localIdx,
                filename: primary.filename,
                examNo:    primary.examNo    || st.examNo    || '',
                name:      st.name           || primary.name || '',
                birthday:  primary.birthday  || st.birth     || '',
                phone:     primary.phone     || st.phone     || '',
                subjectCode: primary.subjectCode || '',
                etcFields:   { ...primary.etcFields },
                score: 0, totalPossible: 0, correctCount: 0, wrongCount: 0,
                answers: [], subjects: {},
                totalScore: 0, totalCorrect: 0, totalWrong: 0, totalMax: 0,
                _matched: true,
                _periodRows: matchedPairs.map(p => p.r),
            };

            matchedPairs.forEach(({ r }) => {
                Object.entries(r.subjects).forEach(([sn, sd]) => {
                    if (!merged.subjects[sn]) {
                        merged.subjects[sn] = { ...sd, answers: [...sd.answers] };
                    } else {
                        // 같은 과목명 → 합산 (기획서 확정 #1)
                        const ex = merged.subjects[sn];
                        ex.score          += sd.score;
                        ex.correctCount   += sd.correctCount;
                        ex.wrongCount     += sd.wrongCount;
                        ex.totalPossible  += sd.totalPossible;
                        ex.answers         = [...ex.answers, ...sd.answers];
                    }
                });
                merged.answers = [...merged.answers, ...r.answers];
            });

            Object.values(merged.subjects).forEach(s => {
                merged.totalScore   += s.score;
                merged.totalCorrect += s.correctCount;
                merged.totalWrong   += s.wrongCount;
                merged.totalMax     += s.totalPossible;
            });
            merged.score          = merged.totalScore;
            merged.totalPossible  = merged.totalMax;
            merged.correctCount   = merged.totalCorrect;
            merged.wrongCount     = merged.totalWrong;

            rows.push(merged);
        });

        // 매칭 안 된 OMR (미등록 수험생)
        allOmrRows.forEach((r, i) => {
            if (!usedIndices.has(i)) rows.push(r);
        });

        // 정렬
        if (this._sortMode === 'score_desc') {
            rows.sort((a, b) => {
                if (a._noOmr && !b._noOmr) return 1;
                if (!a._noOmr && b._noOmr) return -1;
                if (a._noOmr && b._noOmr)  return 0;
                return (b.score || 0) - (a.score || 0);
            });
        } else if (this._sortMode === 'subject_desc' && this._subjectSortName) {
            const sn = this._subjectSortName;
            rows.sort((a, b) => {
                if (a._noOmr && !b._noOmr) return 1;
                if (!a._noOmr && b._noOmr) return -1;
                if (a._noOmr && b._noOmr)  return 0;
                const aS = (a.subjects && a.subjects[sn] && a.subjects[sn].score) || 0;
                const bS = (b.subjects && b.subjects[sn] && b.subjects[sn].score) || 0;
                return bS - aS;
            });
        }
        return rows;
    },

    // ==========================================
    // 과목 관련 헬퍼
    // ==========================================
    // rows에서 등장한 모든 과목명을 순서대로 반환 (첫 등장 순)
    getSubjectList(rows) {
        const seen = [];
        const set = new Set();
        rows.forEach(r => {
            if (!r.subjects) return;
            Object.keys(r.subjects).forEach(name => {
                if (!set.has(name)) { set.add(name); seen.push(name); }
            });
        });
        return seen;
    },

    // 특정 행의 과목 데이터 가져오기 (없으면 null)
    getSubjectData(row, subjectName) {
        if (!row || !row.subjects) return null;
        return row.subjects[subjectName] || null;
    },

    // 동명이인 감지: 이름이 같은데 수험번호가 다른 행들에 _sameName=true 표시
    _markDuplicateNames(rows) {
        const byName = {};
        rows.forEach(r => {
            const name = (r.name || '').trim();
            if (!name) return;
            if (!byName[name]) byName[name] = new Set();
            byName[name].add(r.examNo || '');
        });
        rows.forEach(r => {
            const name = (r.name || '').trim();
            r._sameName = !!(name && byName[name] && byName[name].size > 1);
        });
    },

    // ==========================================
    // 통계 계산
    // ==========================================
    calcStats(rows) {
        const validRows = rows.filter(r => !r._noOmr);
        if (validRows.length === 0) return null;
        const N = validRows.length;

        // 전체 합산 (기존 동작 유지: 단일 과목일 땐 r.score == totalScore)
        const scores = validRows.map(r => r.score);
        const mean = scores.reduce((s, v) => s + v, 0) / N;
        const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / N;
        const stdDev = Math.sqrt(variance);

        const sorted = [...scores].sort((a, b) => b - a);
        validRows.forEach(r => {
            r.rank = sorted.filter(s => s > r.score).length + 1;
            r.tScore = stdDev > 0 ? ((r.score - mean) / stdDev) * 20 + 100 : 100;
            r.percentile = N > 1 ? ((N - r.rank) / (N - 1)) * 100 : 100;
        });

        // 과목별 독립 통계 (각 r.subjects[subj]에 rank/tScore/percentile 기록)
        const subjectNames = this.getSubjectList(validRows);
        subjectNames.forEach(subj => {
            const subScores = validRows.map(r => (r.subjects[subj] ? r.subjects[subj].score : 0));
            const subMean = subScores.reduce((s, v) => s + v, 0) / N;
            const subVar = subScores.reduce((s, v) => s + (v - subMean) ** 2, 0) / N;
            const subStd = Math.sqrt(subVar);
            const subSorted = [...subScores].sort((a, b) => b - a);
            validRows.forEach(r => {
                const s = r.subjects[subj];
                if (!s) return;
                s.rank = subSorted.filter(v => v > s.score).length + 1;
                s.tScore = subStd > 0 ? ((s.score - subMean) / subStd) * 20 + 100 : 100;
                s.percentile = N > 1 ? ((N - s.rank) / (N - 1)) * 100 : 100;
            });
        });

        return { N, mean, stdDev, max: Math.max(...scores), min: Math.min(...scores), subjects: subjectNames };
    },

    // ==========================================
    // 문항분석
    // ==========================================
    calcItemAnalysis(rows, subjectName) {
        rows = rows.filter(r => !r._noOmr);
        if (rows.length === 0) return [];
        // 과목별 분석이면 해당 과목으로 투영 (score/answers가 과목 기준으로 바뀜)
        if (subjectName) {
            rows = rows
                .map(r => r.subjects && r.subjects[subjectName] ? this._projectRow(r, subjectName) : null)
                .filter(Boolean);
            if (rows.length === 0) return [];
        }
        const N = rows.length;
        const uPct = this._upperPct / 100;
        const lPct = this._lowerPct / 100;
        const sortedRows = [...rows].sort((a, b) => b.score - a.score);
        const upperN = Math.max(1, Math.ceil(N * uPct));
        const lowerN = Math.max(1, Math.ceil(N * lPct));
        const upperRows = sortedRows.slice(0, upperN);
        const midRows = sortedRows.slice(upperN, N - lowerN);
        const lowerRows = sortedRows.slice(N - lowerN);
        const upperHalf = sortedRows.slice(0, Math.ceil(N / 2));
        const lowerHalf = sortedRows.slice(Math.ceil(N / 2));

        const allQ = new Set();
        rows.forEach(r => r.answers.forEach(a => allQ.add(a.q)));
        const qNumbers = [...allQ].sort((a, b) => a - b);

        return qNumbers.map(q => {
            const gc = (group) => group.filter(r => { const a = r.answers.find(x => x.q === q); return a && a.isCorrect; }).length;
            const U = gc(upperRows), M = gc(midRows), L = gc(lowerRows), T = gc(rows);
            const sampleAns = rows[0].answers.find(a => a.q === q);
            const correctRate = (T / N) * 100;
            // 변별도 = (U - L) / ((상위비율+하위비율)/2 × N)
            const avgPct = (uPct + lPct) / 2;
            const discrimination = (avgPct * N) > 0 ? (U - L) / (avgPct * N) : 0;

            // 반응분포 (상부50% / 하부50%)
            const getDist = (group) => {
                const dist = { blank: 0, multi: 0 };
                for (let n = 1; n <= 7; n++) dist[n] = 0;
                group.forEach(r => {
                    const a = r.answers.find(x => x.q === q);
                    if (!a || a.marked === null) dist.blank++;
                    else if (a.marked === -1) dist.multi++; // 중복
                    else {
                        const key = a.marked;
                        if (key >= 1 && key <= 7) dist[key] = (dist[key] || 0) + 1;
                        else dist[key] = (dist[key] || 0) + 1;
                    }
                });
                dist.total = group.length;
                return dist;
            };

            return { q, correctAnswer: sampleAns ? sampleAns.correctAnswer : null,
                upper: { correct: U, wrong: upperN - U, total: upperN },
                mid: { correct: M, wrong: midRows.length - M, total: midRows.length },
                lower: { correct: L, wrong: lowerN - L, total: lowerN },
                totalCorrect: T, correctRate, discrimination,
                distUpper: getDist(upperHalf),
                distLower: getDist(lowerHalf),
                distTotal: getDist(rows),
            };
        });
    },

    // ==========================================
    // CSV 다운로드
    // ==========================================
    _dl(csv, name) {
        const n = SessionManager.currentSessionName || '';
        const d = new Date().toISOString().slice(0, 10);
        SubjectManager._downloadFile(csv, `${name}_${n}_${d}.csv`);
    },

    // XLSX 다운로드 (AoA → 시트)
    _dlXlsx(aoa, name, sheetName) {
        if (typeof XLSX === 'undefined') { Toast.error('XLSX 라이브러리 로드 실패'); return; }
        const n = SessionManager.currentSessionName || '';
        const d = new Date().toISOString().slice(0, 10);
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        // 열 폭
        if (aoa[0]) {
            ws['!cols'] = aoa[0].map((h, i) => {
                const maxLen = Math.max(String(h).length, ...aoa.slice(1).map(r => String(r[i] == null ? '' : r[i]).length));
                return { wch: Math.min(Math.max(maxLen + 2, 6), 30) };
            });
        }
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
        XLSX.writeFile(wb, `${name}_${n}_${d}.xlsx`);
    },

    // 성적일람표용 AoA 빌더
    _buildReportAoA(rows) {
        const etcKeys = [...new Set(rows.flatMap(r => Object.keys(r.etcFields || {})))];
        const subjects = this.getSubjectList(rows);
        const groups = subjects.length > 0
            ? [...subjects.map(s => ({ key: s, label: s, isTotal: false })),
               ...(subjects.length > 1 ? [{ key: '__total__', label: '총점', isTotal: true }] : [])]
            : [{ key: '__total__', label: '전체', isTotal: true }];
        const metrics = ['맞은수', '점수', '표준점수', '석차', '백분위'];

        const header = ['응시번호', '성명', '생년월일', ...etcKeys];
        groups.forEach(g => metrics.forEach(m => header.push(`${g.label}_${m}`)));
        const aoa = [header];
        rows.forEach(r => {
            const row = [r.examNo || '', r.name || '', r.birthday || '', ...etcKeys.map(k => (r.etcFields && r.etcFields[k]) || '')];
            if (r._noOmr) {
                groups.forEach(() => metrics.forEach(() => row.push('')));
            } else {
                groups.forEach(g => {
                    const src = g.isTotal
                        ? { correctCount: r.totalCorrect, score: r.totalScore, tScore: r.tScore, rank: r.rank, percentile: r.percentile }
                        : (r.subjects && r.subjects[g.key]) || {};
                    row.push(src.correctCount !== undefined ? this._fmtScore(src.correctCount) : '');
                    row.push(src.score !== undefined ? this._fmtScore(src.score) : '');
                    row.push(src.tScore ? Math.round(src.tScore * 10) / 10 : '');
                    row.push(src.rank != null ? src.rank : '');
                    row.push(src.percentile != null ? Math.round(src.percentile * 10) / 10 : '');
                });
            }
            aoa.push(row);
        });
        return aoa;
    },

    // 문항분석표용 AoA 빌더
    _buildItemAoA(items) {
        const uPct = this._upperPct, lPct = this._lowerPct;
        const mPct = 100 - uPct - lPct;
        const header = ['문항', '정답', `상위${uPct}%O`, `상위${uPct}%X`, `중위${mPct}%O`, `중위${mPct}%X`, `하위${lPct}%O`, `하위${lPct}%X`, '정답률(%)', '변별도'];
        const aoa = [header];
        items.forEach(i => {
            aoa.push([i.q, i.correctAnswer || '', i.upper.correct, i.upper.wrong, i.mid.correct, i.mid.wrong, i.lower.correct, i.lower.wrong,
                Math.round(i.correctRate * 10) / 10, Math.round(i.discrimination * 1000) / 1000]);
        });
        return aoa;
    },

    // XLSX 다운로드 엔트리 (현재 탭 기준)
    downloadOMRxlsx(rows) {
        if (!rows.length) return;
        const subj = this._resolveSubject(rows, this._currentSubject);
        const aoa = this._buildOMRAoA(rows, subj);
        this._dlXlsx(aoa, subj ? `OMR결과표_${subj}` : 'OMR결과표', 'OMR결과');
    },
    downloadAllOMRxlsx(rows) {
        if (!rows.length) return;
        const list = this.getSubjectList(rows);
        if (typeof XLSX === 'undefined') { Toast.error('XLSX 라이브러리 로드 실패'); return; }
        const n = SessionManager.currentSessionName || '';
        const d = new Date().toISOString().slice(0, 10);
        const wb = XLSX.utils.book_new();
        if (list.length === 0) {
            const aoa = this._buildOMRAoA(rows, null);
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            XLSX.utils.book_append_sheet(wb, ws, 'OMR결과');
        } else {
            list.forEach(subj => {
                const aoa = this._buildOMRAoA(rows, subj);
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                XLSX.utils.book_append_sheet(wb, ws, subj.slice(0, 28));
            });
        }
        XLSX.writeFile(wb, `OMR결과표_${n}_${d}.xlsx`);
    },
    downloadReportXlsx(rows) {
        if (!rows.length) return;
        this._dlXlsx(this._buildReportAoA(rows), '성적일람표', '성적일람표');
    },
    downloadItemXlsx(items) {
        if (!items.length) return;
        const subj = this._resolveSubject(this.collectData(), this._itemSubject);
        this._dlXlsx(this._buildItemAoA(items), subj ? `문항분석표_${subj}` : '문항분석표', '문항분석');
    },

    // rows + 선택 과목 → 2D 배열 (CSV/XLSX 공용) — 헤더 visible 상태 반영
    _buildOMRAoA(rows, subj) {
        const proj = subj
            ? rows.map(r => {
                if (r._noOmr) return r;
                if (!r.subjects || !r.subjects[subj]) return { ...r, _noSubject: true };
                return this._projectRow(r, subj);
            })
            : rows;
        const cols = this._getOMRColumns();
        const infoCols = cols.filter(c => c.type === 'info' && c.visible);
        const showAnswers = cols.some(c => c.type === 'answer' && c.visible);
        const showOX = cols.some(c => c.type === 'ox' && c.visible);

        const qSet = new Set();
        proj.forEach(r => (r.answers || []).forEach(a => qSet.add(a.q)));
        const actualMax = qSet.size ? Math.max(...qSet) : 0;
        const targetMax = Math.max(actualMax, this._defaultMaxQ || 0);
        const qs = Array.from({ length: targetMax }, (_, i) => i + 1);

        const header = infoCols.map(c => c.label);
        if (showAnswers) qs.forEach(q => header.push(`${q}번`));
        if (showOX) qs.forEach(q => header.push(`${q}번정오`));

        const aoa = [header];
        proj.forEach(r => {
            const row = [];
            const blank = r._noOmr || r._noSubject;
            infoCols.forEach(col => {
                if (blank && col.type !== 'info') { row.push(''); return; }
                if (col.id === 'examNo') row.push(r.examNo || '');
                else if (col.id === 'name') row.push(r.name || '');
                else if (col.id === 'score') row.push(blank ? '' : this._fmtScore(r.score));
                else if (col.id === 'birthday') row.push(r.birthday || '');
                else if (col.id === 'phone') row.push(r.phone || '');
                else if (col.id === 'rank') row.push(r.rank != null ? r.rank : '');
                else if (col.id === 'percentile') row.push(r.percentile != null ? r.percentile.toFixed(1) : '');
                else if (col.id === 'tScore') row.push(r.tScore ? Math.round(r.tScore * 10) / 10 : '');
                else row.push('');
            });
            if (showAnswers) {
                qs.forEach(q => {
                    if (blank) { row.push(''); return; }
                    const a = (r.answers || []).find(x => x.q === q);
                    row.push(a ? (a.markedLabel || '') : '');
                });
            }
            if (showOX) {
                qs.forEach(q => {
                    if (blank) { row.push(''); return; }
                    const a = (r.answers || []).find(x => x.q === q);
                    row.push(a ? (a.isCorrect ? 'O' : 'X') : '');
                });
            }
            aoa.push(row);
        });
        return aoa;
    },

    // rows + 선택 과목 → CSV 문자열
    _buildOMRCsv(rows, subj) {
        const aoa = this._buildOMRAoA(rows, subj);
        return aoa.map(row => row.map(cell => {
            const s = String(cell == null ? '' : cell);
            return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',')).join('\n');
    },

    // 현재 과목 CSV
    downloadOMR(rows) {
        if (!rows.length) return;
        const subj = this._resolveSubject(rows, this._currentSubject);
        const csv = this._buildOMRCsv(rows, subj);
        this._dl(csv, subj ? `OMR결과표_${subj}` : 'OMR결과표');
    },

    // 전체 과목 CSV (과목별 파일)
    downloadAllOMR(rows) {
        if (!rows.length) return;
        const list = this.getSubjectList(rows);
        if (list.length === 0) {
            this._dl(this._buildOMRCsv(rows, null), 'OMR결과표');
            return;
        }
        list.forEach(subj => {
            const csv = this._buildOMRCsv(rows, subj);
            this._dl(csv, `OMR결과표_${subj}`);
        });
    },

    downloadReport(rows) {
        if (!rows.length) return;
        const etcKeys = [...new Set(rows.flatMap(r => Object.keys(r.etcFields)))];
        const subjects = this.getSubjectList(rows);
        const groups = subjects.length > 0
            ? [...subjects.map(s => ({ key: s, label: s, isTotal: false })),
               ...(subjects.length > 1 ? [{ key: '__total__', label: '총점', isTotal: true }] : [])]
            : [{ key: '__total__', label: '전체', isTotal: true }];
        const metrics = ['맞은수', '점수', '표준점수', '석차', '백분위'];

        // 헤더
        let csv = '응시번호,성명,생년월일';
        etcKeys.forEach(k => csv += `,${k}`);
        groups.forEach(g => {
            metrics.forEach(m => csv += `,${g.label}_${m}`);
        });
        csv += '\n';

        // 데이터
        rows.forEach(r => {
            csv += `${r.examNo},${r.name},${r.birthday}`;
            etcKeys.forEach(k => csv += `,${r.etcFields[k] || ''}`);
            if (r._noOmr) {
                groups.forEach(() => csv += ',,,,,');
                csv += '\n';
                return;
            }
            groups.forEach(g => {
                const src = g.isTotal
                    ? { correctCount: r.totalCorrect, score: r.totalScore, tScore: r.tScore, rank: r.rank, percentile: r.percentile }
                    : (r.subjects && r.subjects[g.key]) || {};
                const cc = src.correctCount !== undefined ? this._fmtScore(src.correctCount) : '';
                const sc = src.score !== undefined ? this._fmtScore(src.score) : '';
                const ts = src.tScore ? src.tScore.toFixed(1) : '';
                const rk = src.rank || '';
                const pc = src.percentile != null ? src.percentile.toFixed(1) : '';
                csv += `,${cc},${sc},${ts},${rk},${pc}`;
            });
            csv += '\n';
        });
        this._dl(csv, '성적일람표');
    },

    _buildItemCsv(items) {
        const uPct = this._upperPct, lPct = this._lowerPct;
        const mPct = 100 - uPct - lPct;
        let csv = `문항,정답,상위${uPct}%O,상위${uPct}%X,중위${mPct}%O,중위${mPct}%X,하위${lPct}%O,하위${lPct}%X,정답률(%),변별도\n`;
        items.forEach(i => {
            csv += `${i.q},${i.correctAnswer||''},${i.upper.correct},${i.upper.wrong},${i.mid.correct},${i.mid.wrong},${i.lower.correct},${i.lower.wrong},${i.correctRate.toFixed(1)},${i.discrimination.toFixed(3)}\n`;
        });
        return csv;
    },

    downloadItem(items) {
        if (!items || !items.length) return;
        this._dl(this._buildItemCsv(items), '문항분석표');
    },

    downloadItemCurrent() {
        const rows = this.collectData();
        const subj = this._resolveSubject(rows, this._itemSubject);
        const items = this.calcItemAnalysis(rows, subj);
        if (!items.length) return;
        this._dl(this._buildItemCsv(items), subj ? `문항분석표_${subj}` : '문항분석표');
    },

    downloadItemCurrentXlsx() {
        const rows = this.collectData();
        const subj = this._resolveSubject(rows, this._itemSubject);
        const items = this.calcItemAnalysis(rows, subj);
        if (!items.length) return;
        this._dlXlsx(this._buildItemAoA(items), subj ? `문항분석표_${subj}` : '문항분석표', '문항분석');
    },

    downloadItemAllXlsx() {
        const rows = this.collectData();
        const list = this.getSubjectList(rows);
        if (typeof XLSX === 'undefined') { Toast.error('XLSX 라이브러리 로드 실패'); return; }
        const n = SessionManager.currentSessionName || '';
        const d = new Date().toISOString().slice(0, 10);
        const wb = XLSX.utils.book_new();
        if (list.length === 0) {
            const items = this.calcItemAnalysis(rows, null);
            if (items.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(this._buildItemAoA(items)), '문항분석');
        } else {
            list.forEach(subj => {
                const items = this.calcItemAnalysis(rows, subj);
                if (items.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(this._buildItemAoA(items)), subj.slice(0, 28));
            });
        }
        XLSX.writeFile(wb, `문항분석표_${n}_${d}.xlsx`);
    },

    downloadItemAll() {
        const rows = this.collectData();
        const list = this.getSubjectList(rows);
        if (list.length === 0) {
            const items = this.calcItemAnalysis(rows, null);
            if (items.length) this._dl(this._buildItemCsv(items), '문항분석표');
            return;
        }
        list.forEach(subj => {
            const items = this.calcItemAnalysis(rows, subj);
            if (items.length) this._dl(this._buildItemCsv(items), `문항분석표_${subj}`);
        });
    },

    // ==========================================
    // 메인 렌더링
    // ==========================================
    // 분석 탭의 최신 결과(img.results)를 기반으로 전체 이미지 재채점
    // + 삭제되지 않은 이미지/교시 모두 대상
    regradeFromAnalysis() {
        if (typeof Grading === 'undefined' || !Grading.grade) {
            Toast.error('Grading 모듈 누락');
            return;
        }
        let graded = 0, skipped = 0;
        const periods = App.state.periods || [];
        const targetImgs = periods.length > 0
            ? periods.flatMap(p => p.images || [])
            : (App.state.images || []);

        targetImgs.forEach(img => {
            if (!img || !img.results) { skipped++; return; }
            const gr = Grading.grade(img.results, img);
            if (gr) { img.gradeResult = gr; graded++; }
            else skipped++;
        });

        if (typeof ImageManager !== 'undefined') ImageManager.updateList();
        if (typeof SessionManager !== 'undefined') SessionManager.markDirty();
        this.renderScoringPanel(document.getElementById('scoring-content'));

        if (graded === 0 && skipped === 0) Toast.info('이미지가 없습니다');
        else if (graded === 0) Toast.info('분석된 이미지가 없거나 정답이 없습니다');
        else Toast.success(`${graded}장 채점 완료${skipped > 0 ? ` · 건너뜀 ${skipped}장` : ''}`);
    },

    renderScoringPanel(container) {
        const rows = this.collectData();
        this._markDuplicateNames(rows);
        const stats = this.calcStats(rows);
        const itemSubj = this._resolveSubject(rows, this._itemSubject);
        const items = this.calcItemAnalysis(rows, itemSubj);

        let html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <!-- 헤더 -->
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; gap:12px;">
                <h1 style="font-size:22px; font-weight:700; margin:0; color:var(--text);">채점 결과</h1>
                <div style="display:flex; align-items:center; gap:10px;">
                    <button class="btn btn-primary btn-sm" onclick="Scoring.regradeFromAnalysis()" title="분석 탭의 최신 결과를 가져와 채점 갱신">
                        ↻ 분석 결과 가져와 채점
                    </button>
                    <span style="font-size:13px; color:var(--text-muted);">${SessionManager.currentSessionName || ''}</span>
                </div>
            </div>`;

        // 요약 카드
        if (stats) {
            html += `
            <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:24px;">
                ${this._statCard('응시 인원', `${stats.N}명`, '#3b82f6')}
                ${this._statCard('평균', `${this._fmtScore(stats.mean)}점`, '#8b5cf6')}
                ${this._statCard('표준편차', `${this._fmtScore(stats.stdDev)}`, '#6366f1')}
                ${this._statCard('최고점', `${this._fmtScore(stats.max)}점`, '#22c55e')}
                ${this._statCard('최저점', `${this._fmtScore(stats.min)}점`, '#ef4444')}
            </div>`;
        }

        if (rows.length === 0) {
            html += `<div style="text-align:center; padding:60px 20px; color:var(--text-muted); font-size:15px;">
                표시할 데이터가 없습니다.<br>분석 탭에서 이미지를 분석하거나 시험관리에서 인원을 등록하세요.<br><span style="font-size:12px;">※ 정답이 없어도 채점 탭에 진입할 수 있습니다.</span>
            </div></div>`;
            container.innerHTML = html;
            return;
        }

        // 탭 바
        html += `<div style="display:flex; gap:2px; margin-bottom:16px; border-bottom:2px solid var(--border);">
            ${this._tabBtn('omr', 'OMR 결과표')}
            ${this._tabBtn('report', '성적일람표')}
            ${this._tabBtn('item', '문항분석표')}
            ${this._tabBtn('personal', '개인별 성적표')}
            <div style="margin-left:auto; display:flex; align-items:center;">
                <button class="btn btn-sm btn-primary" onclick="PublicReport.generate()" style="font-size:11px; padding:5px 12px;">게시용 성적표</button>
            </div>
        </div>`;

        // 탭 내용
        html += `<div id="scoring-tab-content">`;
        if (this._activeTab === 'omr') html += this._renderOMR(rows);
        else if (this._activeTab === 'report') html += this._renderReport(rows);
        else if (this._activeTab === 'item') html += this._renderItem(items, rows.length);
        else if (this._activeTab === 'personal') html += this._renderPersonal(rows, stats);
        html += `</div></div>`;

        container.innerHTML = html;
    },

    _statCard(label, value, color) {
        return `<div style="background:white; border-radius:10px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,0.08); border-left:4px solid ${color};">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${label}</div>
            <div style="font-size:20px; font-weight:700; color:${color};">${value}</div>
        </div>`;
    },

    _tabBtn(id, label) {
        const active = this._activeTab === id;
        return `<button onclick="Scoring._activeTab='${id}'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));"
            style="padding:8px 20px; font-size:13px; font-weight:${active ? '700' : '500'}; border:none;
            background:${active ? 'white' : 'transparent'}; color:${active ? 'var(--blue)' : 'var(--text-muted)'};
            border-bottom:${active ? '3px solid var(--blue)' : '3px solid transparent'};
            cursor:pointer; transition:all 0.15s;">${label}</button>`;
    },

    // ==========================================
    // OMR 결과표
    // ==========================================
    // 선택된 과목 기준으로 row의 값들을 투영 (score/answers/correctCount/rank/tScore/percentile)
    _projectRow(r, subj) {
        if (!subj || !r.subjects || !r.subjects[subj]) return r;
        const s = r.subjects[subj];
        return Object.assign({}, r, {
            score: s.score,
            correctCount: s.correctCount,
            wrongCount: s.wrongCount,
            totalPossible: s.totalPossible,
            answers: s.answers,
            rank: s.rank,
            tScore: s.tScore,
            percentile: s.percentile,
        });
    },

    // OMR/문항분석용 현재 과목 결정 (없으면 첫 과목 자동 선택, '__ALL__'은 전체)
    _resolveSubject(rows, stored) {
        if (stored === '__ALL__') return null; // 전체 (과목 투영 안 함)
        const list = this.getSubjectList(rows);
        if (list.length === 0) return null;
        if (stored && list.includes(stored)) return stored;
        return list[0];
    },

    setCurrentSubject(name) {
        this._currentSubject = name || null;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    setItemSubject(name) {
        this._itemSubject = name || null;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    setPeriodFilter(id) {
        this._periodFilter = id || null;
        this._currentSubject = null; // 과목 리셋 (교시별 과목 다를 수 있음)
        this._itemSubject = null;
        this.invalidate(); // collectData가 _periodFilter를 참조하므로 캐시 무효화
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    _periodDropdown() {
        const periods = App.state.periods || [];
        if (periods.length <= 1) return '';
        const current = this._periodFilter || '';
        const labels = (typeof PeriodManager !== 'undefined') ? PeriodManager.getDisplayLabels() : {};
        const opts = [`<option value="">전체</option>`,
            ...periods.map(p => `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${labels[p.id] || p.name}</option>`)
        ].join('');
        return `<label style="font-size:11px; display:flex; align-items:center; gap:6px;">
            <span style="font-weight:600; color:var(--text-muted);">교시:</span>
            <select onchange="Scoring.setPeriodFilter(this.value)"
                style="padding:4px 8px; font-size:11px; border:1px solid var(--border); border-radius:6px; background:white; font-weight:600;">
                ${opts}
            </select>
        </label>`;
    },

    _subjectDropdown(rows, storedField, handler) {
        const list = this.getSubjectList(rows);
        if (list.length === 0) return '';
        const stored = this[storedField];
        const isAll = stored === '__ALL__';
        const resolved = isAll ? null : this._resolveSubject(rows, stored);
        const opts = [
            `<option value="__ALL__" ${isAll ? 'selected' : ''}>전체</option>`,
            ...list.map(s => `<option value="${s}" ${s === resolved ? 'selected' : ''}>${s}</option>`)
        ].join('');
        return `<label style="font-size:11px; display:flex; align-items:center; gap:6px;">
            <span style="font-weight:600; color:var(--text-muted);">과목:</span>
            <select onchange="Scoring.${handler}(this.value)"
                style="padding:4px 8px; font-size:11px; border:1px solid var(--border); border-radius:6px; background:white; font-weight:600;">
                ${opts}
            </select>
        </label>`;
    },

    _subjectDropdownNoAll(rows, selected, handler) {
        const list = this.getSubjectList(rows);
        if (list.length <= 1) return '';
        const opts = list.map(s => `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`).join('');
        return `<label style="font-size:11px; display:flex; align-items:center; gap:6px;">
            <span style="font-weight:600; color:var(--text-muted);">과목:</span>
            <select onchange="Scoring.${handler}(this.value)"
                style="padding:4px 8px; font-size:11px; border:1px solid var(--border); border-radius:6px; background:white; font-weight:600;">
                ${opts}
            </select>
        </label>`;
    },

    _renderOMR(rowsOrig) {
        const cols = this._getOMRColumns().filter(c => c.visible);
        // OMR 결과표는 항상 특정 과목 1개만 (전체 선택 시 첫 과목 자동)
        const subjList = this.getSubjectList(rowsOrig);
        let subj = this._resolveSubject(rowsOrig, this._currentSubject);
        if (!subj && subjList.length > 0) subj = subjList[0];
        // 모든 학생 표시 — 현재 과목을 응시하지 않은 학생은 _noSubject 플래그로 blank 렌더
        const rows = rowsOrig.map(r => {
            if (r._noOmr) return r;
            if (subj && (!r.subjects || !r.subjects[subj])) {
                return { ...r, _noSubject: true };
            }
            return this._projectRow(r, subj);
        });

        // 상단 도구
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
                ${this._periodDropdown()}
                ${this._subjectDropdownNoAll(rowsOrig, subj, 'setCurrentSubject')}
                <label style="font-size:11px;">문항수:
                    <input type="number" value="${this._defaultMaxQ}" min="1" max="100" style="width:50px; padding:3px; font-size:11px; border:1px solid var(--border); border-radius:4px;"
                        onchange="Scoring.setMaxQ(this.value)">
                </label>
                <button class="btn btn-sm" style="font-size:10px; padding:3px 8px;"
                    onclick="Scoring._showColumnSettings=!Scoring._showColumnSettings; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                    ${this._showColumnSettings ? '설정 닫기' : '열 설정'}
                </button>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn btn-sm" onclick="Scoring.downloadOMR(Scoring.collectData())" style="font-size:11px;">현재 과목 CSV</button>
                <button class="btn btn-sm" onclick="Scoring.downloadAllOMR(Scoring.collectData())" style="font-size:11px;">전체 과목 CSV</button>
                <button class="btn btn-sm" onclick="Scoring.downloadOMRxlsx(Scoring.collectData())" style="font-size:11px;">현재 과목 XLSX</button>
                <button class="btn btn-sm" onclick="Scoring.downloadAllOMRxlsx(Scoring.collectData())" style="font-size:11px;">전체 과목 XLSX</button>
            </div>
        </div>`;

        // 뱃지 영역 (공용 함수)
        html += this._renderBadgeBar(this._getOMRColumns, 'toggleColumn', 'omr');

        // 정렬 + 마킹/정오 토글 + 문항수
        const allCols = this._getOMRColumns();
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding:8px 12px; background:#f8fafc; border-radius:8px; flex-wrap:wrap;">
            ${this._renderSortButtons(rows)}
            <div style="width:1px; height:20px; background:var(--border);"></div>
            <label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" ${allCols.some(c => c.type === 'answer' && !c.visible) ? '' : 'checked'}
                    onchange="Scoring._toggleAnswerCols(this.checked)">
                <span style="padding:2px 8px; border-radius:10px; background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:600;">마킹 내용</span>
            </label>
            <label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" ${allCols.some(c => c.type === 'ox' && !c.visible) ? '' : 'checked'}
                    onchange="Scoring._toggleOXCols(this.checked)">
                <span style="padding:2px 8px; border-radius:10px; background:#fef3c7; color:#92400e; font-size:10px; font-weight:600;">정오표(O/X)</span>
            </label>
            <span style="font-size:10px; color:var(--text-muted); margin-left:auto;">
                문항수: <input type="number" value="${this._defaultMaxQ}" min="1" max="100"
                    style="width:45px; padding:2px; font-size:11px; border:1px solid var(--border); border-radius:4px; text-align:center;"
                    onchange="Scoring.setMaxQ(this.value)">
            </span>
        </div>`;

        // 테이블
        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead><tr>`;

        const _widths = { examNo: 82, name: 72, phone: 104, birthday: 88 };
        cols.forEach(col => {
            const hl = (this._highlightCol === col.id) ? 'background:#93c5fd !important;' : '';
            const bg = col.type === 'ox' ? 'background:#fef3c7;' : col.id === 'score' ? 'color:var(--blue);' : 'background:#f8fafc;';
            const minW = _widths[col.id] ? `min-width:${_widths[col.id]}px;` : '';
            html += `<th style="padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); ${bg} ${hl} ${minW} position:sticky; top:0; z-index:2; white-space:nowrap;">${col.label}</th>`;
        });
        html += `</tr></thead><tbody>`;

        rows.forEach((r, ri) => {
            let bg = ri % 2 === 0 ? '' : 'background:#f8fafc;';
            if (r._sameName) bg = 'background:#fef9c3;'; // 동명이인 노란 별색
            const noOmr = r._noOmr;
            const blankForSubject = r._noSubject; // 현재 과목 미응시 (info는 표시, 그 외는 blank)
            const faded = noOmr || blankForSubject;
            const title = r._sameName ? ' title="동명이인 또는 체킹 오류 확인 필요"' : '';
            html += `<tr style="${bg} ${faded ? 'opacity:0.5;' : ''}"${title}>`;
            cols.forEach(col => {
                const hl = (this._highlightCol === col.id) ? 'background:#dbeafe !important;' : '';
                let val = '', style = `padding:5px 6px; text-align:center; font-size:11px; border-bottom:1px solid #f1f5f9; ${hl}`;
                if ((noOmr || blankForSubject) && col.type !== 'info') { val = ''; html += `<td style="${style}">${val}</td>`; return; }
                if (col.id === 'examNo') val = r.examNo;
                else if (col.id === 'name') { val = r.name; style += 'font-weight:600;'; }
                else if (col.id === 'score') { val = this._fmtScore(r.score); style += 'font-weight:700; color:var(--blue); font-size:12px;'; }
                else if (col.id === 'birthday') val = r.birthday;
                else if (col.id === 'phone') val = r.phone;
                else if (col.id === 'subjectCode') val = r.subjectCode || '';
                else if (col.id === 'correctCount') { val = this._fmtScore(r.correctCount); style += 'color:#22c55e; font-weight:600;'; }
                else if (col.id === 'wrongCount') { val = this._fmtScore(r.wrongCount); style += 'color:#ef4444;'; }
                else if (col.id === 'totalPossible') val = this._fmtMax(r.totalPossible);
                else if (col.id === 'rank') { val = r.rank || ''; style += 'font-weight:700;'; }
                else if (col.id === 'tScore') val = r.tScore ? r.tScore.toFixed(1) : '';
                else if (col.id === 'percentile') val = r.percentile != null ? r.percentile.toFixed(1) + '%' : '';
                else if (col.id === 'filename') val = r.filename;
                else if (col.id && col.id.startsWith('etc_')) { val = r.etcFields[col.etcName || col.id.replace('etc_','')] || ''; }
                else if (col.type === 'answer') {
                    const a = r.answers.find(x => x.q === col.qNum);
                    val = a ? a.markedLabel : '';
                } else if (col.type === 'ox') {
                    const a = r.answers.find(x => x.q === col.qNum);
                    val = a ? (a.isCorrect ? 'O' : 'X') : '';
                    if (val === 'O') style += 'color:#22c55e; font-weight:700;';
                    else if (val === 'X') style += 'color:#ef4444; font-weight:700;';
                } else if (col.type === 'custom') {
                    val = '';
                }
                html += `<td style="${style}">${val}</td>`;
            });
            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    },

    // 정렬 버튼 (rows: collectData() 결과)
    _renderSortButtons(rows) {
        const isStudent = this._sortMode === 'student';
        const isScore   = this._sortMode === 'score_desc';
        const subjects  = this.getSubjectList(rows || []);

        let html = `
            <button class="btn btn-sm" style="font-size:10px; padding:3px 10px; ${isStudent ? 'background:var(--blue); color:#fff;' : ''}"
                onclick="Scoring._sortMode='student'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">인원명단순</button>
            <button class="btn btn-sm" style="font-size:10px; padding:3px 10px; ${isScore ? 'background:var(--blue); color:#fff;' : ''}"
                onclick="Scoring._sortMode='score_desc'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">총점↓</button>`;

        subjects.forEach(subj => {
            const isActive = this._sortMode === 'subject_desc' && this._subjectSortName === subj;
            const safe = subj.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            html += `<button class="btn btn-sm" style="font-size:10px; padding:3px 10px; ${isActive ? 'background:var(--blue); color:#fff;' : ''}"
                onclick="Scoring._sortMode='subject_desc'; Scoring._subjectSortName='${safe}'; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">${subj}↓</button>`;
        });
        return html;
    },

    // 셀 별색 토글 (수동)
    _toggleCellHL(key) {
        if (this._manualHL[key]) delete this._manualHL[key];
        else this._manualHL[key] = this._selectedColor;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 규칙 기반 별색 계산
    _calcRuleHL(items) {
        const hl = {};
        this._hlRules.forEach(rule => {
            if (!rule.on) return;
            items.forEach(item => {
                if (rule.type === 'rate') {
                    const v = item.correctRate;
                    if ((rule.op === '<=' && v <= rule.value) || (rule.op === '>=' && v >= rule.value) || (rule.op === '<' && v < rule.value))
                        hl['q'+item.q+'_rate'] = rule.color;
                } else if (rule.type === 'disc') {
                    const v = item.discrimination;
                    if ((rule.op === '<=' && v <= rule.value) || (rule.op === '>=' && v >= rule.value) || (rule.op === '<' && v < rule.value))
                        hl['q'+item.q+'_disc'] = rule.color;
                } else if (rule.type === 'attractive' && item.distTotal && item.correctAnswer) {
                    const caCount = item.distTotal[item.correctAnswer] || 0;
                    for (let n = 1; n <= 7; n++) {
                        if (n !== item.correctAnswer && (item.distTotal[n] || 0) > caCount)
                            hl['q'+item.q+'_dt_'+n] = rule.color;
                    }
                }
            });
        });
        // 수동이 규칙보다 우선
        return { ...hl, ...this._manualHL };
    },

    // 성적일람표 열 설정
    _reportColumns: null,
    _getReportColumns() {
        if (this._reportColumns) return this._reportColumns;
        const cols = [
            { id: 'examNo', label: '응시번호', type: 'info', visible: true },
            { id: 'name', label: '성명', type: 'info', visible: true },
            { id: 'birthday', label: '생년월일', type: 'info', visible: true },
            { id: 'phone', label: '전화번호', type: 'info', visible: false },
            { id: 'subjectCode', label: '과목코드', type: 'info', visible: false },
            { id: 'filename', label: '파일명', type: 'info', visible: false },
        ];
        // 기타 ROI
        const etcNames = new Set();
        (App.state.images || []).forEach(img => {
            (img.rois || []).forEach(roi => {
                if (roi.settings && roi.settings.type === 'etc' && roi.settings.name) etcNames.add(roi.settings.name);
            });
        });
        etcNames.forEach(name => cols.push({ id: 'etc_' + name, label: name, type: 'info', visible: true, etcName: name }));

        // 성적 열 (group: 'score' → 과목별로 반복 렌더링)
        cols.push(
            { id: 'correctCount', label: '맞은개수', type: 'info', group: 'score', visible: true },
            { id: 'score', label: '점수', type: 'info', group: 'score', visible: true },
            { id: 'tScore', label: '표준점수', type: 'info', group: 'score', visible: true },
            { id: 'rank', label: '석차', type: 'info', group: 'score', visible: true },
            { id: 'percentile', label: '백분위', type: 'info', group: 'score', visible: true },
            { id: 'wrongCount', label: '틀린개수', type: 'info', group: 'score', visible: false },
            { id: 'totalPossible', label: '만점', type: 'info', group: 'score', visible: false },
        );
        this._reportColumns = cols;
        return cols;
    },

    // 선택된 열 하이라이트
    _highlightCol: null,

    // 공용 뱃지 UI 렌더
    _renderBadgeBar(columnsGetter, toggleFn, prefix) {
        const allCols = columnsGetter.call(this);
        const active = allCols.filter(c => c.visible);
        const inactive = allCols.filter(c => !c.visible);
        const fnName = columnsGetter.name || '_getOMRColumns';

        let html = `
        <style>
            .badge-area { transition: background 0.2s; }
            .badge-area.drag-over { background: #dbeafe !important; border-color: var(--blue) !important; }
            .scoring-badge-item {
                padding: 4px 12px; border-radius: 14px; font-size: 11px; cursor: grab;
                user-select: none; transition: all 0.2s ease; display: inline-block;
            }
            .scoring-badge-item:active { cursor: grabbing; transform: scale(1.05); }
            .scoring-badge-item.inactive {
                border: 1.5px dashed #cbd5e1; color: #94a3b8; background: white;
            }
            .scoring-badge-item.inactive:hover {
                border-color: var(--blue); color: var(--blue); background: #eff6ff;
                transform: translateY(-1px); box-shadow: 0 2px 4px rgba(59,130,246,0.15);
            }
            .scoring-badge-item.active {
                border: 1.5px solid var(--blue); color: var(--blue); background: #eff6ff; font-weight: 600;
            }
            .scoring-badge-item.active:hover {
                background: #dbeafe; transform: translateY(-1px); box-shadow: 0 2px 6px rgba(59,130,246,0.2);
            }
            .scoring-badge-item.active.highlighted {
                background: var(--blue); color: white; box-shadow: 0 2px 8px rgba(59,130,246,0.3);
            }
            .scoring-badge-item.dragging { opacity: 0.4; transform: scale(0.95); }
            .drop-indicator { animation: pulse 0.6s ease infinite alternate; }
            @keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }
        </style>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:14px;">
            <div style="margin-bottom:8px;">
                <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; font-weight:500;">사용 가능한 항목 — 아래 헤더 영역으로 드래그하세요</div>
                <div class="badge-area" style="display:flex; flex-wrap:wrap; gap:5px; min-height:30px; padding:6px; border-radius:6px;"
                    id="${prefix}-available"
                    ondragover="Scoring._onBadgeDragOver(event);"
                    ondragleave="Scoring._onBadgeDragLeave(event);"
                    ondrop="Scoring._onBadgeDrop(event,'${toggleFn}','available');">
                    ${inactive.map(c => `<span class="scoring-badge-item inactive" draggable="true" data-col-id="${c.id}"
                        ondragstart="Scoring._onBadgeDragStart(event,'${c.id}')"
                        ondragend="this.classList.remove('dragging')">${c.label}</span>`).join('')}
                    ${inactive.length === 0 ? '<span style="font-size:10px; color:var(--text-muted); padding:4px;">모든 항목이 추가됨</span>' : ''}
                </div>
            </div>
            <div>
                <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; font-weight:500;">현재 표 헤더 — 드래그로 순서 변경 · 위로 드래그하여 제거 · 클릭하면 열 하이라이트</div>
                <div class="badge-area" style="display:flex; flex-wrap:wrap; gap:5px; min-height:34px; padding:6px; border:1.5px solid var(--border); border-radius:8px; background:white;"
                    id="${prefix}-active"
                    ondragover="Scoring._onBadgeDragOver(event);"
                    ondragleave="Scoring._onBadgeDragLeave(event);"
                    ondrop="Scoring._onBadgeDrop(event,'${toggleFn}','active');">
                    ${active.filter(c => c.type === 'info' || c.type === 'custom').map(c => `<span class="scoring-badge-item active ${this._highlightCol === c.id ? 'highlighted' : ''}"
                        draggable="true" data-col-id="${c.id}" data-toggle-fn="${toggleFn}" tabindex="0"
                        ondragstart="Scoring._onBadgeDragStart(event,'${c.id}')"
                        ondragend="this.classList.remove('dragging')"
                        onclick="Scoring._onBadgeClick('${c.id}')"
                        ondblclick="event.stopPropagation(); event.preventDefault(); Scoring._startBadgeRename(this,'${c.id}','${toggleFn}')"
                        onkeydown="if(event.key==='Delete')Scoring._deleteBadge('${c.id}','${toggleFn}'); if(event.key==='Escape')Scoring._clearHighlight();"
                        >${c.label}</span>`).join('')}
                </div>
            </div>
        </div>`;
        return html;
    },

    _onBadgeDragStart(e, colId) {
        this._dragColId = colId;
        e.dataTransfer.effectAllowed = 'move';
        e.target.classList.add('dragging');
    },

    // 드래그 중 삽입 위치 인디케이터
    _onBadgeDragOver(e) {
        e.preventDefault();
        const container = e.currentTarget;
        container.classList.add('drag-over');

        // 기존 인디케이터 제거
        container.querySelectorAll('.drop-indicator').forEach(el => el.remove());

        // 삽입 위치 계산
        const badges = container.querySelectorAll('.scoring-badge-item');
        let insertBefore = null;
        for (const badge of badges) {
            const rect = badge.getBoundingClientRect();
            if (e.clientX < rect.left + rect.width / 2) {
                insertBefore = badge;
                break;
            }
        }

        // 인디케이터 삽입
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.cssText = 'width:3px; height:24px; background:var(--blue); border-radius:2px; flex-shrink:0; animation:pulse 0.6s ease infinite alternate;';
        if (insertBefore) {
            container.insertBefore(indicator, insertBefore);
        } else {
            container.appendChild(indicator);
        }
    },

    _onBadgeDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
        e.currentTarget.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    },

    _getColsForToggleFn(toggleFn) {
        return toggleFn === 'toggleColumn' ? this._getOMRColumns() : this._getReportColumns();
    },

    _onBadgeDrop(e, toggleFn, target) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        e.currentTarget.querySelectorAll('.drop-indicator').forEach(el => el.remove());

        if (!this._dragColId) return;
        const colId = this._dragColId;
        this._dragColId = null;

        const cols = this._getColsForToggleFn(toggleFn);
        const col = cols.find(c => c.id === colId);
        if (!col) return;

        if (target === 'available') {
            // active → available: 제거 (비활성화)
            if (col.visible) {
                col.visible = false;
                this.renderScoringPanel(document.getElementById('scoring-content'));
            }
        } else {
            // available → active: 추가 (활성화)
            if (!col.visible) {
                col.visible = true;
            }

            // 드롭 위치에 따라 순서 변경
            const badges = e.currentTarget.querySelectorAll('.scoring-badge-item');
            let insertBeforeId = null;
            for (const badge of badges) {
                if (badge.dataset.colId === colId) continue;
                const rect = badge.getBoundingClientRect();
                if (e.clientX < rect.left + rect.width / 2) {
                    insertBeforeId = badge.dataset.colId;
                    break;
                }
            }

            // 배열에서 이동
            const fromIdx = cols.findIndex(c => c.id === colId);
            if (fromIdx >= 0) {
                const [moved] = cols.splice(fromIdx, 1);
                if (insertBeforeId) {
                    const toIdx = cols.findIndex(c => c.id === insertBeforeId);
                    cols.splice(toIdx >= 0 ? toIdx : cols.length, 0, moved);
                } else {
                    // 맨 끝 (info/custom 중)
                    const lastInfo = cols.reduce((last, c, i) => (c.type === 'info' || c.type === 'custom') ? i : last, cols.length - 1);
                    cols.splice(lastInfo + 1, 0, moved);
                }
            }

            this.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    _clickTimer: null,
    _onBadgeClick(colId) {
        // 더블클릭 구분용 딜레이
        if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; return; }
        this._clickTimer = setTimeout(() => {
            this._clickTimer = null;
            this._highlightCol = colId;
            this.renderScoringPanel(document.getElementById('scoring-content'));
            setTimeout(() => {
                const badge = document.querySelector(`.scoring-badge-item[data-col-id="${colId}"]`);
                if (badge) badge.focus();
            }, 50);
        }, 250);
    },

    // Escape로 선택 해제
    _clearHighlight() {
        if (this._highlightCol) {
            this._highlightCol = null;
            this.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    // Delete 키로 뱃지 제거 (비활성화)
    _deleteBadge(colId, toggleFn) {
        const cols = this._getColsForToggleFn(toggleFn);
        const col = cols.find(c => c.id === colId);
        if (col && col.visible) {
            col.visible = false;
            if (this._highlightCol === colId) this._highlightCol = null;
            this.renderScoringPanel(document.getElementById('scoring-content'));
        }
    },

    // 더블클릭 → 인라인 이름 변경 (Electron prompt 미지원 대응)
    _startBadgeRename(el, colId, toggleFn) {
        const cols = this._getColsForToggleFn(toggleFn);
        const col = cols.find(c => c.id === colId);
        if (!col) return;

        const oldLabel = col.label;
        const rect = el.getBoundingClientRect();

        // 뱃지를 input으로 교체
        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldLabel;
        input.style.cssText = `width:${Math.max(60, oldLabel.length * 12)}px; padding:3px 8px; border-radius:14px; border:2px solid var(--blue); font-size:11px; font-weight:600; text-align:center; outline:none;`;
        el.textContent = '';
        el.appendChild(input);
        el.draggable = false;
        input.focus();
        input.select();

        const finish = () => {
            const newLabel = input.value.trim() || oldLabel;
            col.label = newLabel;
            el.draggable = true;
            this.renderScoringPanel(document.getElementById('scoring-content'));
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = oldLabel; input.blur(); }
            e.stopPropagation(); // Delete 키 등 전파 방지
        });
    },

    // 성적일람표 열 토글
    toggleReportColumn(colId) {
        const cols = this._getReportColumns();
        const col = cols.find(c => c.id === colId);
        if (col) col.visible = !col.visible;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 드래그 앤 드롭
    _dragColId: null,
    _onDragStart(e, colId) {
        this._dragColId = colId;
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
        setTimeout(() => { if (e.target) e.target.style.opacity = '1'; }, 200);
    },
    _onDropBadge(e) {
        e.preventDefault();
        if (!this._dragColId) return;
        // 드롭 위치의 가장 가까운 뱃지 찾기
        const badges = document.querySelectorAll('#scoring-active-badges .scoring-badge');
        const dropX = e.clientX;
        let insertBeforeId = null;
        badges.forEach(badge => {
            const rect = badge.getBoundingClientRect();
            if (dropX < rect.left + rect.width / 2) {
                if (!insertBeforeId) insertBeforeId = badge.dataset.colId;
            }
        });
        // 순서 변경
        const cols = this._getOMRColumns();
        const fromIdx = cols.findIndex(c => c.id === this._dragColId);
        if (fromIdx < 0) return;
        const [moved] = cols.splice(fromIdx, 1);
        if (insertBeforeId) {
            const toIdx = cols.findIndex(c => c.id === insertBeforeId);
            cols.splice(toIdx, 0, moved);
        } else {
            // 맨 끝에 추가 (info/custom 영역 끝)
            const lastInfoIdx = cols.reduce((last, c, i) => (c.type === 'info' || c.type === 'custom') ? i : last, -1);
            cols.splice(lastInfoIdx + 1, 0, moved);
        }
        this._dragColId = null;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // 마킹/정오 열 일괄 토글
    _toggleAnswerCols(show) {
        this._getOMRColumns().forEach(c => { if (c.type === 'answer') c.visible = show; });
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },
    _toggleOXCols(show) {
        this._getOMRColumns().forEach(c => { if (c.type === 'ox') c.visible = show; });
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    // ==========================================
    // 성적일람표
    // ==========================================
    _renderReport(rows) {
        const allCols = this._getReportColumns().filter(c => c.visible);
        const infoCols = allCols.filter(c => c.group !== 'score');
        const scoreCols = allCols.filter(c => c.group === 'score');
        const subjects = this.getSubjectList(rows);
        // 과목별 교시 이름 수집 (툴팁 표시용: "국어 (1교시)")
        const periodBySubject = {};
        rows.forEach(r => {
            if (!r.subjects) return;
            Object.entries(r.subjects).forEach(([sn, sd]) => {
                if (!periodBySubject[sn] && sd.periodName) periodBySubject[sn] = sd.periodName;
            });
        });

        // 과목 그룹 목록: 각 과목 + 총점 (과목이 1개여도 총점 컬럼 생략 대신 '총점' 안 붙임)
        const groups = subjects.length > 0
            ? [...subjects.map(s => ({ key: s, label: s, isTotal: false })),
               ...(subjects.length > 1 ? [{ key: '__total__', label: '총점', isTotal: true }] : [])]
            : [{ key: '__total__', label: '전체', isTotal: true }];

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                ${this._periodDropdown()}
                <div style="display:flex; gap:4px; flex-wrap:wrap;">${this._renderSortButtons(rows)}</div>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn btn-sm" onclick="Scoring.downloadReport(Scoring.collectData())" style="font-size:11px;">CSV 다운로드</button>
                <button class="btn btn-sm" onclick="Scoring.downloadReportXlsx(Scoring.collectData())" style="font-size:11px;">XLSX 다운로드</button>
            </div>
        </div>`;

        // 뱃지 바
        html += this._renderBadgeBar(this._getReportColumns, 'toggleReportColumn', 'report');

        const colStyle = {
            score: 'background:#eff6ff;', correctCount: 'background:#ecfdf5;',
            tScore: 'background:#f5f3ff;', rank: 'background:#fef3c7;', percentile: 'background:#fce7f3;',
        };

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead>`;

        // 과목 그룹 헤더 (정보열 rowspan + 과목별 colspan)
        if (scoreCols.length > 0 && groups.length > 0) {
            html += `<tr>`;
            infoCols.forEach(col => {
                const hl = (this._highlightCol === col.id) ? 'background:#93c5fd !important;' : '';
                html += `<th rowspan="2" style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); border-right:1px solid var(--border); background:#f8fafc; position:sticky; top:0; white-space:nowrap; ${hl}">${col.label}</th>`;
            });
            groups.forEach(g => {
                const bg = g.isTotal ? 'background:#fef3c7;' : 'background:#dbeafe;';
                // 교시 정보: 다교시일 때 툴팁으로 표시
                const pName = !g.isTotal ? (periodBySubject[g.key] || '') : '';
                const tipAttr = pName ? ` title="${g.label} (${pName})" style="cursor:help;"` : '';
                const displayLabel = pName ? `${g.label}<span style="font-size:9px; font-weight:400; opacity:0.7; margin-left:3px;">(${pName})</span>` : g.label;
                html += `<th colspan="${scoreCols.length}" style="padding:8px 10px; text-align:center; font-size:12px; font-weight:700; border-bottom:1px solid var(--border); border-right:2px solid var(--border); ${bg} position:sticky; top:0; white-space:nowrap;"${tipAttr}>${displayLabel}</th>`;
            });
            html += `</tr><tr>`;
            groups.forEach((g, gi) => {
                scoreCols.forEach((col, ci) => {
                    const extra = colStyle[col.id] || '';
                    const hl = (this._highlightCol === col.id) ? 'background:#93c5fd !important;' : '';
                    const rightBorder = ci === scoreCols.length - 1 ? 'border-right:2px solid var(--border);' : '';
                    html += `<th style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); position:sticky; top:30px; white-space:nowrap; ${extra} ${hl} ${rightBorder}">${col.label}</th>`;
                });
            });
            html += `</tr>`;
        } else {
            // 성적 열 0개 — 정보 열만
            html += `<tr>`;
            infoCols.forEach(col => {
                const hl = (this._highlightCol === col.id) ? 'background:#93c5fd !important;' : '';
                html += `<th style="padding:8px 10px; text-align:center; font-size:11px; font-weight:600; border-bottom:2px solid var(--border); background:#f8fafc; position:sticky; top:0; white-space:nowrap; ${hl}">${col.label}</th>`;
            });
            html += `</tr>`;
        }

        html += `</thead><tbody>`;

        rows.forEach((r, ri) => {
            let bg = ri % 2 === 0 ? '' : 'background:#f8fafc;';
            if (r._sameName) bg = 'background:#fef9c3;'; // 동명이인 노란 별색
            const title = r._sameName ? ' title="동명이인 또는 체킹 오류 확인 필요"' : '';
            html += `<tr style="${bg}"${title}>`;

            // 정보 셀
            infoCols.forEach(col => {
                const hl = (this._highlightCol === col.id) ? 'background:#dbeafe !important;' : '';
                let val = '';
                let style = `style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; border-right:1px solid #f1f5f9; ${hl}"`;
                if (col.id === 'examNo') val = r.examNo;
                else if (col.id === 'name') { val = r.name; style = `style="padding:6px 8px; font-size:12px; font-weight:600; border-bottom:1px solid #f1f5f9; border-right:1px solid #f1f5f9; ${hl}"`; }
                else if (col.id === 'birthday') val = r.birthday;
                else if (col.id === 'phone') val = r.phone;
                else if (col.id === 'subjectCode') val = r.subjectCode || '';
                else if (col.id === 'filename') val = r.filename;
                else if (col.id && col.id.startsWith('etc_')) val = r.etcFields[col.etcName || col.id.replace('etc_', '')] || '';
                html += `<td ${style}>${val}</td>`;
            });

            // 과목별 성적 셀
            groups.forEach(g => {
                // 해당 그룹의 성적 값 선택
                const src = g.isTotal
                    ? { score: r.totalScore !== '' ? r.totalScore : '', correctCount: r.totalCorrect, wrongCount: r.totalWrong,
                        totalPossible: r.totalMax, rank: r.rank, tScore: r.tScore, percentile: r.percentile }
                    : (r.subjects && r.subjects[g.key]
                        ? { score: r.subjects[g.key].score, correctCount: r.subjects[g.key].correctCount,
                            wrongCount: r.subjects[g.key].wrongCount, totalPossible: r.subjects[g.key].totalPossible,
                            rank: r.subjects[g.key].rank, tScore: r.subjects[g.key].tScore, percentile: r.subjects[g.key].percentile }
                        : null);

                scoreCols.forEach((col, ci) => {
                    const hl = (this._highlightCol === col.id) ? 'background:#dbeafe !important;' : '';
                    const rightBorder = ci === scoreCols.length - 1 ? 'border-right:2px solid var(--border);' : '';
                    let val = '';
                    let style = `style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; ${hl} ${rightBorder}"`;
                    if (r._noOmr || !src) {
                        html += `<td ${style}></td>`;
                        return;
                    }
                    if (col.id === 'correctCount') { val = this._fmtScore(src.correctCount); style = `style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; color:#22c55e; font-weight:600; ${hl} ${rightBorder}"`; }
                    else if (col.id === 'score') { val = this._fmtScore(src.score); style = `style="padding:6px 8px; text-align:center; font-size:13px; border-bottom:1px solid #f1f5f9; color:var(--blue); font-weight:700; ${hl} ${rightBorder}"`; }
                    else if (col.id === 'tScore') val = src.tScore ? src.tScore.toFixed(1) : '';
                    else if (col.id === 'rank') { val = src.rank || ''; style = `style="padding:6px 8px; text-align:center; font-size:12px; border-bottom:1px solid #f1f5f9; font-weight:700; ${hl} ${rightBorder}"`; }
                    else if (col.id === 'percentile') val = src.percentile != null ? src.percentile.toFixed(1) + '%' : '';
                    else if (col.id === 'wrongCount') val = this._fmtScore(src.wrongCount);
                    else if (col.id === 'totalPossible') val = this._fmtMax(src.totalPossible);
                    html += `<td ${style}>${val}</td>`;
                });
            });

            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    },

    // ==========================================
    // 문항분석표
    // ==========================================
    _renderItem(items, totalN) {
        const uPct = this._upperPct;
        const lPct = this._lowerPct;
        const mPct = 100 - uPct - lPct;
        const allRows = this.collectData();

        // 설정 바 (과목 드롭다운 + 그룹 비율)
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px; padding:6px 12px; background:#f8fafc; border-radius:8px; border:1px solid var(--border); flex-wrap:wrap;">
                ${this._periodDropdown()}
                ${this._subjectDropdown(allRows, '_itemSubject', 'setItemSubject')}
                <div style="width:1px; height:18px; background:var(--border);"></div>
                <span style="font-size:11px; font-weight:600;">그룹 비율</span>
                <label style="font-size:11px; display:flex; align-items:center; gap:3px;">상위
                    <input type="number" value="${uPct}" min="1" max="49" style="width:38px; padding:2px; font-size:11px; border:1px solid var(--border); border-radius:4px; text-align:center;"
                        onchange="Scoring._upperPct=parseInt(this.value)||27; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">%
                </label>
                <span style="font-size:11px; color:var(--text-muted);">중위 ${mPct}%</span>
                <label style="font-size:11px; display:flex; align-items:center; gap:3px;">하위
                    <input type="number" value="${lPct}" min="1" max="49" style="width:38px; padding:2px; font-size:11px; border:1px solid var(--border); border-radius:4px; text-align:center;"
                        onchange="Scoring._lowerPct=parseInt(this.value)||27; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">%
                </label>
                <span style="font-size:11px; color:var(--text-muted);">총 ${totalN}명</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn btn-sm" onclick="Scoring.downloadItemCurrent()" style="font-size:11px;">현재 과목 CSV</button>
                <button class="btn btn-sm" onclick="Scoring.downloadItemAll()" style="font-size:11px;">전체 과목 CSV</button>
                <button class="btn btn-sm" onclick="Scoring.downloadItemCurrentXlsx()" style="font-size:11px;">현재 과목 XLSX</button>
                <button class="btn btn-sm" onclick="Scoring.downloadItemAllXlsx()" style="font-size:11px;">전체 과목 XLSX</button>
            </div>
        </div>`;

        // 별색 도구: 규칙 + 수동
        const allHL = this._calcRuleHL(items);

        html += `<div style="margin-bottom:10px; padding:8px 10px; background:#f9fafb; border-radius:8px; border:1px solid var(--border);">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
                <span style="font-size:11px; font-weight:600;">별색 규칙</span>
                <span style="font-size:9px; color:var(--text-muted);">체크 후 기준값/색상 지정 · 셀 직접 클릭도 가능</span>
                <button class="btn btn-sm" style="font-size:9px; padding:2px 6px; margin-left:auto;" onclick="Scoring._manualHL={}; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">수동 초기화</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
                ${this._hlRules.map((rule, ri) => `
                <div style="display:flex; align-items:center; gap:4px; padding:3px 8px; border:1px solid ${rule.on ? rule.color : 'var(--border)'}; border-radius:6px; background:${rule.on ? rule.color+'33' : 'white'}; font-size:10px;">
                    <input type="checkbox" ${rule.on ? 'checked' : ''} onchange="Scoring._hlRules[${ri}].on=this.checked; Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                    <span style="font-weight:600;" ${rule.desc ? `title="${rule.desc}"` : ''}>${rule.label}${rule.desc ? ' ℹ' : ''}</span>
                    ${rule.value !== undefined && rule.type !== 'attractive' ? `
                        <input type="number" value="${rule.value}" step="${rule.type==='disc' ? '0.01' : '1'}" style="width:45px; padding:1px 3px; font-size:10px; border:1px solid var(--border); border-radius:3px; text-align:center;"
                            onchange="Scoring._hlRules[${ri}].value=parseFloat(this.value); Scoring.renderScoringPanel(document.getElementById('scoring-content'));">
                        <span>${rule.type==='rate' ? '%' : ''}</span>
                    ` : ''}
                    <span onclick="const cs=Scoring._colors; const ci=cs.findIndex(c=>c.c===Scoring._hlRules[${ri}].color); Scoring._hlRules[${ri}].color=cs[(ci+1)%cs.length].c; Scoring.renderScoringPanel(document.getElementById('scoring-content'));"
                        style="width:14px; height:14px; border-radius:3px; background:${rule.color}; cursor:pointer; border:1px solid #aaa;" title="색상 변경 (클릭)"></span>
                </div>
                `).join('')}
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:10px; font-weight:600;">수동 별색</span>
                <div style="display:flex; gap:3px;">
                    ${this._colors.map(c => `<span onclick="Scoring._selectedColor='${c.c}'; document.querySelectorAll('.hl-sw').forEach(s=>s.style.outline=''); this.style.outline='2px solid #333';"
                        class="hl-sw" title="${c.l}"
                        style="width:16px; height:16px; border-radius:3px; background:${c.c}; cursor:pointer; border:1px solid #ccc;
                        ${this._selectedColor === c.c ? 'outline:2px solid #333;' : ''}"></span>`).join('')}
                </div>
                <span style="font-size:9px; color:var(--text-muted);">색 선택 → 셀 클릭</span>
            </div>
        </div>`;

        const thBase = 'padding:6px 8px; text-align:center; font-size:11px; font-weight:600; border:1px solid var(--border); position:sticky; top:0;';

        const choiceNums = [1,2,3,4,5,6,7];
        const th2 = 'padding:5px 6px; text-align:center; font-size:10px; font-weight:600; border:1px solid #d1d5db; background:#e5e7eb; color:#374151; position:sticky; top:0; z-index:1;';

        html += `<div style="overflow:auto; max-height:60vh; border:1px solid var(--border); border-radius:8px; background:white;">
        <table style="border-collapse:collapse; width:100%;">
        <thead>
        <tr>
            <th style="${th2}">문항</th>
            <th style="${th2}">정답</th>
            <th style="${th2}">구분</th>
            <th style="${th2}">상위${uPct}%</th>
            <th style="${th2}">중위${mPct}%</th>
            <th style="${th2}">하위${lPct}%</th>
            <th style="${th2}">총계</th>
            <th style="${th2}">정답률</th>
            <th style="${th2}">변별도</th>
            <th style="${th2}">구분</th>
            ${choiceNums.map(n => `<th style="${th2}">${n}번</th>`).join('')}
            <th style="${th2}">공백</th>
            <th style="${th2}">중복</th>
            <th style="${th2}">계</th>
        </tr>
        </thead><tbody>`;

        const td = 'padding:4px 5px; text-align:center; font-size:10px; border:1px solid #e2e8f0;';

        // 반응분포 셀 헬퍼
        const distCells = (dist, ca, qNum, group) => {
            let h = '';
            choiceNums.forEach(n => {
                const v = dist[n] || 0;
                const isCA = ca && ca === n;
                const key = 'q'+qNum+'_d'+group+'_'+n;
                const hl = allHL[key] ? 'background:'+allHL[key]+';' : '';
                h += `<td style="${td} cursor:pointer; ${isCA ? 'font-weight:700; text-decoration:underline;' : ''} ${hl}"
                    onclick="Scoring._toggleCellHL('${key}')">${v}</td>`;
            });
            h += `<td style="${td}">${dist.blank || 0}</td>`;
            h += `<td style="${td}">${dist.multi || 0}</td>`;
            h += `<td style="${td} font-weight:600;">${dist.total || 0}</td>`;
            return h;
        };

        // 클릭 가능 셀 헬퍼
        const cc = (key, val, extra) => {
            const bg = allHL[key] ? 'background:'+allHL[key]+';' : '';
            return `<td style="${td} cursor:pointer; ${extra || ''} ${bg}" onclick="Scoring._toggleCellHL('${key}')">${val}</td>`;
        };
        const ccR = (key, val, extra) => {
            const bg = allHL[key] ? 'background:'+allHL[key]+';' : '';
            return `<td rowspan="3" style="${td} cursor:pointer; vertical-align:middle; ${extra || ''} ${bg}" onclick="Scoring._toggleCellHL('${key}')">${val}</td>`;
        };

        items.forEach((item, ri) => {
            const totalCorrect = item.upper.correct + item.mid.correct + item.lower.correct;
            const totalWrong = item.upper.wrong + item.mid.wrong + item.lower.wrong;
            const totalAll = totalCorrect + totalWrong;
            const ca = item.correctAnswer;
            const q = item.q;

            // 행 1: 정답수
            html += `<tr>
                ${ccR('q'+q+'_num', q, 'font-weight:700; font-size:11px; border-right:2px solid #d1d5db; background:#e5e7eb;')}
                ${ccR('q'+q+'_ans', ca || '', 'font-weight:600;')}
                ${cc('q'+q+'_r1_lbl', '정답', 'font-size:9px; font-weight:600;')}
                ${cc('q'+q+'_uc', item.upper.correct, '')}
                ${cc('q'+q+'_mc', item.mid.correct, '')}
                ${cc('q'+q+'_lc', item.lower.correct, '')}
                ${cc('q'+q+'_tc', totalCorrect, 'font-weight:600;')}
                ${ccR('q'+q+'_rate', item.correctRate.toFixed(1)+'%', 'font-weight:700;')}
                ${ccR('q'+q+'_disc', item.discrimination.toFixed(3), 'font-weight:700; border-right:2px solid #d1d5db;')}
                ${cc('q'+q+'_d1_lbl', '상50%', 'font-size:9px; font-weight:600;')}
                ${distCells(item.distUpper, ca, q, 'u')}
            </tr>`;

            // 행 2: 오답수
            html += `<tr>
                ${cc('q'+q+'_r2_lbl', '오답', 'font-size:9px; font-weight:600;')}
                ${cc('q'+q+'_uw', item.upper.wrong, '')}
                ${cc('q'+q+'_mw', item.mid.wrong, '')}
                ${cc('q'+q+'_lw', item.lower.wrong, '')}
                ${cc('q'+q+'_tw', totalWrong, 'font-weight:600;')}
                ${cc('q'+q+'_d2_lbl', '하50%', 'font-size:9px; font-weight:600;')}
                ${distCells(item.distLower, ca, q, 'l')}
            </tr>`;

            // 행 3: 계
            html += `<tr style="border-bottom:2px solid #94a3b8;">
                ${cc('q'+q+'_r3_lbl', '계', 'font-size:9px; font-weight:700;')}
                ${cc('q'+q+'_ut', item.upper.total, 'font-weight:700;')}
                ${cc('q'+q+'_mt', item.mid.total, 'font-weight:700;')}
                ${cc('q'+q+'_lt', item.lower.total, 'font-weight:700;')}
                ${cc('q'+q+'_tt', totalAll, 'font-weight:700;')}
                ${cc('q'+q+'_d3_lbl', '계', 'font-size:9px; font-weight:700;')}
                ${distCells(item.distTotal, ca, q, 't')}
            </tr>`;
        });

        if (items.length > 0) {
            const avgR = items.reduce((s, i) => s + i.correctRate, 0) / items.length;
            const avgD = items.reduce((s, i) => s + i.discrimination, 0) / items.length;
            html += `<tr style="background:#f8fafc; font-weight:700;">
                <td colspan="16" style="padding:8px; text-align:right; font-size:12px; border-top:2px solid var(--border);">전체 평균</td>
                <td colspan="11" style="padding:8px; font-size:12px; border-top:2px solid var(--border);">
                    정답률 <span style="color:var(--blue);">${avgR.toFixed(1)}%</span> · 변별도 <span style="color:var(--blue);">${avgD.toFixed(3)}</span>
                </td>
            </tr>`;
        }

        html += `</tbody></table></div>`;
        return html;
    },

    // ==========================================
    // 개인별 성적표 (A4 가로)
    // ==========================================
    setPersonalIdx(i) {
        const rows = this.collectData();
        const max = Math.max(0, rows.length - 1);
        this._personalIdx = Math.min(Math.max(0, parseInt(i) || 0), max);
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    _personalNextPrev(delta) {
        const rows = this.collectData();
        const n = rows.length;
        if (n === 0) return;
        this._personalIdx = (this._personalIdx + delta + n) % n;
        this.renderScoringPanel(document.getElementById('scoring-content'));
    },

    _personalSearch(query) {
        if (!query) return;
        const q = query.trim().toLowerCase();
        const rows = this.collectData();
        const idx = rows.findIndex(r =>
            (r.name && r.name.toLowerCase().includes(q)) ||
            (r.examNo && r.examNo.includes(q)) ||
            (r.phone && r.phone.includes(q)) ||
            (r.birthday && r.birthday.includes(q))
        );
        if (idx >= 0) { this._personalIdx = idx; this.renderScoringPanel(document.getElementById('scoring-content')); }
        else { Toast.error(`"${query}" 검색 결과 없음`); }
    },

    _personalSearchDropdown(query) {
        const dropdown = document.getElementById('rpt-search-dropdown');
        if (!dropdown) return;
        const q = (query || '').trim().toLowerCase();
        if (!q) { dropdown.style.display = 'none'; return; }
        const rows = this.collectData();
        const matches = [];
        rows.forEach((r, i) => {
            if ((r.name && r.name.toLowerCase().includes(q)) ||
                (r.examNo && r.examNo.includes(q)) ||
                (r.phone && r.phone.includes(q)) ||
                (r.birthday && r.birthday.includes(q))) {
                matches.push({ idx: i, name: r.name || '(이름없음)', examNo: r.examNo || '-', phone: r.phone || '' });
            }
        });
        if (matches.length === 0) {
            dropdown.innerHTML = `<div style="padding:6px 10px;font-size:10px;color:var(--text-muted);">결과 없음</div>`;
        } else {
            dropdown.innerHTML = matches.slice(0, 10).map(m =>
                `<div onclick="Scoring.setPersonalIdx(${m.idx});document.getElementById('rpt-search-dropdown').style.display='none';"
                    style="padding:4px 10px;font-size:11px;cursor:pointer;display:flex;gap:8px;align-items:center;"
                    onmouseenter="this.style.background='#e0f2fe'" onmouseleave="this.style.background=''">
                    <strong>${m.name}</strong><span style="color:var(--text-muted);font-size:10px;">${m.examNo}${m.phone ? ' · ' + m.phone : ''}</span>
                </div>`
            ).join('');
        }
        dropdown.style.display = '';
    },

    _personalPrintPDF() {
        // 인쇄 모드: 성적표 영역만 보이도록 body에 클래스 토글 후 print
        document.body.classList.add('printing-report');
        window.print();
        setTimeout(() => document.body.classList.remove('printing-report'), 500);
    },

    // 과목별 통계 (mean/stdDev/max/min) — calcStats와 중복되지만 접근 편의용
    _calcSubjectStats(rows) {
        const valid = rows.filter(r => !r._noOmr);
        const names = this.getSubjectList(valid);
        const out = {};
        names.forEach(n => {
            const vals = valid.map(r => r.subjects[n] ? r.subjects[n].score : 0).filter(v => typeof v === 'number');
            if (vals.length === 0) return;
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
            out[n] = { mean, stdDev: std, max: Math.max(...vals), min: Math.min(...vals), N: vals.length };
        });
        return out;
    },

    // 분포 히스토그램 bin 계산
    _buildHistogram(rows, binSize) {
        const valid = rows.filter(r => !r._noOmr && typeof r.totalScore === 'number');
        if (valid.length === 0) return { bins: [], min: 0, max: 0 };
        const scores = valid.map(r => r.totalScore);
        const minV = Math.floor(Math.min(...scores) / binSize) * binSize;
        const maxV = Math.ceil(Math.max(...scores) / binSize) * binSize;
        const bins = [];
        for (let v = minV; v < maxV || bins.length === 0; v += binSize) {
            bins.push({ from: v, to: v + binSize, count: 0 });
            if (v >= maxV) break;
        }
        valid.forEach(r => {
            const idx = Math.floor((r.totalScore - minV) / binSize);
            if (bins[idx]) bins[idx].count++;
        });
        return { bins, min: minV, max: maxV };
    },

    _renderPersonal(rows, stats) {
        if (rows.length === 0) {
            return `<div style="text-align:center; padding:60px; color:var(--text-muted);">데이터가 없습니다.</div>`;
        }
        const idx = Math.min(this._personalIdx, rows.length - 1);
        const r = rows[idx];
        const subjects = this.getSubjectList(rows);
        const subjStats = this._calcSubjectStats(rows);
        const totalPages = r._noOmr ? 1 : 2;

        let html = `<style>
            @media print {
                @page { size: A4 landscape; margin: 8mm; }
                body.printing-report > *:not(.report-print-root) { display: none !important; }
                body.printing-report .report-print-root { display: block !important; position: static !important; }
                body.printing-report .rpt-navbar { display: none !important; }
                body.printing-report .report-a4 { box-shadow: none !important; margin: 0 !important; page-break-after: always; }
            }
            .report-print-root { font-family: 'Pretendard', 'Noto Sans KR', -apple-system, system-ui, sans-serif; color: #0f172a; }
            .report-a4 {
                width: 297mm; min-height: 210mm; background: white; margin: 20px auto; padding: 8mm;
                box-shadow: 0 4px 28px rgba(0,0,0,0.12); box-sizing: border-box; position: relative;
            }
            .rpt-h1 { font-size: 22pt; font-weight: 800; letter-spacing: -0.02em; }
            .rpt-mini { font-size: 8pt; color: #64748b; }
            .rpt-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
            .rpt-metric-label { font-size: 8pt; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
            .rpt-metric-value { font-size: 16pt; font-weight: 800; color: #0f172a; line-height: 1.1; }
            .rpt-section-title { font-size: 9pt; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
            .rpt-grid { display: grid; gap: 4mm; }
            .rpt-tbl { border-collapse:collapse; width:100%; font-size:7pt; }
            .rpt-tbl th, .rpt-tbl td { border:1px solid #e2e8f0; padding:2px 3px; text-align:center; }
            .rpt-tbl th { background:#f1f5f9; font-weight:700; color:#334155; }
        </style>`;

        html += `<div class="report-print-root">`;

        // ── 네비게이션 바 (검색 포함) ──
        const opts = rows.map((rr, i) => `<option value="${i}" ${i===idx?'selected':''}>${rr.name || '(이름없음)'} · ${rr.examNo || '-'}</option>`).join('');
        html += `<div class="rpt-navbar" style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; padding:8px 12px; background:#f1f5f9; border-radius:10px; position:sticky; top:0; z-index:10;">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                ${this._periodDropdown()}
                <button class="btn btn-sm" onclick="Scoring._personalNextPrev(-1)" style="font-size:11px; padding:4px 10px;">◀</button>
                <select onchange="Scoring.setPersonalIdx(this.value)"
                    style="padding:4px 8px; font-size:11px; border:1px solid var(--border); border-radius:5px; background:white; min-width:180px;">
                    ${opts}
                </select>
                <button class="btn btn-sm" onclick="Scoring._personalNextPrev(1)" style="font-size:11px; padding:4px 10px;">▶</button>
                <span style="font-size:10px; color:var(--text-muted);">${idx+1}/${rows.length}</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px; position:relative;">
                <input type="text" id="rpt-search-input" placeholder="이름/수험번호/전화/생년"
                    oninput="Scoring._personalSearchDropdown(this.value)"
                    onkeydown="if(event.key==='Enter'){Scoring._personalSearch(this.value);document.getElementById('rpt-search-dropdown').style.display='none';}"
                    onfocus="if(this.value)Scoring._personalSearchDropdown(this.value)"
                    onblur="setTimeout(()=>{const d=document.getElementById('rpt-search-dropdown');if(d)d.style.display='none';},200)"
                    style="padding:4px 8px; font-size:11px; border:1px solid var(--border); border-radius:5px; width:160px;">
                <div id="rpt-search-dropdown" style="display:none;position:absolute;top:100%;left:0;width:260px;max-height:200px;overflow-y:auto;background:white;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:100;margin-top:2px;"></div>
                <button class="btn btn-sm btn-primary" onclick="Scoring._personalPrintPDF()" style="font-size:11px; padding:4px 10px;">PDF/인쇄</button>
            </div>
        </div>`;

        // ============ A4 Page 1: 성적표 ============
        html += `<div class="report-a4">`;
        html += this._rptHeader(r);
        html += this._rptIdentity(r);
        html += `<div style="display:grid; grid-template-columns: 85mm 1fr; gap:4mm; margin-top:4mm;">`;
        html += this._rptSummary(r, stats, subjects);
        html += this._rptSubjectsGrid(r, subjects, subjStats);
        html += `</div>`;
        html += this._rptViz(r, rows, subjects, subjStats);
        html += this._rptFooter(r, 1, totalPages);
        html += `</div>`;

        if (!r._noOmr) {
            // ============ A4 Page 2: 문항분석표 ============
            html += `<div class="report-a4">`;
            html += this._rptItemAnalysis(r, rows, subjects);
            html += this._rptFooter(r, 2, totalPages);
            html += `</div>`;
        }

        html += `</div>`; // .report-print-root
        return html;
    },

    // ── ① HEADER ────────────────────────
    _rptHeader(r) {
        const sessionName = (typeof SessionManager !== 'undefined' && SessionManager.currentSessionName) || '성적표';
        const today = new Date().toISOString().slice(0, 10);
        return `<div style="background: linear-gradient(120deg, #09090b 0%, #27272a 60%, #3f3f46 100%); color:#fafafa; border-radius:6px; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; position:relative; overflow:hidden;">
            <div style="position:absolute; top:0; right:0; width:40%; height:100%; background:radial-gradient(ellipse at top right, rgba(255,255,255,0.08), transparent 70%); pointer-events:none;"></div>
            <div style="position:relative;">
                <div style="font-size:8pt; color:#a1a1aa; font-weight:500; letter-spacing:0.12em; text-transform:uppercase;">Individual Report</div>
                <div style="font-size:12pt; font-weight:500; margin-top:4px; color:#e4e4e7;">${sessionName}</div>
                <div style="font-size:8pt; color:#71717a; margin-top:2px;">${today}</div>
            </div>
            <div style="text-align:right; position:relative;">
                <div style="font-size:7.5pt; color:#a1a1aa; letter-spacing:0.15em; text-transform:uppercase; margin-bottom:2px;">Examinee</div>
                <div style="font-size:24pt; font-weight:300; letter-spacing:-0.02em; line-height:1; color:#fafafa;">${r.name || '(이름 없음)'}</div>
            </div>
        </div>`;
    },

    // ── ② IDENTITY STRIP ───────────────
    _rptIdentity(r) {
        const fields = [
            ['응시번호', r.examNo || '-'],
            ['성명', r.name || '-'],
            ['생년월일', r.birthday || '-'],
            ['전화번호', r.phone || '-'],
        ];
        Object.keys(r.etcFields || {}).forEach(k => fields.push([k, r.etcFields[k] || '-']));

        return `<div style="display:flex; align-items:stretch; background:linear-gradient(180deg, #fafafa, #f4f4f5); border:1px solid #e4e4e7; border-radius:6px; padding:6px 4px; margin-top:4mm;">
            ${fields.map((f, i) => `
                <div style="flex:1; padding:2px 12px; ${i<fields.length-1?'border-right:1px solid #e4e4e7;':''} min-width:0;">
                    <div style="font-size:7.5pt; color:#71717a; font-weight:500; letter-spacing:0.08em; text-transform:uppercase;">${f[0]}</div>
                    <div style="font-size:11pt; font-weight:600; color:#18181b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px;">${f[1]}</div>
                </div>
            `).join('')}
        </div>`;
    },

    // ── ③ 종합 요약 (좌측 패널) ───────
    _rptSummary(r, stats, subjects) {
        const totalScore = r._noOmr ? 0 : (typeof r.totalScore === 'number' ? r.totalScore : 0);
        const totalMax = r._noOmr ? 0 : (typeof r.totalMax === 'number' ? r.totalMax : 0);
        const pct = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
        const rank = r.rank || '-';
        const N = stats ? stats.N : '-';
        const mean = stats ? stats.mean : 0;
        const delta = stats && typeof r.totalScore === 'number' ? (r.totalScore - mean) : 0;
        const deltaAbs = this._fmtScore(Math.abs(delta));
        const deltaStr = delta >= 0 ? `+${deltaAbs}` : `-${deltaAbs}`;
        const deltaArrow = delta >= 0 ? '▲' : '▼';
        const percentile = typeof r.percentile === 'number' ? r.percentile.toFixed(1) : '-';
        const tScore = typeof r.tScore === 'number' ? r.tScore.toFixed(1) : '-';

        return `<aside style="display:flex; flex-direction:column; gap:3mm;">
            <!-- 종합 점수 블록 -->
            <div style="background:linear-gradient(145deg, #18181b 0%, #27272a 55%, #3f3f46 100%); color:#fafafa; border-radius:6px; padding:14px 16px; position:relative; overflow:hidden;">
                <div style="position:absolute; top:-20%; right:-10%; width:60%; height:140%; background:radial-gradient(ellipse, rgba(255,255,255,0.06), transparent 70%); pointer-events:none;"></div>
                <div style="font-size:7.5pt; color:#a1a1aa; letter-spacing:0.15em; font-weight:500; text-transform:uppercase; position:relative;">Total Score</div>
                <div style="display:flex; align-items:baseline; gap:6px; margin-top:6px; position:relative;">
                    <span style="font-size:44pt; font-weight:200; letter-spacing:-0.04em; line-height:1; color:#fafafa;">${this._fmtScore(totalScore)}</span>
                    <span style="font-size:13pt; color:#71717a; font-weight:300;">/ ${this._fmtMax(totalMax)}</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px; margin-top:6px; position:relative;">
                    <div style="flex:1; height:3px; background:#3f3f46; border-radius:2px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, #a1a1aa, #fafafa);"></div>
                    </div>
                    <span style="font-size:10pt; font-weight:500; color:#e4e4e7;">${pct.toFixed(1)}%</span>
                </div>
            </div>

            <!-- 지표 그리드 -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2mm;">
                <div style="background:linear-gradient(180deg, #fafafa, #f4f4f5); border:1px solid #e4e4e7; border-radius:5px; padding:7px 10px;">
                    <div style="font-size:7.5pt; color:#71717a; letter-spacing:0.08em; font-weight:500; text-transform:uppercase;">석차</div>
                    <div style="font-size:17pt; font-weight:300; letter-spacing:-0.02em; color:#18181b; line-height:1.1; margin-top:2px;">${rank}<span style="font-size:9pt; color:#a1a1aa; font-weight:400;"> / ${N}</span></div>
                </div>
                <div style="background:linear-gradient(180deg, #fafafa, #f4f4f5); border:1px solid #e4e4e7; border-radius:5px; padding:7px 10px;">
                    <div style="font-size:7.5pt; color:#71717a; letter-spacing:0.08em; font-weight:500; text-transform:uppercase;">백분위</div>
                    <div style="font-size:17pt; font-weight:300; letter-spacing:-0.02em; color:#18181b; line-height:1.1; margin-top:2px;">${percentile}</div>
                </div>
                <div style="background:linear-gradient(180deg, #fafafa, #f4f4f5); border:1px solid #e4e4e7; border-radius:5px; padding:7px 10px;">
                    <div style="font-size:7.5pt; color:#71717a; letter-spacing:0.08em; font-weight:500; text-transform:uppercase;">표준점수</div>
                    <div style="font-size:17pt; font-weight:300; letter-spacing:-0.02em; color:#18181b; line-height:1.1; margin-top:2px;">${tScore}</div>
                </div>
                <div style="background:linear-gradient(180deg, #fafafa, #f4f4f5); border:1px solid #e4e4e7; border-radius:5px; padding:7px 10px;">
                    <div style="font-size:7.5pt; color:#71717a; letter-spacing:0.08em; font-weight:500; text-transform:uppercase;">평균</div>
                    <div style="font-size:17pt; font-weight:300; letter-spacing:-0.02em; color:#18181b; line-height:1.1; margin-top:2px;">${mean ? this._fmtScore(mean) : '-'}</div>
                </div>
            </div>

            <!-- 평균 대비 -->
            <div style="background:linear-gradient(135deg, #fafafa, #e4e4e7); border:1px solid #d4d4d8; border-radius:5px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:7.5pt; color:#71717a; letter-spacing:0.08em; font-weight:500; text-transform:uppercase;">평균 대비</div>
                    <div style="font-size:18pt; font-weight:300; letter-spacing:-0.02em; color:#18181b; line-height:1.1; margin-top:2px;">${deltaArrow} ${deltaStr}<span style="font-size:9pt; color:#71717a; font-weight:400;"> 점</span></div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:7.5pt; color:#71717a; letter-spacing:0.08em; font-weight:500; text-transform:uppercase;">맞은 개수</div>
                    <div style="font-size:18pt; font-weight:300; letter-spacing:-0.02em; color:#18181b; line-height:1.1; margin-top:2px;">${this._fmtScore(r.totalCorrect || 0)}<span style="font-size:9pt; color:#71717a; font-weight:400;"> 문항</span></div>
                </div>
            </div>
        </aside>`;
    },

    // ── ④ 과목별 카드 그리드 ───────────
    _rptSubjectsGrid(r, subjects, subjStats) {
        if (subjects.length === 0) {
            return `<section style="display:flex; align-items:center; justify-content:center; background:#fafafa; border:1px solid #e4e4e7; border-radius:6px; padding:20mm; color:#a1a1aa; font-size:9pt;">
                과목 데이터가 없습니다
            </section>`;
        }
        const cols = subjects.length <= 3 ? subjects.length : (subjects.length === 4 ? 2 : 3);

        const cards = subjects.map(name => {
            const s = r.subjects[name] || {};
            const score = typeof s.score === 'number' ? s.score : 0;
            // 과목관리의 totalScore 우선 사용
            const subj = (typeof SubjectManager !== 'undefined') ? SubjectManager.findByName(name) : null;
            const max = (subj && subj.totalScore) || (typeof s.totalPossible === 'number' ? s.totalPossible : 0);
            const pct = max > 0 ? (score / max) * 100 : 0;
            const rk = s.rank || '-';
            const pc = typeof s.percentile === 'number' ? s.percentile.toFixed(1) : '-';
            const ts = typeof s.tScore === 'number' ? s.tScore.toFixed(1) : '-';
            const st = subjStats[name] || {};
            const mean = st.mean || 0;
            const delta = score - mean;
            const deltaArrow = delta >= 0 ? '▲' : '▼';
            const deltaAbs = this._fmtScore(Math.abs(delta));
            const deltaStr = delta >= 0 ? `+${deltaAbs}` : `-${deltaAbs}`;

            return `<div style="background:linear-gradient(180deg, #ffffff, #fafafa); border:1px solid #e4e4e7; border-radius:6px; overflow:hidden; display:flex; flex-direction:column;">
                <!-- 헤더 (무채색 그라데이션) -->
                <div style="background:linear-gradient(135deg, #27272a, #52525b); color:#fafafa; padding:6px 12px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:10.5pt; font-weight:500; letter-spacing:0.02em;">${name}</div>
                    <div style="font-size:7.5pt; color:#a1a1aa; letter-spacing:0.05em;">만점 ${this._fmtMax(max)}</div>
                </div>
                <!-- 대형 점수 -->
                <div style="padding:10px 12px; flex:1;">
                    <div style="display:flex; align-items:baseline; justify-content:space-between;">
                        <div>
                            <span style="font-size:28pt; font-weight:200; letter-spacing:-0.03em; color:#18181b; line-height:1;">${this._fmtScore(score)}</span>
                            <span style="font-size:10pt; color:#a1a1aa; font-weight:400;"> / ${this._fmtMax(max)}</span>
                        </div>
                        <div style="font-size:11pt; font-weight:400; color:#52525b; letter-spacing:-0.01em;">${pct.toFixed(1)}%</div>
                    </div>
                    <!-- 진행 바 (그라데이션) -->
                    <div style="height:2px; background:#e4e4e7; border-radius:1px; overflow:hidden; margin-top:8px;">
                        <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, #52525b, #18181b);"></div>
                    </div>
                    <!-- 상세 지표 -->
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:3px 10px; margin-top:10px; font-size:8.5pt;">
                        <div style="display:flex; justify-content:space-between;"><span style="color:#71717a; letter-spacing:0.02em;">맞은 / 틀림</span><span style="font-weight:600; color:#18181b;">${this._fmtScore(s.correctCount || 0)} / ${this._fmtScore(s.wrongCount || 0)}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:#71717a; letter-spacing:0.02em;">석차</span><span style="font-weight:600; color:#18181b;">${rk}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:#71717a; letter-spacing:0.02em;">백분위</span><span style="font-weight:600; color:#18181b;">${pc}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:#71717a; letter-spacing:0.02em;">표준점수</span><span style="font-weight:600; color:#18181b;">${ts}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:#71717a; letter-spacing:0.02em;">평균</span><span style="font-weight:600; color:#18181b;">${this._fmtScore(mean)}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:#71717a; letter-spacing:0.02em;">평균 대비</span><span style="font-weight:600; color:#18181b;">${deltaArrow} ${deltaStr}</span></div>
                    </div>
                </div>
            </div>`;
        }).join('');

        return `<section>
            <div style="font-size:8pt; font-weight:500; color:#71717a; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:4px;">과목별 성적 · Subjects</div>
            <div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:3mm;">${cards}</div>
        </section>`;
    },

    // ── ⑤ 시각화 바 ──────────────────
    _rptViz(r, rows, subjects, subjStats) {
        if (r._noOmr) return `<div style="margin-top:4mm;"></div>`;

        // 5-1. 과목별 막대 (내 점수 vs 평균 vs 만점)
        const barsSvg = this._rptBars(r, subjects, subjStats);
        // 5-2. 히스토그램
        const histSvg = this._rptHistogram(r, rows);
        // 5-3. 레이더/도넛
        const radarSvg = subjects.length >= 3 ? this._rptRadar(r, subjects) : this._rptDonut(r, subjects);

        const vizCard = (label, body) => `<div style="background:linear-gradient(180deg, #ffffff, #fafafa); border:1px solid #e4e4e7; border-radius:6px; padding:10px 12px;">
            <div style="font-size:7.5pt; font-weight:500; color:#71717a; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:6px;">${label}</div>
            ${body}
        </div>`;

        return `<section style="margin-top:4mm;">
            <div style="font-size:8pt; font-weight:500; color:#71717a; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:4px;">시각화 · Visualization</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:3mm;">
                ${vizCard('과목별 점수 비교', barsSvg)}
                ${vizCard('전체 점수 분포', histSvg)}
                ${vizCard(subjects.length >= 3 ? '표준점수 프로파일' : '정답률', radarSvg)}
            </div>
        </section>`;
    },

    _rptBars(r, subjects, subjStats) {
        if (subjects.length === 0) return '<div style="height:90px; display:flex; align-items:center; justify-content:center; color:#a1a1aa; font-size:9pt;">데이터 없음</div>';
        const W = 280, H = 110, pad = { l: 24, r: 8, t: 8, b: 22 };
        const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
        const n = subjects.length;
        const groupW = iw / n;
        const barW = groupW * 0.28;
        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;">
            <defs>
                <linearGradient id="barMe" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#18181b"/>
                    <stop offset="100%" stop-color="#52525b"/>
                </linearGradient>
                <linearGradient id="barAvg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#d4d4d8"/>
                    <stop offset="100%" stop-color="#e4e4e7"/>
                </linearGradient>
            </defs>`;
        // Y축
        [0, 25, 50, 75, 100].forEach(p => {
            const y = pad.t + ih - (p / 100) * ih;
            svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#f4f4f5" stroke-width="0.5"/>`;
            svg += `<text x="${pad.l - 3}" y="${y + 2}" text-anchor="end" font-size="6" fill="#a1a1aa">${p}</text>`;
        });

        subjects.forEach((name, i) => {
            const s = r.subjects[name] || {};
            const st = subjStats[name] || {};
            const max = s.totalPossible || 0;
            const myPct = max > 0 ? ((s.score || 0) / max) * 100 : 0;
            const avgPct = max > 0 ? ((st.mean || 0) / max) * 100 : 0;
            const gx = pad.l + groupW * i + groupW * 0.5;
            const myH = (myPct / 100) * ih;
            svg += `<rect x="${gx - barW - 2}" y="${pad.t + ih - myH}" width="${barW}" height="${myH}" fill="url(#barMe)" rx="1"/>`;
            svg += `<text x="${gx - barW / 2 - 2}" y="${pad.t + ih - myH - 2}" text-anchor="middle" font-size="6" fill="#18181b" font-weight="600">${s.score || 0}</text>`;
            const avgH = (avgPct / 100) * ih;
            svg += `<rect x="${gx + 2}" y="${pad.t + ih - avgH}" width="${barW}" height="${avgH}" fill="url(#barAvg)" rx="1"/>`;
            svg += `<text x="${gx + barW / 2 + 2}" y="${pad.t + ih - avgH - 2}" text-anchor="middle" font-size="6" fill="#71717a">${(st.mean || 0).toFixed(0)}</text>`;
            svg += `<text x="${gx}" y="${pad.t + ih + 10}" text-anchor="middle" font-size="7" font-weight="500" fill="#27272a">${name.length > 6 ? name.slice(0, 6) + '…' : name}</text>`;
        });
        svg += `<g transform="translate(${pad.l}, ${H - 6})">
            <rect x="0" y="-4" width="5" height="4" fill="#18181b"/><text x="7" y="0" font-size="6" fill="#52525b">내 점수</text>
            <rect x="35" y="-4" width="5" height="4" fill="#d4d4d8"/><text x="42" y="0" font-size="6" fill="#52525b">평균</text>
        </g>`;
        svg += `</svg>`;
        return svg;
    },

    _rptHistogram(r, rows) {
        const bin = 10;
        const { bins, min, max } = this._buildHistogram(rows, bin);
        if (bins.length === 0) return '<div style="height:90px; display:flex; align-items:center; justify-content:center; color:#a1a1aa; font-size:9pt;">데이터 없음</div>';
        const W = 280, H = 110, pad = { l: 20, r: 8, t: 8, b: 22 };
        const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
        const maxCount = Math.max(...bins.map(b => b.count)) || 1;
        const barW = iw / bins.length;
        const myScore = typeof r.totalScore === 'number' ? r.totalScore : 0;
        const range = max - min || 1;

        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;">
            <defs>
                <linearGradient id="histBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#d4d4d8"/>
                    <stop offset="100%" stop-color="#e4e4e7"/>
                </linearGradient>
                <linearGradient id="histMine" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#18181b"/>
                    <stop offset="100%" stop-color="#52525b"/>
                </linearGradient>
            </defs>`;
        bins.forEach((b, i) => {
            const h = (b.count / maxCount) * ih;
            const x = pad.l + barW * i;
            const y = pad.t + ih - h;
            const isMine = myScore >= b.from && myScore < b.to;
            svg += `<rect x="${x + 1}" y="${y}" width="${barW - 2}" height="${h}" fill="${isMine ? 'url(#histMine)' : 'url(#histBar)'}" rx="1"/>`;
            if (b.count > 0) {
                svg += `<text x="${x + barW / 2}" y="${y - 1}" text-anchor="middle" font-size="5.5" fill="#71717a">${b.count}</text>`;
            }
        });
        svg += `<line x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}" stroke="#d4d4d8" stroke-width="0.5"/>`;
        const ticks = [bins[0].from, bins[Math.floor(bins.length / 2)].from, bins[bins.length - 1].to];
        ticks.forEach((t, i) => {
            const x = pad.l + (iw * i) / 2;
            svg += `<text x="${x}" y="${pad.t + ih + 8}" text-anchor="${i===0?'start':i===2?'end':'middle'}" font-size="6" fill="#a1a1aa">${t}</text>`;
        });
        const myX = pad.l + ((myScore - min) / range) * iw;
        svg += `<line x1="${myX}" y1="${pad.t}" x2="${myX}" y2="${pad.t + ih}" stroke="#18181b" stroke-width="0.8" stroke-dasharray="2,1.5"/>`;
        svg += `<text x="${myX}" y="${H - 2}" text-anchor="middle" font-size="7" fill="#18181b" font-weight="600">나 ${myScore}</text>`;
        svg += `</svg>`;
        return svg;
    },

    _rptRadar(r, subjects) {
        const W = 200, H = 110, cx = W / 2, cy = H / 2 + 4, R = 40;
        const n = subjects.length;
        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;">
            <defs>
                <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#52525b" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#18181b" stop-opacity="0.15"/>
                </radialGradient>
            </defs>`;
        [30, 50, 70].forEach(t => {
            const rr = ((t - 30) / 40) * R;
            svg += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="#e4e4e7" stroke-width="0.4"/>`;
        });
        subjects.forEach((name, i) => {
            const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
            const x = cx + Math.cos(angle) * R;
            const y = cy + Math.sin(angle) * R;
            svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e4e4e7" stroke-width="0.4"/>`;
            const lx = cx + Math.cos(angle) * (R + 8);
            const ly = cy + Math.sin(angle) * (R + 8);
            svg += `<text x="${lx}" y="${ly + 2}" text-anchor="middle" font-size="6.5" font-weight="500" fill="#52525b">${name.length > 4 ? name.slice(0, 4) : name}</text>`;
        });
        const avgR = ((50 - 30) / 40) * R;
        svg += `<circle cx="${cx}" cy="${cy}" r="${avgR}" fill="none" stroke="#a1a1aa" stroke-width="0.5" stroke-dasharray="2,1"/>`;
        let pts = '';
        subjects.forEach((name, i) => {
            const s = r.subjects[name] || {};
            const t = typeof s.tScore === 'number' ? s.tScore : 50;
            const clamped = Math.max(30, Math.min(70, t));
            const rr = ((clamped - 30) / 40) * R;
            const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
            const x = cx + Math.cos(angle) * rr;
            const y = cy + Math.sin(angle) * rr;
            pts += `${x},${y} `;
            svg += `<circle cx="${x}" cy="${y}" r="1.6" fill="#18181b"/>`;
        });
        svg += `<polygon points="${pts}" fill="url(#radarFill)" stroke="#18181b" stroke-width="1"/>`;
        svg += `<text x="${cx}" y="${cy - avgR - 1}" font-size="5" fill="#a1a1aa" text-anchor="middle">T50</text>`;
        svg += `</svg>`;
        return svg;
    },

    _rptDonut(r, subjects) {
        const W = 200, H = 110, cx = W / 2, cy = H / 2 + 4, outer = 40, inner = 28;
        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;">
            <defs>
                <linearGradient id="donutArc" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#27272a"/>
                    <stop offset="100%" stop-color="#71717a"/>
                </linearGradient>
            </defs>`;
        if (subjects.length === 0) {
            svg += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="8" fill="#a1a1aa">데이터 없음</text>`;
            svg += `</svg>`;
            return svg;
        }
        const gap = 60;
        subjects.forEach((name, i) => {
            const s = r.subjects[name] || {};
            const max = s.totalPossible || 0;
            const pct = max > 0 ? ((s.score || 0) / max) : 0;
            const thisCx = subjects.length === 1 ? cx : (cx - gap/2 + i * gap);

            svg += `<circle cx="${thisCx}" cy="${cy}" r="${outer}" fill="#f4f4f5"/>`;
            const endAngle = Math.PI * 2 * pct - Math.PI / 2;
            const startAngle = -Math.PI / 2;
            const sx = thisCx + Math.cos(startAngle) * outer;
            const sy = cy + Math.sin(startAngle) * outer;
            const ex = thisCx + Math.cos(endAngle) * outer;
            const ey = cy + Math.sin(endAngle) * outer;
            const large = pct > 0.5 ? 1 : 0;
            if (pct >= 1) {
                svg += `<circle cx="${thisCx}" cy="${cy}" r="${outer}" fill="url(#donutArc)"/>`;
            } else if (pct > 0) {
                svg += `<path d="M ${thisCx} ${cy} L ${sx} ${sy} A ${outer} ${outer} 0 ${large} 1 ${ex} ${ey} Z" fill="url(#donutArc)"/>`;
            }
            svg += `<circle cx="${thisCx}" cy="${cy}" r="${inner}" fill="white"/>`;
            svg += `<text x="${thisCx}" y="${cy - 1}" text-anchor="middle" font-size="11" font-weight="300" fill="#18181b" letter-spacing="-0.5">${(pct*100).toFixed(0)}%</text>`;
            svg += `<text x="${thisCx}" y="${cy + 8}" text-anchor="middle" font-size="6.5" fill="#71717a">${name}</text>`;
        });
        svg += `</svg>`;
        return svg;
    },

    // ── ⑥ 문항 정오표 ────────────────
    _rptQuestions(r, subjects) {
        if (r._noOmr || subjects.length === 0) return '';
        const rows = subjects.map(name => {
            const s = r.subjects[name] || {};
            const ans = s.answers || [];
            const cells = ans.map(a => {
                // 무채색: O=연한배경/검정글씨, X=검정배경/흰글씨, ∅=회색 배경
                let bg = '#f4f4f5', color = '#a1a1aa', sym = '·', weight = '400';
                if (a.marked !== null && a.marked !== undefined) {
                    if (a.isCorrect) { bg = '#e4e4e7'; color = '#18181b'; sym = 'O'; weight = '600'; }
                    else { bg = 'linear-gradient(135deg, #18181b, #3f3f46)'; color = '#fafafa'; sym = 'X'; weight = '700'; }
                }
                return `<div style="display:inline-flex; flex-direction:column; align-items:center; margin:0 1px 1px 0; width:18px;">
                    <div style="font-size:6pt; color:#a1a1aa; line-height:1;">${a.q}</div>
                    <div style="width:16px; height:16px; background:${bg}; color:${color}; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:8pt; font-weight:${weight};">${sym}</div>
                </div>`;
            }).join('');
            return `<div style="display:flex; align-items:flex-start; gap:6px; margin-bottom:4px;">
                <div style="min-width:56px; padding:4px 8px; background:linear-gradient(135deg, #27272a, #52525b); color:#fafafa; border-radius:4px; font-size:8pt; font-weight:500; text-align:center; letter-spacing:0.02em;">${name}</div>
                <div style="flex:1; display:flex; flex-wrap:wrap;">${cells}</div>
            </div>`;
        }).join('');

        return `<section style="margin-top:4mm;">
            <div style="font-size:8pt; font-weight:500; color:#71717a; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:4px;">
                문항별 정오표 · Item Analysis
                <span style="color:#a1a1aa; font-weight:400; text-transform:none; letter-spacing:0; margin-left:6px;">O 정답 · X 오답 · · 미응답</span>
            </div>
            <div style="background:linear-gradient(180deg, #ffffff, #fafafa); border:1px solid #e4e4e7; border-radius:6px; padding:8px 10px;">
                ${rows}
            </div>
        </section>`;
    },

    // ── ⑦ FOOTER ─────────────────────
    _rptFooter(r, page, total) {
        const now = new Date();
        const ts = now.toISOString().slice(0, 16).replace('T', ' ');
        const docId = `OMR-${(r.examNo || '0').padStart(8, '0')}-${now.getTime().toString().slice(-4)}`;
        const p = page || 1, t = total || 1;
        return `<footer style="position:absolute; bottom:4mm; left:8mm; right:8mm; display:flex; justify-content:space-between; font-size:7pt; color:#a1a1aa; border-top:1px solid #e4e4e7; padding-top:4px; letter-spacing:0.02em;">
            <span>발행 · ${ts}</span>
            <span>${docId}</span>
            <span>OMR Scoring Engine v1.0</span>
            <span>Page ${p} / ${t}</span>
        </footer>`;
    },

    // ── A4 Page 2: OMR 결과표 ─────────────────────
    _rptOmrResults(r, subjects) {
        const sessionName = (typeof SessionManager !== 'undefined' && SessionManager.currentSessionName) || '';
        let html = `<div style="margin-bottom:4mm;">
            <div style="font-size:14pt; font-weight:800; color:#0f172a;">OMR 결과표</div>
            <div style="font-size:8pt; color:#64748b;">${r.name || ''} · ${r.examNo || ''} · ${sessionName}</div>
        </div>`;

        subjects.forEach(name => {
            const s = r.subjects[name] || {};
            const ans = s.answers || [];
            if (ans.length === 0) return;

            const periodLabel = s.periodName ? `[${s.periodName}] ` : '';
            const scoreText = `${s.correctCount || 0}/${ans.length} (${s.score != null ? s.score : '-'}점)`;

            // 테이블: 문항번호 / 마킹 / 정답 / 정오
            // 가로로 최대 25문항씩 잘라서 표시
            const COLS = 25;
            const chunks = [];
            for (let i = 0; i < ans.length; i += COLS) chunks.push(ans.slice(i, i + COLS));

            let tableHtml = '';
            chunks.forEach(chunk => {
                let hdr = '<tr><th style="width:40px;">구분</th>';
                let rowQ = '<tr><td style="font-weight:700;background:#f8fafc;">문항</td>';
                let rowM = '<tr><td style="font-weight:700;background:#f8fafc;">마킹</td>';
                let rowA = '<tr><td style="font-weight:700;background:#f8fafc;">정답</td>';
                let rowR = '<tr><td style="font-weight:700;background:#f8fafc;">정오</td>';
                chunk.forEach(a => {
                    hdr += `<th>${a.q}</th>`;
                    rowQ += `<td>${a.q}</td>`;
                    const mLabel = a.marked != null ? a.marked : '-';
                    rowM += `<td style="font-weight:700;">${mLabel}</td>`;
                    const aLabel = a.correctAnswer != null ? a.correctAnswer : '-';
                    rowA += `<td>${aLabel}</td>`;
                    if (a.marked == null) {
                        rowR += `<td style="color:#a1a1aa;">·</td>`;
                    } else if (a.isCorrect) {
                        rowR += `<td style="color:#16a34a;font-weight:700;">O</td>`;
                    } else {
                        rowR += `<td style="color:#dc2626;font-weight:700;">X</td>`;
                    }
                });
                hdr += '</tr>'; rowQ += '</tr>'; rowM += '</tr>'; rowA += '</tr>'; rowR += '</tr>';
                tableHtml += `<table class="rpt-tbl" style="margin-bottom:2px;">${hdr}${rowM}${rowA}${rowR}</table>`;
            });

            html += `<div style="margin-bottom:4mm;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                    <span style="padding:2px 8px;background:#27272a;color:#fafafa;border-radius:3px;font-size:8pt;font-weight:600;">${periodLabel}${name}</span>
                    <span style="font-size:8pt;color:#64748b;">${scoreText}</span>
                </div>
                ${tableHtml}
            </div>`;
        });

        return html;
    },

    // ── A4 Page 2: 문항분석표 (5과목 가로배치) ─────────────────────
    _rptItemAnalysis(r, rows, subjects) {
        const sessionName = (typeof SessionManager !== 'undefined' && SessionManager.currentSessionName) || '';
        // 버블 스타일 헬퍼
        const bubble = (num, color, bg) => `<span style="display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;border-radius:50%;background:${bg};color:${color};font-size:6pt;font-weight:700;line-height:1;">${num}</span>`;
        const bubbleCorrect = (num) => bubble(num, '#fff', '#18181b');
        const bubbleWrong = (num) => bubble(num, '#fff', '#dc2626');
        const bubbleMissing = () => bubble('-', '#a1a1aa', '#f4f4f5');

        let html = `<div style="margin-bottom:2mm;">
            <div style="font-size:12pt; font-weight:800; color:#0f172a;">문항분석표</div>
            <div style="font-size:7pt; color:#64748b;">${r.name || ''} · ${r.examNo || ''} · ${sessionName}
                <span style="margin-left:8px;"><span style="background:#fef2f2;padding:0 3px;border-radius:2px;">오답</span> <span style="background:#fefce8;padding:0 3px;border-radius:2px;">미응답</span></span>
            </div>
        </div>`;

        // 5과목 가로 배치: 각 과목 1칼럼
        const colCount = Math.max(subjects.length, 1);
        html += `<div style="display:grid;grid-template-columns:repeat(${colCount},1fr);gap:2mm;align-items:start;">`;

        subjects.forEach(name => {
            const items = this.calcItemAnalysis(rows, name);
            if (!items || items.length === 0) { html += '<div></div>'; return; }

            const s = r.subjects[name] || {};
            const myAnswers = {};
            (s.answers || []).forEach(a => { myAnswers[a.q] = a; });
            const periodLabel = s.periodName ? `[${s.periodName}] ` : '';
            const avgCr = (items.reduce((sum, it) => sum + (it.correctRate || 0), 0) / items.length).toFixed(0);
            const score = s.score != null ? s.score : '-';
            const correct = s.correctCount || 0;

            let tableRows = items.map(it => {
                const my = myAnswers[it.q] || {};
                const isWrong = my.marked != null && !my.isCorrect;
                const isMissing = my.marked == null;
                const rowBg = isWrong ? 'background:#fef2f2;' : isMissing ? 'background:#fefce8;' : '';

                // 답 버블
                const ansBubble = it.correctAnswer != null ? bubbleCorrect(it.correctAnswer) : '-';
                // 내답 버블
                let myBubble;
                if (my.marked != null && my.isCorrect) {
                    myBubble = bubbleCorrect(my.marked);
                } else if (my.marked != null) {
                    myBubble = bubbleWrong(my.marked);
                } else {
                    myBubble = bubbleMissing();
                }

                const cr = it.correctRate != null ? it.correctRate.toFixed(0) : '-';
                const disc = it.discrimination != null ? it.discrimination.toFixed(2) : '-';
                const crColor = it.correctRate < 30 ? '#dc2626' : it.correctRate > 80 ? '#16a34a' : '#0f172a';
                const discColor = it.discrimination < 0.2 ? '#dc2626' : it.discrimination > 0.4 ? '#16a34a' : '#0f172a';

                return `<tr style="${rowBg}">
                    <td>${it.q}</td>
                    <td>${ansBubble}</td>
                    <td>${myBubble}</td>
                    <td style="color:${crColor};">${cr}</td>
                    <td style="color:${discColor};">${disc}</td>
                </tr>`;
            }).join('');

            html += `<div>
                <div style="padding:2px 0;margin-bottom:1px;">
                    <div style="padding:1px 6px;background:#27272a;color:#fafafa;border-radius:2px;font-size:7pt;font-weight:600;text-align:center;">${periodLabel}${name}</div>
                    <div style="font-size:5pt;color:#64748b;text-align:center;margin-top:1px;">${correct}/${items.length} ${score}점 평균${avgCr}%</div>
                </div>
                <table class="rpt-tbl" style="font-size:6pt;">
                    <tr><th>Q</th><th>답</th><th>내답</th><th>정답률</th><th>변별도</th></tr>
                    ${tableRows}
                </table>
            </div>`;
        });

        html += `</div>`;
        return html;
    }
};
