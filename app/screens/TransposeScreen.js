import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, ScrollView,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import axios from "axios";
import { API_URL } from "../config";
import NoteList from "../components/NoteList";

const KEYS = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];

export default function TransposeScreen() {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [selectedKey, setSelectedKey] = useState("G");
  const [fileName, setFileName] = useState(null);
  const [resultInfo, setResultInfo] = useState(null);

  async function handlePickAndTranspose() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/midi", "audio/*", "*/*"],
      });

      if (result.canceled) return;

      const file = result.assets[0];
      setFileName(file.name);
      setLoading(true);
      setNotes([]);
      setResultInfo(null);

      const formData = new FormData();
      formData.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || "audio/midi",
      });
      formData.append("target_key", selectedKey);

      const response = await axios.post(`${API_URL}/api/transpose`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 30000,
      });

      setNotes(response.data.notes);
      setResultInfo({
        originalKey: response.data.original_key,
        targetKey: response.data.target_key,
        semitones: response.data.semitones,
      });
    } catch (error) {
      Alert.alert("오류", error.message || "변조 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>악보 키 변조</Text>
      <Text style={styles.subtitle}>MIDI 파일을 선택하고 원하는 키를 고르세요</Text>

      {/* 키 선택 */}
      <Text style={styles.sectionLabel}>변조할 키 선택</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.keyScroll}>
        {KEYS.map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.keyButton, selectedKey === key && styles.keyButtonActive]}
            onPress={() => setSelectedKey(key)}
          >
            <Text style={[styles.keyButtonText, selectedKey === key && styles.keyButtonTextActive]}>
              {key}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.button} onPress={handlePickAndTranspose} disabled={loading}>
        <Text style={styles.buttonText}>🎼 MIDI 파일 선택 후 변조</Text>
      </TouchableOpacity>

      {fileName && <Text style={styles.fileLabel}>선택된 파일: {fileName}</Text>}

      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#7C4FE0" />
          <Text style={styles.loadingText}>변조 중...</Text>
        </View>
      )}

      {resultInfo && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            {resultInfo.originalKey}장조 → {resultInfo.targetKey}장조 ({resultInfo.semitones > 0 ? "+" : ""}{resultInfo.semitones} 반음)
          </Text>
        </View>
      )}

      {notes.length > 0 && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>변조된 음표 ({notes.length}개)</Text>
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
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#444",
    marginBottom: 10,
  },
  keyScroll: {
    marginBottom: 24,
  },
  keyButton: {
    borderWidth: 1.5,
    borderColor: "#7C4FE0",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  keyButtonActive: {
    backgroundColor: "#7C4FE0",
  },
  keyButtonText: {
    color: "#7C4FE0",
    fontWeight: "bold",
  },
  keyButtonTextActive: {
    color: "#fff",
  },
  button: {
    backgroundColor: "#7C4FE0",
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
  infoBox: {
    marginTop: 20,
    backgroundColor: "#ede9ff",
    borderRadius: 8,
    padding: 12,
  },
  infoText: {
    color: "#7C4FE0",
    fontWeight: "bold",
    fontSize: 15,
  },
  resultBox: {
    marginTop: 24,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1a1a2e",
    marginBottom: 8,
  },
});
