/**
 * SheetMusic.web.js — VexFlow 5 Factory API 기반 악보 렌더링 + PNG 다운로드
 */
import React, { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, StyleSheet, View } from "react-native";

// ── 변환 테이블 ──────────────────────────────────────────
const DURATION_MAP = {
  whole: "w", half: "h", quarter: "q",
  eighth: "8", "16th": "16", "32nd": "32",
};
const BEAT_VALUES = {
  w: 4, h: 2, q: 1, "8": 0.5, "16": 0.25, "32": 0.125,
};

function convertPitch(pitch) {
  const m = pitch.match(/^([A-G])(#{0,2}|b{0,2})(\d)$/);
  if (!m) return "b/4";
  return `${m[1].toLowerCase()}${m[2]}/${m[3]}`;
}

function convertDuration(dur) {
  return DURATION_MAP[dur] || "q";
}

function groupIntoMeasures(notes, beatsPerMeasure = 4) {
  const measures = [];
  let current = [];
  let beats = 0;

  for (const note of notes) {
    const vfDur = convertDuration(note.duration);
    const b = BEAT_VALUES[vfDur] ?? 1;

    if (beats + b > beatsPerMeasure + 0.001 && current.length > 0) {
      measures.push(padMeasure(current, beats, beatsPerMeasure));
      current = [];
      beats = 0;
    }

    current.push({ ...note, _vfDur: vfDur, _beats: b });
    beats += b;

    if (Math.abs(beats - beatsPerMeasure) < 0.001) {
      measures.push(current);
      current = [];
      beats = 0;
    }
  }

  if (current.length > 0) {
    measures.push(padMeasure(current, beats, beatsPerMeasure));
  }

  return measures;
}

function padMeasure(notes, usedBeats, total) {
  const remaining = total - usedBeats;
  if (remaining < 0.01) return notes;
  const restDur = beatsToRestDuration(remaining);
  return [...notes, {
    pitch: "rest", duration: restDur,
    _vfDur: convertDuration(restDur), _beats: remaining,
  }];
}

function beatsToRestDuration(beats) {
  if (beats >= 4) return "whole";
  if (beats >= 2) return "half";
  if (beats >= 1) return "quarter";
  if (beats >= 0.5) return "eighth";
  return "16th";
}

// ── PNG 다운로드 ──────────────────────────────────────────
function downloadAsPng(containerEl, filename) {
  // SVG → Canvas 변환
  const svgEl = containerEl.querySelector("svg");
  const canvasEl = containerEl.querySelector("canvas");

  if (canvasEl) {
    const a = document.createElement("a");
    a.href = canvasEl.toDataURL("image/png");
    a.download = filename;
    a.click();
    return;
  }

  if (svgEl) {
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const w = svgEl.clientWidth || 900;
    const h = svgEl.clientHeight || 300;
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = filename;
      a.click();
    };
    img.src = url;
  }
}

// ── 레이아웃 상수 ─────────────────────────────────────────
const STAVE_WIDTH = 200;
const STAVE_HEIGHT = 130;
const STAVES_PER_ROW = 4;
const CLEF_EXTRA = 65; // 첫 마디 클레프+박자표 여백

export default function SheetMusic({ notes, filename = "sheet_music" }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setReady(false);
    setError(null);
    if (!containerRef.current || !notes || notes.length === 0) return;

    (async () => {
      try {
        const VF = await import("vexflow");
        const { Factory, Stave, StaveNote, Voice, Formatter, Accidental } = VF;

        containerRef.current.innerHTML = "";

        const measures = groupIntoMeasures(notes);
        const rows = Math.ceil(measures.length / STAVES_PER_ROW);
        const totalW = STAVES_PER_ROW * STAVE_WIDTH + CLEF_EXTRA + 20;
        const totalH = rows * STAVE_HEIGHT + 40;

        // Factory가 폰트·렌더러를 올바르게 초기화함
        const vf = new Factory({
          renderer: { elementId: containerRef.current, width: totalW, height: totalH },
        });
        const ctx = vf.getContext();

        measures.forEach((measureNotes, idx) => {
          const row = Math.floor(idx / STAVES_PER_ROW);
          const col = idx % STAVES_PER_ROW;
          const isFirst = idx === 0;
          const staveW = isFirst ? STAVE_WIDTH + CLEF_EXTRA : STAVE_WIDTH;

          const x = col === 0 ? 10 : 10 + CLEF_EXTRA + col * STAVE_WIDTH;
          const y = row * STAVE_HEIGHT + 20;

          const stave = new Stave(x, y, staveW);
          if (isFirst) stave.addClef("treble").addTimeSignature("4/4");
          stave.setContext(ctx).draw();

          const vexNotes = measureNotes.map((n) => {
            const isRest = n.pitch === "rest";
            const dur = n._vfDur || convertDuration(n.duration);
            const sn = new StaveNote({
              keys: [isRest ? "b/4" : convertPitch(n.pitch)],
              duration: isRest ? `${dur}r` : dur,
            });
            if (!isRest) {
              const accMatch = n.pitch.match(/^[A-G](#{1,2}|b{1,2})\d$/);
              if (accMatch) sn.addModifier(new Accidental(accMatch[1]), 0);
            }
            return sn;
          });

          try {
            const voice = new Voice({ num_beats: 4, beat_value: 4 });
            voice.setStrict(false);
            voice.addTickables(vexNotes);
            new Formatter().joinVoices([voice]).format([voice], staveW - 30);
            voice.draw(ctx, stave);
          } catch (e) {
            console.warn(`[SheetMusic] 마디 ${idx + 1}:`, e.message);
          }
        });

        setReady(true);
      } catch (e) {
        console.error("[SheetMusic] 오류:", e);
        setError(e.message);
      }
    })();
  }, [notes]);

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
