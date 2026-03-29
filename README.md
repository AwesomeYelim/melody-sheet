# melody-sheet

멜로디를 들으면 악보를 만들어주고, 악보를 다양한 키로 변조해주는 앱 백엔드 API

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 | Python FastAPI |
| 피치 추출 | CREPE full (torchcrepe) + pYIN (librosa) 하이브리드 |
| 가사 추출 | OpenAI Whisper (base, 한국어) |
| 악보 처리 | music21, pretty_midi |
| 악보 렌더링 | VexFlow 5 (Bravura SMuFL) |
| 앱 | React Native (Expo) |

## AMT 파이프라인

```
오디오 입력 (M4A/MP3/WAV)
  ↓
① WAV 변환         — imageio-ffmpeg으로 비-WAV 파일 변환
  ↓
② CREPE + pYIN     — CREPE full 딥러닝 피치 추출 (MPS/CUDA GPU 지원)
  하이브리드           pYIN 보조: CREPE 미감지 구간 피치 보완
  ↓
③ onset 감지       — librosa onset_detect로 새 발성 시작점 감지
  ↓
④ 히스테리시스      — 피치 변화 + onset 기반 이산 음표 세그멘테이션
  세그멘테이션         5프레임 이동중앙값으로 비브라토 흡수
  ↓
⑤ RMS 음량 필터    — 저음량 구간 음표 제거
  ↓
⑥ 옥타브 중복 제거 — 배음/하모닉스 필터링
  ↓
⑦ 동일음 병합      — 인접 동일 피치 병합 + 짧은음 흡수
                     (onset 분할 음표는 보존)
  ↓
⑧ 조성 감지 + 보정 — Krumhansl-Schmuckler 프로파일, ±1 반음 스냅
  ↓
⑨ 템포 감지 + 양자화 — 16분음표 그리드에 맞게 정량화
  ↓
⑩ pretty_midi      — MIDI 출력 (조성 정보 포함)
  ↓
⑪ Whisper 가사 추출 — 음절 단위 한국어 가사 + 음표 타임스탬프 매핑
```

## 프로젝트 구조

```
melody-sheet/
├── main.py                  # FastAPI 서버 진입점
├── requirements.txt         # 패키지 목록
├── test.py                  # API 테스트 스크립트
├── core/
│   ├── audio_to_midi.py     # CREPE+pYIN 하이브리드 AMT: 오디오 → MIDI
│   ├── midi_to_sheet.py     # MIDI → 음표 JSON (Chord 객체 지원)
│   ├── chord_detector.py    # 멜로디 기반 코드 감지
│   ├── lyrics.py            # Whisper 가사 추출 + 음표 매핑
│   └── transposer.py        # 키 변조
├── uploads/                 # 업로드 파일 임시 저장
└── output/                  # 변환된 MIDI 저장
```

## 설치 및 실행

```bash
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
# .venv\Scripts\activate   # Windows

# PyTorch 설치 (GPU 지원 포함)
# macOS (MPS):
pip install torch torchvision torchaudio
# CPU only:
# pip install torch --index-url https://download.pytorch.org/whl/cpu

# 나머지 패키지
pip install -r requirements.txt

# Whisper 설치 (가사 추출용)
pip install openai-whisper

# 서버 실행
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API 엔드포인트

### GET /health
서버 상태 확인

### POST /api/audio-to-sheet
오디오 파일(M4A/MP3/WAV)을 업로드하면 음표 + 코드 + 가사를 반환

**Request:** `multipart/form-data`
- `file`: 오디오 파일
- `key`: (선택) 조성 강제 지정 (예: `C`, `Am`)

**Response:**
```json
{
  "notes": [
    {"pitch": "C4", "duration": "quarter", "start_time": 0.0},
    {"pitch": "D4", "duration": "quarter", "start_time": 1.0}
  ],
  "chords": [
    {"chord": "C", "start_time": 0.0, "end_time": 4.0}
  ],
  "lyrics": ["하", "늘", "", "보", "다"],
  "detected_key": "C major",
  "midi_file": "song.mid"
}
```

### POST /api/transpose
MIDI 파일을 원하는 키로 변조

**Request:** `multipart/form-data`
- `file`: MIDI 파일
- `target_key`: 변조할 키 (예: `G`, `Bb`, `F#`)

