/**
 * SheetMusic.web.js — VexFlow 5 EasyScore API 기반 악보 렌더링 + 제어 패널
 */
import React, { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, StyleSheet, View } from "react-native";
import VexFlowModule from "vexflow/bravura";
import { API_URL } from "../config";

// ── 상수 ──────────────────────────────────────────────────
const STAVE_HEIGHT = 160;
const STAVES_PER_ROW = 4;
const BEATS_PER_MEASURE = 4;
const MIN_STAVE_W = 160;
const NOTE_PX = 32;

const DUR_MAP = {
  whole: "w", half: "h", quarter: "q",
  eighth: "8", "16th": "16", "32nd": "32",
};
const DUR_UNITS = { w: 32, h: 16, q: 8, "8": 4, "16": 2, "32": 1 };
const MEASURE_UNITS = BEATS_PER_MEASURE * 8;

const DEFAULT_BPM = 100;
const BEAT_SEC = 60 / DEFAULT_BPM;
const DUR_SEC = {
  whole: BEAT_SEC * 4, half: BEAT_SEC * 2, quarter: BEAT_SEC,
  eighth: BEAT_SEC / 2, "16th": BEAT_SEC / 4, "32nd": BEAT_SEC / 8,
};

// ── 피치 → 주파수 변환 ────────────────────────────────────
function pitchToFreq(pitch) {
  if (!pitch || pitch === "rest") return null;
  const s = pitch.replace(/-/g, "b");
  const m = s.match(/^([A-G])(#{1,2}|b{1,2})?(\d+)$/);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const acc = m[2] || "";
  const semitone = base + acc.split("").reduce((a, c) => a + (c === "#" ? 1 : -1), 0);
  const octave = parseInt(m[3], 10);
  const midi = 12 + octave * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Web Audio API 재생 ────────────────────────────────────
function scheduleNotes(notes) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.25;
  masterGain.connect(ctx.destination);

  let t = ctx.currentTime + 0.05;
  let totalSec = 0;
  const noteTimes = [];
  let noteIndex = 0;

  for (const note of notes) {
    const dur = DUR_SEC[note.duration] || BEAT_SEC;
    const freq = pitchToFreq(note.pitch);

    if (freq) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + 0.015);
      gain.gain.setValueAtTime(1, t + dur * 0.65);
      gain.gain.linearRampToValueAtTime(0, t + dur * 0.9);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(t);
      osc.stop(t + dur);

      noteTimes.push({ noteIndex, startTime: t, endTime: t + dur });
    }

    noteIndex++;
    t += dur;
    totalSec += dur;
  }

  return { ctx, totalSec, noteTimes };
}

// ── 악보 레이아웃 ─────────────────────────────────────────
function toEasyPitch(pitch) {
  return pitch.replace(/-/g, "b");
}

function toEasyDur(dur) {
  return DUR_MAP[dur] || "q";
}

function buildMeasures(notes) {
  const measures = [];
  let cur = [];
  let units = 0;

  for (const note of notes) {
    const vd = toEasyDur(note.duration);
    const u = DUR_UNITS[vd] ?? 8;

    if (units + u > MEASURE_UNITS && cur.length > 0) {
      measures.push(finalizeMeasureObj(cur, units));
      cur = [];
      units = 0;
    }

    cur.push({ ...note, _vd: vd, _u: u, _lyric: note._lyric || "" });
    units += u;

    if (units >= MEASURE_UNITS) {
      measures.push(finalizeMeasureObj(cur, units));
      cur = [];
      units = 0;
    }
  }
  if (cur.length > 0) measures.push(finalizeMeasureObj(cur, units));
  return measures;
}

