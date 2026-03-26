import os
import subprocess
import tempfile
import numpy as np
import librosa
import torchcrepe
import torch
import torchaudio
import torchaudio.transforms as T
import noisereduce as nr
import pretty_midi
import imageio_ffmpeg

OUTPUT_DIR = "output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── 상수 ──────────────────────────────────────────────────
CONFIDENCE_THRESHOLD = 0.45   # CREPE 신뢰도 임계값 (낮출수록 더 많은 음 감지)
MIN_NOTE_DURATION    = 0.08   # 최소 음표 길이 (초) — 너무 짧은 노이즈 제거
CREPE_STEP_MS        = 10     # CREPE 분석 단위 (ms)
MIDI_MIN             = 36     # C2
MIDI_MAX             = 84     # C6 (허밍 범위)


# ── 오디오 로드 (포맷 자동 처리) ─────────────────────────
def _load_audio(path: str, target_sr: int = 16000):
    """
    WAV/FLAC/OGG → torchaudio 직접 로드
    MP3/M4A/AAC 등 → imageio-ffmpeg으로 WAV 변환 후 로드
    """
    try:
        waveform, sr = torchaudio.load(path)
    except Exception:
        # ffmpeg으로 임시 WAV 변환
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        try:
            subprocess.run(
                [ffmpeg, "-y", "-i", path, "-ar", str(target_sr), "-ac", "1", tmp.name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            waveform, sr = torchaudio.load(tmp.name)
        finally:
            os.unlink(tmp.name)

    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != target_sr:
        waveform = T.Resample(orig_freq=sr, new_freq=target_sr)(waveform)
        sr = target_sr
    return waveform.squeeze(0).numpy(), sr


# ── 유틸 ──────────────────────────────────────────────────
def hz_to_midi(freq: float):
    """Hz → MIDI 노트 번호"""
    if freq is None or freq <= 0:
        return None
    return int(round(69 + 12 * np.log2(freq / 440.0)))


def quantize(value: float, grid: float) -> float:
    """value를 grid 단위로 양자화"""
    return round(value / grid) * grid


def duration_to_grid(duration_sec: float, bpm: float) -> float:
    """
    음표 길이를 악보 그리드(16분음표 단위)에 맞게 양자화.
    최소 1개 단위 보장.
    """
    beat = 60.0 / bpm
    grid = beat / 4          # 16분음표
    steps = max(1, round(duration_sec / grid))
    return steps * grid


# ── 메인 변환 함수 ─────────────────────────────────────────
def convert_audio_to_midi(audio_path: str) -> str:
    """
    딥러닝 기반 AMT 파이프라인:
    noisereduce → CREPE(viterbi) → onset detection → 양자화 → MIDI

    - 노이즈 환경 대응: noisereduce spectral gating
    - 불안정한 피치 대응: CREPE viterbi 디코딩 + 신뢰도 가중 중앙값
    - 빠른 음 전환 대응: librosa onset detection (backtrack=True)
    """
    print(f"[AMT] 분석 시작: {audio_path}")

    # ── 1. 오디오 로드 (WAV/MP3/M4A/FLAC 등 자동 처리) ──────
    audio, sr = _load_audio(audio_path)
    print(f"[AMT] 로드 완료: {len(audio)/sr:.1f}초")

    # ── 2. 노이즈 제거 ───────────────────────────────────────
    # 앞 0.3초를 노이즈 프로파일로 사용 (정적 배경음 제거)
    noise_clip = audio[:int(sr * 0.3)]
    audio_clean = nr.reduce_noise(
        y=audio,
        sr=sr,
        y_noise=noise_clip,
        prop_decrease=0.75,    # 75% 노이즈 감쇄
        stationary=False,      # 비정상 노이즈도 처리
    )
    print("[AMT] 노이즈 제거 완료")

    # ── 3. CREPE 피치 추정 (딥러닝, torchcrepe) ─────────────
    print("[AMT] CREPE 피치 추정 중...")
    hop_length = int(sr * CREPE_STEP_MS / 1000)   # 10ms → 샘플 수

    audio_tensor = torch.tensor(audio_clean, dtype=torch.float32).unsqueeze(0)
    frequencies, confidences = torchcrepe.predict(
        audio_tensor,
        sr,
        hop_length=hop_length,
        fmin=32.7,    # C1
        fmax=1975.5,  # B6
        model="tiny",
        decoder=torchcrepe.decode.viterbi,   # Viterbi: 피치 급변 스무딩
        device="cpu",
        return_periodicity=True,
    )
    # (1, T) → (T,) numpy 변환
    frequencies  = frequencies.squeeze(0).numpy()
    confidences  = confidences.squeeze(0).numpy()
    times        = np.arange(len(frequencies)) * (CREPE_STEP_MS / 1000.0)
    print(f"[AMT] CREPE 완료: {len(times)} 프레임")

    # ── 4. Onset 감지 ────────────────────────────────────────
    onset_times = librosa.onset.onset_detect(
        y=audio_clean,
        sr=sr,
        units="time",
        backtrack=True,          # 실제 음 시작점으로 역추적
        delta=0.04,              # 민감도 (낮출수록 더 많은 onset 감지)
        wait=5,                  # 최소 50ms 간격
    )
    # 양 끝 경계 추가
    onset_times = np.concatenate([[0.0], onset_times, [float(times[-1])]])
    print(f"[AMT] Onset 감지: {len(onset_times) - 2}개")

    # ── 5. 템포 추정 ─────────────────────────────────────────
    tempo_arr, _ = librosa.beat.beat_track(y=audio_clean, sr=sr)
    bpm = float(np.atleast_1d(tempo_arr)[0])
    bpm = max(60.0, min(180.0, bpm))   # 현실적 범위로 클리핑
    print(f"[AMT] 템포: {bpm:.1f} BPM")

    # ── 6. Onset 구간별 음표 추출 ────────────────────────────
    beat        = 60.0 / bpm
    grid_16th   = beat / 4      # 16분음표 길이(초)

    notes = []
    for i in range(len(onset_times) - 1):
        seg_start = onset_times[i]
        seg_end   = onset_times[i + 1]

        # 해당 구간의 CREPE 프레임
        mask      = (times >= seg_start) & (times < seg_end)
        seg_freq  = frequencies[mask]
        seg_conf  = confidences[mask]

        if len(seg_freq) == 0:
            continue

        # 신뢰도 임계값 이상인 프레임만
        valid = seg_conf >= CONFIDENCE_THRESHOLD
        if valid.sum() < 3:
            continue   # 유효 프레임이 너무 적으면 묵음/노이즈로 판단

        vf = seg_freq[valid]
        vc = seg_conf[valid]

        # 신뢰도 가중 중앙값으로 대표 피치 결정
        # (단순 평균보다 불안정한 피치에 강함)
        sorted_idx = np.argsort(vf)
        cum_conf   = np.cumsum(vc[sorted_idx])
        mid_idx    = np.searchsorted(cum_conf, cum_conf[-1] / 2)
        rep_freq   = vf[sorted_idx[mid_idx]]

        midi_note = hz_to_midi(rep_freq)
        if midi_note is None or not (MIDI_MIN <= midi_note <= MIDI_MAX):
            continue

        raw_dur = seg_end - seg_start
        if raw_dur < MIN_NOTE_DURATION:
            continue

        # 양자화
        q_start = quantize(seg_start, grid_16th)
        q_dur   = duration_to_grid(raw_dur, bpm)

        notes.append({
            "midi_note": midi_note,
            "start":     q_start,
            "duration":  q_dur,
            "velocity":  int(np.clip(np.mean(vc) * 110, 40, 110)),
        })

    print(f"[AMT] 음표 추출: {len(notes)}개")

    # ── 7. MIDI 생성 (pretty_midi) ───────────────────────────
    midi_obj   = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    instrument = pretty_midi.Instrument(program=0)  # Acoustic Grand Piano

    for n in notes:
        end = n["start"] + n["duration"]
        instrument.notes.append(
            pretty_midi.Note(
                velocity=n["velocity"],
                pitch=n["midi_note"],
                start=n["start"],
                end=end,
            )
        )

    midi_obj.instruments.append(instrument)

    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    midi_path = os.path.join(OUTPUT_DIR, f"{base_name}.mid")
    midi_obj.write(midi_path)
    print(f"[AMT] MIDI 저장 완료: {midi_path}")

    return midi_path
