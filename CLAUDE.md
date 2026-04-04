# melody-sheet 프로젝트

## 프로젝트 구조

### 백엔드 (Python 3.11 / FastAPI)
- `main.py` — FastAPI 서버 (엔드포인트: `/api/audio-to-sheet`, `/api/transpose`, `/api/download/{filename}`, `/health`)
- `core/audio_to_midi.py` — CREPE+pYIN 하이브리드 피치 추출 파이프라인 (763줄, 가장 복잡)
  - 12단계 파이프라인: WAV변환 → CREPE피치 → 옥타브필터 → 동일음병합 → 짧은음흡수 → 조성감지 → 조성보정 → 재병합 → 템포양자화 → 겹침해소 → 음역대정제 → MIDI생성
- `core/midi_to_sheet.py` — MIDI→JSON 음표 변환 (music21 기반, 120줄)
- `core/chord_detector.py` — Krumhansl-Schmuckler 키 감지 + 다이아토닉 코드 배정 (182줄)
- `core/lyrics.py` — Whisper 한국어 가사 추출 + 음표 정렬 (140줄)
- `core/transposer.py` — 키 변환 + 손상 MIDI 에러핸들링 (187줄)
- `test.py` — 테스트용 WAV 생성 + API 호출 테스트

### 프론트엔드 (React Native / Expo Web)
- `app/screens/AudioToSheetScreen.js` — 녹음/업로드/실시간 피치감지 (675줄)
- `app/components/SheetMusic.web.js` — VexFlow 5 EasyScore 악보 렌더링+재생+다운로드 (640줄)
- `app/components/SheetMusic.js` — 네이티브 SheetMusic (web.js로 위임)
- `app/components/NoteList.js` — 음표 리스트 표시
- `app/screens/TransposeScreen.js` — 키 변조 화면
- `app/config.js` — API_URL 설정

### 모듈 의존성 그래프
```
main.py
  ├→ core/audio_to_midi.py   (convert_audio_to_midi, _load_audio, fill_gaps_with_whisper)
  ├→ core/midi_to_sheet.py   (midi_to_note_list)
  ├→ core/chord_detector.py  (detect_chords)
  ├→ core/lyrics.py          (transcribe_lyrics, align_lyrics_to_notes)
  └→ core/transposer.py      (transpose_midi)
       └→ core/midi_to_sheet.py (_resolve_duration, _to_flat_name)
core/lyrics.py
  └→ core/audio_to_midi.py   (_ensure_wav)
```

### 빌드/실행
- `Makefile` — `make run` (빌드+서버), `make build` (Expo 웹 빌드), `make serve` (서버만)
- `requirements.txt` — Python 의존성 (numpy, torch, torchcrepe, librosa, pretty_midi, music21, whisper, noisereduce 등)
- `.venv/` — Python 가상환경

## 핵심 제약 조건 (절대 위반 금지)
1. `audio_to_midi.py` 12단계 파이프라인 순서 변경 금지
2. API 응답 형식: `{notes, chords, lyrics, detected_key, midi_file, bpm}`
3. 음표 형식: `{pitch: "C4", duration: "quarter", start_time: 0.0}`
4. 코드 형식: `{chord: "Am", start_time: 0.0, end_time: 2.0}`
5. VexFlow EasyScore 포맷: `"C#4/q"`, `"B4/wr"` (rest)
6. MIDI 음역대 상수: MIDI_MIN=36(C2), MIDI_MAX=96(C7)
7. 한국어 UI 텍스트 유지
8. 기존 공개 함수의 시그니처 변경 금지 (새 파라미터는 기본값 필수)

## 코딩 컨벤션
- Python: 타입힌트 필수, bare except 금지, 함수 50줄 이내 권장
- docstring: 공개 함수에 필수 (한 줄 또는 구글 스타일)
- 한국어 주석 유지, `[모듈명]` 로그 접두사 (예: `[AMT]`, `[Lyrics]`)
- 에러핸들링: HTTPException으로 한국어 에러 메시지 전달
- numpy 배열 연산 선호, 매직넘버 → 상수 추출

