import os
import music21

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)


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
    notes = []

    for element in score.flat.notesAndRests:
        if isinstance(element, music21.note.Note):
            notes.append({
                "pitch": element.nameWithOctave,       # 예: "C4", "G#3"
                "duration": element.duration.type,     # 예: "quarter", "eighth"
                "start_time": float(element.offset),   # 마디 내 시작 위치
            })
        elif isinstance(element, music21.note.Rest):
            notes.append({
                "pitch": "rest",
                "duration": element.duration.type,
                "start_time": float(element.offset),
            })

    return notes
