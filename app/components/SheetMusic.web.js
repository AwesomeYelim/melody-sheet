/**
 * SheetMusic.web.js — VexFlow 5 EasyScore API 기반 악보 렌더링 + PNG 다운로드
 * VexFlow는 index.html의 <script src="/vexflow-bravura.js"> 로 로드 → window.VexFlow
 */
import React, { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, StyleSheet, View } from "react-native";

// ── 상수 ──────────────────────────────────────────────────
const STAVE_HEIGHT = 140;
const STAVES_PER_ROW = 4;
const BEATS_PER_MEASURE = 4;
const MIN_STAVE_W = 160;
const NOTE_PX = 32; // 음표/쉼표 1개당 픽셀

// music21 duration → EasyScore duration
const DUR_MAP = {
  whole: "w", half: "h", quarter: "q",
  eighth: "8", "16th": "16", "32nd": "32",
};
// 부동소수점 오류 방지: 박자를 32분음표 단위(정수)로 관리
const DUR_UNITS = { w: 32, h: 16, q: 8, "8": 4, "16": 2, "32": 1 };
const MEASURE_UNITS = BEATS_PER_MEASURE * 8; // 4/4박자 = 32 units

function toEasyPitch(pitch) {
  // music21: 'C-4' → 'Cb4', 'E--4' → 'Ebb4', 더블샵/플랫도 처리
  return pitch.replace(/-/g, "b");
}

function toEasyDur(dur) {
  return DUR_MAP[dur] || "q";
}

// 마디별 { noteStr, startTime, tokenCount } 반환
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

// 마디 넓이 계산 (음표 수 기반)
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
export default function SheetMusic({ notes, chords = [], filename = "sheet_music" }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

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

        // 캔버스 크기: 행별 넓이 합산 → 최대값
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

          // x 좌표: 해당 행의 이전 마디 넓이 합산
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

            // 코드 심볼 (마디 첫 음표 위)
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
            // 각 행 시작마다 음자리표, 첫 마디에만 박자표
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
  }, [notes, chords]); // chords 변경 시도 재렌더링

  if (!notes || notes.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.label}>악보</Text>
        {ready && (
          <TouchableOpacity
            style={styles.downloadBtn}
            onPress={() => downloadAsPng(containerRef.current, `${filename}.png`)}
          >
            <Text style={styles.downloadText}>이미지 다운로드</Text>
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.errorText}>렌더링 오류: {error}</Text>}
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
  label: { fontSize: 13, fontWeight: "bold", color: "#888" },
  downloadBtn: {
    backgroundColor: "#4F8EF7",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  downloadText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  errorText: { color: "red", fontSize: 12, marginBottom: 4 },
});
