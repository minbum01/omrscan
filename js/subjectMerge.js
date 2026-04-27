// ============================================
// subjectMerge.js - 과목 합치기 (한 학생이 A or B에만 마킹한 경우 한 과목으로 통합)
// 비파괴: 원본 ROI/results 손대지 않고, Scoring.collectData 결과에 동적 매핑
// ============================================

const SubjectMerge = {
    // 모달 편집 상태 (UI 전용)
    _editing: null, // [{ target, sources }]
    _modalEl: null,

    // ── 헬퍼 ─────────────────────────────────
    _groups() { return (App.state.subjectMerges || []); },

    isSource(name) {
        return this._groups().some(g => g.sources.includes(name));
    },

    getTarget(name) {
        const g = this._groups().find(g => g.sources.includes(name));
        return g ? g.target : null;
    },

    // 원본 이름 → 표시 이름 (소스면 타깃, 아니면 자기 자신)
    getEffectiveName(name) {
        return this.getTarget(name) || name;
    },

    // ROI에서 후보 과목 목록 수집 (subject_answer 만, 이름별 1개)
    getCandidateSubjects() {
        const map = {};
        const allImages = this._allImages();
        allImages.forEach(img => {
            if (!img.rois) return;
            img.rois.forEach((roi, ri) => {
                if (!roi.settings || roi.settings.type !== 'subject_answer') return;
                const subjectName = this._roiSubjectName(roi, ri);
                if (!subjectName) return;
                if (!map[subjectName]) {
                    map[subjectName] = {
                        name: subjectName,
                        startNum: roi.settings.startNum || 1,
                        numQuestions: roi.settings.numQuestions || 0,
                        markedStudents: 0,
                    };
                }
                // 이 이미지에서 markedAnswer 있는 행이 1개라도 있으면 카운트
                const res = img.results && img.results[ri];
                if (res && res.rows && res.rows.some(r => r.markedAnswer !== null)) {
                    map[subjectName].markedStudents++;
                }
            });
        });
        return Object.values(map);
    },

    _allImages() {
        // 다교시 포함 — 모든 periods 의 이미지
        const out = [];
        if (App.state.periods && App.state.periods.length > 0) {
            App.state.periods.forEach(p => { if (p.images) out.push(...p.images); });
        } else if (App.state.images) {
            out.push(...App.state.images);
        }
        return out;
    },

    _roiSubjectName(roi, ri) {
        const rawName = (roi.settings && roi.settings.name && roi.settings.name.trim()) || '';
        const mapped = (typeof SubjectManager !== 'undefined' && SubjectManager.findByRoiName) ? SubjectManager.findByRoiName(rawName) : null;
        return (mapped && mapped.name) || rawName || `과목${ri + 1}`;
    },

    // 검증: 같은 그룹 내 모든 과목의 startNum + numQuestions 일치
    validateGroup(group) {
        const cands = this.getCandidateSubjects();
        const all = [group.target, ...group.sources].map(n => cands.find(c => c.name === n)).filter(Boolean);
        if (all.length < 2) return { ok: false, reason: '타깃 + 소스 1개 이상이 필요합니다.' };
        const first = all[0];
        for (const c of all) {
            if (c.startNum !== first.startNum || c.numQuestions !== first.numQuestions) {
                return {
                    ok: false,
                    reason: `문항 범위가 달라 합칠 수 없습니다 (${all.map(x => `${x.name}: ${x.startNum}~${x.startNum + x.numQuestions - 1}`).join(', ')}).`
                };
            }
        }
        return { ok: true };
    },

    // 충돌 감지: 한 학생이 그룹 내 2개 이상 영역에 markedAnswer != null 행을 가진 경우
    detectConflicts(group) {
        const targetSet = new Set([group.target, ...group.sources]);
        const out = [];
        this._allImages().forEach(img => {
            if (!img.rois || !img.results) return;
            const marked = new Set();
            img.rois.forEach((roi, ri) => {
                if (!roi.settings || roi.settings.type !== 'subject_answer') return;
                const subjectName = this._roiSubjectName(roi, ri);
                if (!targetSet.has(subjectName)) return;
                const res = img.results[ri];
                if (res && res.rows && res.rows.some(r => r.markedAnswer !== null)) marked.add(subjectName);
            });
            if (marked.size >= 2) {
                out.push({
                    imgName: img._originalName || img.name || '이미지',
                    marked: [...marked],
                });
            }
        });
        return out;
    },

    // 타깃의 정답키 + 배점 정보 (questionNumber → { correctAnswer, score })
    // 동일 이름 ROI 여러개(1~20+21~40 concat) 케이스도 합산
    _getTargetAnswerInfo(targetName) {
        const result = { keyByQ: {}, scoreByQ: {}, defaultScore: (App.state.answerKey && App.state.answerKey.scorePerQuestion) || 5 };
        const seen = new Set(); // (img, ri) 중복 방지 — 다교시에 동일 ROI 가 여러 번 나올 수 있음
        // 한 이미지로 충분 — 첫 매칭 이미지의 모든 동일 이름 ROI 를 사용
        for (const img of this._allImages()) {
            if (!img.rois) continue;
            const matchingIdx = img.rois.map((roi, ri) => ({ roi, ri }))
                .filter(({ roi, ri }) => roi.settings && roi.settings.type === 'subject_answer' && this._roiSubjectName(roi, ri) === targetName);
            if (matchingIdx.length === 0) continue;

            matchingIdx.forEach(({ roi, ri }) => {
                if (seen.has(ri)) return;
                seen.add(ri);
                const answers = (typeof Grading !== 'undefined' && Grading.getAnswersForRoi) ? Grading.getAnswersForRoi(ri, img) : null;
                if (!answers) return;
                const startNum = roi.settings.startNum || 1;
                const rawName = (roi.settings.name || '').trim();
                const subjConfig = (typeof SubjectManager !== 'undefined' && rawName) ? SubjectManager.findByRoiName(rawName) : null;
                const defaultScore = (subjConfig && subjConfig.scorePerQuestion) || result.defaultScore;
                const hasCustom = subjConfig && subjConfig.useCustomScore && Array.isArray(subjConfig.scoreMap);

                answers.forEach((correctAns, idx) => {
                    const q = startNum + idx;
                    if (correctAns !== null && correctAns !== undefined && result.keyByQ[q] === undefined) {
                        result.keyByQ[q] = correctAns;
                    }
                    if (result.scoreByQ[q] === undefined) {
                        result.scoreByQ[q] = (hasCustom && subjConfig.scoreMap[idx] != null) ? subjConfig.scoreMap[idx] : defaultScore;
                    }
                });
                result.defaultScore = defaultScore;
            });
            return result; // 첫 이미지 처리 완료
        }
        return result;
    },

    // ── 핵심: rows에 적용 ────────────────────────
    applyToRows(rows) {
        const groups = this._groups();
        if (!groups || groups.length === 0) return rows;
        groups.forEach(g => this._applyGroup(rows, g));
        // row 합산 갱신
        rows.forEach(row => {
            if (!row.subjects) return;
            let totalScore = 0, totalCorrect = 0, totalWrong = 0, totalMax = 0;
            Object.values(row.subjects).forEach(s => {
                totalScore   += (s.score        || 0);
                totalCorrect += (s.correctCount || 0);
                totalWrong   += (s.wrongCount   || 0);
                totalMax     += (s.totalPossible || 0);
            });
            row.totalScore   = totalScore;
            row.totalCorrect = totalCorrect;
            row.totalWrong   = totalWrong;
            row.totalMax     = totalMax;
            row.score          = totalScore;
            row.correctCount   = totalCorrect;
            row.wrongCount     = totalWrong;
            row.totalPossible  = totalMax;
        });
        return rows;
    },

    _applyGroup(rows, group) {
        const { target, sources } = group;
        const info = this._getTargetAnswerInfo(target);

        rows.forEach(row => {
            if (!row.subjects) return;
            const presentSources = sources.filter(s => row.subjects[s]);
            const targetExists = !!row.subjects[target];
            if (!targetExists && presentSources.length === 0) return;

            // 1) byQ 초기화 — 타깃의 marked 우선, 없으면 비어있음
            // 채점값(isCorrect/correctAnswer)은 무시 — 어차피 마지막에 타깃 키로 재채점함
            const byQ = {};
            if (targetExists) {
                (row.subjects[target].answers || []).forEach(a => {
                    byQ[a.q] = { q: a.q, marked: a.marked, markedLabel: a.markedLabel };
                });
            }

            // 2) 소스에서 marked 채움 — 타깃이 비어있을 때만 (타깃 우선)
            presentSources.forEach(srcName => {
                const srcSub = row.subjects[srcName];
                (srcSub.answers || []).forEach(srcAns => {
                    if (srcAns.marked === null) return; // 소스 빈칸 → 패스
                    const q = srcAns.q;
                    const tAns = byQ[q];
                    if (tAns && tAns.marked !== null) return; // 타깃 우선
                    byQ[q] = { q, marked: srcAns.marked, markedLabel: srcAns.markedLabel };
                });
            });

            // 3) 타깃 정답키로 일괄 재채점 — 모든 q를 동일 기준으로
            // q 후보: byQ + info.keyByQ 합집합
            const allQs = new Set(Object.keys(byQ).map(Number));
            Object.keys(info.keyByQ).forEach(q => allQs.add(Number(q)));
            const sortedQs = [...allQs].sort((a, b) => a - b);

            let score = 0, correctCount = 0, wrongCount = 0, totalPossible = 0;
            const newAnswers = sortedQs.map(q => {
                const cur = byQ[q] || { q, marked: null, markedLabel: null };
                const correctAnswer = (info.keyByQ[q] !== undefined) ? info.keyByQ[q] : null;
                const isCorrect = (correctAnswer !== null && correctAnswer !== undefined) && (cur.marked === correctAnswer);
                const qScore = (info.scoreByQ[q] != null) ? info.scoreByQ[q] : info.defaultScore;

                if (correctAnswer !== null && correctAnswer !== undefined) {
                    totalPossible += qScore;
                    if (isCorrect) { correctCount++; score += qScore; }
                    else if (cur.marked !== null) { wrongCount++; }
                }

                return {
                    q,
                    marked: cur.marked,
                    markedLabel: cur.markedLabel,
                    isCorrect,
                    correctAnswer,
                    subject: target,
                };
            });

            // 타깃 sub 메타 (period 정보 등) 보존
            const meta = row.subjects[target] || (presentSources.length > 0 ? row.subjects[presentSources[0]] : {});
            row.subjects[target] = {
                score, correctCount, wrongCount, totalPossible,
                answers: newAnswers,
                periodId:   meta.periodId   || null,
                periodName: meta.periodName || null,
            };

            // 소스 제거 (타깃과 같은 이름이면 제거 안 함)
            sources.forEach(s => { if (s !== target) delete row.subjects[s]; });
        });
    },

    // ── 모달 UI ─────────────────────────────────
    openModal() {
        // 현재 저장된 그룹을 편집 상태로 복사
        this._editing = this._groups().map(g => ({ target: g.target, sources: [...g.sources] }));
        if (this._editing.length === 0) this._editing.push({ target: null, sources: [] });
        this._renderModal();
    },

    _closeModal() {
        if (this._modalEl) {
            this._modalEl.remove();
            this._modalEl = null;
        }
        this._editing = null;
    },

    _renderModal() {
        if (this._modalEl) this._modalEl.remove();
        const cands = this.getCandidateSubjects();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

        // 다른 그룹에 이미 사용된 과목명 (현재 그룹 편집 시 비활성화)
        const usedInOtherGroup = (currentIdx) => {
            const set = new Set();
            this._editing.forEach((g, i) => {
                if (i === currentIdx) return;
                if (g.target) set.add(g.target);
                g.sources.forEach(s => set.add(s));
            });
            return set;
        };

        let groupsHtml = '';
        this._editing.forEach((g, gi) => {
            const used = usedInOtherGroup(gi);
            const targetChips = cands.map(c => {
                const disabled = used.has(c.name);
                const checked = g.target === c.name;
                return `<label style="display:inline-flex;align-items:center;gap:4px;padding:5px 9px;border:1px solid ${checked ? 'var(--blue)' : 'var(--border)'};border-radius:14px;font-size:12px;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? 0.4 : 1};background:${checked ? 'var(--blue-light)' : '#fff'};">
                    <input type="radio" name="sm-target-${gi}" value="${this._esc(c.name)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                        onchange="SubjectMerge._setTarget(${gi}, this.value)">
                    ${this._esc(c.name)} <span style="color:var(--text-muted);font-size:10px;">${c.startNum}~${c.startNum + c.numQuestions - 1}</span>
                </label>`;
            }).join('');

            const sourceChips = cands.map(c => {
                const isTarget = g.target === c.name;
                const disabled = used.has(c.name) || isTarget;
                const checked = g.sources.includes(c.name);
                return `<label style="display:inline-flex;align-items:center;gap:4px;padding:5px 9px;border:1px solid ${checked ? 'var(--orange, #f59e0b)' : 'var(--border)'};border-radius:14px;font-size:12px;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? 0.4 : 1};background:${checked ? '#fef3c7' : '#fff'};">
                    <input type="checkbox" value="${this._esc(c.name)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                        onchange="SubjectMerge._toggleSource(${gi}, this.value, this.checked)">
                    ${this._esc(c.name)} <span style="color:var(--text-muted);font-size:10px;">${c.markedStudents}명</span>
                </label>`;
            }).join('');

            // 검증 메시지
            let warn = '';
            if (g.target && g.sources.length > 0) {
                const v = this.validateGroup(g);
                if (!v.ok) warn = `<div style="margin-top:8px;font-size:11px;color:var(--red);">⚠ ${this._esc(v.reason)}</div>`;
            }

            groupsHtml += `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;background:#fafbfc;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <strong style="font-size:13px;">그룹 ${gi + 1}</strong>
                    <button onclick="SubjectMerge._removeGroup(${gi})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:16px;line-height:1;">×</button>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">타깃 과목 (1개 — 정답키와 표시 이름의 기준):</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${targetChips}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">합칠 소스 과목들 (체크):</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">${sourceChips}</div>
                ${warn}
            </div>`;
        });

        overlay.innerHTML = `<div style="width:640px;max-width:92vw;max-height:84vh;background:#fff;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
            <div style="padding:16px 20px;border-bottom:1px solid var(--border);">
                <h2 style="margin:0;font-size:18px;font-weight:700;">과목 합치기</h2>
                <p style="margin:4px 0 0;color:var(--text-muted);font-size:12px;line-height:1.5;">학생이 A 또는 B에만 마킹한 경우 두 영역을 한 과목으로 통합합니다. 채점은 <strong>타깃 과목의 정답키</strong>로 진행됩니다.</p>
            </div>
            <div style="flex:1;overflow-y:auto;padding:16px 20px;">
                ${groupsHtml}
                <button onclick="SubjectMerge._addGroup()" style="width:100%;padding:8px;font-size:12px;font-weight:600;border:1px dashed var(--border);border-radius:8px;background:#fff;cursor:pointer;color:var(--text-secondary);">+ 새 그룹 추가</button>
            </div>
            <div style="padding:12px 20px;border-top:1px solid var(--border);text-align:right;">
                <button onclick="SubjectMerge._closeModal()" class="btn" style="margin-right:6px;">취소</button>
                <button onclick="SubjectMerge._apply()" class="btn btn-primary">적용</button>
            </div>
        </div>`;

        overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeModal(); });
        document.body.appendChild(overlay);
        this._modalEl = overlay;
    },

    _setTarget(gi, name) {
        if (!this._editing[gi]) return;
        this._editing[gi].target = name;
        // 타깃이 소스에 있으면 제거
        this._editing[gi].sources = this._editing[gi].sources.filter(s => s !== name);
        this._renderModal();
    },

    _toggleSource(gi, name, checked) {
        if (!this._editing[gi]) return;
        const src = this._editing[gi].sources;
        const idx = src.indexOf(name);
        if (checked && idx < 0) src.push(name);
        if (!checked && idx >= 0) src.splice(idx, 1);
        this._renderModal();
    },

    _addGroup() {
        this._editing.push({ target: null, sources: [] });
        this._renderModal();
    },

    _removeGroup(gi) {
        this._editing.splice(gi, 1);
        if (this._editing.length === 0) this._editing.push({ target: null, sources: [] });
        this._renderModal();
    },

    _apply() {
        // 빈 그룹 제거 (타깃 또는 소스 없는 그룹은 무효)
        const valid = this._editing.filter(g => g.target && g.sources.length > 0);

        // 검증
        for (const g of valid) {
            const v = this.validateGroup(g);
            if (!v.ok) {
                if (typeof Toast !== 'undefined') Toast.error(`그룹 검증 실패: ${v.reason}`);
                else alert(`그룹 검증 실패: ${v.reason}`);
                return;
            }
        }

        // 충돌 감지 (적용 전 1회 얼럿)
        const allConflicts = [];
        valid.forEach(g => {
            const conflicts = this.detectConflicts(g);
            if (conflicts.length > 0) {
                allConflicts.push({ group: g, conflicts });
            }
        });

        if (allConflicts.length > 0) {
            const lines = [];
            lines.push('아래 학생(이미지)이 그룹 내 2개 이상 영역에 마킹했습니다.');
            lines.push('합치기 진행 시 타깃 과목의 답이 사용되고 소스 과목의 답은 무시됩니다.');
            lines.push('');
            allConflicts.forEach(({ group, conflicts }) => {
                lines.push(`[${group.sources.join(', ')} → ${group.target}] ${conflicts.length}건`);
                conflicts.slice(0, 10).forEach(c => lines.push(`  · ${c.imgName} (${c.marked.join(', ')})`));
                if (conflicts.length > 10) lines.push(`  · ... 외 ${conflicts.length - 10}건`);
            });
            lines.push('');
            lines.push('계속 진행하시겠습니까?');
            if (!confirm(lines.join('\n'))) return;
        }

        App.state.subjectMerges = valid;
        if (typeof Scoring !== 'undefined' && Scoring.invalidate) Scoring.invalidate();
        if (typeof SessionManager !== 'undefined' && SessionManager.markDirty) SessionManager.markDirty();
        if (typeof Toast !== 'undefined') Toast.success(`과목 합치기 ${valid.length}개 그룹 적용됨`);

        this._closeModal();

        // 채점 결과 / 우측 패널 갱신
        if (typeof Scoring !== 'undefined' && Scoring.renderScoringPanel) {
            const sc = document.getElementById('scoring-content');
            if (sc) Scoring.renderScoringPanel(sc);
        }
        if (typeof UI !== 'undefined' && UI.updateRightPanel) UI.updateRightPanel();
    },

    _esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
};
