from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import shutil
import time

from core.audio_to_midi import convert_audio_to_midi
from core.midi_to_sheet import midi_to_note_list
from core.transposer import transpose_midi

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
async def audio_to_sheet(file: UploadFile = File(...)):
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

    # 2. Basic Pitch로 MIDI 변환
    midi_path = convert_audio_to_midi(upload_path)

    # 3. MIDI → 음표 리스트
    notes = midi_to_note_list(midi_path)

    # 4. 업로드 파일 정리
    os.remove(upload_path)

    return {"notes": notes, "midi_file": os.path.basename(midi_path)}


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

    # 3. 업로드 파일 정리
    os.remove(upload_path)

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
