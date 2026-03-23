"""
테스트용 WAV 파일 생성 후 API 호출 테스트
"""
import numpy as np
import wave
import struct
import requests

# --------------------------------------------------
# 1. 테스트용 WAV 파일 생성 (도레미파솔)
# --------------------------------------------------
SAMPLE_RATE = 44100
DURATION = 0.5  # 음표 하나당 0.5초

# 도레미파솔 주파수 (Hz)
NOTES = [261.63, 293.66, 329.63, 349.23, 392.00]

def generate_tone(frequency, duration, sample_rate):
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    wave_data = (np.sin(2 * np.pi * frequency * t) * 32767).astype(np.int16)
    return wave_data

# 음표 이어붙이기
audio = np.concatenate([generate_tone(f, DURATION, SAMPLE_RATE) for f in NOTES])

# WAV 파일로 저장
wav_path = "test_melody.wav"
with wave.open(wav_path, "w") as wf:
    wf.setnchannels(1)       # 모노
    wf.setsampwidth(2)       # 16bit
    wf.setframerate(SAMPLE_RATE)
    wf.writeframes(audio.tobytes())

print(f"테스트 WAV 생성 완료: {wav_path}")

# --------------------------------------------------
# 2. API 테스트: /api/audio-to-sheet
# --------------------------------------------------
print("\n--- /api/audio-to-sheet 테스트 ---")
with open(wav_path, "rb") as f:
    response = requests.post(
        "http://localhost:8000/api/audio-to-sheet",
        files={"file": ("test_melody.wav", f, "audio/wav")},
    )

if response.status_code == 200:
    result = response.json()
    print(f"추출된 음표 수: {len(result['notes'])}")
    print("첫 10개 음표:")
    for note in result["notes"][:10]:
        print(f"  {note}")
    midi_file = result.get("midi_file")
else:
    print(f"에러: {response.status_code} - {response.text}")
    exit()

# --------------------------------------------------
# 3. API 테스트: /api/transpose (G장조로 변조)
# --------------------------------------------------
print("\n--- /api/transpose 테스트 (→ G장조) ---")
midi_path = f"output/{midi_file}"
with open(midi_path, "rb") as f:
    response = requests.post(
        "http://localhost:8000/api/transpose",
        files={"file": (midi_file, f, "audio/midi")},
        data={"target_key": "G"},
    )

if response.status_code == 200:
    result = response.json()
    print(f"원본 키: {result['original_key']}")
    print(f"변조 키: {result['target_key']} ({result['semitones']:+d} 반음)")
    print(f"첫 10개 음표:")
    for note in result["notes"][:10]:
        print(f"  {note}")
else:
    print(f"에러: {response.status_code} - {response.text}")
