"""
U0 — 합성 정답셋 생성기

사인파로 '정답을 정확히 아는' 멜로디 WAV + ground-truth MIDI 쌍을 만든다.
사람 라벨링 없이 평가 하베스트를 부트스트랩하기 위한 도구.

생성물:
    eval/dataset/<name>.wav      — 입력 오디오 (파이프라인에 넣을 것)
    eval/dataset/<name>.gt.mid   — 정답 MIDI (mir_eval 비교 기준)

실행:
    venv\\Scripts\\python.exe eval\\gen_synthetic.py
"""
import os
import sys
import wave

import numpy as np
import pretty_midi

# Windows 콘솔(cp949)에서도 유니코드 출력이 깨지지 않도록
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SAMPLE_RATE = 44100
DEFAULT_DUR = 0.5      # 음표 1개 길이 (초)
GAP = 0.06            # 음표 사이 무음 (onset 분리용)
FADE = 0.006          # 클릭 방지용 페이드 인/아웃 (초)

DATASET_DIR = os.path.join(os.path.dirname(__file__), "dataset")


# ── 멜로디 정의 (MIDI 번호 시퀀스, 모두 0.5초) ──────────────
#   C4 = 60. 다양한 패턴으로 약점 노출:
#   - 순차진행 / 반복음 / 도약 / 더 긴 음가
SCALE = [60, 62, 64, 65, 67, 69, 71, 72]                       # C장조 음계
TWINKLE = [60, 60, 67, 67, 69, 69, 67,                          # 반짝반짝 작은별
           65, 65, 64, 64, 62, 62, 60]
ARPEGGIO = [60, 64, 67, 72, 67, 64, 60]                        # 도미솔도 상하행

MELODIES = {
    "c_major_scale": [(p, DEFAULT_DUR) for p in SCALE],
    "twinkle":       [(p, 0.4) for p in TWINKLE],
    "arpeggio":      [(p, 0.45) for p in ARPEGGIO],
}


def _tone(midi: int, dur: float) -> np.ndarray:
    """단일 음표 사인파 + 페이드(클릭 제거)를 생성한다."""
    freq = 440.0 * (2 ** ((midi - 69) / 12.0))
    n = int(SAMPLE_RATE * dur)
    t = np.linspace(0, dur, n, endpoint=False)
    sig = np.sin(2 * np.pi * freq * t)
    # 페이드 인/아웃
    f = int(SAMPLE_RATE * FADE)
    if f > 0 and n > 2 * f:
        env = np.ones(n)
        env[:f] = np.linspace(0, 1, f)
        env[-f:] = np.linspace(1, 0, f)
        sig *= env
    return sig


def generate(name: str, notes: list) -> None:
    """멜로디 1개를 WAV + GT MIDI로 저장한다.

    Args:
        name: 파일 베이스 이름
        notes: [(midi, dur_sec), ...]
    """
    os.makedirs(DATASET_DIR, exist_ok=True)
    gap_samples = int(SAMPLE_RATE * GAP)
    silence = np.zeros(gap_samples)

    audio_parts = []
    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(program=0)

    t = 0.0
    for midi, dur in notes:
        sounded = dur - GAP
        audio_parts.append(_tone(midi, sounded))
        audio_parts.append(silence)
        inst.notes.append(
            pretty_midi.Note(velocity=100, pitch=midi, start=t, end=t + sounded)
        )
        t += dur

    pm.instruments.append(inst)
    gt_path = os.path.join(DATASET_DIR, f"{name}.gt.mid")
    pm.write(gt_path)

    audio = np.concatenate(audio_parts)
    audio_i16 = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    wav_path = os.path.join(DATASET_DIR, f"{name}.wav")
    with wave.open(wav_path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_i16.tobytes())

    print(f"  ✓ {name}: {len(notes)}음 → {os.path.basename(wav_path)} + {os.path.basename(gt_path)}")


def main() -> None:
    print(f"합성 정답셋 생성 → {DATASET_DIR}")
    for name, notes in MELODIES.items():
        generate(name, notes)
    print("완료.")


if __name__ == "__main__":
    main()
