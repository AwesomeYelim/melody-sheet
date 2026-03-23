import os
import music21

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 키 이름 → 반음 수 변환 테이블
KEY_SEMITONES = {
    "C":  0,  "C#": 1,  "Db": 1,
    "D":  2,  "D#": 3,  "Eb": 3,
    "E":  4,
    "F":  5,  "F#": 6,  "Gb": 6,
    "G":  7,  "G#": 8,  "Ab": 8,
    "A":  9,  "A#": 10, "Bb": 10,
    "B":  11,
}


def transpose_midi(midi_path: str, target_key: str) -> dict:
    """
    MIDI 파일을 원하는 키로 변조합니다.

    target_key 예시: "G", "Bb", "F#"

    반환값:
    {
        "midi_path": "output/song_G.mid",
        "notes": [ {"pitch": ..., "duration": ..., "start_time": ...}, ... ]
    }
    """
    if target_key not in KEY_SEMITONES:
        raise ValueError(f"지원하지 않는 키입니다: {target_key}. 사용 가능: {list(KEY_SEMITONES.keys())}")

    score = music21.converter.parse(midi_path)

    # 원본 키 감지
    original_key = score.analyze("key")
    original_tonic = original_key.tonic.name  # 예: "C"

    # 이동할 반음 수 계산
    semitones = KEY_SEMITONES[target_key] - KEY_SEMITONES.get(original_tonic, 0)

    # 변조 적용
    transposed = score.transpose(semitones)

    # 저장
    base_name = os.path.splitext(os.path.basename(midi_path))[0]
    out_path = os.path.join(OUTPUT_DIR, f"{base_name}_{target_key}.mid")
    transposed.write("midi", fp=out_path)
    print(f"변조 완료 ({original_tonic} → {target_key}): {out_path}")

    # 음표 리스트도 함께 반환
    notes = []
    for element in transposed.flat.notesAndRests:
        if isinstance(element, music21.note.Note):
            notes.append({
                "pitch": element.nameWithOctave,
                "duration": element.duration.type,
                "start_time": float(element.offset),
            })
        elif isinstance(element, music21.note.Rest):
            notes.append({
                "pitch": "rest",
                "duration": element.duration.type,
                "start_time": float(element.offset),
            })

    return {
        "original_key": original_tonic,
        "target_key": target_key,
        "semitones": semitones,
        "midi_path": out_path,
        "notes": notes,
    }
