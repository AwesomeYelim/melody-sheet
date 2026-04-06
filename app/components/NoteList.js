import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { COLORS, SPACING, RADIUS, TYPO, SHADOW } from "../theme";

// 음표 하나를 카드로 표시
function NoteCard({ note }) {
  const isRest = note.pitch === "rest";
  return (
    <View style={[styles.card, isRest && styles.restCard]}>
      <Text style={[styles.pitch, isRest && styles.restPitch]}>
        {isRest ? "쉼표" : note.pitch}
      </Text>
      <Text style={[styles.duration, isRest && styles.restDuration]}>
        {note.duration}
      </Text>
    </View>
  );
}

// 음표 전체 리스트
export default function NoteList({ notes }) {
  if (!notes || notes.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.container}>
      {notes.map((note, index) => (
        <NoteCard key={index} note={note} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    marginRight: SPACING.sm,
    alignItems: "center",
    minWidth: 56,
  },
  restCard: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pitch: {
    ...TYPO.bodyBold,
    color: COLORS.textInverse,
  },
  restPitch: {
    color: COLORS.textTertiary,
  },
  duration: {
    ...TYPO.small,
    color: "rgba(255,255,255,0.7)",
    marginTop: SPACING.xs,
  },
  restDuration: {
    color: COLORS.textTertiary,
  },
});
