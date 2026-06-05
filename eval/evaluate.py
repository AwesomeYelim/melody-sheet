"""
U0 — 평가 하베스트 (전사 정확도 측정기)

eval/dataset/ 안의 (오디오, 정답MIDI) 쌍마다:
  1) convert_audio_to_midi()로 예측 MIDI 생성
  2) 정답 MIDI와 mir_eval로 note-level 정확도 비교
  3) 표 + 집계 점수 출력, 결과를 eval/results/에 저장

지표 (mir_eval.transcription):
  F_on    — onset(±50ms) + pitch 일치   (offset 무시; 멜로디 핵심 지표)
  F_full  — onset + offset + pitch 일치  (더 엄격)

실행:
    venv\\Scripts\\python.exe eval\\evaluate.py
"""
import os
import sys
import glob
import json
import time

import numpy as np
import pretty_midi
import mir_eval

# Windows 콘솔(cp949)에서도 유니코드 출력이 깨지지 않도록
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 저장소 루트를 path에 추가해 core 모듈 임포트
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from core.audio_to_midi import convert_audio_to_midi  # noqa: E402

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(EVAL_DIR, "dataset")
RESULTS_DIR = os.path.join(EVAL_DIR, "results")

ONSET_TOL = 0.05  # onset 허용 오차 (초)


def load_midi_notes(path: str):
    """MIDI를 (intervals[N,2], pitches_hz[N]) 로 로드한다 (onset 정렬)."""
    pm = pretty_midi.PrettyMIDI(path)
    intervals, pitches = [], []
    for inst in pm.instruments:
        if inst.is_drum:
            continue
        for n in inst.notes:
            if n.end <= n.start:
                continue
            intervals.append([n.start, n.end])
            pitches.append(pretty_midi.note_number_to_hz(n.pitch))
    if not intervals:
        return np.zeros((0, 2)), np.zeros(0)
    intervals = np.array(intervals, dtype=float)
    pitches = np.array(pitches, dtype=float)
    order = np.argsort(intervals[:, 0])
    return intervals[order], pitches[order]


def _prf(ref_int, ref_pitch, est_int, est_pitch, offset_ratio):
    """mir_eval 래퍼. 빈 예측/정답을 안전 처리."""
    if len(ref_int) == 0:
        return None  # 정답 없음 → 평가 불가
    if len(est_int) == 0:
        return 0.0, 0.0, 0.0
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ref_int, ref_pitch, est_int, est_pitch,
        onset_tolerance=ONSET_TOL,
        offset_ratio=offset_ratio,
        pitch_tolerance=50.0,  # cents
    )
    return float(p), float(r), float(f)


def evaluate_pair(audio_path: str, gt_path: str) -> dict:
    """오디오 1개를 파이프라인에 태우고 정답과 비교한다."""
    name = os.path.splitext(os.path.basename(gt_path))[0].replace(".gt", "")
    ref_int, ref_pitch = load_midi_notes(gt_path)

    midi_path, _offset, bpm = convert_audio_to_midi(audio_path)
    est_int, est_pitch = load_midi_notes(midi_path)

    on = _prf(ref_int, ref_pitch, est_int, est_pitch, offset_ratio=None)
    full = _prf(ref_int, ref_pitch, est_int, est_pitch, offset_ratio=0.2)

    return {
        "name": name,
        "n_ref": int(len(ref_int)),
        "n_est": int(len(est_int)),
        "bpm": round(float(bpm), 1),
        "p_on": on[0], "r_on": on[1], "f_on": on[2],
        "f_full": full[2],
    }


def find_pairs():
    """dataset/ 에서 (오디오, GT MIDI) 쌍을 찾는다."""
    pairs = []
    for gt in sorted(glob.glob(os.path.join(DATASET_DIR, "*.gt.mid"))):
        base = gt[:-len(".gt.mid")]
        audio = None
        for ext in (".wav", ".m4a", ".mp3"):
            if os.path.exists(base + ext):
                audio = base + ext
                break
        if audio:
            pairs.append((audio, gt))
        else:
            print(f"  ! 오디오 없음, 건너뜀: {os.path.basename(gt)}")
    return pairs


def main() -> None:
    pairs = find_pairs()
    if not pairs:
        print("dataset/ 에 (*.wav, *.gt.mid) 쌍이 없습니다. 먼저 gen_synthetic.py 실행.")
        sys.exit(1)

    print(f"평가 대상 {len(pairs)}개\n")
    rows = []
    for audio, gt in pairs:
        print(f"▶ {os.path.basename(audio)}")
        try:
            rows.append(evaluate_pair(audio, gt))
        except Exception as e:  # noqa: BLE001 — 한 파일 실패가 전체를 막지 않도록
            print(f"  ✗ 실패: {e}")
            rows.append({"name": os.path.basename(gt), "error": str(e)})
        print()

    ok = [r for r in rows if "error" not in r]

    # ── 콘솔 표 ──────────────────────────────────────────
    print("=" * 72)
    print(f"{'melody':<18}{'ref':>5}{'est':>5}{'P_on':>8}{'R_on':>8}{'F_on':>8}{'F_full':>8}")
    print("-" * 72)
    for r in ok:
        print(f"{r['name']:<18}{r['n_ref']:>5}{r['n_est']:>5}"
              f"{r['p_on']:>8.3f}{r['r_on']:>8.3f}{r['f_on']:>8.3f}{r['f_full']:>8.3f}")
    print("-" * 72)
    if ok:
        mean_f_on = float(np.mean([r["f_on"] for r in ok]))
        mean_f_full = float(np.mean([r["f_full"] for r in ok]))
        print(f"{'MEAN':<18}{'':>5}{'':>5}{'':>8}{'':>8}{mean_f_on:>8.3f}{mean_f_full:>8.3f}")
    else:
        mean_f_on = mean_f_full = 0.0
    print("=" * 72)

    # ── 결과 저장 ────────────────────────────────────────
    os.makedirs(RESULTS_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    summary = {
        "timestamp": stamp,
        "onset_tolerance": ONSET_TOL,
        "mean_f_on": mean_f_on,
        "mean_f_full": mean_f_full,
        "rows": rows,
    }
    out = os.path.join(RESULTS_DIR, f"{stamp}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    with open(os.path.join(RESULTS_DIR, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\n결과 저장: eval/results/{stamp}.json (mean F_on={mean_f_on:.3f})")


if __name__ == "__main__":
    main()
