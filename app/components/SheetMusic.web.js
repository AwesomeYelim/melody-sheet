/**
 * SheetMusic.web.js — VexFlow 5 EasyScore API 기반 악보 렌더링 + PNG 다운로드 + 재생
 * VexFlow는 index.html의 <script src="/vexflow-bravura.js"> 로 로드 → window.VexFlow
 */
import React, { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, StyleSheet, View } from "react-native";

// ── 상수 ──────────────────────────────────────────────────
const STAVE_HEIGHT = 140;
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

// 재생 BPM 기준 음표 길이(초)
const BPM = 100;
const BEAT_SEC = 60 / BPM;
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
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;

  const ctx = new AudioContext();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.25;
  masterGain.connect(ctx.destination);

  let t = ctx.currentTime + 0.05;
  let totalSec = 0;

  for (const note of notes) {
    const dur = DUR_SEC[note.duration] || BEAT_SEC;
    const freq = pitchToFreq(note.pitch);

    if (freq) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;

      // 간단한 ADSR 엔벨로프
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + 0.015);
      gain.gain.setValueAtTime(1, t + dur * 0.65);
      gain.gain.linearRampToValueAtTime(0, t + dur * 0.9);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(t);
      osc.stop(t + dur);
    }

    t += dur;
    totalSec += dur;
  }

  return { ctx, totalSec };
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

    cur.push({ ...note, _vd: vd, _u: u });
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
  return {
    noteStr,
    startTime: notes[0].start_time ?? 0,
    tokenCount: result.length,
  };
}

function calcStaveWidth(tokenCount, isRowStart, isFirst) {
  const base = Math.max(MIN_STAVE_W, tokenCount * NOTE_PX);
  const extra = (isRowStart ? 30 : 0) + (isFirst ? 25 : 0);
  return base + extra;
}

// ── PNG 다운로드 ──────────────────────────────────────────
async function downloadAsPng(containerEl, filename) {
  const svgEl = containerEl && containerEl.querySelector("svg");
  if (!svgEl) return;

  const clone = svgEl.cloneNode(true);
  const fontUrl = window._bravuraFontUrl;
  if (fontUrl) {
    let defs = clone.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      clone.insertBefore(defs, clone.firstChild);
    }
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `@font-face { font-family: 'Bravura'; src: url('${fontUrl}'); font-display: block; }`;
    defs.appendChild(style);
  }

  const bbox = svgEl.getBoundingClientRect();
  const w = Math.round(bbox.width) || 900;
  const h = Math.round(bbox.height) || 300;
  clone.setAttribute("width", w);
  clone.setAttribute("height", h);

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
export default function SheetMusic({ notes, chords = [], title = "", filename = "sheet_music" }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef(null);
  const playTimerRef = useRef(null);

  // 재생 중 notes 변경 시 자동 중지
  useEffect(() => {
    handleStop();
  }, [notes]);

  useEffect(() => {
    setReady(false);
    setError(null);
    if (!containerRef.current || !notes || notes.length === 0) return;

    (async () => {
      try {
        const VF = window.VexFlow;
        if (!VF) throw new Error("VexFlow 미로드");

        await document.fonts.ready;

        containerRef.current.innerHTML = "";

        const measures = buildMeasures(notes);
        const rows = Math.ceil(measures.length / STAVES_PER_ROW);

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
            const { noteStr, startTime } = measures[i];
            const voice = score.voice(score.notes(noteStr));
            voice.setMode(VF.Voice.Mode.SOFT);

            const chordName = getChordAt(chords, startTime);
            if (chordName) {
              const tickables = voice.getTickables();
              if (tickables.length > 0) {
                tickables[0].addModifier(
                  new VF.Annotation(chordName)
                    .setFont("Arial", 11, "bold")
                    .setVerticalJustification(VF.Annotation.VerticalJustify.TOP),
                  0
                );
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
        setReady(true);
      } catch (e) {
        console.error("[SheetMusic] 오류:", e);
        setError(e.message);
      }
    })();
  }, [notes, chords]);

  function handlePlay() {
    if (isPlaying) { handleStop(); return; }

    const result = scheduleNotes(notes);
    if (!result) return;

    audioCtxRef.current = result.ctx;
    setIsPlaying(true);

    // 재생 완료 후 자동 초기화
    playTimerRef.current = setTimeout(() => {
      setIsPlaying(false);
      audioCtxRef.current = null;
    }, result.totalSec * 1000 + 200);
  }

  function handleStop() {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsPlaying(false);
  }

  if (!notes || notes.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.label}>악보</Text>
        <View style={styles.btnRow}>
          {ready && (
            <TouchableOpacity
              style={[styles.playBtn, isPlaying && styles.playBtnStop]}
              onPress={handlePlay}
            >
              <Text style={styles.playBtnText}>{isPlaying ? "■ 정지" : "▶ 재생"}</Text>
            </TouchableOpacity>
          )}
          {ready && (
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={() => downloadAsPng(containerRef.current, `${filename}.png`)}
            >
              <Text style={styles.downloadText}>이미지 다운로드</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {error && <Text style={styles.errorText}>렌더링 오류: {error}</Text>}
      {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
      <div ref={containerRef} style={{ overflowX: "auto" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 24,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  label: { fontSize: 13, fontWeight: "bold", color: "#888" },
  playBtn: {
    backgroundColor: "#34C759",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  playBtnStop: {
    backgroundColor: "#E94F4F",
  },
  playBtnText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  downloadBtn: {
    backgroundColor: "#4F8EF7",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  downloadText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  errorText: { color: "red", fontSize: 12, marginBottom: 4 },
  sheetTitle: { fontSize: 16, fontWeight: "bold", color: "#1a1a2e", textAlign: "center", marginBottom: 6 },
});