function finalizeMeasureObj(notes, usedUnits) {
  let remaining = MEASURE_UNITS - usedUnits;
  const result = [...notes];
  const restOrder = [
    { u: 32, dur: "w" }, { u: 16, dur: "h" }, { u: 8, dur: "q" },
    { u: 4, dur: "8" }, { u: 2, dur: "16" }, { u: 1, dur: "32" },
  ];
  for (const { u, dur } of restOrder) {
    while (remaining >= u) {
      result.push({ pitch: "rest", _vd: dur, _u: u });
      remaining -= u;
    }
  }
  const noteStr = result.map((n) => {
    if (n.pitch === "rest") return `B4/${n._vd}r`;
    return `${toEasyPitch(n.pitch)}/${n._vd}`;
  }).join(", ");
  // Track which tickable indices are real notes (not padding rests)
  const tickableMap = result.map((n, i) => (n.pitch !== "rest" ? i : -1)).filter((i) => i >= 0);
  // Lyrics for each tickable (indexed by position in result)
  const lyricMap = result.map((n) => (n.pitch !== "rest" ? (n._lyric || "") : ""));
  return {
    noteStr,
    startTime: notes[0].start_time ?? 0,
    tokenCount: result.length,
    tickableMap,
    lyricMap,
  };
}

function calcStaveWidth(tokenCount, isRowStart, isFirst) {
  const base = Math.max(MIN_STAVE_W, tokenCount * NOTE_PX);
  const extra = (isRowStart ? 30 : 0) + (isFirst ? 25 : 0);
  return base + extra;
}

// ── PNG 다운로드 ──────────────────────────────────────────
// 폰트 캐시 (한 번만 fetch)
let _fontCache = null;

async function fetchFontDataUrls() {
  if (_fontCache) return _fontCache;

  const VF = VexFlowModule.default || VexFlowModule;
  const Font = VF.Font;
  const fontNames = ["Bravura", "Academico"];
  const rules = [];

  for (const name of fontNames) {
    try {
      const url = Font.HOST_URL + Font.FILES[name];
      if (!url) continue;

      // 이미 data URL이면 그대로 사용
      if (url.startsWith("data:")) {
        rules.push(`@font-face { font-family: '${name}'; src: url(${url}) format('woff2'); }`);
        continue;
      }

      const resp = await fetch(url);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const dataUrl = await new Promise((res) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result);
        reader.readAsDataURL(blob);
      });
      rules.push(`@font-face { font-family: '${name}'; src: url(${dataUrl}) format('woff2'); }`);
    } catch (e) {
      console.warn(`[SheetMusic] 폰트 ${name} 로드 실패:`, e);
    }
  }

  _fontCache = rules;
  return rules;
}

async function downloadAsPng(containerEl, filename) {
  const svgEl = containerEl && containerEl.querySelector("svg");
  if (!svgEl) return;

  const clone = svgEl.cloneNode(true);
  const bbox = svgEl.getBoundingClientRect();
  const w = Math.round(bbox.width) || 900;
  const h = Math.round(bbox.height) || 300;
  clone.setAttribute("width", w);
  clone.setAttribute("height", h);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // 폰트를 SVG에 인라인 삽입
  const fontRules = await fetchFontDataUrls();
  if (fontRules.length > 0) {
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = fontRules.join("\n");
    clone.insertBefore(styleEl, clone.firstChild);
  }

  const svgData = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");

  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = filename;
      a.click();
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    img.src = url;
  });
}

// ── 코드 심볼 ─────────────────────────────────────────────
function getChordAt(chords, startTime) {
  if (!chords || chords.length === 0) return null;
  for (const c of chords) {
    if (startTime >= c.start_time && startTime < c.end_time) return c.chord;
  }
  return null;
}

