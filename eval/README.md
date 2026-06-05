# eval/ — 전사 정확도 평가 하베스트 (U0)

> **왜 있나:** 파이프라인을 바꿨을 때 *정말 좋아졌는지*를 숫자로 재기 위함.
> 이게 없으면 모든 "고도화"는 추측이다. 여기가 모든 개선의 기준점(ruler).

## 빠른 시작

```bash
# 1) 합성 정답셋 생성 (사람 라벨링 불필요, 정답을 정확히 아는 사인파 멜로디)
venv\Scripts\python.exe eval\gen_synthetic.py

# 2) 평가 실행 (각 오디오를 파이프라인에 태우고 정답과 비교)
venv\Scripts\python.exe eval\evaluate.py
```

(mac/zsh 환경에선 `make eval`)

## 지표

`mir_eval.transcription` note-level precision/recall/F-measure:

| 지표 | 의미 |
|------|------|
| **F_on** | onset(±50ms) + pitch(±50 cents) 일치. **offset 무시** → 멜로디 전사의 핵심 지표 |
| **F_full** | onset + offset + pitch 모두 일치. 음가(길이)까지 보는 더 엄격한 지표 |

→ 개선 작업의 1차 목표는 **F_on 끌어올리기**.

## 데이터셋 구조

```
eval/dataset/
  <name>.wav      ← 입력 오디오
  <name>.gt.mid   ← 정답 MIDI (mir_eval 비교 기준)
```

`evaluate.py`는 `*.gt.mid`마다 같은 이름의 `.wav/.m4a/.mp3`를 찾아 쌍으로 평가한다.

### 정답셋 두 종류

1. **합성 (synthetic)** — `gen_synthetic.py`가 생성. 정답이 수학적으로 정확.
   파이프라인의 *기본 동작*(음정/온셋/병합)을 빠르게 회귀 측정하는 용도.
2. **실제 녹음 (real)** — 사람이 부른 멜로디. 아래 절차로 추가.

### 실제 녹음 정답 추가하기

1. 멜로디를 녹음해 `eval/dataset/<name>.wav` 로 저장.
2. 파이프라인을 한 번 돌려 나온 MIDI를 받는다 (`output/<...>.mid`).
3. 그 MIDI를 MuseScore 등으로 열어 **틀린 음만 손으로 교정** → `eval/dataset/<name>.gt.mid` 로 저장.
4. `evaluate.py` 재실행.

> 합성셋만으로도 회귀는 잡히지만, 실제 보컬(비브라토·포르타멘토·잡음)의 약점은 real 셋이 있어야 드러난다.

## 결과

- `eval/results/<timestamp>.json` — 실행 스냅샷 (per-file + mean)
- `eval/results/latest.json` — 가장 최근 실행

## 개선 루프 (이후 모든 유닛의 작업 방식)

```
baseline F_on 기록 → 파이프라인 1곳 수정 → evaluate.py → F_on 비교
   ├─ 올랐다 → 채택 (commit)
   └─ 내렸다 → 폐기
```

한 유닛 = 한 PR = **측정된 개선 한 칸**. 추측 금지.

## 측정 로그 (합성셋 3곡)

| 유닛 | 변경 | mean F_on | mean F_full | 비고 |
|------|------|:---------:|:-----------:|------|
| **U0** | 평가 하베스트 구축 (baseline) | 0.117 | 0.042 | ruler 가동 |
| **U1** | Basic Pitch 출력 onset 오름차순 정렬 (`_run_basic_pitch`) | **0.804** | **0.456** | +0.687 |

### U0가 노출한 버그 (U1으로 수정)
Basic Pitch는 `note_events`를 **onset 내림차순**(마지막 음표부터)으로 반환한다.
파이프라인은 이를 정렬하지 않아, 9단계 "시작 오프셋 제거"가 `notes[0].start`
(= 사실상 마지막 음표의 onset)를 전체에서 빼버려 **모든 음표 onset이 0으로 붕괴**했다.
동일음 병합·짧은음 흡수 단계도 시간순 정렬을 전제하므로 함께 오작동.
→ `_run_basic_pitch`에서 onset 오름차순 정렬 한 줄로 세 단계 동시 해결.

### 남은 약점 (다음 유닛 후보)
- **twinkle 0.643**: 반복음(도도/솔솔) 처리 — back-to-back onset 분할/병합 경계.
- **arpeggio est=6 vs ref=7**: 도약 음표 1개 누락 (옥타브/IQR 필터 또는 병합).
- **F_full 낮음(0.456)**: 순음 클립에서 `librosa.beat.beat_track`이 degenerate →
  bpm이 60으로 clamp → 양자화 그리드 붕괴(음가 전부 0.25s). 템포 추정/합성셋 개선 과제.
