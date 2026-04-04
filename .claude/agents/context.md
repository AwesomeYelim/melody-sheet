# 공통 프로젝트 컨텍스트

> 모든 에이전트(시행자/수행자/검사자)가 참조하는 공유 컨텍스트.

## 프로젝트 구조

### 백엔드 (Python 3.11 / FastAPI)
- main.py — FastAPI 서버, 3개 엔드포인트
  - POST /api/audio-to-sheet — 오디오→악보 (notes, chords, lyrics, detected_key, midi_file, bpm)
  - POST /api/transpose — MIDI 키 변환
  - GET  /api/download/{filename} — MIDI 파일 다운로드
- core/audio_to_midi.py (~780줄) — CREPE+pYIN 하이브리드 피치 추출 파이프라인
  - convert_audio_to_midi() → (midi_path, start_offset, bpm) — 메인 12단계 파이프라인
  - fill_gaps_with_whisper() → (midi_path, added_count) — Whisper 갭 보정
  - _run_crepe(), _segment_notes(), _find_voiced_groups(), _group_to_notes(), _emit_note()
  - _remove_octave_duplicates(), _merge_same_pitch(), _absorb_short_notes(bpm 적응형)
  - _detect_key(), _snap_to_key()
- core/midi_to_sheet.py (~130줄) — MIDI→JSON 음표 변환
  - midi_to_note_list() — MIDI→{pitch, duration, start_time} 리스트
  - _resolve_duration() — music21 complex/dotted duration 해결
  - _to_flat_name() — 이명동음 변환
- core/chord_detector.py (254줄) — 코드 감지 (반마디 단위)
  - detect_chords(audio, sr, notes, beats_per_measure, forced_key) — 반마디별 코드 (마디당 최대 2코드)
  - _best_chord(note_list, is_first_in_measure) — 내부 함수, 음표 리스트→최적 코드
  - _key_from_notes() — Krumhansl-Schmuckler 조성 추정
  - _build_diatonic() — 7개 다이아토닉 코드 생성
- core/lyrics.py (~157줄) — Whisper 가사 추출
  - transcribe_lyrics() — 음절 단위 추출 [{char, start, end}]
  - _is_rest() — rest 음표 판별 헬퍼
  - align_lyrics_to_notes() — 음절→음표 매핑 (rest 인덱스 보존)
- core/transposer.py (~187줄) — 키 변환 (장조+단조 지원, 손상 MIDI 에러핸들링)
  - transpose_midi() — music21 기반 변조
  - _normalize_key_name() — 키 이름 정규화
  - _music21_key_to_name() — music21 Key 객체→문자열
- test.py — 테스트 WAV 생성 + API 호출

### 프론트엔드 (React Native / Expo Web)
- app/screens/AudioToSheetScreen.js (675줄) — 녹음/업로드/피치감지
- app/components/SheetMusic.web.js (~660줄) — VexFlow 악보 렌더링+재생 (BPM props 지원, 점음표 지원)
- app/components/SheetMusic.js — 네이티브 SheetMusic (5줄, web.js로 위임)
- app/components/NoteList.js — 음표 리스트 표시
- app/screens/TransposeScreen.js — 키 변조 화면
- app/config.js — API_URL 설정

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

## 핵심 제약 (절대 위반 금지)
1. audio_to_midi.py 12단계 파이프라인 순서 변경 금지
2. API 응답 형식: {notes, chords, lyrics, detected_key, midi_file, bpm}
3. 음표 JSON 형식: {pitch: "C4", duration: "quarter", start_time: 0.0}
4. 코드 JSON 형식: {chord: "Am", start_time: 0.0, end_time: 2.0}
5. VexFlow EasyScore 포맷: "C#4/q", "B4/wr" (rest), 점음표 "C4/qd"
6. MIDI 음역대 상수: MIDI_MIN=36(C2), MIDI_MAX=96(C7)
7. 한국어 UI 텍스트 유지
8. 기존 공개 함수의 시그니처 변경 금지 (새 파라미터는 기본값 필수)

## 알려진 버그 카탈로그

### CRITICAL (crash 또는 기능 완전 실패)
- [BUG-001] audio_to_midi.py — 빈 음표 시 반환값 불일치 (**해결됨**)
- [BUG-006] transposer.py — 단조 키 미지원 (**해결됨**)

### MAJOR (정확도에 직접 영향)
- [BUG-002] audio_to_midi.py:322-342 — _remove_octave_duplicates O(n²) + median 기반이라 넓은 음역 실제 음표 삭제
- [BUG-003] lyrics.py:100-107 — rest 포함 인덱스 불일치로 가사 어긋남 (**해결됨** — _is_rest 헬퍼 + 선할당 리팩토링)
- [BUG-004] chord_detector.py — 다이아토닉 7개 트라이어드만, 7th/sus/세컨더리 없음
- [BUG-009] midi_to_sheet.py — 점음표 리듬 손실 (**해결됨**)
- [BUG-011] audio_to_midi.py — MIN_NOTE_DURATION 고정 (**해결됨** — BPM 적응형)
- [BUG-012] audio_to_midi.py — Whisper 갭 pYIN 임계값 (**해결됨** — 0.3으로 상향)
- [BUG-013] audio_to_midi.py — HYSTERESIS 비브라토 (**해결됨** — 1.2로 상향)
- [BUG-014] audio_to_midi.py — RMS 필터 (**해결됨** — p10으로 완화)
- [BUG-015] SheetMusic.web.js — BEATS_PER_MEASURE=4 하드코딩 → 3/4, 6/8 마디 틀림
- [BUG-016] SheetMusic.web.js — BPM 하드코딩 (**해결됨** — 백엔드 BPM 전달)
- [BUG-017] SheetMusic.web.js:366 — lyricMap rest 인덱싱 → 마디 내 가사 어긋남 (**해결됨** — _originalIdx 기반 패딩 rest 분리)
- [BUG-018] transposer.py — 키 분석 장/단 미구분 → 변조 반음 수 틀림 (**해결됨** — _music21_key_to_name)
- [BUG-019] chord_detector.py:129 — 마디당 1코드 → 코드 변경 누락 (**해결됨** — 반마디 단위 감지, 마디당 최대 2코드)

