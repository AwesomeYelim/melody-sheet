"""
멜로디 음표 기반 코드 심볼 감지
- 오디오 크로마 대신 이미 감지된 MIDI 음표를 이용해 조성 추정 (훨씬 정확)
- Krumhansl-Schmuckler 프로파일 + 음표 지속 시간 가중치
- 다이아토닉 코드 내에서 하모닉 기능(T/S/D) 기반 코드 배정
- diminished 억제, 코드 스무딩
"""
import numpy as np
import re

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


def detect_chords(audio, sr, notes: list, beats_per_measure: int = 4, forced_key: str = None):
    """
    notes 리스트 → 마디별 코드 심볼 목록
    audio/sr 파라미터는 호환성 유지를 위해 받되 사용하지 않음 (음표 기반으로 처리)

    Returns:
        [{"chord": "Am", "start_time": 0.0, "end_time": 2.0}, ...]
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

    # 2. 마디 분할 (박자 기반)
    measures = []
    cur_notes, cur_beats, cur_start = [], 0.0, 0.0

    for note in notes:
        dur = _DUR_BEATS.get(note.get('duration', 'quarter'), 1.0)
        cur_notes.append(note)
        cur_beats += dur

        if cur_beats >= beats_per_measure - 0.01:
            end_t = note.get('start_time', cur_start) + dur
            measures.append({'notes': cur_notes[:], 'start': cur_start, 'end': end_t})
            cur_start = end_t
            cur_notes, cur_beats = [], 0.0

    if cur_notes:
        last = notes[-1]
        end_t = last.get('start_time', cur_start) + _DUR_BEATS.get(last.get('duration','quarter'), 1.0)
        measures.append({'notes': cur_notes, 'start': cur_start, 'end': end_t})

    # 3. 각 마디 → 최적 코드 선택
    results = []
    prev_name = None

    for m in measures:
        # 지속시간 가중 pitch class 히스토그램
        hist = np.zeros(12)
        for n in m['notes']:
            pc = _pitch_to_class(n.get('pitch', 'rest'))
            if pc is None:
                continue
            dur = _DUR_BEATS.get(n.get('duration', 'quarter'), 1.0)
            # 강박(첫 음표) 가중치 2배
            if n is m['notes'][0]:
                dur *= 2.0
            hist[pc] += dur

        total = hist.sum()
        if total < 1e-6:
            chord_name = prev_name or diatonic[0]['name']
        else:
            hist = hist / total
            best_name, best_score = diatonic[0]['name'], -1.0
            for chord in diatonic:
                # 코드 음의 히스토그램 합 × 하모닉 안정도 가중치
                score = sum(hist[t] for t in chord['tones']) * chord['weight']
                if score > best_score:
                    best_score = score
                    best_name = chord['name']
            chord_name = best_name

        # 인접한 같은 코드 병합
        if results and results[-1]['chord'] == chord_name:
            results[-1]['end_time'] = round(m['end'], 3)
        else:
            results.append({
                'chord': chord_name,
                'start_time': round(m['start'], 3),
                'end_time': round(m['end'], 3),
            })
        prev_name = chord_name

    return results, detected_key
