import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";

// 음표 하나를 카드로 표시
function NoteCard({ note }) {
  const isRest = note.pitch === "rest";
  return (
    <View style={[styles.card, isRest && styles.restCard]}>
      <Text style={styles.pitch}>{isRest ? "쉼표" : note.pitch}</Text>
      <Text style={styles.duration}>{note.duration}</Text>
    </View>
  );
}

// 음표 전체 리스트
export default function NoteList({ notes }) {
  if (!notes || notes.length === 0) return null;

  return (
    <ScrollView horizontal style={styles.container}>
      {notes.map((note, index) => (
        <NoteCard key={index} note={note} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  card: {
    backgroundColor: "#4F8EF7",
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 4,
    alignItems: "center",
    minWidth: 60,
  },
  restCard: {
    backgroundColor: "#aaa",
  },
  pitch: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  duration: {
    color: "#dce8ff",
    fontSize: 11,
    marginTop: 4,
  },
});