### MINOR (품질/UX)
- [BUG-005] midi_to_sheet.py:19 — _to_flat_name 이중샵/옥타브>9 미처리
- [BUG-007] main.py — 성공 시 업로드 파일 미삭제
- [BUG-008] lyrics.py:12-23 — Whisper 전역 싱글턴 스레드 안전성
- [BUG-010] SheetMusic.web.js:293 — useEffect 의존성 누락
- [BUG-020] audio_to_midi.py:440 — snap_to_key 양방향 모호 시 무조건 아래로 스냅
- [BUG-021] audio_to_midi.py:210 — 숨쉬기 갭 200ms까지 브릿지 → 프레이즈 구분 소실
- [BUG-022] transposer.py — _to_flat_name 미적용 → "D#4" vs "Eb4" 표기 불일치 (**해결됨**)
- [BUG-023] transposer.py — 손상 MIDI 에러핸들링 없음 (**해결됨**)
- [BUG-024] 포르타멘토(음 슬라이드) 미처리 → 보컬 런이 평균 피치 1개로

## 피치 추출 파라미터 맵 (정확도 튜닝용)
```
상수                    현재값    상태
HYSTERESIS              1.2       해결됨 (BUG-013)
MIN_NOTE_DURATION       0.12s     해결됨 (BUG-011, BPM 적응형)
RMS_THRESHOLD_PERCENTILE 10       해결됨 (BUG-014)
WHISPER_GAP_PYIN_THRESHOLD 0.3    해결됨 (BUG-012)
MERGE_GAP               0.08s     BPM 적응형 필요
MAX_GAP                 20프레임   RMS 기반 판단 필요
pYIN(CREPE보완)         0.15      상향 검토 필요 (0.25~0.35)
```

## 파일별 수정 시 주의사항

### core/audio_to_midi.py
- 파이프라인 단계 번호(1~12)가 주석으로 표시됨 — 순서 보존 필수
- numpy 배열 연산 선호 (파이썬 for 루프 지양)
- pretty_midi.Note(velocity, pitch, start, end) — end는 start+duration
- _run_crepe()는 CREPE(GPU) + pYIN(CPU) 하이브리드 → device 분기 주의
- librosa 함수는 sr 파라미터 필수
- 상수는 파일 상단에 대문자로 정의됨

### core/chord_detector.py
- _NOTE_NAMES 배열 인덱스 = pitch class (C=0, C#=1, ..., B=11)
- _build_diatonic() 반환값: [{"name": "Am", "tones": {0,3,7}, "weight": 1.1}]
- detect_chords()는 audio/sr을 받지만 사용 안 함 (음표 기반 처리)
- 반마디(half-measure) 단위로 분할 후 코드 감지 → 같으면 1개로 병합, 다르면 2개 반환
- _best_chord() 내부 함수: 강박 가중치(첫 음표 2x), 빈 음표 → None 반환

### core/midi_to_sheet.py
- music21 파싱 후 .flat.notesAndRests 순회
- Chord 객체는 최고음만 추출 (멜로디 가정)
- use_flats 플래그: 조표에 b가 있으면 True → D#→Eb 변환
- 점음표: duration.dots >= 1 → "dotted {type}" 형태

### core/lyrics.py
- Whisper word_timestamps → 한국어 글자 단위 분할 (균등 배분)
- audio_offset: audio_to_midi에서 제거된 시작 오프셋 — MIDI 시간 + offset = 오디오 시간
- _is_rest(note): pitch가 "rest"/None/"" → True. rest 판별 시 반드시 이 헬퍼 사용
- align_lyrics_to_notes(): 반환값은 notes와 1:1 대응 리스트 (rest → "")

### main.py
- FastAPI async def — 파일 I/O는 동기
- 에러 시 한국어 HTTPException detail 필수
- 파일명 안전: ASCII safe_name 패턴 사용

### app/components/SheetMusic.web.js
- VexFlow 5 EasyScore API 사용
- DUR_MAP: {whole:"w", half:"h", quarter:"q", eighth:"8", "16th":"16", "32nd":"32", "dotted whole":"wd", ...}
- makeDurSec(bpm) 팩토리 함수로 BPM 기반 재생 시간 계산
- 패딩 rest: 마디 미달 시 finalizeMeasureObj에서 자동 추가 (_originalIdx: -1)
- _originalIdx: 실제 음표는 0,1,2,..., 패딩 rest는 -1. lyricMap/tickableMap이 이를 기준으로 분리
