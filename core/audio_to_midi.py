import os
import subprocess
import tempfile
import numpy as np
import librosa
import pretty_midi
import imageio_ffmpeg
from basic_pitch.inference import predict as bp_predict

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── 상수 ──────────────────────────────────────────────────
MIDI_MIN          = 36     # C2
MIDI_MAX          = 96     # C7
PITCH_FMIN        = 65.0   # C2
PITCH_FMAX        = 2093.0 # C7
MIN_NOTE_DURATION = 0.12   # 최소 음표 길이 (초)
MERGE_GAP         = 0.08   # 동일음 병합 간격 (초)
MIN_AMPLITUDE     = 0.35   # 최소 진폭 (잡음 필터)

# ── 조성 템플릿 ──────────────────────────────────────────
MAJOR_TEMPLATE = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]
MINOR_TEMPLATE = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0]
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


# ── WAV 변환 (Basic Pitch는 m4a를 못 읽음) ────────────────
def _ensure_wav(audio_path: str) -> str:
    """m4a 등 비-wav 파일을 임시 wav로 변환. wav면 그대로 반환."""
    if audio_path.lower().endswith('.wav'):
        return audio_path

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    subprocess.run(
        [ffmpeg, "-y", "-i", audio_path, "-ar", "22050", "-ac", "1", tmp.name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return tmp.name


# ── 오디오 로드 (코드 감지용) ──────────────────────────────
def _load_audio(path: str, target_sr: int = 22050):
    """오디오 파일을 numpy 배열로 로드 (ffmpeg 변환 포함)"""
    wav_path = _ensure_wav(path)
    is_temp = wav_path != path
    try:
        audio, sr = librosa.load(wav_path, sr=target_sr, mono=True)
    finally:
        if is_temp:
            os.unlink(wav_path)
    return audio, sr


# ── 유틸 ──────────────────────────────────────────────────
def quantize(value, grid):
    return round(value / grid) * grid


def duration_to_grid(duration_sec, bpm):
    beat = 60.0 / bpm
    grid = beat / 4
    steps = max(1, round(duration_sec / grid))
    return steps * grid


# ── Basic Pitch → 음표 추출 ──────────────────────────────
def _run_basic_pitch(wav_path: str):
    """Basic Pitch로 음표 추출 (end-to-end 딥러닝 AMT)"""
    model_output, midi_data, note_events = bp_predict(
        wav_path,
        onset_threshold=0.7,
        frame_threshold=0.5,
        minimum_note_length=127.7,
        minimum_frequency=PITCH_FMIN,
        maximum_frequency=PITCH_FMAX,
        melodia_trick=True,
    )

    # note_events: [(start, end, pitch, amplitude, [pitch_bends])]
    notes = []
    for ev in note_events:
        start, end, pitch, amplitude = ev[0], ev[1], ev[2], ev[3]
        dur = end - start
        if dur < MIN_NOTE_DURATION:
            continue
        if not (MIDI_MIN <= pitch <= MIDI_MAX):
            continue
        if amplitude < MIN_AMPLITUDE:
            continue
        notes.append({
            "midi_note": int(pitch),
            "start": float(start),
            "duration": float(dur),
            "velocity": int(np.clip(amplitude * 127, 40, 110)),
        })

    # 시간순 정렬
    notes.sort(key=lambda x: x["start"])
    return notes


# ── 옥타브 중복 제거 (배음/하모닉스) ─────────────────────
def _remove_octave_duplicates(notes):
    """
    모노포닉 멜로디에서 발생하는 배음(옥타브 위/아래) 제거.
    1. 메인 옥타브 범위 밖 제거
    2. 동시에 울리는 음표 중 메인 옥타브에 가까운 것만 남김
    """
    if len(notes) < 2:
        return notes

    # 메인 옥타브 범위 결정 (중앙값 기준)
    all_midi = [n["midi_note"] for n in notes]
    median_midi = float(np.median(all_midi))

    # 1차: 범위 밖 제거
    filtered = [n for n in notes if abs(n["midi_note"] - median_midi) <= 11]

    # 2차: 시간이 겹치는 음표 중 메인 옥타브에서 먼 것 제거
    result = []
    for i, n in enumerate(filtered):
        is_harmonic = False
        for j, other in enumerate(filtered):
            if i == j:
                continue
            # 시간이 겹치는지
            n_end = n["start"] + n["duration"]
            o_end = other["start"] + other["duration"]
            overlap = min(n_end, o_end) - max(n["start"], other["start"])
            if overlap > 0:
                # 옥타브 관계인지 (12반음 차이)
                diff = abs(n["midi_note"] - other["midi_note"])
                if diff == 12 or diff == 24:
                    # 메인 옥타브에서 더 먼 쪽 제거
                    if abs(n["midi_note"] - median_midi) > abs(other["midi_note"] - median_midi):
                        is_harmonic = True
                        break
        if not is_harmonic:
            result.append(n)

    return result


# ── 동일음 병합 ──────────────────────────────────────────
def _merge_same_pitch(notes, max_gap=MERGE_GAP):
    """인접한 동일 피치 음표를 병합"""
    if len(notes) < 2:
        return notes

    merged = [notes[0].copy()]
    for n in notes[1:]:
        prev = merged[-1]
        gap = n["start"] - (prev["start"] + prev["duration"])
        if n["midi_note"] == prev["midi_note"] and gap < max_gap:
            prev["duration"] = (n["start"] + n["duration"]) - prev["start"]
            prev["velocity"] = max(prev["velocity"], n["velocity"])
        else:
            merged.append(n.copy())

    return merged


# ── 짧은 음표 흡수 ──────────────────────────────────────
def _absorb_short_notes(notes, min_dur=0.15):
    """짧은 음표를 인접 음에 흡수 (피치 차이 2반음 이내)"""
    if len(notes) < 2:
        return notes

    absorbed = []
    for n in notes:
        if n["duration"] < min_dur and len(absorbed) > 0:
            prev = absorbed[-1]
            if abs(n["midi_note"] - prev["midi_note"]) <= 2:
                prev["duration"] = (n["start"] + n["duration"]) - prev["start"]
                continue
        absorbed.append(n)

    return absorbed


# ── 조성 감지 ────────────────────────────────────────────
def _detect_key(notes):
    """음표 분포에서 조성(Key) 추정"""
    if not notes:
        return 0, 'major', 0.0

    hist = np.zeros(12)
    for n in notes:
        pc = n['midi_note'] % 12
        hist[pc] += n['duration']

    total = hist.sum()
    if total == 0:
        return 0, 'major', 0.0
    hist /= total

    best_score = -1
    best_key = 0
    best_mode = 'major'

    for root in range(12):
        for mode, template in [('major', MAJOR_TEMPLATE), ('minor', MINOR_TEMPLATE)]:
            rotated = [template[(i - root) % 12] for i in range(12)]
            score = sum(hist[i] * rotated[i] for i in range(12))
            if score > best_score:
                best_score = score
                best_key = root
                best_mode = mode

    return best_key, best_mode, best_score


def _snap_to_key(notes, key_root, key_mode):
    """조성에 맞게 음표 보정 (±1 반음만 조정)"""
    template = MAJOR_TEMPLATE if key_mode == 'major' else MINOR_TEMPLATE
    valid_pcs = set()
    for i in range(12):
        if template[(i - key_root) % 12]:
            valid_pcs.add(i)

    changed = 0
    for n in notes:
        pc = n['midi_note'] % 12
        if pc not in valid_pcs:
            down = (pc - 1) % 12
            up = (pc + 1) % 12
            down_ok = down in valid_pcs
            up_ok = up in valid_pcs
            if down_ok and not up_ok:
                n['midi_note'] -= 1
                changed += 1
            elif up_ok and not down_ok:
                n['midi_note'] += 1
                changed += 1
            elif down_ok and up_ok:
                n['midi_note'] -= 1   # 음성 녹음은 약간 sharp 경향 → 아래로 보정
                changed += 1

    return notes, changed


# ── 메인 변환 함수 ─────────────────────────────────────────
def convert_audio_to_midi(audio_path: str) -> str:
    """
    AMT 파이프라인 (Basic Pitch 기반):
    1. Basic Pitch (ONNX) end-to-end 음표 추출
    2. 옥타브 중복 제거
    3. 동일음 병합 + 짧은음 흡수
    4. 조성 감지 + 보정
    5. 템포 양자화 → MIDI 출력
    """
    print(f"[AMT] 분석 시작: {audio_path}")

    # ── 1. WAV 변환 ─────────────────────────────────────────
    wav_path = _ensure_wav(audio_path)
    is_temp = wav_path != audio_path
    audio_duration = librosa.get_duration(path=wav_path)
    print(f"[AMT] 로드 완료: {audio_duration:.1f}초")

    try:
        # ── 2. Basic Pitch 음표 추출 ────────────────────────
        print("[AMT] Basic Pitch 분석 중...")
        raw_notes = _run_basic_pitch(wav_path)
        print(f"[AMT] Basic Pitch 완료: {len(raw_notes)}개 음표")

        # 템포용 오디오 로드 (같은 wav 사용)
        audio_for_tempo, sr_tempo = librosa.load(wav_path, sr=16000, mono=True)

    finally:
        if is_temp:
            os.unlink(wav_path)

    if not raw_notes:
        print("[AMT] 음표 없음")
        midi_obj = pretty_midi.PrettyMIDI()
        midi_obj.instruments.append(pretty_midi.Instrument(program=0))
        base_name = os.path.splitext(os.path.basename(audio_path))[0]
        midi_path = os.path.join(OUTPUT_DIR, f"{base_name}.mid")
        midi_obj.write(midi_path)
        return midi_path

    # ── 3. 옥타브 중복 제거 ──────────────────────────────────
    before = len(raw_notes)
    raw_notes = _remove_octave_duplicates(raw_notes)
    if len(raw_notes) < before:
        print(f"[AMT] 옥타브 필터: {before}개 → {len(raw_notes)}개")

    # ── 4. 동일음 병합 ──────────────────────────────────────
    before = len(raw_notes)
    raw_notes = _merge_same_pitch(raw_notes)
    if len(raw_notes) < before:
        print(f"[AMT] 동일음 병합: {before}개 → {len(raw_notes)}개")

    # ── 5. 짧은음 흡수 ──────────────────────────────────────
    before = len(raw_notes)
    raw_notes = _absorb_short_notes(raw_notes)
    if len(raw_notes) < before:
        print(f"[AMT] 짧은음 흡수: {before}개 → {len(raw_notes)}개")

    # ── 6. 조성 감지 + 보정 ──────────────────────────────────
    key_root, key_mode, key_score = _detect_key(raw_notes)
    key_name = NOTE_NAMES[key_root]
    print(f"[AMT] 감지된 조성: {key_name} {key_mode} (점수: {key_score:.3f})")

    if key_score >= 0.3:
        raw_notes, n_changed = _snap_to_key(raw_notes, key_root, key_mode)
        print(f"[AMT] 조성 보정: {n_changed}개 음표 조정")

    # ── 7. 조성 보정 후 재병합 ──────────────────────────────
    before = len(raw_notes)
    raw_notes = _merge_same_pitch(raw_notes)
    if len(raw_notes) < before:
        print(f"[AMT] 보정 후 재병합: {before}개 → {len(raw_notes)}개")

    # ── 8. 템포 추정 + 양자화 ───────────────────────────────
    tempo_arr, _ = librosa.beat.beat_track(y=audio_for_tempo, sr=sr_tempo)
    bpm = float(np.atleast_1d(tempo_arr)[0])
    bpm = max(60.0, min(180.0, bpm))
    print(f"[AMT] 템포: {bpm:.1f} BPM")

    grid_16th = (60.0 / bpm) / 4
    notes = []
    for n in raw_notes:
        q_start = quantize(n["start"], grid_16th)
        q_dur = duration_to_grid(n["duration"], bpm)
        notes.append({
            "midi_note": n["midi_note"],
            "start":     q_start,
            "duration":  q_dur,
            "velocity":  n["velocity"],
        })

    # ── 양자화 후 최종 동일음 병합 ────────────────────────────
    if len(notes) >= 2:
        final_merged = [notes[0]]
        for n in notes[1:]:
            prev = final_merged[-1]
            if n["midi_note"] == prev["midi_note"] and n["start"] <= prev["start"] + prev["duration"]:
                prev["duration"] = (n["start"] + n["duration"]) - prev["start"]
            else:
                final_merged.append(n)
        if len(final_merged) < len(notes):
            print(f"[AMT] 최종 병합: {len(notes)}개 → {len(final_merged)}개")
        notes = final_merged

    # ── 9. 시작 오프셋 제거 ──────────────────────────────────
    if notes:
        offset = notes[0]["start"]
        if offset > 0:
            for n in notes:
                n["start"] = max(0, n["start"] - offset)

    # ── 10. 옥타브 오류 보정 ─────────────────────────────────
    if len(notes) >= 2:
        all_midi = np.array([n["midi_note"] for n in notes])
        median_midi = float(np.median(all_midi))
        for n in notes:
            while n["midi_note"] - median_midi > 11:
                n["midi_note"] -= 12
            while median_midi - n["midi_note"] > 11:
                n["midi_note"] += 12

    # ── 11. 로그 ─────────────────────────────────────────────
    print(f"[AMT] 최종 음표: {len(notes)}개")
    pc_count = {}
    for n in notes:
        pc = NOTE_NAMES[n["midi_note"] % 12]
        pc_count[pc] = pc_count.get(pc, 0) + 1
    print(f"[AMT] 음고 분포: {dict(sorted(pc_count.items(), key=lambda x: -x[1]))}")

    for i, n in enumerate(notes[:15]):
        name = pretty_midi.note_number_to_name(n["midi_note"])
        print(f"  {i+1:2d}. {name:5s} (MIDI {n['midi_note']:3d}) "
              f"시작:{n['start']:6.2f}s 길이:{n['duration']:.2f}s")

    # ── 12. MIDI 생성 ────────────────────────────────────────
    midi_obj = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    # 조성 정보 삽입 → music21이 올바른 음이름(# vs b) 결정
    key_num = key_root if key_mode == 'major' else key_root + 12
    midi_obj.key_signature_changes.append(pretty_midi.KeySignature(key_num, 0.0))
    instrument = pretty_midi.Instrument(program=0)

    for n in notes:
        instrument.notes.append(
            pretty_midi.Note(
                velocity=n["velocity"],
                pitch=n["midi_note"],
                start=n["start"],
                end=n["start"] + n["duration"],
            )
        )

    midi_obj.instruments.append(instrument)

    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    midi_path = os.path.join(OUTPUT_DIR, f"{base_name}.mid")
    midi_obj.write(midi_path)
    print(f"[AMT] MIDI 저장 완료: {midi_path}")

    return midi_path
