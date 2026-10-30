import React, { useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
export default function Editor({ name, value, onChange, onSave, dirty, onClose }) {
  const input = useRef(null);
  const selection = useRef({ start: 0, end: 0 });
  const history = useRef({ undo: [], redo: [] });
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [tools, setTools] = useState(false);
  const gutter = useRef(null);
  function change(next) {
    history.current.undo.push(value);
    if (history.current.undo.length > 80) history.current.undo.shift();
    history.current.redo = [];
    onChange(next);
  }
  function travel(from, to) {
    const stack = history.current[from];
    if (!stack.length) return;
    history.current[to].push(value);
    onChange(stack.pop());
  }
  function insert(text) {
    const { start, end } = selection.current;
    change(value.slice(0, start) + text + value.slice(end));
    const position = start + text.length;
    selection.current = { start: position, end: position };
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setNativeProps({ selection: selection.current }); });
  }
  function nextMatch() {
    if (!find) return;
    let start = value.indexOf(find, selection.current.end);
    if (start < 0) start = value.indexOf(find);
    if (start >= 0) {
      selection.current = { start, end: start + find.length };
      input.current?.focus();
      input.current?.setNativeProps({ selection: selection.current });
    }
  }
  const lines = value.split('\n').length;
  return <View style={s.root}>
    <View style={s.header}>
      <Ionicons name="code-slash" size={19} color="#a8c7fa" />
      <Text style={s.title} numberOfLines={1}>{dirty ? '● ' : ''}{name}</Text>
      <Pressable accessibilityLabel="Поиск и замена" onPress={() => setTools(!tools)} style={s.icon}><Ionicons name="search" size={19} color="#c2d4ef" /></Pressable>
      <Pressable accessibilityLabel="Сохранить" onPress={onSave} style={s.save}><Text style={s.saveText}>Сохранить</Text></Pressable>
      <Pressable accessibilityLabel="Закрыть редактор" onPress={onClose} style={s.icon}><Ionicons name="close" size={20} color="#c2d4ef" /></Pressable>
    </View>
    {tools && <View style={s.search}>
      <TextInput placeholder="Найти" placeholderTextColor="#91a0b6" style={s.field} value={find} onChangeText={setFind} autoCapitalize="none" />
      <TextInput placeholder="Заменить на" placeholderTextColor="#91a0b6" style={s.field} value={replace} onChangeText={setReplace} autoCapitalize="none" />
      <View style={s.row}><Pressable onPress={nextMatch}><Text style={s.link}>Следующее</Text></Pressable><Pressable onPress={() => find && change(value.split(find).join(replace))}><Text style={s.link}>Заменить всё</Text></Pressable></View>
    </View>}
    <View style={s.code}>
      <ScrollView ref={gutter} scrollEnabled={false} style={s.gutter} showsVerticalScrollIndicator={false}><Text style={s.numbers}>{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</Text></ScrollView>
      <TextInput ref={input} value={value} onChangeText={change} onSelectionChange={e => { selection.current = e.nativeEvent.selection; }}
        onScroll={e => gutter.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false })} scrollEventThrottle={16}
        multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top"
        style={s.input} accessibilityLabel="Исходный код" keyboardType="default" />
    </View>
    <ScrollView horizontal keyboardShouldPersistTaps="always" style={s.toolbar} contentContainerStyle={s.toolInner} showsHorizontalScrollIndicator={false}>
      <Pressable onPress={() => travel('undo', 'redo')} style={s.key}><Text style={s.keyText}>↶</Text></Pressable>
      <Pressable onPress={() => travel('redo', 'undo')} style={s.key}><Text style={s.keyText}>↷</Text></Pressable>
      {['  ', '{', '}', '(', ')', '[', ']', ';', ':', '"', "'", '=', '/', '<', '>'].map((key, i) => <Pressable key={i} style={s.key} onPress={() => insert(key)}><Text style={s.keyText}>{key === '  ' ? 'TAB' : key}</Text></Pressable>)}
      <Pressable style={s.key} onPress={() => insert('console.log();')}><Text style={s.keyText}>log</Text></Pressable>
    </ScrollView>
    <Text style={s.status}>UTF-8 · {lines} строк · перенос строк · {dirty ? 'есть изменения' : 'сохранено'}</Text>
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#162238', borderRadius: 24, overflow: 'hidden', minHeight: 250 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 6, backgroundColor: '#20304a' },
  title: { color: '#e5edfa', flex: 1, fontSize: 13 }, icon: { padding: 5 },
  save: { backgroundColor: '#a8c7fa', padding: 8, borderRadius: 12 }, saveText: { color: '#15305c', fontSize: 11, fontWeight: '700' },
  code: { flex: 1, flexDirection: 'row', minHeight: 100 },
  gutter: { width: 42, flexGrow: 0, backgroundColor: '#132035' },
  numbers: { color: '#697e9c', fontFamily: MONO, fontSize: 13, lineHeight: 22, textAlign: 'right', paddingTop: 14, paddingRight: 8 },
  input: { flex: 1, color: '#dde7fb', fontFamily: MONO, fontSize: 13, lineHeight: 22, paddingTop: 14, paddingHorizontal: 10, paddingBottom: 70, margin: 0 },
  toolbar: { flexGrow: 0, maxHeight: 48, backgroundColor: '#20304a' }, toolInner: { padding: 6, gap: 5 },
  key: { minWidth: 34, padding: 7, alignItems: 'center', backgroundColor: '#30435f', borderRadius: 8 }, keyText: { color: '#dbe8ff', fontFamily: MONO },
  status: { color: '#9eb3cf', padding: 8, fontSize: 10 }, search: { padding: 10, gap: 6 },
  field: { backgroundColor: '#293b55', color: '#fff', borderRadius: 8, padding: 8 }, row: { flexDirection: 'row', gap: 20 }, link: { color: '#a8c7fa', paddingVertical: 4 }
});
