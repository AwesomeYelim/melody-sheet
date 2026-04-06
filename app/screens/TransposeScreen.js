import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, ScrollView,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import axios from "axios";
import { API_URL } from "../config";
import NoteList from "../components/NoteList";
import SheetMusic from "../components/SheetMusic";
import { COLORS, SPACING, RADIUS, TYPO, SHADOW } from "../theme";

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
      <Text style={styles.subtitle}>MIDI 파일을 선택하고 원하는 키를 골라보세요</Text>

      {/* 키 선택 카드 */}
      <View style={styles.keyCard}>
        <Text style={styles.keyCardLabel}>변조할 키</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.keyScroll}>
          {KEYS.map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.keyChip, selectedKey === key && styles.keyChipActive]}
              onPress={() => setSelectedKey(key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.keyChipText, selectedKey === key && styles.keyChipTextActive]}>
                {key}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 파일 선택 + 변조 버튼 */}
      <TouchableOpacity
        style={styles.actionBtn}
        onPress={handlePickAndTranspose}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Text style={styles.actionBtnIcon}>{"\u{1F3B5}"}</Text>
        <Text style={styles.actionBtnText}>MIDI 파일 선택 후 변조</Text>
      </TouchableOpacity>

      {fileName && (
        <View style={styles.fileTag}>
          <Text style={styles.fileTagText}>{fileName}</Text>
        </View>
      )}

      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.secondary} />
          <Text style={styles.loadingText}>변조 중...</Text>
        </View>
      )}

      {resultInfo && (
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>원래 키</Text>
              <Text style={styles.infoValue}>{resultInfo.originalKey}</Text>
            </View>
            <Text style={styles.infoArrow}>{"\u2192"}</Text>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>변조 키</Text>
              <Text style={[styles.infoValue, { color: COLORS.secondary }]}>
                {resultInfo.targetKey}
              </Text>
            </View>
            <View style={styles.infoBadge}>
              <Text style={styles.infoBadgeText}>
                {resultInfo.semitones > 0 ? "+" : ""}{resultInfo.semitones} 반음
              </Text>
            </View>
          </View>
        </View>
      )}

      {notes.length > 0 && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <Text style={styles.resultTitle}>변조된 악보</Text>
            <View style={styles.resultBadge}>
              <Text style={styles.resultBadgeText}>{notes.length}개 음표</Text>
            </View>
          </View>
          <SheetMusic
            notes={notes}
            filename={fileName ? `${fileName.replace(/\.[^.]+$/, "")}_${resultInfo?.targetKey ?? ""}` : "sheet_music"}
          />
          <NoteList notes={notes} />
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

  // 키 선택 카드
  keyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    ...SHADOW.sm,
  },
  keyCardLabel: {
    ...TYPO.caption,
    color: COLORS.textTertiary,
    marginBottom: SPACING.md,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  keyScroll: {
    flexGrow: 0,
  },
  keyChip: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    marginRight: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  keyChipActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  keyChipText: {
    ...TYPO.bodyBold,
    color: COLORS.textSecondary,
  },
  keyChipTextActive: {
    color: COLORS.textInverse,
  },

  // 액션 버튼
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
    ...SHADOW.md,
  },
  actionBtnIcon: {
    fontSize: 18,
  },
  actionBtnText: {
    ...TYPO.bodyBold,
    color: COLORS.textInverse,
  },

  // 파일 태그
  fileTag: {
    backgroundColor: COLORS.secondaryBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    alignSelf: "flex-start",
    marginBottom: SPACING.md,
  },
  fileTagText: {
    ...TYPO.caption,
    color: COLORS.secondary,
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

  // 정보 카드
  infoCard: {
    backgroundColor: COLORS.secondaryBg,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.lg,
  },
  infoItem: {
    alignItems: "center",
  },
  infoLabel: {
    ...TYPO.small,
    color: COLORS.textTertiary,
    marginBottom: SPACING.xs,
  },
  infoValue: {
    ...TYPO.h2,
    color: COLORS.textPrimary,
  },
  infoArrow: {
    fontSize: 20,
    color: COLORS.textTertiary,
  },
  infoBadge: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  infoBadgeText: {
    ...TYPO.small,
    color: COLORS.textInverse,
    fontWeight: "600",
  },

  // 결과 카드
  resultCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
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
    backgroundColor: COLORS.secondaryBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  resultBadgeText: {
    ...TYPO.small,
    color: COLORS.secondary,
    fontWeight: "600",
  },
});
