import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, ScrollView, TextInput, Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Audio } from "expo-av";
import { API_URL } from "../config";
import SheetMusic from "../components/SheetMusic";
import { COLORS, SPACING, RADIUS, TYPO, SHADOW } from "../theme";

// ── 피치 감지 헬퍼 ──────────────────────────────────────
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const MIN_MIDI = 48; // C3
const MAX_MIDI = 84; // C6
const PITCH_RANGE = MAX_MIDI - MIN_MIDI;

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
  const [lyrics, setLyrics] = useState([]);
  const [selectedKey, setSelectedKey] = useState("auto");
  const [detectedKey, setDetectedKey] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [songTitle, setSongTitle] = useState("");
  const [midiFile, setMidiFile] = useState(null);
  const [bpm, setBpm] = useState(null);

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
  const [currentPitch, setCurrentPitch] = useState(0);
  const [currentNote, setCurrentNote] = useState(null);
  const [waveData, setWaveData] = useState([]);
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

      const timeBuf = new Uint8Array(analyser.frequencyBinCount);

      function loop(time) {
        pitchLoopRef.current = requestAnimationFrame(loop);
        if (time - lastTime < 50) return;
        lastTime = time;

        analyser.getByteTimeDomainData(timeBuf);
        const step = Math.floor(timeBuf.length / 40);
        const wave = [];
        for (let i = 0; i < 40; i++) {
          wave.push((timeBuf[i * step] - 128) / 128);
        }
        setWaveData(wave);

        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, ctx.sampleRate);

        if (freq > 60 && freq < 2000) {
          const midi = Math.round(12 * Math.log2(freq / 440) + 69);
          const normed = Math.max(0, Math.min(1, (midi - MIN_MIDI) / PITCH_RANGE));
          setCurrentNote(midiToNoteName(midi));
          setCurrentPitch(normed);
        } else {
          setCurrentPitch((prev) => prev * 0.85);
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
    setLyrics([]);
    setBpm(null);
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
      setLyrics(data.lyrics || []);
      setDetectedKey(data.detected_key || null);
      setMidiFile(data.midi_file || null);
      setBpm(data.bpm || null);
    } catch (error) {
      const msg = error.message || "분석 중 오류가 발생했습니다.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  function formatTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* 인트로 섹션 */}
      <Text style={styles.subtitle}>노래를 녹음하거나 파일을 올려보세요</Text>

      {/* 노래 제목 */}
      <View style={styles.inputCard}>
        <Text style={styles.inputLabel}>노래 제목</Text>
        <TextInput
          style={styles.titleInput}
          placeholder="선택 사항"
          placeholderTextColor={COLORS.textTertiary}
          value={songTitle}
          onChangeText={setSongTitle}
        />
      </View>

      {/* 액션 카드 */}
      <View style={styles.actionsCard}>
        {!isRecording ? (
          <>
            <TouchableOpacity
              style={styles.recordBtn}
              onPress={handleStartRecording}
              disabled={loading}
              activeOpacity={0.8}
            >
              <View style={styles.recordBtnInner}>
                <Text style={styles.recordBtnIcon}>{"\u23FA"}</Text>
              </View>
              <Text style={styles.recordBtnLabel}>녹음 시작</Text>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>또는</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.fileBtn}
              onPress={handlePickFile}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.fileBtnIcon}>{"\u{1F4C2}"}</Text>
              <Text style={styles.fileBtnText}>파일에서 불러오기</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.stopBtn}
            onPress={handleStopRecording}
            activeOpacity={0.8}
          >
            <View style={styles.stopBtnDot} />
            <Text style={styles.stopBtnText}>
              녹음 중  {formatTime(recordSeconds)}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 실시간 피치 시각화 (녹음 중) */}
      {isRecording && (
        <View style={styles.pitchCard}>
          <Text style={styles.pitchNote}>{currentNote || "--"}</Text>
          <View style={styles.waveArea}>
            <View
              style={[
                styles.pitchBall,
                { bottom: `${currentPitch * 80 + 5}%` },
                { backgroundColor: `hsl(${220 - currentPitch * 160}, 80%, 60%)` },
              ]}
            />
            <View style={styles.waveBars}>
              {waveData.map((v, i) => {
                const amp = Math.abs(v) * (0.5 + currentPitch * 0.5);
                const heightPx = Math.max(2, amp * 100);
                const hue = 220 - currentPitch * 160;
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
          <View style={styles.scaleRow}>
            <Text style={styles.scaleLabel}>Low</Text>
            <View style={styles.scaleLine} />
            <Text style={styles.scaleLabel}>High</Text>
          </View>
        </View>
      )}

      {fileName && !isRecording && (
        <View style={styles.fileTag}>
          <Text style={styles.fileTagText}>{fileName}</Text>
        </View>
      )}

      {/* Key 선택 */}
      {!isRecording && (
        <View style={styles.keySection}>
          <Text style={styles.keyLabel}>Key</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {KEY_OPTIONS.map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.keyChip, selectedKey === k && styles.keyChipActive]}
                onPress={() => setSelectedKey(k)}
                activeOpacity={0.7}
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
        <View style={styles.detectedKeyTag}>
          <Text style={styles.detectedKeyText}>감지된 키: {detectedKey}</Text>
        </View>
      )}

      {/* 에러 */}
      {errorMsg && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {/* 로딩 */}
      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>분석 중... (최대 1분 소요)</Text>
        </View>
      )}

      {/* 결과 */}
      {notes.length > 0 && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <Text style={styles.resultTitle}>악보</Text>
            <View style={styles.resultBadge}>
              <Text style={styles.resultBadgeText}>{notes.length}개 음표</Text>
            </View>
          </View>
          <SheetMusic
            notes={notes}
            chords={chords}
            lyrics={lyrics}
            title={songTitle}
            filename={songTitle || (fileName ? fileName.replace(/\.[^.]+$/, "") : "sheet_music")}
            midiFile={midiFile}
            bpm={bpm}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: SPACING.xxl,
    paddingBottom: SPACING.xxxl,
    backgroundColor: COLORS.bg,
  },
  subtitle: {
    ...TYPO.body,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xl,
  },

  // 입력 카드
  inputCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    ...SHADOW.sm,
  },
  inputLabel: {
    ...TYPO.caption,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  titleInput: {
    ...TYPO.body,
    color: COLORS.textPrimary,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  // 액션 카드
  actionsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xxl,
    marginBottom: SPACING.lg,
    alignItems: "center",
    ...SHADOW.sm,
  },
  recordBtn: {
    alignItems: "center",
    marginBottom: SPACING.xl,
  },
  recordBtnInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.danger,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md,
    ...SHADOW.md,
  },
  recordBtnIcon: {
    fontSize: 28,
    color: COLORS.textInverse,
  },
  recordBtnLabel: {
    ...TYPO.bodyBold,
    color: COLORS.textPrimary,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginBottom: SPACING.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    ...TYPO.caption,
    color: COLORS.textTertiary,
    marginHorizontal: SPACING.lg,
  },
  fileBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: "dashed",
    gap: SPACING.sm,
  },
  fileBtnIcon: {
    fontSize: 18,
  },
  fileBtnText: {
    ...TYPO.bodyBold,
    color: COLORS.textSecondary,
  },

  // 녹음 중지 버튼
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingVertical: SPACING.lg,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.danger,
    gap: SPACING.md,
  },
  stopBtnDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.textInverse,
  },
  stopBtnText: {
    ...TYPO.bodyBold,
    color: COLORS.textInverse,
  },

  // 피치 시각화
  pitchCard: {
    backgroundColor: COLORS.pitchBg,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    alignItems: "center",
  },
  pitchNote: {
    color: COLORS.pitchAccent,
    fontSize: 28,
    fontWeight: "700",
    marginBottom: SPACING.sm,
  },
  waveArea: {
    width: "100%",
    height: 140,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  pitchBall: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    left: "50%",
    marginLeft: -10,
    shadowColor: COLORS.pitchAccent,
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
    width: 4,
    borderRadius: 2,
    minHeight: 2,
  },
  scaleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: SPACING.sm,
    width: "100%",
  },
  scaleLabel: {
    ...TYPO.small,
    color: COLORS.textTertiary,
  },
  scaleLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#1E293B",
    marginHorizontal: SPACING.sm,
  },

  // 파일 태그
  fileTag: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    alignSelf: "flex-start",
    marginBottom: SPACING.md,
  },
  fileTagText: {
    ...TYPO.caption,
    color: COLORS.primary,
  },

  // Key 선택
  keySection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: SPACING.md,
  },
  keyLabel: {
    ...TYPO.bodyBold,
    color: COLORS.textSecondary,
    marginRight: SPACING.md,
    minWidth: 32,
  },
  keyChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    marginRight: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  keyChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  keyChipText: {
    ...TYPO.caption,
    color: COLORS.textSecondary,
  },
  keyChipTextActive: {
    color: COLORS.textInverse,
    fontWeight: "600",
  },
  detectedKeyTag: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    alignSelf: "flex-start",
    marginBottom: SPACING.md,
  },
  detectedKeyText: {
    ...TYPO.caption,
    color: COLORS.primary,
    fontWeight: "600",
  },

  // 에러
  errorCard: {
    backgroundColor: COLORS.dangerBg,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    marginTop: SPACING.lg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
  },
  errorText: {
    ...TYPO.body,
    color: COLORS.danger,
  },

  // 로딩
  loadingBox: {
    marginTop: SPACING.xxxl,
    alignItems: "center",
    gap: SPACING.md,
  },
  loadingText: {
    ...TYPO.caption,
    color: COLORS.textTertiary,
  },

  // 결과
  resultCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    marginTop: SPACING.xxl,
    ...SHADOW.sm,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.lg,
  },
  resultTitle: {
    ...TYPO.h2,
    color: COLORS.textPrimary,
  },
  resultBadge: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  resultBadgeText: {
    ...TYPO.small,
    color: COLORS.primary,
    fontWeight: "600",
  },
});
