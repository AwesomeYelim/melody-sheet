// 백엔드 서버 주소
// 실제 기기에서 테스트할 경우 EXPO_PUBLIC_API_URL로 PC의 로컬 IP를 넘겨준다.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8000";
