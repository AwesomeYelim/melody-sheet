"""
멜로디 음표 기반 코드 심볼 감지
- 오디오 크로마 대신 이미 감지된 MIDI 음표를 이용해 조성 추정 (훨씬 정확)
- Krumhansl-Schmuckler 프로파일 + 음표 지속 시간 가중치
- 다이아토닉 코드 내에서 하모닉 기능(T/S/D) 기반 코드 배정
- diminished 억제, 코드 스무딩
"""
import numpy as np
import re

try:
    import autochord
    _HAS_AUTOCHORD = True
except ImportError:
    _HAS_AUTOCHORD = False

# ── Krumhansl-Schmuckler 프로파일 ───────────────────────────
_KS_MAJOR = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
_KS_MINOR = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])

_NOTE_NAMES  = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
_DUR_BEATS   = {'whole':4,'half':2,'quarter':1,'eighth':0.5,'16th':0.25,'32nd':0.125}

# 장조 7개 다이아토닉 코드: (3도 오프셋, 5도 오프셋, 이름 접미사, 안정도 가중치)
_MAJOR_SCALE = [0,2,4,5,7,9,11]   # W W H W W W H
_MINOR_SCALE = [0,2,3,5,7,8,10]   # W H W W H W W

# 하모닉 기능 가중치 (불안정한 코드 억제)
# 장조: I(T) ii(S) iii(T) IV(S) V(D) vi(T) vii°(D/불안정)
_MAJOR_WEIGHTS = [1.3, 0.9, 0.8, 1.2, 1.2, 1.1, 0.3]
# 단조: i(T) ii°(S) III(T) iv(S) v/V(D) VI(T) VII(D)
_MINOR_WEIGHTS = [1.3, 0.3, 0.8, 1.1, 1.0, 1.1, 0.9]