---

## 알려진 버그 카탈로그 (24건)

### CRITICAL (crash)
- **BUG-001**: `audio_to_midi.py:497` — 빈 음표 시 반환값 1개 vs 2개 → TypeError (**해결됨**)
- **BUG-006**: `transposer.py:32` — 단조 키("Am" 등) 미지원 → ValueError crash (**해결됨**)

### MAJOR (정확도 직결)
- **BUG-002**: `audio_to_midi.py:322` — 옥타브 중복 제거 O(n²) + median 기반으로 실제 음표 삭제
- **BUG-003**: `lyrics.py:100` — rest 포함 인덱스 불일치 → 가사 어긋남
- **BUG-004**: `chord_detector.py` — 다이아토닉 7개만, 7th/sus/세컨더리 없음
- **BUG-009**: `midi_to_sheet.py:31` — 점음표 리듬 손실 (dotted half→half 등) (**해결됨**)
- **BUG-011**: `audio_to_midi.py:292` — MIN_NOTE_DURATION=120ms 고정 → 빠른 곡 32분음표 소멸 (**해결됨**)
- **BUG-012**: `audio_to_midi.py:721` — Whisper 갭 pYIN 임계값 0.05 → 숨소리가 음표로 (**해결됨**)
- **BUG-013**: `audio_to_midi.py:259` — HYSTERESIS=0.6 → 비브라토에서 음표 쪼개짐 (**해결됨**)
- **BUG-014**: `audio_to_midi.py:468` — RMS 필터 p25 → 여린 구간 전체 삭제 (**해결됨**)
- **BUG-015**: `SheetMusic.web.js:12` — 4/4 하드코딩 → 3/4, 6/8 마디 틀림
- **BUG-016**: `SheetMusic.web.js:23` — BPM 하드코딩 → 재생 속도 불일치 (**해결됨**)
- **BUG-017**: `SheetMusic.web.js:366` — lyricMap rest 인덱싱 → 악보 가사 어긋남
- **BUG-018**: `transposer.py:38` — 키 분석 장/단 미구분 → 변조 반음 수 틀림
- **BUG-019**: `chord_detector.py:129` — 마디당 1코드 → 코드 변경 누락

