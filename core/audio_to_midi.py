import os
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)


def convert_audio_to_midi(audio_path: str) -> str:
    """
    오디오 파일(MP3/WAV)을 받아서 MIDI 파일로 변환합니다.
    변환된 MIDI 파일 경로를 반환합니다.
    """
    print(f"Basic Pitch 분석 시작: {audio_path}")

    model_output, midi_data, note_events = predict(
        audio_path,
        model_or_model_path=ICASSP_2022_MODEL_PATH,
    )

    # 출력 파일명: 원본 파일명 기반
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    midi_path = os.path.join(OUTPUT_DIR, f"{base_name}.mid")

    midi_data.write(midi_path)
    print(f"MIDI 저장 완료: {midi_path}")

    return midi_path
