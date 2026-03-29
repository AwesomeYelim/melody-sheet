import os
import music21

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 이명동음 변환: # → b
_SHARP_TO_FLAT = {
    "C#": "D-", "D#": "E-", "E#": "F", "F#": "G-",
    "G#": "A-", "A#": "B-", "B#": "C",
}


def _to_flat_name(pitch_name_with_octave: str, use_flats: bool) -> str:
    """use_flats이면 D#4 → Eb4 등으로 변환."""
    if not use_flats:
        return pitch_name_with_octave
    # 이름 부분과 옥타브 분리 (예: "D#4" → "D#", "4")
    name = pitch_name_with_octave[:-1]  # "D#"
    octave = pitch_name_with_octave[-1]  # "4"
    if name in _SHARP_TO_FLAT:
        flat_name = _SHARP_TO_FLAT[name]
        # B# → C 는 옥타브 +1, E# → F 는 같은 옥타브
        if name == "B#":
            octave = str(int(octave) + 1)
        return flat_name + octave
    return pitch_name_with_octave


# quarterLength → 표준 duration type 매핑 (내림차순)
_QL_TO_TYPE = [
    (4.0, "whole"),
    (3.0, "half"),       # 점2분음표 → 2분음표로 근사
    (2.0, "half"),
    (1.5, "quarter"),    # 점4분음표 → 4분음표로 근사
    (1.0, "quarter"),
    (0.75, "eighth"),
    (0.5, "eighth"),
    (0.375, "16th"),
    (0.25, "16th"),
    (0.125, "32nd"),
]

def _resolve_duration(element) -> str:
    """
    music21 duration type이 'complex'이면 quarterLength 기준으로 가장 가까운
    표준 음표 길이로 변환합니다.
    """
    dtype = element.duration.type
    if dtype != "complex":
        return dtype
    ql = float(element.duration.quarterLength)
    for threshold, name in _QL_TO_TYPE:
        if ql >= threshold:
            return name
    return "32nd"


def midi_to_musicxml(midi_path: str) -> str:
    """
    MIDI 파일을 MusicXML로 변환합니다.
    앱에서 악보 렌더링할 때 이 XML을 사용합니다.
    """
    score = music21.converter.parse(midi_path)

    base_name = os.path.splitext(os.path.basename(midi_path))[0]
    xml_path = os.path.join(OUTPUT_DIR, f"{base_name}.xml")

    score.write("musicxml", fp=xml_path)
    print(f"MusicXML 저장 완료: {xml_path}")

    return xml_path


def midi_to_note_list(midi_path: str) -> list:
    """
    MIDI 파일을 파싱해서 음표 리스트를 반환합니다.
    앱에서 VexFlow로 악보 그릴 때 사용하는 JSON 데이터입니다.

    반환 예시:
    [
        {"pitch": "C4", "duration": "quarter", "start_time": 0.0},
        {"pitch": "E4", "duration": "eighth", "start_time": 0.5},
        ...
    ]
    """
    score = music21.converter.parse(midi_path)

    # 조성 감지 → 플랫 키(조표에 b 포함)이면 # 대신 b 표기 사용
    key_sig = score.analyze("key")
    use_flats = False
    if key_sig and hasattr(key_sig, "sharps") and key_sig.sharps is not None:
        use_flats = key_sig.sharps < 0
    print(f"[Sheet] 조성: {key_sig}, 플랫 표기: {use_flats}")

    notes = []

    for element in score.flat.notesAndRests:
        if isinstance(element, music21.note.Note):
            notes.append({
                "pitch": _to_flat_name(element.nameWithOctave, use_flats),
                "duration": _resolve_duration(element),
                "start_time": float(element.offset),
            })
        elif isinstance(element, music21.chord.Chord):
            # 양자화로 동시 시작된 음표 → 가장 높은 음(멜로디)만 추출
            top = element.pitches[-1]
            notes.append({
                "pitch": _to_flat_name(top.nameWithOctave, use_flats),
                "duration": _resolve_duration(element),
                "start_time": float(element.offset),
            })
        elif isinstance(element, music21.note.Rest):
            notes.append({
                "pitch": "rest",
                "duration": _resolve_duration(element),
                "start_time": float(element.offset),
            })

    return notes
