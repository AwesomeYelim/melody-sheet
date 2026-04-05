"""
WhisperX 기반 가사 추출 + 음표 타임스탬프 매핑 (음절 단위)
"""
import os
import torch
import whisperx
import numpy as np
import librosa
import pretty_midi
from core.audio_to_midi import _ensure_wav

_model = None
_align_model = None
_align_metadata = None


def _get_model():
    """WhisperX 모델 싱글턴 로딩."""
    global _model
    if _model is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "float32"
        print(f"[Lyrics] WhisperX 모델 로딩 (medium, {device})...")
        _model = whisperx.load_model("medium", device, compute_type=compute_type)
        print("[Lyrics] 모델 로딩 완료")
    return _model


def _get_align_model(device: str) -> tuple:
    """한국어 강제정렬 모델 싱글턴 로딩."""
    global _align_model, _align_metadata
    if _align_model is None:
        print("[Lyrics] 한국어 정렬 모델 로딩...")
        _align_model, _align_metadata = whisperx.load_align_model(
            language_code="ko", device=device
        )
        print("[Lyrics] 정렬 모델 로딩 완료")
    return _align_model, _align_metadata


def transcribe_lyrics(audio_path: str) -> list:
    """
    오디오에서 가사를 음절 단위로 추출.
    WhisperX 강제정렬로 단어 단위 정밀 타임스탬프 → 한국어 글자 분할.
    반환: [{"char": "하", "start": 0.0, "end": 0.25}, ...]
    """
    wav_path = _ensure_wav(audio_path)
    is_temp = wav_path != audio_path
    device = "cuda" if torch.cuda.is_available() else "cpu"

    try:
        model = _get_model()
        audio = whisperx.load_audio(wav_path)
        result = model.transcribe(audio, batch_size=16, language="ko")

        # 강제정렬로 단어 단위 정밀 타임스탬프
        try:
            align_model, metadata = _get_align_model(device)
            result = whisperx.align(
                result["segments"], align_model, metadata,
                audio, device, return_char_alignments=False,
            )
        except Exception as e:
            print(f"[Lyrics] 강제정렬 실패, 기본 타임스탬프 사용: {e}")
    finally:
        if is_temp:
            os.unlink(wav_path)

    # 단어 → 글자(음절) 분할
    syllables = []
    for seg in result.get("segments", []):
        for word_info in seg.get("words", []):
            word = word_info.get("word", "").strip()
            w_start = word_info.get("start")
            w_end = word_info.get("end")
            if not word or w_start is None or w_end is None:
                continue

            chars = list(word)
            if not chars:
                continue
            dur = (w_end - w_start) / len(chars)
            for ci, ch in enumerate(chars):
                syllables.append({
                    "char": ch,
                    "start": round(w_start + ci * dur, 4),
                    "end": round(w_start + (ci + 1) * dur, 4),
                })

    print(f"[Lyrics] WhisperX 추출 완료: {len(syllables)}개 음절")
    return syllables


def _is_rest(note: dict) -> bool:
    """
    음표가 rest(쉼표)인지 판별.
    - pitch가 "rest"이거나 비어 있으면 rest
    - pitch가 없거나 None이면 rest
    """
    pitch = note.get("pitch")
    if not pitch or pitch == "rest":
        return True
    return False


def align_lyrics_to_notes(syllables: list, notes: list, midi_path: str, audio_offset: float = 0.0) -> list:
    """
    Whisper 음절 타임스탬프(초)를 음표에 매핑.
    MIDI 파일에서 실제 초 단위 타이밍을 읽어서 매칭.

    반환값: notes와 1:1 대응하는 문자열 리스트.
           rest 음표에는 빈 문자열 ""이 할당됨.

    audio_offset: convert_audio_to_midi에서 제거된 시작 오프셋(초).
                  MIDI 음표 시간에 이 값을 더해야 Whisper 타임스탬프와 맞음.
    """
    if not syllables or not notes:
        return [""] * len(notes)

    # MIDI에서 초 단위 시간 (pretty_midi는 rest를 포함하지 않음)
    midi = pretty_midi.PrettyMIDI(midi_path)
    midi_notes = []
    if midi.instruments:
        midi_notes = sorted(midi.instruments[0].notes, key=lambda n: n.start)

    # notes[i] → 초 단위 시간 매핑
    # rest는 건너뛰고 pitched 음표만 midi_notes에 대응시킴
    # audio_offset을 더해서 원래 오디오 시간 복원
    note_times_sec = []
    midi_idx = 0
    for note in notes:
        if _is_rest(note):
            note_times_sec.append(None)
        elif midi_idx < len(midi_notes):
            note_times_sec.append(midi_notes[midi_idx].start + audio_offset)
            midi_idx += 1
        else:
            note_times_sec.append(None)

    print(f"[Lyrics] 오프셋 보정: +{audio_offset:.2f}s")
    if note_times_sec and any(t is not None for t in note_times_sec):
        valid_times = [t for t in note_times_sec if t is not None]
        print(f"[Lyrics] 음표 시간 범위: {valid_times[0]:.2f}s ~ {valid_times[-1]:.2f}s")
    if syllables:
        print(f"[Lyrics] 가사 시간 범위: {syllables[0]['start']:.2f}s ~ {syllables[-1]['end']:.2f}s")

    # 음절 매핑: rest를 건너뛰고 pitched 음표에만 가사를 할당
    lyrics = [""] * len(notes)
    syl_idx = 0

    for i, note in enumerate(notes):
        # rest 음표는 건너뜀 (빈 문자열 유지)
        if _is_rest(note):
            continue

        t_sec = note_times_sec[i]
        if t_sec is None or syl_idx >= len(syllables):
            continue

        # 이미 지나간 음절 스킵
        while syl_idx < len(syllables) - 1 and syllables[syl_idx]["end"] < t_sec - 0.3:
            syl_idx += 1

        syl = syllables[syl_idx]

        # 음표 시작과 음절이 겹치면 매핑
        if syl["start"] <= t_sec + 0.5 and syl["end"] >= t_sec - 0.3:
            lyrics[i] = syl["char"]
            syl_idx += 1

    return lyrics
