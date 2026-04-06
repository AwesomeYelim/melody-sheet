import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { StatusBar } from "expo-status-bar";
import AudioToSheetScreen from "./screens/AudioToSheetScreen";
import TransposeScreen from "./screens/TransposeScreen";
import { COLORS, SPACING, RADIUS, TYPO, SHADOW } from "./theme";

export default function App() {
  const [tab, setTab] = useState("audio"); // "audio" | "transpose"

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Melody Sheet</Text>
      </View>

      {/* 화면 */}
      <View style={styles.content}>
        {tab === "audio" ? <AudioToSheetScreen /> : <TransposeScreen />}
      </View>

      {/* 하단 탭 바 */}
      <View style={styles.tabBarWrap}>
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === "audio" && styles.tabActive]}
            onPress={() => setTab("audio")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, tab === "audio" && styles.tabIconActive]}>
              {"\u266B"}
            </Text>
            <Text style={[styles.tabText, tab === "audio" && styles.tabTextActive]}>
              악보 변환
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, tab === "transpose" && styles.tabActive]}
            onPress={() => setTab("transpose")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, tab === "transpose" && styles.tabIconActive]}>
              {"\u266F"}
            </Text>
            <Text style={[styles.tabText, tab === "transpose" && styles.tabTextActive]}>
              키 변조
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingHorizontal: SPACING.xxl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  headerTitle: {
    ...TYPO.h1,
    color: COLORS.textPrimary,
  },
  content: {
    flex: 1,
  },
  tabBarWrap: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.bg,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xs,
    ...SHADOW.md,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    gap: SPACING.sm,
  },
  tabActive: {
    backgroundColor: COLORS.primary,
  },
  tabIcon: {
    fontSize: 18,
    color: COLORS.textTertiary,
  },
  tabIconActive: {
    color: COLORS.textInverse,
  },
  tabText: {
    ...TYPO.bodyBold,
    color: COLORS.textTertiary,
  },
  tabTextActive: {
    color: COLORS.textInverse,
  },
});
