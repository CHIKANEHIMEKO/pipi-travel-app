import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    // 確保最外層有 GestureHandlerRootView 且 flex: 1
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ 
        headerShown: false, // ✅ 這裡設定為 false，就不會再出現 "index" 字樣
        contentStyle: { backgroundColor: '#FFFDF8' } 
      }}>
        {/* 指向您的主頁面 */}
        <Stack.Screen name="index" />
      </Stack>
      <StatusBar style="dark" />
    </GestureHandlerRootView>
  );
}