def _pitch_to_class(pitch_str: str):
    """'C#4' → 1, 'Eb3' → 3, 'E-4' → 3, 'rest' → None"""
    if not pitch_str or pitch_str == 'rest':
        return None
    s = pitch_str.replace('-', 'b')
    m = re.match(r'^([A-G])(#{1,2}|b{1,2})?(\d)$', s)
    if not m:
        return None
    base = {'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[m.group(1)]
    acc = m.group(2) or ''
    return (base + acc.count('#') - acc.count('b')) % 12


def _key_from_notes(notes: list):
    """
    음표 리스트 (지속시간 가중) → Krumhansl-Schmuckler → (root_idx, 'major'|'minor')
    """
    chroma = np.zeros(12)
    for n in notes:
        pc = _pitch_to_class(n.get('pitch', 'rest'))
        if pc is None:
            continue
        dur = _DUR_BEATS.get(n.get('duration', 'quarter'), 1.0)
        chroma[pc] += dur

    total = chroma.sum()
    if total < 1e-6:
        return 7, 'major'   # G major 기본값

    chroma = chroma / total
    best_score, best_root, best_scale = -np.inf, 7, 'major'
    for root in range(12):
        rot = np.roll(chroma, -root)
        s_maj = float(np.corrcoef(rot, _KS_MAJOR / _KS_MAJOR.sum())[0, 1])
        s_min = float(np.corrcoef(rot, _KS_MINOR / _KS_MINOR.sum())[0, 1])
        if s_maj > best_score:
            best_score, best_root, best_scale = s_maj, root, 'major'
        if s_min > best_score:
            best_score, best_root, best_scale = s_min, root, 'minor'

    return best_root, best_scale


def _build_diatonic(root: int, scale: str):
    """
    7개 다이아토닉 코드 반환:
    [{"name": "Am", "tones": {0,3,7}, "weight": 1.1}, ...]
    """
    degrees = _MAJOR_SCALE if scale == 'major' else _MINOR_SCALE
    weights  = _MAJOR_WEIGHTS if scale == 'major' else _MINOR_WEIGHTS
    chords = []
    for i, (deg, w) in enumerate(zip(degrees, weights)):
        r = (root + deg) % 12
        # 3도: 장조는 [4,3,3,4,4,3,3], 단조는 [3,3,4,3,4,4,3]
        third_offsets = ([4,3,3,4,4,3,3] if scale == 'major' else [3,3,4,3,4,4,3])
        t3 = (r + third_offsets[i]) % 12
        t5 = (r + 7) % 12
        suffix = 'm' if third_offsets[i] == 3 else ''
        if third_offsets[i] == 3 and (scale == 'major' and i == 6 or scale == 'minor' and i == 1):
            suffix = 'dim'
            t5 = (r + 6) % 12   # diminished fifth
        name = _NOTE_NAMES[r] + suffix
        chords.append({"name": name, "tones": {r, t3, t5}, "weight": w})
    return chords


def _convert_chord_label(label: str) -> str:
    """autochord 레이블을 프로젝트 형식으로 변환. 'F:maj'→'F', 'D:min'→'Dm'"""
    parts = label.split(':')
    root = parts[0]
    quality = parts[1] if len(parts) > 1 else 'maj'
    if quality == 'min':
        return root + 'm'
    return root


def _detect_chords_autochord(audio_path: str) -> list:
    """autochord Bi-LSTM-CRF 기반 오디오 코드 감지."""
    raw_chords = autochord.recognize(audio_path)
    chords = []
    for start, end, label in raw_chords:
        if label == 'N':
            continue
        chord_name = _convert_chord_label(label)
        chords.append({
            "chord": chord_name,
            "start_time": round(float(start), 3),
            "end_time": round(float(end), 3),
        })
    print(f"[Chord] autochord 감지 완료: {len(chords)}개 코드")
    return chords


def _key_from_notes_str(notes: list, forced_key: str = None) -> str:
    """음표 리스트에서 조성 문자열 반환."""
    if forced_key:
        return forced_key
    root, mode = _key_from_notes(notes)
    root_name = _NOTE_NAMES[root]
    return root_name + 'm' if mode == 'minor' else root_name


def _detect_chords_diatonic(audio, sr, notes: list, beats_per_measure: int = 4,
                            forced_key: str = None):
    """
    기존 Krumhansl-Schmuckler 다이아토닉 규칙 기반 코드 감지.
    notes 리스트 → 마디별 코드 심볼 목록
    audio/sr 파라미터는 호환성 유지를 위해 받되 사용하지 않음 (음표 기반으로 처리)

    Returns:
        ([{"chord": "Am", "start_time": 0.0, "end_time": 2.0}, ...], "Am")
    """
    if not notes:
        return [], None

    # 1. 조성 결정 (forced_key 우선, 없으면 자동 감지)
    if forced_key:
        # "Am" → root=A, scale=minor / "G" → root=G, scale=major
        is_minor = forced_key.endswith('m') and len(forced_key) > 1
        root_name = forced_key[:-1] if is_minor else forced_key
        root_name = root_name.replace('b', 'b')  # 그대로 유지
        root_idx = _NOTE_NAMES.index(root_name) if root_name in _NOTE_NAMES else 0
        scale = 'minor' if is_minor else 'major'
    else:
        root_idx, scale = _key_from_notes(notes)

    detected_key = _NOTE_NAMES[root_idx] + ('m' if scale == 'minor' else '')
    diatonic = _build_diatonic(root_idx, scale)

    # 2. 마디 분할 (박자 기반) — 반마디(half-measure) 단위로 분리
    half_beats = beats_per_measure / 2.0
    measures = []
    cur_notes_1st, cur_notes_2nd = [], []
    cur_beats, cur_start = 0.0, 0.0
    in_second_half = False
    mid_time = None

    for note in notes:
        dur = _DUR_BEATS.get(note.get('duration', 'quarter'), 1.0)

        if not in_second_half and cur_beats + dur >= half_beats - 0.01:
            # 이 음표가 첫 반마디의 마지막 음표(또는 경계를 넘는 음표)
            cur_notes_1st.append(note)
            cur_beats += dur
            note_end = note.get('start_time', cur_start) + dur
            mid_time = note_end
            in_second_half = True

            if cur_beats >= beats_per_measure - 0.01:
                # 첫 반마디가 마디 전체를 채움 (두번째 반마디 비어있음)
                measures.append({
                    'notes_1st': cur_notes_1st[:],
                    'notes_2nd': [],
                    'start': cur_start,
                    'mid': mid_time,
                    'end': note_end,
                })
                cur_notes_1st, cur_notes_2nd = [], []
                cur_beats, cur_start = 0.0, note_end
                in_second_half = False
                mid_time = None
        elif in_second_half:
            cur_notes_2nd.append(note)
            cur_beats += dur

            if cur_beats >= beats_per_measure - 0.01:
                note_end = note.get('start_time', cur_start) + dur
                measures.append({
                    'notes_1st': cur_notes_1st[:],
                    'notes_2nd': cur_notes_2nd[:],
                    'start': cur_start,
                    'mid': mid_time,
                    'end': note_end,
                })
                cur_notes_1st, cur_notes_2nd = [], []
                cur_beats, cur_start = 0.0, note_end
                in_second_half = False
                mid_time = None
        else:
            cur_notes_1st.append(note)
            cur_beats += dur

    # 잔여 음표 처리
    if cur_notes_1st or cur_notes_2nd:
        last = notes[-1]
        end_t = last.get('start_time', cur_start) + _DUR_BEATS.get(last.get('duration', 'quarter'), 1.0)
        if mid_time is None:
            mid_time = (cur_start + end_t) / 2.0
        measures.append({
            'notes_1st': cur_notes_1st,
            'notes_2nd': cur_notes_2nd,
            'start': cur_start,
            'mid': mid_time,
            'end': end_t,
        })

    # ── 헬퍼: 음표 리스트 → 최적 코드 이름 ──
    def _best_chord(note_list, is_first_in_measure=False):
        """주어진 음표 리스트에서 최적 다이아토닉 코드를 선택한다."""
        hist = np.zeros(12)
        for n in note_list:
            pc = _pitch_to_class(n.get('pitch', 'rest'))
            if pc is None:
                continue
            dur = _DUR_BEATS.get(n.get('duration', 'quarter'), 1.0)
            # 강박(첫 음표) 가중치 2배
            if is_first_in_measure and n is note_list[0]:
                dur *= 2.0
            hist[pc] += dur

        total = hist.sum()
        if total < 1e-6:
            return None  # 음표 없음

        hist = hist / total
        best_name, best_score = diatonic[0]['name'], -1.0
        for chord in diatonic:
            score = sum(hist[t] for t in chord['tones']) * chord['weight']
            if score > best_score:
                best_score = score
                best_name = chord['name']
        return best_name

    # 3. 각 마디 → 반마디별 코드 감지 후 병합
    results = []
    prev_name = None

    for m in measures:
        chord_1st = _best_chord(m['notes_1st'], is_first_in_measure=True)
        chord_2nd = _best_chord(m['notes_2nd'], is_first_in_measure=False)

        # 빈 반마디 → 이전 코드 또는 다른 반마디 코드로 대체
        if chord_1st is None and chord_2nd is None:
            chord_1st = prev_name or diatonic[0]['name']
            chord_2nd = chord_1st
        elif chord_1st is None:
            chord_1st = chord_2nd
        elif chord_2nd is None:
            chord_2nd = chord_1st

        if chord_1st == chord_2nd:
            # 두 반마디 코드가 같으면 마디 전체를 하나의 코드로
            segments = [(chord_1st, m['start'], m['end'])]
        else:
            # 두 반마디 코드가 다르면 2개 코드로 분리
            segments = [
                (chord_1st, m['start'], m['mid']),
                (chord_2nd, m['mid'], m['end']),
            ]

        for chord_name, seg_start, seg_end in segments:
            # 인접한 같은 코드 병합
            if results and results[-1]['chord'] == chord_name:
                results[-1]['end_time'] = round(seg_end, 3)
            else:
                results.append({
                    'chord': chord_name,
                    'start_time': round(seg_start, 3),
                    'end_time': round(seg_end, 3),
                })
            prev_name = chord_name

    return results, detected_key


def detect_chords(audio, sr, notes: list, beats_per_measure: int = 4,
                  forced_key: str = None, audio_path: str = None):
    """
    코드 감지: autochord 우선, 실패 시 다이아토닉 규칙 폴백.

    Args:
        audio: 오디오 배열 (다이아토닉 폴백용, 현재 미사용)
        sr: 샘플레이트
        notes: 음표 리스트
        beats_per_measure: 박자 (기본 4/4)
        forced_key: 강제 조성 지정 (예: "Am", "G")
        audio_path: autochord용 오디오 파일 경로 (None이면 규칙 기반만 사용)

    Returns:
        ([{"chord": "Am", "start_time": 0.0, "end_time": 2.0}, ...], "Am")
    """
    # autochord 딥러닝 감지 우선 시도
    if _HAS_AUTOCHORD and audio_path is not None:
        try:
            chords = _detect_chords_autochord(audio_path)
            if chords:
                # 키 감지는 기존 음표 기반 KS 사용
                key_str = _key_from_notes_str(notes, forced_key)
                return chords, key_str
        except Exception as e:
            print(f"[Chord] autochord 실패, 다이아토닉 폴백: {e}")

    # 기존 Krumhansl-Schmuckler 다이아토닉 폴백
    return _detect_chords_diatonic(audio, sr, notes, beats_per_measure, forced_key)
