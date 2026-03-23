import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { StatusBar } from "expo-status-bar";
import AudioToSheetScreen from "./screens/AudioToSheetScreen";
import TransposeScreen from "./screens/TransposeScreen";

export default function App() {
  const [tab, setTab] = useState("audio"); // "audio" | "transpose"

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🎵 Melody Sheet</Text>
      </View>

      {/* 탭 */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === "audio" && styles.tabActive]}
          onPress={() => setTab("audio")}
        >
          <Text style={[styles.tabText, tab === "audio" && styles.tabTextActive]}>
            멜로디 → 악보
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "transpose" && styles.tabActive]}
          onPress={() => setTab("transpose")}
        >
          <Text style={[styles.tabText, tab === "transpose" && styles.tabTextActive]}>
            키 변조
          </Text>
        </TouchableOpacity>
      </View>

      {/* 화면 */}
      <View style={styles.content}>
        {tab === "audio" ? <AudioToSheetScreen /> : <TransposeScreen />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1a1a2e",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#4F8EF7",
  },
  tabText: {
    fontSize: 14,
    color: "#aaa",
    fontWeight: "bold",
  },
  tabTextActive: {
    color: "#4F8EF7",
  },
  content: {
    flex: 1,
  },
});
