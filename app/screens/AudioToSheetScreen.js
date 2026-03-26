import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, ScrollView,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Audio } from "expo-av";
import axios from "axios";
import { API_URL } from "../config";
import NoteList from "../components/NoteList";
import SheetMusic from "../components/SheetMusic";

export default function AudioToSheetScreen() {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [fileName, setFileName] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // 녹음 관련 상태
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordingRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      // 언마운트 시 정리
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync();
    };
  }, []);

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
        // 웹: native File 객체를 그대로 전달
        await sendToApi(asset.file);
      } else {
        // 모바일: uri/name/type 구조로 전달
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
    } catch (error) {
      Alert.alert("오류", error.message || "녹음을 시작할 수 없습니다.");
    }
  }

  // ── 녹음 중지 ──────────────────────────────────────────
  async function handleStopRecording() {
    try {
      clearInterval(timerRef.current);
      setIsRecording(false);

      const recording = recordingRef.current;
      await recording.stopAndUnloadAsync();

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recording.getURI();
      const name = `recording_${Date.now()}.m4a`;
      setFileName(name);

      await sendToApi({ uri, name, type: "audio/m4a" });
    } catch (error) {
      Alert.alert("오류", error.message || "녹음 중지 중 오류가 발생했습니다.");
    } finally {
      recordingRef.current = null;
    }
  }

  // ── API 전송 (공통) ────────────────────────────────────
  // fileOrObj: 웹은 native File 객체, 모바일은 { uri, name, type }
  async function sendToApi(fileOrObj) {
    setLoading(true);
    setNotes([]);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", fileOrObj);

      const res = await fetch(`${API_URL}/api/audio-to-sheet`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `서버 오류 ${res.status}`);
      }

      const data = await res.json();
      setNotes(data.notes);
    } catch (error) {
      const msg = error.response?.data?.detail || error.message || "분석 중 오류가 발생했습니다.";
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
          <SheetMusic notes={notes} filename={fileName ? fileName.replace(/\.[^.]+$/, "") : "sheet_music"} />
          <NoteList notes={notes} />
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
