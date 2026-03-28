import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, ScrollView, TextInput, Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Audio } from "expo-av";
import { API_URL } from "../config";
import SheetMusic from "../components/SheetMusic";

// ── 피치 감지 헬퍼 ──────────────────────────────────────
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const MIN_MIDI = 48; // C3
const MAX_MIDI = 84; // C6
const PITCH_RANGE = MAX_MIDI - MIN_MIDI;
const MAX_HISTORY = 80;

function autoCorrelate(buf, sampleRate) {
  let SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < 0.2) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < 0.2) { r2 = SIZE - i; break; }
  }

  buf = buf.slice(r1, r2);
  SIZE = buf.length;
  if (SIZE < 2) return -1;

  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE - i; j++) {
      c[i] += buf[j] * buf[j + i];
    }
  }

  let d = 0;
  while (d < SIZE - 1 && c[d] > c[d + 1]) d++;

  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  if (maxpos < 1 || maxpos >= SIZE - 1) return -1;

  let T0 = maxpos;
  const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  return sampleRate / T0;
}

function midiToNoteName(midi) {
  if (midi < 0) return "";
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

// ── 메인 컴포넌트 ────────────────────────────────────────
export default function AudioToSheetScreen() {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [chords, setChords] = useState([]);
  const [selectedKey, setSelectedKey] = useState("auto");
  const [detectedKey, setDetectedKey] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [songTitle, setSongTitle] = useState("");
  const [midiFile, setMidiFile] = useState(null);

  const KEY_OPTIONS = [
    "auto",
    "C", "G", "D", "A", "E", "B", "F#",
    "F", "Bb", "Eb", "Ab", "Db",
    "Am", "Em", "Bm", "F#m", "C#m",
    "Dm", "Gm", "Cm",
  ];

  // 녹음 관련 상태
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordingRef = useRef(null);
  const timerRef = useRef(null);

  // 피치 감지 상태
  const [currentPitch, setCurrentPitch] = useState(0); // 0~1 정규화된 피치
  const [currentNote, setCurrentNote] = useState(null);
  const [waveData, setWaveData] = useState([]); // 파형 데이터
  const audioCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const pitchLoopRef = useRef(null);
  const analyserRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync();
      stopPitchDetection();
    };
  }, []);

  // ── 피치 감지 시작/종료 (웹 전용) ──────────────────────
  async function startPitchDetection() {
    if (Platform.OS !== "web") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      let lastTime = 0;

      analyserRef.current = analyser;
      setCurrentPitch(0);
      setCurrentNote(null);
      setWaveData([]);

      // 파형 + 주파수 데이터 버퍼
      const timeBuf = new Uint8Array(analyser.frequencyBinCount);

      function loop(time) {
        pitchLoopRef.current = requestAnimationFrame(loop);
        if (time - lastTime < 50) return; // ~20fps
        lastTime = time;

        // 파형 데이터 (출렁거리는 시각화용)
        analyser.getByteTimeDomainData(timeBuf);
        const step = Math.floor(timeBuf.length / 40);
        const wave = [];
        for (let i = 0; i < 40; i++) {
          wave.push((timeBuf[i * step] - 128) / 128); // -1 ~ 1
        }
        setWaveData(wave);

        // 피치 감지
        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, ctx.sampleRate);

        if (freq > 60 && freq < 2000) {
          const midi = Math.round(12 * Math.log2(freq / 440) + 69);
          const normed = Math.max(0, Math.min(1, (midi - MIN_MIDI) / PITCH_RANGE));
          setCurrentNote(midiToNoteName(midi));
          setCurrentPitch(normed);
        } else {
          setCurrentPitch((prev) => prev * 0.85); // 부드럽게 감소
        }
      }
      pitchLoopRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.warn("Pitch detection failed:", e);
    }
  }

  function stopPitchDetection() {
    if (pitchLoopRef.current) {
      cancelAnimationFrame(pitchLoopRef.current);
      pitchLoopRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }

  // ── 파일 선택 ──────────────────────────────────────────
  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/*"],
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      setFileName(asset.name);

      if (asset.file) {
        await sendToApi(asset.file);
      } else {
        await sendToApi({
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || "audio/mpeg",
        });
      }
    } catch (error) {
      Alert.alert("오류", error.message || "파일 선택 중 오류가 발생했습니다.");
    }
  }

  // ── 녹음 시작 ──────────────────────────────────────────
  async function handleStartRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert("권한 필요", "마이크 접근 권한이 필요합니다.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
      setRecordSeconds(0);
      setNotes([]);
      setErrorMsg(null);
      setFileName(null);

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);

      await startPitchDetection();
    } catch (error) {
      Alert.alert("오류", error.message || "녹음을 시작할 수 없습니다.");
    }
  }

  // ── 녹음 중지 ──────────────────────────────────────────
  async function handleStopRecording() {
    try {
      clearInterval(timerRef.current);
      setIsRecording(false);
      stopPitchDetection();

      const recording = recordingRef.current;
      await recording.stopAndUnloadAsync();

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recording.getURI();
      const name = `recording_${Date.now()}.m4a`;
      setFileName(name);

      if (Platform.OS === "web") {
        // 웹: blob URI → File 객체로 변환
        const resp = await fetch(uri);
        const blob = await resp.blob();
        const file = new File([blob], name, { type: "audio/mp4" });
        await sendToApi(file);
      } else {
        await sendToApi({ uri, name, type: "audio/m4a" });
      }
    } catch (error) {
      Alert.alert("오류", error.message || "녹음 중지 중 오류가 발생했습니다.");
    } finally {
      recordingRef.current = null;
    }
  }

  // ── API 전송 (공통) ────────────────────────────────────
  async function sendToApi(fileOrObj) {
    setLoading(true);
    setNotes([]);
    setChords([]);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", fileOrObj);
      if (selectedKey !== "auto") formData.append("key", selectedKey);

      const res = await fetch(`${API_URL}/api/audio-to-sheet`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = typeof err.detail === "string"
          ? err.detail
          : JSON.stringify(err.detail) || `서버 오류 ${res.status}`;
        throw new Error(detail);
      }

      const data = await res.json();
      setNotes(data.notes);
      setChords(data.chords || []);
      setDetectedKey(data.detected_key || null);
      setMidiFile(data.midi_file || null);
    } catch (error) {
      const msg = error.message || "분석 중 오류가 발생했습니다.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  // ── 타이머 포맷 ────────────────────────────────────────
  function formatTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>멜로디 → 악보</Text>
      <Text style={styles.subtitle}>마이크로 녹음하거나 파일을 선택하세요</Text>

      {/* 노래 제목 입력 */}
      <TextInput
        style={styles.titleInput}
        placeholder="노래 제목 입력 (선택)"
        placeholderTextColor="#aaa"
        value={songTitle}
        onChangeText={setSongTitle}
      />

      {/* 녹음 버튼 */}
      {!isRecording ? (
        <TouchableOpacity
          style={[styles.button, styles.recordButton]}
          onPress={handleStartRecording}
          disabled={loading}
        >
          <Text style={styles.buttonText}>🎙 녹음 시작</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.button, styles.stopButton]}
          onPress={handleStopRecording}
        >
          <View style={styles.recordingRow}>
            <View style={styles.recordingDot} />
            <Text style={styles.buttonText}>
              녹음 중... {formatTime(recordSeconds)}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* 실시간 피치 시각화 (녹음 중) */}
      {isRecording && (
        <View style={styles.pitchContainer}>
          {/* 현재 음이름 */}
          <Text style={styles.pitchCurrentNote}>
            {currentNote || "--"}
          </Text>

          {/* 출렁거리는 웨이브 */}
          <View style={styles.waveArea}>
            {/* 피치 높이 인디케이터 (원) */}
            <View
              style={[
                styles.pitchBall,
                { bottom: `${currentPitch * 80 + 5}%` },
                { backgroundColor: `hsl(${200 - currentPitch * 200}, 75%, 55%)` },
              ]}
            />
            {/* 파형 바 */}
            <View style={styles.waveBars}>
              {waveData.map((v, i) => {
                const amp = Math.abs(v) * (0.5 + currentPitch * 0.5);
                const heightPx = Math.max(2, amp * 100);
                const hue = 200 - currentPitch * 200;
                const dist = Math.abs(i - 20) / 20;
                const opacity = 1 - dist * 0.5;
                return (
                  <View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: heightPx,
                        backgroundColor: `hsla(${hue}, 70%, 60%, ${opacity})`,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>

          {/* 스케일 라벨 */}
          <View style={styles.scaleRow}>
            <Text style={styles.scaleLabel}>낮음</Text>
            <View style={styles.scaleLine} />
            <Text style={styles.scaleLabel}>높음</Text>
          </View>
        </View>
      )}

      {/* 파일 선택 버튼 */}
      {!isRecording && (
        <TouchableOpacity
          style={[styles.button, styles.fileButton]}
          onPress={handlePickFile}
          disabled={loading}
        >
          <Text style={[styles.buttonText, styles.fileButtonText]}>
            🎵 파일에서 불러오기
          </Text>
        </TouchableOpacity>
      )}

      {fileName && !isRecording && (
        <Text style={styles.fileLabel}>파일: {fileName}</Text>
      )}

      {/* Key 선택 */}
      {!isRecording && (
        <View style={styles.keyRow}>
          <Text style={styles.keyLabel}>Key</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.keyScroll}>
            {KEY_OPTIONS.map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.keyChip, selectedKey === k && styles.keyChipActive]}
                onPress={() => setSelectedKey(k)}
              >
                <Text style={[styles.keyChipText, selectedKey === k && styles.keyChipTextActive]}>
                  {k === "auto" ? "자동" : k}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {detectedKey && selectedKey === "auto" && (
        <Text style={styles.detectedKeyLabel}>감지된 키: {detectedKey}</Text>
      )}

      {errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>오류: {errorMsg}</Text>
        </View>
      )}

      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#4F8EF7" />
          <Text style={styles.loadingText}>분석 중... (최대 1분 소요)</Text>
        </View>
      )}

      {notes.length > 0 && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>추출된 음표 ({notes.length}개)</Text>
          <SheetMusic notes={notes} chords={chords} title={songTitle} filename={songTitle || (fileName ? fileName.replace(/\.[^.]+$/, "") : "sheet_music")} midiFile={midiFile} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: "#f8f9ff",
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1a1a2e",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 32,
    lineHeight: 22,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  recordButton: {
    backgroundColor: "#E94F4F",
  },
  stopButton: {
    backgroundColor: "#E94F4F",
    opacity: 0.85,
  },
  fileButton: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#4F8EF7",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  fileButtonText: {
    color: "#4F8EF7",
  },
  recordingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
    opacity: 0.9,
  },
  fileLabel: {
    marginTop: 4,
    marginBottom: 8,
    fontSize: 13,
    color: "#555",
  },
  // ── 피치 시각화 스타일 ──────────────────────────
  pitchContainer: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
  },
  pitchCurrentNote: {
    color: "#4FD1C5",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
  },
  waveArea: {
    width: "100%",
    height: 160,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  pitchBall: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    left: "50%",
    marginLeft: -12,
    shadowColor: "#4FD1C5",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    zIndex: 2,
  },
  waveBars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: "100%",
    zIndex: 1,
  },
  waveBar: {
    width: 5,
    borderRadius: 3,
    minHeight: 2,
  },
  scaleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    width: "100%",
  },
  scaleLabel: {
    color: "#555",
    fontSize: 10,
  },
  scaleLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#333",
    marginHorizontal: 8,
  },
  // ── 기존 스타일 ──────────────────────────────────
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 4,
  },
  keyLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#555",
    marginRight: 8,
    minWidth: 28,
  },
  keyScroll: { flexGrow: 1 },
  keyChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#ccc",
    marginRight: 6,
    backgroundColor: "#fff",
  },
  keyChipActive: {
    backgroundColor: "#4F8EF7",
    borderColor: "#4F8EF7",
  },
  keyChipText: { fontSize: 12, color: "#555" },
  keyChipTextActive: { color: "#fff", fontWeight: "bold" },
  detectedKeyLabel: {
    fontSize: 12,
    color: "#4F8EF7",
    marginBottom: 6,
  },
  errorBox: {
    marginTop: 16,
    backgroundColor: "#fff0f0",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#ffcccc",
  },
  errorText: {
    color: "#cc0000",
    fontSize: 13,
  },
  titleInput: {
    borderWidth: 1.5,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a2e",
    backgroundColor: "#fff",
    marginBottom: 20,
  },
  loadingBox: {
    marginTop: 40,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#888",
    fontSize: 14,
  },
  resultBox: {
    marginTop: 32,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1a1a2e",
    marginBottom: 8,
  },
});
