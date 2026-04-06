import os
import subprocess
import tempfile
import numpy as np
from basic_pitch.inference import predict
import librosa
import pretty_midi
import imageio_ffmpeg
import noisereduce as nr

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── 상수 ──────────────────────────────────────────────────
MIDI_MIN          = 36     # C2
MIDI_MAX          = 96     # C7
PITCH_FMIN        = 65.0   # C2
PITCH_FMAX        = 2093.0 # C7
MIN_NOTE_DURATION = 0.12   # 최소 음표 길이 (초) — BPM 미지정 시 폴백
MERGE_GAP         = 0.08   # 동일음 병합 간격 (초)
WHISPER_GAP_PYIN_THRESHOLD = 0.3   # Whisper 갭 보정 시 pYIN 유효 판정 임계값
RMS_THRESHOLD_PERCENTILE   = 10    # RMS 저음량 필터 하위 퍼센타일

# ── 조성 템플릿 ──────────────────────────────────────────
MAJOR_TEMPLATE = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]
MINOR_TEMPLATE = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0]
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


# ── WAV 변환 ────────────────────────────────────────────
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


# ── Basic Pitch 피치 추출 ──────────────────────────────
PYIN_HOP     = 512      # ~23ms at 22050Hz (fill_gaps_with_whisper에서 사용)


def _run_basic_pitch(wav_path: str) -> tuple:
    """Basic Pitch로 오디오에서 음표 이벤트를 직접 추출."""
    model_output, midi_data, note_events = predict(wav_path)
    # note_events: [(start_sec, end_sec, pitch_midi, amplitude, pitch_bends), ...]

    notes = []
    for start, end, pitch, amp, _ in note_events:
        midi_note = int(round(pitch))
        if not (MIDI_MIN <= midi_note <= MIDI_MAX):
            continue
        notes.append({
            "midi_note": midi_note,
            "start": float(start),
            "duration": float(end - start),
            "velocity": int(np.clip(amp * 70 + 40, 40, 110)),
        })

    # RMS 필터 + 템포 추정용 오디오 데이터
    audio_22k, _ = librosa.load(wav_path, sr=22050, mono=True)
    print(f"[AMT] Basic Pitch 음표 추출: {len(notes)}개")
    return notes, audio_22k, 22050


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
    """인접한 동일 피치 음표를 병합. 단, 연속(back-to-back) 음표는 보존."""
    if len(notes) < 2:
        return notes

    merged = [notes[0].copy()]
    for n in notes[1:]:
        prev = merged[-1]
        gap = n["start"] - (prev["start"] + prev["duration"])
        # gap > 0.02s이고 < max_gap인 경우만 병합 (실제 작은 간격)
        # gap ≤ 0.02s (back-to-back)면 onset 분할이므로 보존
        if n["midi_note"] == prev["midi_note"] and 0.02 < gap < max_gap:
            prev["duration"] = (n["start"] + n["duration"]) - prev["start"]
            prev["velocity"] = max(prev["velocity"], n["velocity"])
        else:
            merged.append(n.copy())

    return merged


