# melody-sheet

멜로디를 들으면 악보를 만들어주고, 악보를 다양한 키로 변조해주는 앱 백엔드 API

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 | Python FastAPI |
| 오디오 분석 | CREPE (torchcrepe, PyTorch 기반 딥러닝 AMT) |
| 노이즈 제거 | noisereduce |
| 악보 처리 | music21, pretty_midi |
| 앱 | React Native (Expo) |

## AMT 파이프라인

```
오디오 입력
  ↓
① noisereduce    — 배경 노이즈 제거 (spectral gating)
  ↓
② CREPE          — 딥러닝 피치 추정 (viterbi 디코딩으로 불안정 피치 스무딩)
  ↓
③ librosa onset  — 음표 시작점 감지 (빠른 전환 처리)
  ↓
④ 음표 세그먼테이션 — 구간별 신뢰도 가중 중앙값으로 대표 음 추출
  ↓
⑤ 템포 감지 + 양자화 — 16분음표 그리드에 맞게 정량화
  ↓
⑥ pretty_midi    — MIDI 출력
```

## 프로젝트 구조

```
melody-sheet/
├── main.py                  # FastAPI 서버 진입점
├── requirements.txt         # 패키지 목록
├── test.py                  # API 테스트 스크립트
├── core/
│   ├── audio_to_midi.py     # 딥러닝 AMT: 오디오 → MIDI (CREPE + noisereduce)
│   ├── midi_to_sheet.py     # MIDI → 음표 JSON
│   └── transposer.py        # 키 변조
├── uploads/                 # 업로드 파일 임시 저장
└── output/                  # 변환된 MIDI 저장
```

## 설치 및 실행

```bash
python -m venv venv
venv\Scripts\activate

# PyTorch (CPU) 먼저 설치
pip install torch --index-url https://download.pytorch.org/whl/cpu

# 나머지 패키지
pip install -r requirements.txt

# 서버 실행
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API 엔드포인트

### GET /
서버 상태 확인

### POST /api/audio-to-sheet
오디오 파일(MP3/WAV)을 업로드하면 음표 리스트를 반환

**Request:** `multipart/form-data`
- `file`: MP3 또는 WAV 파일

**Response:**
```json
{
  "notes": [
    {"pitch": "C4", "duration": "quarter", "start_time": 0.0},
    {"pitch": "D4", "duration": "quarter", "start_time": 1.0}
  ],
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
    └── NoteList.js               # 음표 카드 리스트 컴포넌트
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
- [x] 오디오 → MIDI 변환 (Basic Pitch → **CREPE 딥러닝으로 업그레이드**)
- [x] 노이즈 제거 (noisereduce)
- [x] MIDI → 음표 JSON 변환
- [x] 키 변조 기능
- [x] React Native 앱 기본 구조
- [x] 오디오 파일 업로드 화면
- [x] 키 변조 화면
- [x] 앱에서 마이크 녹음
- [ ] 웹(PC) 파일 업로드 422 오류 수정 (모바일은 정상)
- [ ] 앱에서 악보 렌더링 (VexFlow)
