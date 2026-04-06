/**
 * melody-sheet 공통 디자인 토큰
 * 모든 화면/컴포넌트에서 import하여 사용
 */

export const COLORS = {
  // 브랜드
  primary:      "#6366F1",   // Indigo
  primaryLight: "#818CF8",
  primaryBg:    "#EEF2FF",
  secondary:    "#8B5CF6",   // Violet
  secondaryBg:  "#F5F3FF",

  // 시맨틱
  danger:       "#EF4444",
  dangerBg:     "#FEF2F2",
  success:      "#10B981",
  successBg:    "#ECFDF5",
  warning:      "#F59E0B",

  // 표면
  bg:           "#F8FAFC",
  surface:      "#FFFFFF",
  surfaceAlt:   "#F1F5F9",

  // 텍스트
  textPrimary:  "#0F172A",
  textSecondary:"#475569",
  textTertiary: "#94A3B8",
  textInverse:  "#FFFFFF",

  // 보더 & 구분선
  border:       "#E2E8F0",
  borderLight:  "#F1F5F9",
  divider:      "#E2E8F0",

  // 피치 시각화
  pitchBg:      "#0F172A",
  pitchAccent:  "#38BDF8",
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
};

export const TYPO = {
  h1:       { fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  h2:       { fontSize: 18, fontWeight: "700" },
  h3:       { fontSize: 16, fontWeight: "600" },
  body:     { fontSize: 15, fontWeight: "400", lineHeight: 22 },
  bodyBold: { fontSize: 15, fontWeight: "600" },
  caption:  { fontSize: 13, fontWeight: "400" },
  small:    { fontSize: 11, fontWeight: "500" },
};

export const SHADOW = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
};
