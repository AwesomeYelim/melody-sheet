import logging
import os
import music21
import pretty_midi
from core.midi_to_sheet import _resolve_duration, _to_flat_name

logger = logging.getLogger(__name__)

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 키 이름 → 반음 수 변환 테이블 (장조 + 단조)
KEY_SEMITONES = {
    # 장조 (Major)
    "C":  0,  "C#": 1,  "Db": 1,
    "D":  2,  "D#": 3,  "Eb": 3,
    "E":  4,
    "F":  5,  "F#": 6,  "Gb": 6,
    "G":  7,  "G#": 8,  "Ab": 8,
    "A":  9,  "A#": 10, "Bb": 10,
    "B":  11,
    # 단조 (Minor) — 토닉 기준 반음 수는 장조와 동일
    "Cm":  0,  "C#m": 1,  "Dbm": 1,
    "Dm":  2,  "D#m": 3,  "Ebm": 3,
    "Em":  4,
    "Fm":  5,  "F#m": 6,  "Gbm": 6,
    "Gm":  7,  "G#m": 8,  "Abm": 8,
    "Am":  9,  "A#m": 10, "Bbm": 10,
    "Bm":  11,
}


def _normalize_key_name(key_str: str) -> str:
    """
    다양한 키 표기를 KEY_SEMITONES에서 사용하는 형태로 정규화합니다.

    지원 형태:
      - "C", "Am"               → 그대로
      - "a minor", "C# minor"   → "Am", "C#m"  (music21 형식)
      - "A Major", "c major"    → "A", "C"      (music21 형식)
      - "am", "c#m"             → "Am", "C#m"   (소문자 입력)
    """
    s = key_str.strip()

    # music21 형식: "A minor" / "C# major" 등
    lower = s.lower()
    if " minor" in lower:
        tonic = s.split()[0]
        tonic = tonic[0].upper() + tonic[1:]  # 첫 글자 대문자
        return tonic + "m"
    if " major" in lower:
        tonic = s.split()[0]
        tonic = tonic[0].upper() + tonic[1:]
        return tonic

    # 단축 표기: "am", "c#m", "bbm" 등 → 정규화
    # 주의: 대문자 "M"은 장조 약칭(예: "BM" = B Major), 소문자 "m"만 단조
    if s.endswith("m") and len(s) >= 2:
        # 소문자 m → 단조 단축형
        tonic_part = s[:-1]
        tonic_part = tonic_part[0].upper() + tonic_part[1:]
        return tonic_part + "m"
    if s.endswith("M") and len(s) >= 2:
        # 대문자 M → 장조 약칭 (예: "BM" → "B", "FM" → "F")
        tonic_part = s[:-1]
        return tonic_part[0].upper() + tonic_part[1:]

    # 장조 단축형: "c", "f#" 등
    return s[0].upper() + s[1:]


def _music21_key_to_name(key_obj) -> str:
    """
    music21 Key 객체를 KEY_SEMITONES 키 이름으로 변환합니다.
    예: Key('A', 'minor') → "Am",  Key('C', 'major') → "C"
    """
    tonic = key_obj.tonic.name  # 예: "A", "C#", "B-"
    # music21은 플랫을 '-'로 표기 → 'b'로 변환
    tonic = tonic.replace("-", "b")
    if key_obj.mode == "minor":
        return tonic + "m"
    return tonic


def transpose_midi(midi_path: str, target_key: str) -> dict:
    """
    MIDI 파일을 원하는 키로 변조합니다.

    target_key 예시: "G", "Bb", "F#", "Am", "C#m"
    장조→장조, 장조→단조, 단조→장조, 단조→단조 모두 지원.

    반환값:
    {
        "midi_path": "output/song_Am.mid",
        "notes": [ {"pitch": ..., "duration": ..., "start_time": ...}, ... ]
    }
    """
    # 타겟 키 정규화
    target_key = _normalize_key_name(target_key)

    if target_key not in KEY_SEMITONES:
        raise ValueError(f"지원하지 않는 키입니다: {target_key}. 사용 가능: {list(KEY_SEMITONES.keys())}")

    # ── MIDI 파일 파싱 (music21) ──
    try:
        score = music21.converter.parse(midi_path)
    except Exception as e:
        raise ValueError(
            f"MIDI 파일을 파싱할 수 없습니다 (music21): {midi_path}. "
            f"파일이 손상되었거나 유효한 MIDI 형식이 아닙니다. 원본 오류: {e}"
        ) from e

    # ── MIDI 파일 검증 (pretty_midi) ──
    try:
        pm = pretty_midi.PrettyMIDI(midi_path)
    except Exception as e:
        raise ValueError(
            f"MIDI 파일을 파싱할 수 없습니다 (pretty_midi): {midi_path}. "
            f"파일이 손상되었거나 유효한 MIDI 형식이 아닙니다. 원본 오류: {e}"
        ) from e

    # ── 빈 MIDI 파일 검사 (음표 0개) ──
    total_pm_notes = sum(len(inst.notes) for inst in pm.instruments)
    has_music21_notes = any(
        isinstance(el, (music21.note.Note, music21.chord.Chord))
        for el in score.flat.notesAndRests
    )
    if total_pm_notes == 0 and not has_music21_notes:
        raise ValueError(
            f"MIDI 파일에 음표가 없습니다: {midi_path}. "
            "빈 MIDI 파일은 변조할 수 없습니다."
        )

    # 원본 키 감지 (music21 Key 객체 → 정규화된 이름)
    original_key_obj = score.analyze("key")
    original_key_name = _music21_key_to_name(original_key_obj)

    # 이동할 반음 수 계산
    if original_key_name not in KEY_SEMITONES:
        logger.warning(
            "감지된 원본 키 '%s'이(가) KEY_SEMITONES에 없습니다. "
            "반음 수를 0으로 간주합니다.",
            original_key_name,
        )
    original_semitones = KEY_SEMITONES.get(original_key_name, 0)
    target_semitones = KEY_SEMITONES[target_key]
    semitones = target_semitones - original_semitones

    # 변조 적용
    transposed = score.transpose(semitones)

    # 저장
    base_name = os.path.splitext(os.path.basename(midi_path))[0]
    out_path = os.path.join(OUTPUT_DIR, f"{base_name}_{target_key}.mid")
    transposed.write("midi", fp=out_path)
    print(f"변조 완료 ({original_key_name} → {target_key}): {out_path}")

    # 조표 기준 플랫 표기 여부 판단 (midi_to_note_list와 동일 로직)
    transposed_key = transposed.analyze("key")
    use_flats = False
    if transposed_key and hasattr(transposed_key, "sharps") and transposed_key.sharps is not None:
        use_flats = transposed_key.sharps < 0

    # 음표 리스트도 함께 반환
    notes = []
    for element in transposed.flat.notesAndRests:
        if isinstance(element, music21.note.Note):
            notes.append({
                "pitch": _to_flat_name(element.nameWithOctave, use_flats),
                "duration": _resolve_duration(element),
                "start_time": float(element.offset),
            })
        elif isinstance(element, music21.note.Rest):
            notes.append({
                "pitch": "rest",
                "duration": _resolve_duration(element),
                "start_time": float(element.offset),
            })

    return {
        "original_key": original_key_name,
        "target_key": target_key,
        "semitones": semitones,
        "midi_path": out_path,
        "notes": notes,
    }