# ── 짧은 음표 흡수 ──────────────────────────────────────
def _absorb_short_notes(notes: list, min_dur: float = MIN_NOTE_DURATION, bpm: float | None = None) -> list:
    """짧은 음표를 인접 음에 흡수 (피치 차이 2반음 이내).

    bpm이 주어지면 32분음표 기준(beat_duration / 8)으로 최소 길이를 적응적으로 계산.
    bpm이 None이면 MIN_NOTE_DURATION(0.12초) 폴백.
    """
    if len(notes) < 2:
        return notes

    if bpm is not None and bpm > 0:
        beat_duration = 60.0 / bpm
        effective_min = beat_duration / 8  # 32분음표 기준
    else:
        effective_min = min_dur

    absorbed = []
    for n in notes:
        if n["duration"] < effective_min and len(absorbed) > 0:
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
def convert_audio_to_midi(audio_path: str) -> tuple:
    """
    AMT 파이프라인 (Basic Pitch 기반).
    반환: (midi_path, start_offset, estimated_bpm)
      — start_offset은 가사 매핑에 필요한 원본 시작 시간(초).
      — estimated_bpm은 librosa로 추정한 BPM (60~180 범위).
    """
    print(f"[AMT] 분석 시작: {audio_path}")

    # ── 1. WAV 변환 ─────────────────────────────────────────
    wav_path = _ensure_wav(audio_path)
    is_temp = wav_path != audio_path
    audio_duration = librosa.get_duration(path=wav_path)
    print(f"[AMT] 로드 완료: {audio_duration:.1f}초")

    try:
        # ── 2. Basic Pitch 피치 추출 ─────────────────────────
        print("[AMT] Basic Pitch 분석 중...")
        raw_notes, audio_data, sr_audio = _run_basic_pitch(wav_path)
        print(f"[AMT] Basic Pitch 완료: {len(raw_notes)}개 음표")

        # RMS 기반 저음량 구간 필터링
        rms = librosa.feature.rms(y=audio_data, hop_length=512)[0]
        rms_threshold = np.percentile(rms[rms > 0], RMS_THRESHOLD_PERCENTILE) if np.any(rms > 0) else 0.01
        rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr_audio, hop_length=512)

        filtered_notes = []
        for n in raw_notes:
            note_mask = (rms_times >= n["start"]) & (rms_times < n["start"] + n["duration"])
            if np.any(note_mask):
                note_rms = np.mean(rms[note_mask])
                if note_rms >= rms_threshold:
                    filtered_notes.append(n)
        if len(filtered_notes) < len(raw_notes):
            print(f"[AMT] 음량 필터: {len(raw_notes)}개 → {len(filtered_notes)}개")
        raw_notes = filtered_notes

        # 템포용 오디오 리샘플
        audio_for_tempo = librosa.resample(audio_data, orig_sr=sr_audio, target_sr=16000)
        sr_tempo = 16000

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
        return midi_path, 0.0, 100.0

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

    # ── 양자화 후 겹침 해소 (병합 대신 이전 음표 잘라냄) ─────
    if len(notes) >= 2:
        for i in range(len(notes) - 1):
            curr_end = notes[i]["start"] + notes[i]["duration"]
            next_start = notes[i + 1]["start"]
            if curr_end > next_start:
                notes[i]["duration"] = max(grid_16th, next_start - notes[i]["start"])

    # ── 9. 시작 오프셋 제거 (가사 매핑용 원본 오프셋 보존) ──
    start_offset = 0.0
    if notes:
        start_offset = notes[0]["start"]
        if start_offset > 0:
            for n in notes:
                n["start"] = max(0, n["start"] - start_offset)

    # ── 10. 음역대 정제 (IQR 이상치 제거 + 옥타브 보정) ──────
    if len(notes) >= 4:
        all_midi = np.array([n["midi_note"] for n in notes])
        q1, median_midi, q3 = np.percentile(all_midi, [25, 50, 75])
        iqr = q3 - q1
        # 허용 범위: Q1 - 1.5*IQR ~ Q3 + 1.5*IQR (최소 ±7반음 보장)
        half_range = max(7, iqr * 1.5)
        low_bound = median_midi - half_range
        high_bound = median_midi + half_range

        before = len(notes)
        corrected = []
        for n in notes:
            midi = n["midi_note"]
            # 옥타브 보정 시도
            while midi - median_midi > 11:
                midi -= 12
            while median_midi - midi > 11:
                midi += 12
            n["midi_note"] = midi
            # IQR 범위 내만 유지
            if low_bound <= midi <= high_bound:
                corrected.append(n)
        notes = corrected
        if len(notes) < before:
            print(f"[AMT] 음역대 정제: {before}개 → {len(notes)}개 "
                  f"(범위: MIDI {low_bound:.0f}~{high_bound:.0f}, "
                  f"중앙: {pretty_midi.note_number_to_name(int(median_midi))})")

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
    print(f"[AMT] MIDI 저장 완료: {midi_path} (오프셋: {start_offset:.2f}s, BPM: {bpm:.1f})")

    return midi_path, start_offset, bpm


