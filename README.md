# melody-sheet

멜로디를 들으면 악보를 만들어주고, 악보를 다양한 키로 변조해주는 앱 백엔드 API

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 | Python FastAPI |
| 오디오 분석 | Basic Pitch (Spotify) |
| 악보 처리 | music21 |
| 앱 (예정) | React Native |

## 프로젝트 구조

```
melody-sheet/
├── main.py                  # FastAPI 서버 진입점
├── requirements.txt         # 패키지 목록
├── test.py                  # API 테스트 스크립트
├── core/
│   ├── audio_to_midi.py     # Basic Pitch: 오디오 → MIDI
│   ├── midi_to_sheet.py     # MIDI → 음표 JSON
│   └── transposer.py        # 키 변조
├── uploads/                 # 업로드 파일 임시 저장
└── output/                  # 변환된 MIDI 저장
```

## 설치 및 실행

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
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
│   ├── AudioToSheetScreen.js     # 멜로디 → 악보 화면
│   └── TransposeScreen.js        # 키 변조 화면
└── components/
    └── NoteList.js               # 음표 카드 리스트 컴포넌트
```

앱 실행:
```bash
cd app
npx expo start
```

## 개발 현황

- [x] 백엔드 API 구축
- [x] 오디오 → MIDI 변환 (Basic Pitch)
- [x] MIDI → 음표 JSON 변환
- [x] 키 변조 기능
- [x] React Native 앱 기본 구조
- [x] 오디오 파일 업로드 화면
- [x] 키 변조 화면
- [ ] 앱에서 마이크 녹음
- [ ] 앱에서 악보 렌더링 (VexFlow)