// ── 컴포넌트 ──────────────────────────────────────────────
export default function SheetMusic({ notes, chords = [], lyrics = [], title = "", filename = "sheet_music", midiFile = null }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef(null);
  const playTimerRef = useRef(null);
  const noteElementsRef = useRef([]);
  const rafRef = useRef(null);
  const prevHighlightRef = useRef(-1);

  const [showSheet, setShowSheet] = useState(true);

  // API가 music21의 notesAndRests를 반환하므로 rest 제거
  // (buildMeasures가 자체적으로 패딩 rest를 생성함)
  const pitchedNotes = React.useMemo(() => {
    const allNotes = notes || [];
    const lyr = lyrics || [];
    let lyricIdx = 0;
    return allNotes
      .map((n, i) => {
        if (n.pitch && n.pitch !== "rest") {
          return { ...n, _lyric: lyr[i] || "" };
        }
        return null;
      })
      .filter(Boolean);
  }, [notes, lyrics]);

  useEffect(() => {
    handleStop();
  }, [notes]);

  useEffect(() => {
    setReady(false);
    setError(null);
    if (!containerRef.current || !pitchedNotes || pitchedNotes.length === 0) return;
    if (!showSheet) return;

    (async () => {
      try {
        const VF = VexFlowModule.default || VexFlowModule;
        if (!VF || !VF.Factory) throw new Error("VexFlow 로드 실패");

        await document.fonts.ready;
        containerRef.current.innerHTML = "";

        const measures = buildMeasures(pitchedNotes);
        const rows = Math.ceil(measures.length / STAVES_PER_ROW);
        const voiceInfos = [];

        let maxRowW = 0;
        for (let row = 0; row < rows; row++) {
          let rowW = 10;
          for (let col = 0; col < STAVES_PER_ROW; col++) {
            const idx = row * STAVES_PER_ROW + col;
            if (idx >= measures.length) break;
            rowW += calcStaveWidth(measures[idx].tokenCount, col === 0, idx === 0);
          }
          maxRowW = Math.max(maxRowW, rowW);
        }
        const totalW = maxRowW + 20;
        const totalH = rows * STAVE_HEIGHT + 20;

        const vf = new VF.Factory({
          renderer: { elementId: containerRef.current, width: totalW, height: totalH },
        });
        const score = vf.EasyScore();

        for (let i = 0; i < measures.length; i++) {
          const col = i % STAVES_PER_ROW;
          const row = Math.floor(i / STAVES_PER_ROW);
          const isFirst = i === 0;
          const isRowStart = col === 0;

          let x = 10;
          const rowStart = row * STAVES_PER_ROW;
          for (let j = rowStart; j < i; j++) {
            x += calcStaveWidth(measures[j].tokenCount, j % STAVES_PER_ROW === 0, j === 0);
          }
          const y = row * STAVE_HEIGHT + 20;
          const w = calcStaveWidth(measures[i].tokenCount, isRowStart, isFirst);

          try {
            const { noteStr, startTime, tickableMap, lyricMap } = measures[i];
            const voice = score.voice(score.notes(noteStr));
            voice.setMode(VF.Voice.Mode.SOFT);
            voiceInfos.push({ voice, tickableMap });

            const tickables = voice.getTickables();

            // 코드 심볼 (위)
            const chordName = getChordAt(chords, startTime);
            if (chordName && tickables.length > 0) {
              tickables[0].addModifier(
                new VF.Annotation(chordName)
                  .setFont("Arial", 11, "bold")
                  .setVerticalJustification(VF.Annotation.VerticalJustify.TOP),
                0
              );
            }

            // 가사 (아래)
            if (lyricMap) {
              for (let ti = 0; ti < tickables.length; ti++) {
                const lyric = lyricMap[ti];
                if (lyric) {
                  tickables[ti].addModifier(
                    new VF.Annotation(lyric)
                      .setFont("Arial", 11, "normal")
                      .setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM),
                    0
                  );
                }
              }
            }

            const system = vf.System({ x, y, width: w, spaceBetweenStaves: 10 });
            const stave = system.addStave({ voices: [voice] });
            if (isRowStart) stave.addClef("treble");
            if (isFirst) stave.addTimeSignature("4/4");
          } catch (e) {
            console.warn(`[SheetMusic] 마디 ${i + 1} 오류:`, e.message);
          }
        }

        vf.draw();

        // Collect SVG elements for each real note (rest excluded)
        const svgElements = [];
        for (const { voice, tickableMap } of voiceInfos) {
          const tickables = voice.getTickables();
          for (const ti of tickableMap) {
            const el = tickables[ti] && tickables[ti].getSVGElement
              ? tickables[ti].getSVGElement()
              : null;
            if (el) svgElements.push(el);
          }
        }
        noteElementsRef.current = svgElements;

        setReady(true);
      } catch (e) {
        console.error("[SheetMusic] 오류:", e);
        setError(e.message);
      }
    })();
  }, [pitchedNotes, chords, showSheet]);

  function highlightNote(index) {
    const el = noteElementsRef.current[index];
    if (!el) return;
    el.querySelectorAll("path, rect, line, circle, ellipse, text, polygon").forEach((child) => {
      const origFill = child.getAttribute("fill");
      if (origFill !== "none") child.style.fill = "#4F8EF7";
      child.style.stroke = "#4F8EF7";
    });
  }

  function unhighlightNote(index) {
    const el = noteElementsRef.current[index];
    if (!el) return;
    el.querySelectorAll("path, rect, line, circle, ellipse, text, polygon").forEach((child) => {
      child.style.fill = "";
      child.style.stroke = "";
    });
  }

  function clearAllHighlights() {
    for (let i = 0; i < noteElementsRef.current.length; i++) {
      unhighlightNote(i);
    }
    prevHighlightRef.current = -1;
  }

  async function handlePlay() {
    if (isPlaying) { handleStop(); return; }

    const result = scheduleNotes(pitchedNotes);
    if (!result) return;

    if (result.ctx.state === "suspended") {
      await result.ctx.resume();
    }

    audioCtxRef.current = result.ctx;
    setIsPlaying(true);

    const { noteTimes } = result;

    function tick() {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;

      let activeIdx = -1;
      for (let i = 0; i < noteTimes.length; i++) {
        if (now >= noteTimes[i].startTime && now < noteTimes[i].endTime) {
          activeIdx = i;
          break;
        }
      }

      if (activeIdx !== prevHighlightRef.current) {
        if (prevHighlightRef.current >= 0) unhighlightNote(prevHighlightRef.current);
        if (activeIdx >= 0) highlightNote(activeIdx);
        prevHighlightRef.current = activeIdx;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    playTimerRef.current = setTimeout(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearAllHighlights();
      setIsPlaying(false);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    }, result.totalSec * 1000 + 200);
  }

  function handleStop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    clearAllHighlights();
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsPlaying(false);
  }

  function handleDownloadMidi() {
    if (!midiFile) return;
    const a = document.createElement("a");
    a.href = `${API_URL}/api/download/${midiFile}`;
    a.download = midiFile;
    a.click();
  }

  if (!pitchedNotes || pitchedNotes.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      {/* 제어 패널 */}
      <View style={styles.controlPanel}>
        {/* 악보 토글 */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, showSheet && styles.toggleBtnActive]}
            onPress={() => setShowSheet(!showSheet)}
          >
            <Text style={[styles.toggleText, showSheet && styles.toggleTextActive]}>
              악보
            </Text>
          </TouchableOpacity>
        </View>

        {/* 액션 버튼 */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, isPlaying ? styles.stopBtn : styles.playBtn]}
            onPress={handlePlay}
          >
            <Text style={styles.actionBtnText}>
              {isPlaying ? "■ 정지" : "▶ 재생"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.downloadPngBtn]}
            onPress={() => downloadAsPng(containerRef.current, `${filename}.png`)}
            disabled={!ready || !showSheet}
          >
            <Text style={styles.actionBtnText}>PNG</Text>
          </TouchableOpacity>

          {midiFile && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.downloadMidiBtn]}
              onPress={handleDownloadMidi}
            >
              <Text style={styles.actionBtnText}>MIDI</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {error && <Text style={styles.errorText}>렌더링 오류: {error}</Text>}
      {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}

      {/* 악보 영역 */}
      {showSheet && (
        <div ref={containerRef} style={{ overflowX: "auto" }} />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 24,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  // ── 제어 패널 ──────────────────────────────────
  controlPanel: {
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#ddd",
    backgroundColor: "#f5f5f5",
  },
  toggleBtnActive: {
    backgroundColor: "#4F8EF7",
    borderColor: "#4F8EF7",
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
  },
  toggleTextActive: {
    color: "#fff",
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 60,
    alignItems: "center",
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "bold",
  },
  playBtn: {
    backgroundColor: "#34C759",
  },
  stopBtn: {
    backgroundColor: "#E94F4F",
  },
  downloadPngBtn: {
    backgroundColor: "#4F8EF7",
  },
  downloadMidiBtn: {
    backgroundColor: "#8B5CF6",
  },
  // ── 기타 ──────────────────────────────────────
  errorText: { color: "red", fontSize: 12, marginBottom: 4 },
  sheetTitle: {
    fontSize: 16, fontWeight: "bold", color: "#1a1a2e",
    textAlign: "center", marginBottom: 6,
  },
});