# ── Whisper 기반 갭 보정 ────────────────────────────────────
def fill_gaps_with_whisper(audio_path: str, midi_path: str, syllables: list, audio_offset: float):
    """
    Whisper가 감지한 가사 구간에 음표가 없으면 pYIN으로 채움.
    Returns: (updated_midi_path, added_count)
    """
    if not syllables:
        return midi_path, 0

    midi = pretty_midi.PrettyMIDI(midi_path)
    if not midi.instruments:
        return midi_path, 0

    existing = sorted(midi.instruments[0].notes, key=lambda n: n.start)

    # 기존 음표의 음역대 범위 (추가 음표도 이 범위 내로 제한)
    if existing:
        existing_pitches = [n.pitch for n in existing]
        pitch_median = float(np.median(existing_pitches))
        pitch_low = pitch_median - 7
        pitch_high = pitch_median + 7
    else:
        pitch_low, pitch_high = MIDI_MIN, MIDI_MAX

    # 기존 음표를 오디오 시간으로 변환
    existing_ranges = [(n.start + audio_offset, n.end + audio_offset) for n in existing]

    # Whisper 음절 중 매칭 안 되는 것 찾기
    unmatched = []
    for syl in syllables:
        has_note = any(
            syl["start"] < ne + 0.2 and syl["end"] > ns - 0.2
            for ns, ne in existing_ranges
        )
        if not has_note:
            unmatched.append(syl)

    if not unmatched:
        print(f"[Whisper보정] 갭 없음 — 모든 음절에 음표 매칭됨")
        return midi_path, 0

    print(f"[Whisper보정] 매칭 안 된 음절: {len(unmatched)}/{len(syllables)}개")

    # 연속 미매칭 음절을 구간으로 묶기
    regions = []
    r_start = unmatched[0]["start"]
    r_end = unmatched[0]["end"]
    for s in unmatched[1:]:
        if s["start"] - r_end < 0.5:
            r_end = s["end"]
        else:
            regions.append((r_start, r_end))
            r_start = s["start"]
            r_end = s["end"]
    regions.append((r_start, r_end))

    # 오디오 로드 + 전처리
    wav_path = _ensure_wav(audio_path)
    is_temp = wav_path != audio_path
    try:
        audio, sr = librosa.load(wav_path, sr=22050, mono=True)
        audio = nr.reduce_noise(y=audio, sr=sr, prop_decrease=0.7)
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio = audio / peak * 0.95
    finally:
        if is_temp:
            os.unlink(wav_path)

    added = 0
    for r_start, r_end in regions:
        # 구간 오디오 추출 (앞뒤 0.1초 여유)
        s_sample = max(0, int((r_start - 0.1) * sr))
        e_sample = min(len(audio), int((r_end + 0.1) * sr))
        segment = audio[s_sample:e_sample]

        if len(segment) < int(sr * 0.1):
            continue

        # pYIN (WHISPER_GAP_PYIN_THRESHOLD 임계값으로 숨소리/잡음 필터링)
        f0, voiced, probs = librosa.pyin(
            segment, fmin=PITCH_FMIN, fmax=PITCH_FMAX, sr=sr
        )
        times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=PYIN_HOP)
        times += r_start - 0.1  # 절대 시간으로 변환

        valid = voiced & (probs >= WHISPER_GAP_PYIN_THRESHOLD) & ~np.isnan(f0)
        if not np.any(valid):
            continue

        midi_pitches = librosa.hz_to_midi(f0[valid])

        # 이 구간의 각 Whisper 음절에 음표 할당
        region_syls = [s for s in unmatched if s["start"] >= r_start and s["end"] <= r_end]
        for syl in region_syls:
            syl_mask = valid & (times >= syl["start"] - 0.1) & (times < syl["end"] + 0.1)
            if not np.any(syl_mask):
                continue

            syl_pitches = librosa.hz_to_midi(f0[syl_mask])
            syl_pitches = syl_pitches[~np.isnan(syl_pitches)]
            if len(syl_pitches) == 0:
                continue

            midi_note = int(round(np.median(syl_pitches)))
            # 기존 음표 음역대 범위 내만 허용
            if not (pitch_low <= midi_note <= pitch_high):
                continue

            # MIDI 시간으로 변환 (오프셋 제거)
            note_start = max(0.0, syl["start"] - audio_offset)
            note_end = max(note_start + 0.1, syl["end"] - audio_offset)

            midi.instruments[0].notes.append(pretty_midi.Note(
                velocity=60,
                pitch=midi_note,
                start=note_start,
                end=note_end,
            ))
            added += 1

    if added > 0:
        midi.instruments[0].notes.sort(key=lambda n: n.start)
        midi.write(midi_path)
        print(f"[Whisper보정] {added}개 음표 추가 → MIDI 업데이트")
    else:
        print(f"[Whisper보정] 추가된 음표 없음")

    return midi_path, added