### MINOR (품질/UX)
- **BUG-005**: `midi_to_sheet.py:19` — _to_flat_name 이중샵/옥타브>9 미처리
- **BUG-007**: `main.py` — 성공 시 업로드 파일 미삭제
- **BUG-008**: `lyrics.py:12` — Whisper 싱글턴 스레드 안전성
- **BUG-010**: `SheetMusic.web.js:293` — useEffect 의존성 누락
- **BUG-020**: `audio_to_midi.py:440` — snap_to_key 양방향 모호 시 무조건 아래로
- **BUG-021**: `audio_to_midi.py:210` — 숨쉬기 갭 200ms 브릿지 → 프레이즈 소실
- **BUG-022**: `transposer.py:58` — _to_flat_name 미적용 (D# vs Eb 불일치) (**해결됨**)
- **BUG-023**: `transposer.py:35` — 손상 MIDI 에러핸들링 없음 (**해결됨**)
- **BUG-024**: 포르타멘토 미처리 → 보컬 런이 평균 피치 1개로

## 개선 로드맵

### 멜로디 악보화
**P0**: ~~BUG-001 반환값 통일~~ (해결됨)
**P1**: ~~BUG-011 MIN_NOTE_DURATION 적응형~~ (해결됨), ~~BUG-012 pYIN 임계값~~ (해결됨), ~~BUG-013 HYSTERESIS~~ (해결됨), ~~BUG-014 RMS~~ (해결됨), ~~BUG-009 점음표~~ (해결됨), BUG-015 박자 전달, ~~BUG-016 BPM 전달~~ (해결됨)
**P2**: BUG-002 옥타브 중복, BUG-021 숨쉬기 갭, BUG-020 snap_to_key, BUG-024 포르타멘토

### 키 조정
**P0**: ~~BUG-006 단조 키 추가~~ (해결됨)
**P1**: BUG-018 장/단 구분, ~~BUG-023 에러핸들링~~ (해결됨), ~~BUG-022 표기 통일~~ (해결됨)
**P2**: 변조 후 음역대 확인+경고

---

## 3-Agent 워크플로우 (계획표 수신 시 필수 적용)

사용자가 개선 계획표나 작업 지시를 주면 반드시 아래 워크플로우를 따른다.
`.claude/agents/` 아래 역할별 md 파일로 관리, `prompts.py`가 조합.

### 에이전트 파일 구조
```
.claude/agents/
  ├── context.md          # 공통 프로젝트 컨텍스트 (버그 카탈로그, 제약조건, 파일별 주의사항)
  ├── planner.md          # 시행자 역할 정의
  ├── executor.md         # 수행자 역할 정의
  ├── executor-retry.md   # 수행자 재시도 역할 정의
  ├── reviewer.md         # 검사자 역할 정의 (문서 갱신 + git push 포함)
  └── prompts.py          # md 파일을 읽어 프롬프트 상수로 조합
```

### 프롬프트 상수 (prompts.py에서 export)
```python
PLANNER_PROMPT        # 시행자 — .format(plan=...)
EXECUTOR_PROMPT       # 수행자 — .format(task=...)
EXECUTOR_RETRY_PROMPT # 수행자 재시도 — .format(task=..., feedback=...)
REVIEWER_PROMPT       # 검사자 — .format(task=..., changes=...)
```

### 1단계: 시행자 (Plan Agent)
- `Task(subagent_type="Plan", prompt=PLANNER_PROMPT.format(plan=계획표))`
- 계획표를 분석하여 구체적 태스크 리스트로 분해
- 각 태스크: 대상 파일, 변경 내용, 성공 기준, 주의사항, 의존성, 예상 난이도
- 관련 알려진 버그(BUG-xxx)가 있으면 태스크에 포함

### 2단계: 태스크별 루프 (수행자 + 검사자)

#### 수행자 (Executor Agent)
- `Task(subagent_type="general-purpose", prompt=EXECUTOR_PROMPT.format(task=태스크))`
- 파일 읽기 → 연관 파일 확인 → 코드 수정 → 변경 확인
- 변경 보고: 파일:라인범위, 추가/수정 함수, 자체 확인

#### 검사자 (Reviewer Agent)
- `Task(subagent_type="general-purpose", prompt=REVIEWER_PROMPT.format(task=태스크, changes=수행자보고))`
- 8가지 체크리스트: 정확성, 통합성, 에러핸들링, 코드품질, 성능, 프로젝트특화, 테스트, **문서 업데이트**
- PASS/FAIL 판정 기준: CRITICAL 1개이상 OR MAJOR 2개이상 → FAIL
- **PASS 시 검사자가 직접**: 문서 갱신 → git commit → git push origin HEAD

### 루프 규칙
- FAIL → `EXECUTOR_RETRY_PROMPT.format(task=태스크, feedback=검사자피드백)` 으로 수행자 재호출
- 3회 FAIL → 이슈 기록 후 다음 태스크로 이동
- 모든 태스크 완료 → 최종 리포트

### 3단계: 최종 요약 리포트
```
## 최종 리포트
| 태스크 | 결과 | 시도 횟수 | 비고 |
|--------|------|-----------|------|
| 1. ... | PASS | 1 | ... |
| 2. ... | FAIL | 3 | 잔여 이슈: ... |

### 변경된 파일
- file1.py (함수A 추가, 함수B 수정)
- ...

### 잔여 이슈
- ...

### 후속 작업 제안
- ...
```
