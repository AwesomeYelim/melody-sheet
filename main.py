from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import shutil
import time

from core.audio_to_midi import convert_audio_to_midi, _load_audio, fill_gaps_with_whisper
from core.midi_to_sheet import midi_to_note_list
from core.transposer import transpose_midi
from core.chord_detector import detect_chords
from core.lyrics import transcribe_lyrics, align_lyrics_to_notes

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def read_root():
    return {"message": "Melody Sheet API is running."}


# --------------------------------------------------
# 기능 1: 오디오 → 악보 (음표 JSON 반환)
# --------------------------------------------------
@app.post("/api/audio-to-sheet")
async def audio_to_sheet(file: UploadFile = File(...), key: str = Form(None)):
    """
    오디오 파일(MP3/WAV)을 업로드하면 음표 리스트를 반환합니다.

    반환 예시:
    {
        "notes": [
            {"pitch": "C4", "duration": "quarter", "start_time": 0.0},
            ...
        ]
    }
    """
    # 1. 파일 저장 (한글 파일명 ffmpeg 오류 방지 → ASCII 이름 사용)
    ext = os.path.splitext(file.filename)[1] or ".m4a"
    safe_name = f"upload_{int(time.time() * 1000)}{ext}"
    upload_path = os.path.join(UPLOAD_DIR, safe_name)
    with open(upload_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # 2. MIDI 변환 + 코드 감지 병렬 실행
    try:
        midi_path, audio_offset, estimated_bpm = convert_audio_to_midi(upload_path)
    except Exception as e:
        os.remove(upload_path)
        raise HTTPException(status_code=500, detail=f"오디오→MIDI 변환 실패: {e}")

    # 3. MIDI → 음표 리스트
    try:
        notes = midi_to_note_list(midi_path)
    except Exception as e:
        os.remove(upload_path)
        raise HTTPException(status_code=500, detail=f"MIDI 분석 실패: {e}")

    # 4. 코드 감지 (조성 감지 + 다이아토닉 화성 분석)
    detected_key = None
    try:
        audio, sr = _load_audio(upload_path, target_sr=22050)
        chords, detected_key = detect_chords(audio, sr, notes, forced_key=key)
    except Exception:
        chords = []

    # 5. 가사 추출 (Whisper) + Whisper 보정 + 음표 매핑
    lyrics = []
    try:
        words = transcribe_lyrics(upload_path)
        if words:
            # Whisper 가사 타이밍으로 누락 구간 보정
            midi_path, n_added = fill_gaps_with_whisper(
                upload_path, midi_path, words, audio_offset
            )
            if n_added > 0:
                # MIDI가 업데이트되었으므로 음표 리스트 재생성
                notes = midi_to_note_list(midi_path)
                print(f"[AMT] Whisper 보정 후 음표: {len(notes)}개")

            lyrics = align_lyrics_to_notes(words, notes, midi_path, audio_offset=audio_offset)
            print(f"[AMT] 가사 매핑: {sum(1 for l in lyrics if l)}개 음표에 가사 할당")
    except Exception as e:
        print(f"[AMT] 가사 추출 실패: {e}")

    return {
        "notes": notes,
        "chords": chords,
        "lyrics": lyrics,
        "detected_key": detected_key,
        "midi_file": os.path.basename(midi_path),
        "bpm": round(estimated_bpm, 1),
    }


# --------------------------------------------------
# 기능 2: MIDI → 키 변조
# --------------------------------------------------
@app.post("/api/transpose")
async def transpose(
    file: UploadFile = File(...),
    target_key: str = Form(...),
):
    """
    MIDI 파일을 업로드하고 target_key를 지정하면 변조된 음표 리스트를 반환합니다.

    target_key 예시: "G", "Bb", "F#"
    """
    # 1. 파일 저장 (한글 파일명 ffmpeg 오류 방지 → ASCII 이름 사용)
    ext = os.path.splitext(file.filename)[1] or ".mid"
    safe_name = f"upload_{int(time.time() * 1000)}{ext}"
    upload_path = os.path.join(UPLOAD_DIR, safe_name)
    with open(upload_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # 2. 변조
    result = transpose_midi(upload_path, target_key)

    # 3. 업로드 파일 보존 (정확도 검사용)

    return {
        "original_key": result["original_key"],
        "target_key": result["target_key"],
        "semitones": result["semitones"],
        "notes": result["notes"],
        "midi_file": os.path.basename(result["midi_path"]),
    }


# --------------------------------------------------
# MIDI 파일 다운로드
# --------------------------------------------------
@app.get("/api/download/{filename}")
def download_file(filename: str):
    """변환된 MIDI 파일을 다운로드합니다."""
    file_path = os.path.join("output", filename)
    if not os.path.exists(file_path):
        return {"error": "파일을 찾을 수 없습니다."}
    return FileResponse(file_path, media_type="audio/midi", filename=filename)


# ── VexFlow bravura 직접 서빙 (번들링 우회, 폰트 포함 버전) ─
VEXFLOW_PATH = os.path.join(
    os.path.dirname(__file__), "app", "node_modules",
    "vexflow", "build", "cjs", "vexflow-bravura.js"
)

@app.get("/vexflow-bravura.js")
def serve_vexflow():
    return FileResponse(VEXFLOW_PATH, media_type="application/javascript")

@app.get("/vf-test.html")
def serve_vf_test():
    p = os.path.join(os.path.dirname(__file__), "app", "dist", "vf-test.html")
    return FileResponse(p, media_type="text/html")


# ── 앱 정적 파일 서빙 (빌드된 Expo 웹앱) ─────────────────
WEB_DIST = os.path.join(os.path.dirname(__file__), "app", "dist")
if os.path.isdir(WEB_DIST):
    # JS/CSS 번들 등 정적 자산 마운트
    _expo_dir = os.path.join(WEB_DIST, "_expo")
    if os.path.isdir(_expo_dir):
        app.mount("/_expo", StaticFiles(directory=_expo_dir), name="expo-assets")

    # 그 외 모든 GET 요청 → index.html (SPA 폴백)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        index = os.path.join(WEB_DIST, "index.html")
        return FileResponse(index)

# 실행 방법:
# cd C:\Users\User\Desktop\yelim\melody-sheet
# uvicorn main:app --host 0.0.0.0 --port 8000