**Response:**
```json
{
  "original_key": "C",
  "target_key": "G",
  "semitones": 7,
  "notes": [...],
  "midi_file": "song_G.mid"
}
```

### GET /api/download/{filename}
변환된 MIDI 파일 다운로드

## 지원하는 키

`C` `C#` `Db` `D` `D#` `Eb` `E` `F` `F#` `Gb` `G` `G#` `Ab` `A` `A#` `Bb` `B`

## 앱 프로젝트

`app/` 폴더에 React Native (Expo) 앱 존재

```
app/
├── App.js                        # 탭 네비게이션
├── config.js                     # API_URL 설정
├── screens/
│   ├── AudioToSheetScreen.js     # 멜로디 → 악보 화면 (마이크 녹음 + 파일 업로드)
│   └── TransposeScreen.js        # 키 변조 화면
└── components/
    └── SheetMusic.web.js         # VexFlow 악보 렌더링 + 재생 하이라이트 + 가사 표시
```

앱 실행:
```bash
cd app
npx expo install react-dom react-native-web  # 웹 테스트 시 최초 1회
npx expo start --web                          # PC 브라우저에서 테스트
npx expo start                                # 모바일 (Expo Go)
```

## 개발 현황

- [x] 백엔드 API 구축
- [x] 오디오 → MIDI 변환 (Basic Pitch → CREPE+pYIN 하이브리드로 교체)
- [x] CREPE full 모델 + MPS GPU 가속
- [x] pYIN 보조 피치 추출 (CREPE 미감지 구간 보완)
- [x] onset 감지로 동일 피치 내 새 음절 분리
- [x] 히스테리시스 기반 음표 세그멘테이션 (비브라토 흡수)
- [x] RMS 음량 기반 노이즈 필터링
- [x] 잡음 필터링 (옥타브 중복 제거 + 짧은음 흡수)
- [x] MIDI → 음표 JSON 변환
- [x] 키 변조 기능
- [x] 코드 감지 (Krumhansl-Schmuckler 조성 감지 + 다이아토닉 코드 배정)
- [x] Whisper 기반 한국어 가사 추출 (음절 단위)
- [x] 가사-음표 타임스탬프 정렬 (MIDI 오프셋 보정)
- [x] React Native 앱 기본 구조
- [x] 오디오 파일 업로드 화면
- [x] 키 변조 화면
- [x] 앱에서 마이크 녹음
- [x] 수동 키 선택 UI (21개 키 옵션)
- [x] 앱에서 악보 렌더링 (VexFlow) — 웹 전용, 모바일은 음표 카드 폴백
- [x] VexFlow 악보에 가사 렌더링 (Annotation BOTTOM)
- [x] VexFlow 악보에 코드 심볼 표시 (Annotation TOP)
- [x] 악보 재생 기능 (Web Audio API, triangle wave) + 재생 중 음표 하이라이트
- [x] 노래 제목 입력란 — 악보 상단 표시 + 파일명 사용
- [x] PNG 다운로드 (Bravura 폰트 embed → canvas 변환)
- [x] MIDI 다운로드
- [x] M4A 등 다양한 오디오 포맷 지원 (imageio-ffmpeg)
- [x] Oracle Cloud 서버 배포 (Ubuntu 24.04)
- [x] GitHub Actions 자동 배포

## 다음 할 일

- [ ] 도돌이표 (반복 구간) 자동 감지
- [ ] 피치 추출 정확도 추가 개선
- [ ] 모바일 앱 빌드 및 배포 (Expo EAS Build)
- [ ] 코드 감지 정확도 개선
