import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <View style={s.root}><Text style={s.title}>Не удалось показать FileBe</Text><Text style={s.text}>Файлы не удалены. Перезапустите приложение. Если ошибка повторится, сохраните копию данных перед переустановкой.</Text><Pressable accessibilityRole="button" style={s.button} onPress={() => this.setState({ failed: false })}><Text>Повторить</Text></Pressable></View>;
  }
}
const s = StyleSheet.create({ root: { flex: 1, justifyContent: 'center', padding: 28, gap: 20, backgroundColor: '#eff4fc' }, title: { fontSize: 24, fontWeight: '700' }, text: { fontSize: 16, lineHeight: 24 }, button: { backgroundColor: '#a8c7fa', padding: 16, borderRadius: 16, alignItems: 'center' } });
