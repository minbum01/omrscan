# OMR 엔진 신규 로직 기획서

## 1. 기존 로직의 근본 문제

### BFS 기반 (현재)
```
픽셀 → BFS 블롭 탐지 → 크기 필터 → 행 그룹핑 → 점수 비교
```
- **인접 마킹 합침**: BFS가 위아래 마킹을 하나로 연결 → 블롭 소실
- **노이즈 블롭 혼입**: 인쇄 잔상, 문제번호 등이 블롭으로 잡혀 순서 밀림
- **필터 딜레마**: 엄격하면 마킹 블롭 탈락, 완화하면 노이즈 통과
- **스트립 분할도 한계**: 행 위치가 틀리면 스트립이 버블을 잘라냄

### 투영 기반 (시도 후 폐기)
```
픽셀 → 수평/수직 투영 → 피크 감지 → 교차점 샘플링
```
- 피크 감지가 테이블 선, 문제번호 등에 의해 오염
- ROI 내 비버블 요소(텍스트, 구분선)가 피크 왜곡

---

## 2. 신규 로직: 그리드 샘플링

### 핵심 발상
**블롭을 찾지 않는다.** 사용자가 이미 ROI와 문항수/지선다를 설정했으므로, 각 버블의 위치를 **계산**으로 알 수 있다. 해당 위치의 픽셀을 직접 읽어서 밝기를 비교한다.

### 알고리즘
```
입력: ROI(x,y,w,h), 문항수(numQ), 지선다(numC), 방향(orientation)

1. 셀 크기 계산
   - 세로: cellW = ROI.w / numC, cellH = ROI.h / numQ
   - 가로: cellW = ROI.w / numQ, cellH = ROI.h / numC

2. 각 셀 중심 좌표 계산
   - 세로: cx = col * cellW + cellW/2, cy = row * cellH + cellH/2
   - 가로: cx = col * cellW + cellW/2, cy = row * cellH + cellH/2

3. 셀별 밝기 샘플링 (셀 크기의 50~60% 영역)
   - meanBrightness: 평균 밝기
   - darkRatio: 어두운 픽셀 비율
   - centerFill: 중심부(내부 50%) 어두운 비율

4. 행(또는 열) 내 상대 비교
   - 행 평균 점수 계산
   - 평균보다 확실히 어두운 셀 = 마킹된 답
   - 2개 이상이면 중복 마킹
   - 차이 미미하면 미기입
```

### 기존 대비 장점

| 문제 | BFS | 그리드 샘플링 |
|------|-----|-------------|
| 인접 마킹 합침 | BFS가 연결 → 블롭 소실 | **발생 안 함** (셀별 독립 샘플링) |
| 노이즈 블롭 | 필터로 제거 시도 (불완전) | **발생 안 함** (블롭 탐지 안 함) |
| 블롭 수 불일치 | 행마다 다른 블롭 수 → 답 밀림 | **항상 정확** (설정된 numQ×numC 고정) |
| 성능 | BFS O(픽셀), 무거움 | **O(numQ×numC×샘플크기)**, 매우 빠름 |
| 코드 복잡도 | BFS+필터+그룹핑+보정 600줄 | **100줄 이내** |

### 전제 조건
- 사용자가 ROI를 **버블 영역에 맞춰** 그려야 함
- ROI 안에서 버블이 **균등 간격**이어야 함 (인쇄된 OMR 시트는 거의 항상 균등)
- numQ와 numC가 정확해야 함 (자동 감지로 보조)

### 전제 조건의 보완
- **ROI 미세 조정**: 캔버스에서 드래그로 위치/크기 조절 (이미 구현됨)
- **자동 감지**: 박스 치면 자동으로 numQ/numC 추정 (이미 구현됨)
- **서브픽셀 보정**: 각 셀의 기대 위치 주변에서 가장 어두운 점을 찾아 중심 미세 조정

---

## 3. 구현 계획

### Phase 1: 핵심 엔진 교체
- `analyzeROI`를 그리드 샘플링으로 완전 교체
- 전처리(preprocess)는 그대로 유지
- BFS 관련 코드 전부 제거 (findBlobs, filterBlobs 등)
- autoDetect는 기존 BFS 기반 유지 (초기 감지용으로만)

### Phase 2: 정밀도 향상
- 셀별 로컬 적응 임계값 (행 전체 평균 대신 셀 주변 밝기 기준)
- 서브픽셀 보정 (기대 위치 ±3px 범위에서 최적 중심 탐색)
- 중복 마킹 감지 (행 내 2개 이상 확실히 어두운 셀)

### Phase 3: 오버레이 연동
- 각 셀의 계산된 좌표로 오버레이 원 표시 (항상 정확한 위치)
- 수기 교정 시 해당 셀 위치 확대 팝업 (이미 구현됨)

---

## 4. 의사 코드

```javascript
analyzeROI(imageData, offsetX, offsetY, numQ, numC, orientation) {
    const gray = preprocess(imageData);
    const w = imageData.width, h = imageData.height;

    // 셀 크기
    const isVert = orientation === 'vertical';
    const cellW = isVert ? w / numC : w / numQ;
    const cellH = isVert ? h / numQ : h / numC;

    // 샘플 영역 (셀의 55%)
    const sampleW = cellW * 0.55;
    const sampleH = cellH * 0.55;

    const results = [];

    for (let q = 0; q < numQ; q++) {
        const cellScores = [];

        for (let c = 0; c < numC; c++) {
            // 셀 중심
            const cx = isVert ? c * cellW + cellW/2 : q * cellW + cellW/2;
            const cy = isVert ? q * cellH + cellH/2 : c * cellH + cellH/2;

            // 샘플링
            const { brightness, darkRatio, centerFill } = sampleCell(gray, w, h, cx, cy, sampleW, sampleH);
            const score = darkRatio * 300 + (255 - brightness) + centerFill * 800;

            cellScores.push({ col: c, score, brightness, darkRatio, centerFill, cx: cx + offsetX, cy: cy + offsetY });
        }

        // 행 내 상대 비교
        const avg = mean(cellScores.map(s => s.score));
        const best = max(cellScores);
        const diff = best.score - avg;

        if (diff > threshold) {
            markedAnswer = best.col + 1;
        } else {
            markedAnswer = null; // 미기입
        }

        results.push({ questionNumber: q+1, markedAnswer, cells: cellScores });
    }

    return results;
}
```

---

## 5. 리스크

| 리스크 | 대응 |
|--------|------|
| ROI가 버블 영역에 안 맞음 | 드래그로 조절 가능 + 자동 감지 보조 |
| 버블 간격이 불균등 | 인쇄 OMR은 균등. 불균등 시 서브픽셀 보정으로 대응 |
| 기존 기능 회귀 | BFS 엔진은 백업 유지, 필요시 복원 가능 |
