from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
import os
import shutil

from core.audio_to_midi import convert_audio_to_midi
from core.midi_to_sheet import midi_to_note_list
from core.transposer import transpose_midi

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI()


@app.get("/")
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
    # 1. 파일 저장
    upload_path = os.path.join(UPLOAD_DIR, file.filename)
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
    # 1. 파일 저장
    upload_path = os.path.join(UPLOAD_DIR, file.filename)
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


# 실행 방법:
# cd C:\Users\User\Desktop\yelim\melody-sheet
# uvicorn main:app --reload
