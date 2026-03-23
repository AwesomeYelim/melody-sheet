import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, ScrollView,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import axios from "axios";
import { API_URL } from "../config";
import NoteList from "../components/NoteList";

export default function AudioToSheetScreen() {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [midiFile, setMidiFile] = useState(null);
  const [fileName, setFileName] = useState(null);

  // 파일 선택 후 API 호출
  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/mpeg", "audio/wav", "audio/*"],
      });

      if (result.canceled) return;

      const file = result.assets[0];
      setFileName(file.name);
      setLoading(true);
      setNotes([]);
      setMidiFile(null);

      const formData = new FormData();
      formData.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || "audio/mpeg",
      });

      const response = await axios.post(`${API_URL}/api/audio-to-sheet`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });

      setNotes(response.data.notes);
      setMidiFile(response.data.midi_file);
    } catch (error) {
      Alert.alert("오류", error.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>멜로디 → 악보</Text>
      <Text style={styles.subtitle}>MP3 또는 WAV 파일을 선택하면{"\n"}음표로 변환해드립니다</Text>

      <TouchableOpacity style={styles.button} onPress={handlePickFile} disabled={loading}>
        <Text style={styles.buttonText}>🎵 오디오 파일 선택</Text>
      </TouchableOpacity>

      {fileName && <Text style={styles.fileLabel}>선택된 파일: {fileName}</Text>}

      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#4F8EF7" />
          <Text style={styles.loadingText}>분석 중... (최대 1분 소요)</Text>
        </View>
      )}

      {notes.length > 0 && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>추출된 음표 ({notes.length}개)</Text>
          <NoteList notes={notes} />
          {midiFile && (
            <Text style={styles.midiLabel}>MIDI 파일: {midiFile}</Text>
          )}
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
    backgroundColor: "#4F8EF7",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  fileLabel: {
    marginTop: 12,
    fontSize: 13,
    color: "#555",
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
  midiLabel: {
    marginTop: 16,
    fontSize: 12,
    color: "#888",
  },
});
