import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Editor from './src/Editor';
import ErrorBoundary from './src/ErrorBoundary';
import { saveDraft, readDraft, removeDraft } from './src/drafts';
import * as F from './src/files';
import { cloud, fetchMessages, sendCloud, downloadAttachment } from './src/cloud';

const STORE = 'filebe.preferences.v1';
const LOCAL = 'filebe.saved.v1';
const initialShortcuts = [{ id: 'docs', title: 'Expo Docs', type: 'url', value: 'https://docs.expo.dev' }];
const TABS = [{ id: 'files', icon: 'folder-outline', title: 'Файлы' }, { id: 'projects', icon: 'code-slash-outline', title: 'Проекты' }, { id: 'chat', icon: 'chatbubbles-outline', title: 'Мессенджер' }];
function Icon({ name, color = '#52647e', size = 21 }) { return <Ionicons name={name} size={size} color={color} />; }
function Button({ title, icon, onPress, small, danger, disabled }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={[s.button, small && s.smallButton, danger && s.danger, disabled && { opacity: 0.4 }]}>{icon && <Icon name={icon} color={danger ? '#a62c30' : '#244d86'} size={18} />}<Text style={[s.buttonText, danger && { color: '#a62c30' }]}>{title}</Text></Pressable>;
}
function Glass({ children, style }) { return <View style={[s.glassFrame, style]}><BlurView intensity={55} tint="light" style={s.glass}>{children}</BlurView></View>; }

export default function App() { return <SafeAreaProvider><ErrorBoundary><FileBe /></ErrorBoundary></SafeAreaProvider>; }
function FileBe() {
  const { width } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [tab, setTab] = useState('files');
  const [dir, setDir] = useState(F.ROOT);
  const [files, setFiles] = useState([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [grid, setGrid] = useState(false);
  const [split, setSplit] = useState(false);
  const [selected, setSelected] = useState([]);
  const [clipboard, setClipboard] = useState(null);
  const [trash, setTrash] = useState([]);
  const [opened, setOpened] = useState(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [shortcuts, setShortcuts] = useState(initialShortcuts);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [localMessages, setLocalMessages] = useState([]);
  const [remoteMessages, setRemoteMessages] = useState([]);
  const [mode, setMode] = useState('local');
  const [session, setSession] = useState(null);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null);
  const lock = useRef(false);
  const listing = useRef(0);
  const chatList = useRef(null);
  const dirty = opened?.kind === 'text' && text !== saved;
  const twoPane = width >= 760 || split;
  const showBrowser = !opened || twoPane;
  const selectedEntries = files.filter(file => selected.includes(file.uri));

  async function refresh(path = dir) {
    const ticket = ++listing.current;
    const items = await F.listFiles(path);
    if (ticket === listing.current) setFiles(items);
  }
  function errorMessage(error) { return error?.message || String(error); }
  async function run(fn) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await fn(); }
    catch (error) { Alert.alert('FileBe', errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  function toast(message) { setNotice(message); }
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t); } }, [notice]);
  async function boot() {
    setBootError('');
    try {
      await F.initFiles();
      const [prefs, messages] = await Promise.all([AsyncStorage.getItem(STORE), AsyncStorage.getItem(LOCAL)]);
      const p = prefs ? JSON.parse(prefs) : {};
      setShortcuts(Array.isArray(p.shortcuts) ? p.shortcuts : initialShortcuts);
      setTrash(await F.loadTrash(Array.isArray(p.trash) ? p.trash : []));
      if (messages) setLocalMessages(JSON.parse(messages));
      await refresh(F.ROOT);
      setReady(true);
    } catch (error) { setBootError(errorMessage(error)); }
  }
  useEffect(() => { boot(); }, []);
  useEffect(() => {
    if (ready) AsyncStorage.setItem(STORE, JSON.stringify({ shortcuts })).catch(error => Alert.alert('Настройки не сохранены', errorMessage(error)));
  }, [shortcuts, ready]);
  useEffect(() => {
    if (!ready || opened?.kind !== 'text') return;
    const uri = opened.uri;
    const timer = setTimeout(() => saveDraft(uri, text, saved).catch(error => setNotice(`Черновик не сохранён: ${errorMessage(error)}`)), 700);
    return () => clearTimeout(timer);
  }, [ready, opened?.uri, opened?.kind, text, saved]);
  useEffect(() => {
    if (ready) refresh(dir).catch(error => Alert.alert('Ошибка папки', errorMessage(error)));
    setSelected([]);
  }, [dir, ready]);
  useEffect(() => {
    if (!cloud) return;
    cloud.auth.getSession().then(({ data, error }) => { if (error) Alert.alert('Авторизация', error.message); else setSession(data.session); });
    const { data: listener } = cloud.auth.onAuthStateChange((_event, value) => { setSession(value); setRemoteMessages([]); });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') cloud.auth.startAutoRefresh(); else cloud.auth.stopAutoRefresh(); });
    cloud.auth.startAutoRefresh();
    return () => { listener.subscription.unsubscribe(); subscription.remove(); cloud.auth.stopAutoRefresh(); };
  }, []);
  useEffect(() => {
    if (tab !== 'chat' || mode !== 'cloud' || !session) return;
    let alive = true;
    let fetching = false;
    async function poll() {
      if (fetching || AppState.currentState !== 'active') return;
      fetching = true;
      try { const result = await fetchMessages(); if (alive) { setRemoteMessages(result); setNotice(current => current.startsWith('Облако:') ? '' : current); } }
      catch (error) { if (alive) setNotice(`Облако: ${errorMessage(error)}`); }
      finally { fetching = false; }
    }
    poll(); const timer = setInterval(poll, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [tab, mode, session?.user?.id]);
  function guard(action) {
    if (!dirty) return action();
    Alert.alert('Несохранённый код', 'Сохраните файл или подтвердите потерю правок.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Не сохранять', style: 'destructive', onPress: action },
      { text: 'Сохранить', onPress: () => run(async () => { await F.saveText(opened.uri, text, saved); await removeDraft(opened.uri); setSaved(text); action(); }) }
    ]);
  }
  function go(path) { guard(() => { setOpened(null); setDir(path); setQuery(''); }); }
  function changeTab(next) { guard(() => { setOpened(null); setTab(next); if (next === 'projects') setDir(F.ROOT); setQuery(''); }); }
  function open(file) {
    if (selected.length) return toggle(file.uri);
    if (file.directory) return go(file.uri);
    guard(() => run(async () => {
      if (F.isText(file.name)) {
        const value = await F.readText(file);
        const draft = await readDraft(file.uri);
        const editorFile = { ...file, kind: 'text' };
        setSaved(value);
        if (draft && draft.text !== value) {
          const changed = draft.base !== value;
          Alert.alert(changed ? 'Файл изменился' : 'Восстановить черновик?', changed ? 'На диске есть более новая версия. Черновик можно восстановить, но он не будет записан до нажатия «Сохранить».' : 'Найден несохранённый черновик.', [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть файл', onPress: () => { setText(value); setOpened(editorFile); removeDraft(file.uri).catch(error => setNotice(`Черновик не удалён: ${errorMessage(error)}`)); } },
            { text: 'Восстановить черновик', onPress: () => { setText(draft.text); setOpened(editorFile); } }
          ]);
        } else {
          if (draft) await removeDraft(file.uri);
          setText(value); setOpened(editorFile);
        }
      } else setOpened({ ...file, kind: F.isImage(file.name) ? 'image' : 'binary' });
    }));
  }
  function toggle(uri) { setSelected(current => current.includes(uri) ? current.filter(value => value !== uri) : [...current, uri]); }
  function ask(type, values = {}) { setForm(values); setDialog(type); }
  function closeDialog() { if (!busy) setDialog(null); }
  async function submitDialog() {
    await run(async () => {
      if (dialog === 'file' || dialog === 'folder') { await F.createEntry(dir, form.name || '', dialog === 'folder'); await refresh(); }
      if (dialog === 'project') { const path = await F.createProject(dir, form.name || ''); setDir(path); }
      if (dialog === 'rename') {
        await F.renameEntry(selectedEntries[0], form.name || '');
        setOpened(null); setSelected([]); await refresh();
      }
      if (dialog === 'shortcut') {
        const title = (form.name || '').trim();
        if (!title) throw new Error('Введите название.');
        const type = form.type || 'url';
        let value = (form.value || '').trim();
        if (type === 'folder') value = dir;
        else if (type === 'url' && !/^https?:\/\//i.test(value)) throw new Error('Ссылка должна начинаться с https:// или http://.');
        else if (type === 'app' && !/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('Укажите URL-схему приложения, например tg://.');
        setShortcuts(current => [...current, { id: F.uid(), title, type, value }]);
      }
      if (dialog === 'login' || dialog === 'signup') {
        if (!cloud) throw new Error('Добавьте переменные Supabase в .env и перезапустите Expo.');
        const credentials = { email: (form.email || '').trim(), password: form.password || '' };
        if (!credentials.email || credentials.password.length < 8) throw new Error('Введите email и пароль от 8 символов.');
        const { data, error } = await cloud.auth[dialog === 'login' ? 'signInWithPassword' : 'signUp'](credentials);
        if (error) throw error;
        if (!data.session) Alert.alert('Проверьте почту', 'Подтвердите email и затем войдите в приложение.');
      }
      setDialog(null);
    });
  }
  function confirmTrash() {
    if (!selectedEntries.length) return;
    guard(() => Alert.alert('В корзину?', `Выбрано: ${selectedEntries.length}. Можно восстановить кнопкой «Вернуть».`, [
      { text: 'Отмена', style: 'cancel' }, { text: 'В корзину', style: 'destructive', onPress: () => run(async () => {
        // По одному: уже перемещённые элементы сохраняются даже при ошибке следующего.
        for (const entry of selectedEntries) { const records = await F.trashEntries([entry]); setTrash(current => [...current, ...records]); }
        setSelected([]); setOpened(null); await refresh(); toast('Перемещено в корзину');
      }) }
    ]));
  }
  function doPaste() {
    guard(() => run(async () => {
      await F.pasteEntries(clipboard.entries, dir, clipboard.move); setClipboard(null); setSelected([]); setOpened(null); await refresh();
    }));
  }
  async function openShortcut(item) {
    if (item.type === 'folder') { setTab('files'); go(item.value); return; }
    await Linking.openURL(item.value);
  }
  function removeShortcut(item) { Alert.alert('Убрать кнопку?', item.title, [{ text: 'Отмена', style: 'cancel' }, { text: 'Убрать', style: 'destructive', onPress: () => setShortcuts(current => current.filter(x => x.id !== item.id)) }]); }
  async function send() {
    if (!draft.trim() && !attachment) return;
    await run(async () => {
      const body = draft.trim();
      if (body.length > 10000) throw new Error('Максимум 10 000 символов в сообщении.');
      if (mode === 'cloud') {
        if (!session) throw new Error('Сначала войдите.');
        await sendCloud(body, attachment, session.user);
        setDraft(''); setAttachment(null);
        setRemoteMessages(await fetchMessages());
      } else {
        const next = [...localMessages, { id: F.uid(), body, attachment, created_at: new Date().toISOString() }];
        await AsyncStorage.setItem(LOCAL, JSON.stringify(next)); setLocalMessages(next); setDraft(''); setAttachment(null);
      }
    });
  }
  function openAttachment(message) { run(async () => {
    const uri = mode === 'cloud' ? await downloadAttachment(message) : message.attachment.uri;
    await F.shareFile(uri);
  }); }
  const filtered = files.filter(file => file.name.toLowerCase().includes(query.toLowerCase()) && (tab !== 'projects' || dir !== F.ROOT || file.directory)).sort((a, b) => Number(b.directory) - Number(a.directory) || (sort === 'size' ? b.size - a.size : sort === 'date' ? b.modified - a.modified : a.name.localeCompare(b.name)));
  const countLabel = `${files.filter(x => x.directory).length} папок · ${files.filter(x => !x.directory).length} файлов`;
  const currentMessages = mode === 'cloud' ? remoteMessages : localMessages;

  if (!ready) return <SafeAreaView style={s.loading}><StatusBar style="dark" /><Icon name="cube" size={48} color="#3979d0" /><Text style={s.logo}>FileBe</Text>{bootError ? <><Text style={s.muted}>{bootError}</Text><Button title="Повторить" onPress={boot} /></> : <ActivityIndicator color="#3979d0" />}</SafeAreaView>;
  return <SafeAreaView style={s.screen}>
    <StatusBar style="dark" />
    <View pointerEvents="none" style={s.orbOne} /><View pointerEvents="none" style={s.orbTwo} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.top}><View style={s.brandIcon}><Icon name="cube" color="#fff" size={24} /></View><View style={{ flex: 1 }}><Text style={s.logo}>FileBe<Text style={s.logoDot}>.</Text></Text><Text style={s.eyebrow}>ФАЙЛЫ. КОД. ОБЩЕНИЕ.</Text></View><Pressable accessibilityLabel="О приложении" onPress={() => Alert.alert('FileBe 1.0', 'Рабочая папка приложения + импорт/экспорт. Liquid Glass — стилизация, не системный Apple Liquid Glass.\n\nДолгое нажатие выделяет файл или удаляет быструю кнопку.\n\nОбщий облачный канал видят все вошедшие участники. Не отправляйте туда секреты.')} style={s.round}><Icon name="information-circle-outline" /></Pressable></View>
      <ScrollView horizontal style={s.shortcutScroll} contentContainerStyle={s.shortcuts} showsHorizontalScrollIndicator={false}>
        {shortcuts.map(item => <Pressable accessibilityLabel={item.title} key={item.id} onPress={() => guard(() => run(() => openShortcut(item)))} onLongPress={() => removeShortcut(item)} style={s.shortcut}><Icon size={16} name={item.type === 'folder' ? 'folder-outline' : item.type === 'app' ? 'apps-outline' : 'link-outline'} color="#3979d0" /><Text style={s.shortcutText}>{item.title}</Text></Pressable>)}
        <Pressable accessibilityLabel="Добавить быструю кнопку" style={s.shortcut} onPress={() => ask('shortcut', { type: 'url' })}><Icon name="add" size={17} /><Text style={s.shortcutText}>Кнопка</Text></Pressable>
      </ScrollView>
      {tab !== 'chat' ? <View style={s.workspace}>
        {showBrowser && <Glass style={[s.browser, opened && twoPane && { flex: width < 600 ? 0.43 : 0.39 }]}>
          <View style={s.sectionHeader}><View style={{ flex: 1 }}><Text style={s.heading}>{tab === 'projects' ? 'Проекты' : 'Мои файлы'}</Text><Text style={s.muted}>{countLabel}</Text></View><Pressable accessibilityLabel="Двухпанельный режим" style={[s.round, twoPane && s.activeRound]} onPress={() => setSplit(!split)}><Icon name="albums-outline" color={twoPane ? '#1964b3' : '#52647e'} /></Pressable></View>
          <View style={s.breadcrumb}><Pressable accessibilityLabel="На уровень вверх" onPress={() => go(F.parent(dir))} disabled={dir === F.ROOT}><Icon name="arrow-up" size={18} color={dir === F.ROOT ? '#b7c2d2' : '#3979d0'} /></Pressable><ScrollView horizontal showsHorizontalScrollIndicator={false}><Text style={s.path}>FileBe / {decodeURI(dir.slice(F.ROOT.length))}</Text></ScrollView></View>
          <View style={s.searchBox}><Icon name="search-outline" size={18} /><TextInput value={query} onChangeText={setQuery} placeholder="Поиск в папке" style={s.searchInput} placeholderTextColor="#8491a7" /></View>
          <ScrollView horizontal style={s.actionsScroll} contentContainerStyle={s.actionRow} showsHorizontalScrollIndicator={false}>
            <Button small title="Файл" icon="add" onPress={() => ask('file')} /><Button small title="Папка" icon="folder-open-outline" onPress={() => ask('folder')} /><Button small title="Проект" icon="code-slash" onPress={() => ask('project')} /><Button small title="Импорт" icon="download-outline" onPress={() => run(async () => { const n = await F.importFiles(dir); await refresh(); if (n) toast(`Импортировано: ${n}`); })} />
          </ScrollView>
          <View style={s.listTools}><Pressable onPress={() => setSort(sort === 'name' ? 'date' : sort === 'date' ? 'size' : 'name')}><Text style={s.link}>По {sort === 'name' ? 'имени' : sort === 'date' ? 'дате' : 'размеру'} ↕</Text></Pressable><Pressable accessibilityLabel="Список или сетка" onPress={() => setGrid(!grid)}><Icon name={grid ? 'list-outline' : 'grid-outline'} size={18} /></Pressable><Pressable accessibilityLabel="Обновить" onPress={() => run(() => refresh())}><Icon name="refresh" size={18} /></Pressable></View>
          {selected.length > 0 && <View style={s.selection}><Text style={s.selectionTitle}>Выбрано: {selected.length}</Text><ScrollView horizontal contentContainerStyle={{ gap: 6 }} showsHorizontalScrollIndicator={false}>
            <Button small title="Копия" onPress={() => { setClipboard({ entries: selectedEntries, move: false }); setSelected([]); }} /><Button small title="Вырезать" onPress={() => { setClipboard({ entries: selectedEntries, move: true }); setSelected([]); }} />
            {selected.length === 1 && <Button small title="Имя" onPress={() => guard(() => ask('rename', { name: selectedEntries[0].name }))} />}
            {selected.length === 1 && !selectedEntries[0]?.directory && <Button small title="Отправить" onPress={() => run(() => F.shareFile(selectedEntries[0].uri))} />}
            <Button small danger title="В корзину" onPress={confirmTrash} /><Button small title="Снять" onPress={() => setSelected([])} />
          </ScrollView></View>}
          {clipboard && <Button small title={`Вставить ${clipboard.entries.length} · ${clipboard.move ? 'перенести' : 'копировать'}`} icon="clipboard-outline" onPress={doPaste} />}
          <FlatList key={grid ? 'grid' : 'list'} data={filtered} numColumns={grid ? 2 : 1} keyExtractor={item => item.uri} contentContainerStyle={s.fileList}
            ListEmptyComponent={<View style={s.empty}><Icon name="folder-open-outline" size={40} color="#a2b6d3" /><Text style={s.muted}>{query ? 'Ничего не найдено' : 'Здесь пока пусто'}</Text></View>}
            renderItem={({ item }) => <Pressable onPress={() => open(item)} onLongPress={() => toggle(item.uri)} accessibilityLabel={item.name} style={[s.file, grid && s.fileGrid, selected.includes(item.uri) && s.fileSelected, opened?.uri === item.uri && s.fileOpened]}>
              <View style={[s.fileIcon, { backgroundColor: item.directory ? '#e1edff' : F.isText(item.name) ? '#e5e2fa' : '#def2ea' }]}><Icon name={selected.includes(item.uri) ? 'checkmark-circle' : item.directory ? 'folder' : F.isImage(item.name) ? 'image-outline' : F.isText(item.name) ? 'code-slash' : 'document-outline'} color={item.directory ? '#4e88d9' : '#74809d'} size={25} /></View>
              <View style={grid ? { alignSelf: 'stretch' } : { flex: 1 }}><Text style={s.filename} numberOfLines={2}>{item.name}</Text><Text style={s.filemeta}>{item.directory ? 'Папка' : F.formatSize(item.size)}</Text></View>
              {!grid && <Pressable accessibilityLabel="Выделить" onPress={() => toggle(item.uri)} style={{ padding: 8 }}><Icon name="ellipsis-vertical" size={17} /></Pressable>}
            </Pressable>} />
          {trash.length > 0 && <View style={s.trashRow}><Text style={s.muted}>Корзина: {trash.length}</Text><Button small title="Вернуть последнее" onPress={() => run(async () => { const last = trash[trash.length - 1]; await F.restoreEntries([last]); setTrash(current => current.slice(0, -1)); await refresh(); })} /></View>}
        </Glass>}
        {(opened || twoPane) && <View style={[s.preview, { flex: showBrowser ? (width < 600 ? 0.57 : 0.61) : 1 }]}>
          {opened?.kind === 'text' ? <Editor key={opened.uri} name={opened.name} value={text} onChange={setText} dirty={dirty} onSave={() => run(async () => { await F.saveText(opened.uri, text, saved); await removeDraft(opened.uri); setSaved(text); await refresh(); toast('Файл сохранён'); })} onClose={() => guard(() => setOpened(null))} /> : opened ? <Glass style={{ flex: 1 }}><View style={s.previewHeader}><Text style={[s.filename, { flex: 1 }]} numberOfLines={1}>{opened.name}</Text><Pressable accessibilityLabel="Закрыть" onPress={() => setOpened(null)}><Icon name="close" /></Pressable></View>{opened.kind === 'image' ? <Image source={{ uri: opened.uri }} style={{ flex: 1, minHeight: 180 }} resizeMode="contain" /> : <View style={s.empty}><Icon name="document-outline" size={58} /><Text style={s.muted}>Бинарный файл · {F.formatSize(opened.size)}</Text></View>}<Button title="Открыть / экспортировать" icon="share-outline" onPress={() => run(() => F.shareFile(opened.uri))} /></Glass> : <Glass style={{ flex: 1 }}><View style={s.empty}><View style={s.bigIcon}><Icon name="code-slash" size={40} color="#5f8cd0" /></View><Text style={s.heading}>Место для идей</Text><Text style={[s.muted, { textAlign: 'center' }]}>Выберите файл слева.\nКод или изображение появится здесь.</Text></View></Glass>}
        </View>}
      </View> : <Glass style={s.chat}>
        <View style={s.sectionHeader}><View style={{ flex: 1 }}><Text style={s.heading}>Мессенджер</Text><Text style={s.muted}>{mode === 'local' ? 'Избранное · только на этом устройстве' : 'Общий канал · все вошедшие участники'}</Text></View>{session && <Pressable accessibilityLabel="Выйти из аккаунта" onPress={() => Alert.alert('Выйти?', 'Облачная сессия будет завершена.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Выйти', onPress: () => run(async () => { const { error } = await cloud.auth.signOut(); if (error) throw error; }) }])}><Icon name="log-out-outline" /></Pressable>}</View>
        <View style={s.segment}><Pressable style={[s.segmentItem, mode === 'local' && s.segmentActive]} onPress={() => setMode('local')}><Text style={s.buttonText}>Избранное</Text></Pressable><Pressable style={[s.segmentItem, mode === 'cloud' && s.segmentActive]} onPress={() => setMode('cloud')}><Text style={s.buttonText}>Общий канал</Text></Pressable></View>
        {mode === 'cloud' && !session ? <View style={s.empty}><Icon name="cloud-outline" size={52} color="#7199d3" /><Text style={s.heading}>{cloud ? 'Войдите в FileBe' : 'Подключите Supabase'}</Text><Text style={[s.muted, { textAlign: 'center' }]}>{cloud ? 'Общий чат с текстом и файлами до 8 МБ.\nСообщения обновляются каждые 8 секунд.' : 'Скопируйте .env.example в .env, выполните SQL\nиз supabase/schema.sql и перезапустите Expo.'}</Text>{cloud && <View style={s.actionRow}><Button title="Войти" onPress={() => ask('login')} /><Button title="Регистрация" onPress={() => ask('signup')} /></View>}</View> : <>
          <FlatList ref={chatList} data={currentMessages} keyExtractor={item => String(item.id)} contentContainerStyle={s.messages} onContentSizeChange={() => chatList.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={<View style={s.empty}><Icon name="chatbubble-ellipses-outline" size={42} color="#9bb4d7" /><Text style={s.muted}>Отправьте сообщение или файл</Text></View>}
            renderItem={({ item }) => { const mine = mode === 'local' || item.sender === session?.user?.id; const hasFile = mode === 'local' ? !!item.attachment : !!item.attachment_path; return <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}><Text style={s.sender}>{mode === 'local' ? 'Вы · Избранное' : mine ? 'Вы' : `Участник ${item.sender.slice(0, 6)}`}</Text>{!!item.body && <Text style={s.messageText} selectable>{item.body}</Text>}{hasFile && <Pressable onPress={() => openAttachment(item)} style={s.attachment}><Icon name="document-attach-outline" color="#3979d0" /><View style={{ flex: 1 }}><Text style={s.filename} numberOfLines={2}>{item.attachment?.name || item.attachment_name}</Text><Text style={s.filemeta}>{F.formatSize(item.attachment?.size || item.attachment_size)} · открыть / отправить</Text></View></Pressable>}<Text style={s.time}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View>; }} />
          {attachment && <View style={s.pending}><Text style={[s.muted, { flex: 1 }]} numberOfLines={1}>📎 {attachment.name}</Text><Pressable accessibilityLabel="Убрать вложение" onPress={() => setAttachment(null)}><Icon name="close" /></Pressable></View>}
          <View style={s.composer}><Pressable accessibilityLabel="Прикрепить файл" disabled={busy} onPress={() => run(async () => { const value = await F.attachLocal(); if (value) setAttachment(value); })} style={s.round}><Icon name="attach" /></Pressable><TextInput value={draft} onChangeText={setDraft} style={s.messageInput} multiline maxLength={10000} placeholder="Сообщение или файл…" placeholderTextColor="#8696ac" /><Pressable accessibilityLabel="Отправить сообщение" disabled={busy} onPress={send} style={s.send}><Icon name="arrow-up" color="#fff" /></Pressable></View>
        </>}
      </Glass>}
      {!!notice && <View style={s.notice}><Text style={s.noticeText}>{notice}</Text></View>}
      <Glass style={s.navFrame}><View style={s.nav}>{TABS.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} style={s.navItem} onPress={() => changeTab(item.id)}><View style={[s.navIcon, tab === item.id && s.navIconActive]}><Icon name={item.icon} color={tab === item.id ? '#225d9c' : '#78879c'} /></View><Text style={[s.navLabel, tab === item.id && { color: '#225d9c', fontWeight: '700' }]}>{item.title}</Text></Pressable>)}</View></Glass>
    </KeyboardAvoidingView>
    {busy && <View pointerEvents="auto" style={s.busyOverlay}><ActivityIndicator size="large" color="#3979d0" /><Text style={s.muted}>Выполняется…</Text></View>}
    <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={closeDialog}>
      <KeyboardAvoidingView style={s.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.modalCard}><Text style={s.heading}>{{ file: 'Новый файл', folder: 'Новая папка', project: 'Новый проект', rename: 'Переименовать', shortcut: 'Быстрая кнопка', login: 'Вход', signup: 'Регистрация' }[dialog]}</Text>
          {(dialog === 'login' || dialog === 'signup') ? <><TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Email" style={s.formInput} value={form.email || ''} onChangeText={email => setForm(current => ({ ...current, email }))} /><TextInput secureTextEntry placeholder="Пароль, минимум 8 символов" style={s.formInput} value={form.password || ''} onChangeText={password => setForm(current => ({ ...current, password }))} /></> : <TextInput autoFocus placeholder="Название" style={s.formInput} value={form.name || ''} onChangeText={name => setForm(current => ({ ...current, name }))} />}
          {dialog === 'shortcut' && <><View style={s.actionRow}>{[['url', 'Ссылка'], ['app', 'Приложение'], ['folder', 'Эта папка']].map(([type, label]) => <Pressable key={type} onPress={() => setForm(current => ({ ...current, type }))} style={[s.typeChip, form.type === type && s.segmentActive]}><Text style={s.buttonText}>{label}</Text></Pressable>)}</View>{form.type !== 'folder' && <TextInput autoCapitalize="none" placeholder={form.type === 'app' ? 'tg:// или другая URL-схема' : 'https://example.com'} style={s.formInput} value={form.value || ''} onChangeText={value => setForm(current => ({ ...current, value }))} />}<Text style={s.muted}>Для приложения нужна известная URL-схема. Список установленных приложений не запрашивается.</Text></>}
          <View style={[s.actionRow, { justifyContent: 'flex-end' }]}><Button title="Отмена" onPress={closeDialog} disabled={busy} /><Button title={busy ? 'Подождите…' : 'Готово'} onPress={submitDialog} disabled={busy} /></View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eff4fc' }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, backgroundColor: '#eff4fc' },
  orbOne: { position: 'absolute', width: 350, height: 350, borderRadius: 175, backgroundColor: '#d7e6ff', right: -160, top: 80, opacity: 0.7 }, orbTwo: { position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: '#e4defb', left: -150, bottom: 100, opacity: 0.7 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 10, paddingBottom: 15, gap: 11 }, brandIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4f87d6', transform: [{ rotate: '-8deg' }] },
  logo: { fontSize: 28, fontWeight: '800', color: '#243955', letterSpacing: -1.5 }, logoDot: { color: '#548cda' }, eyebrow: { color: '#7e91ad', fontSize: 8, letterSpacing: 2, fontWeight: '700' },
  round: { padding: 10, borderRadius: 18, backgroundColor: '#ffffff99' }, activeRound: { backgroundColor: '#d8e8ff' },
  shortcutScroll: { flexGrow: 0, maxHeight: 45, marginBottom: 10 }, shortcuts: { paddingHorizontal: 18, gap: 8, alignItems: 'center' }, shortcut: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 22, backgroundColor: '#ffffffba', borderWidth: 1, borderColor: '#fff' }, shortcutText: { fontSize: 12, color: '#506786' },
  workspace: { flex: 1, flexDirection: 'row', paddingHorizontal: 12, gap: 9, minHeight: 0 }, glassFrame: { borderRadius: 25, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffffee', backgroundColor: '#ffffffaa' }, glass: { flex: 1, backgroundColor: '#ffffff55' }, browser: { flex: 1 }, preview: { minWidth: 0 },
  sectionHeader: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 6 }, heading: { fontSize: 21, color: '#2a405d', fontWeight: '700', letterSpacing: -0.5 }, muted: { fontSize: 11, color: '#7c8ea8', lineHeight: 18 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 17, paddingVertical: 8 }, path: { fontSize: 11, color: '#7a8da8' }, searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, backgroundColor: '#eaf0f9', paddingHorizontal: 12, borderRadius: 15 }, searchInput: { flex: 1, fontSize: 13, color: '#2b4263', paddingVertical: 11, minWidth: 0 },
  actionsScroll: { flexGrow: 0, maxHeight: 55 }, actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, flexWrap: 'wrap' }, button: { backgroundColor: '#dce9fc', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, smallButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11 }, buttonText: { color: '#315b91', fontSize: 12, fontWeight: '600' }, danger: { backgroundColor: '#ffe2e2' },
  listTools: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 17, paddingBottom: 10 }, link: { fontSize: 11, color: '#6986af' }, fileList: { paddingHorizontal: 8, paddingBottom: 10, flexGrow: 1 }, file: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderRadius: 17, marginBottom: 4, borderWidth: 1, borderColor: 'transparent' }, fileGrid: { flex: 1, maxWidth: '50%', flexDirection: 'column', alignItems: 'center', paddingVertical: 14 }, fileSelected: { backgroundColor: '#d7e7ff', borderColor: '#abcafa' }, fileOpened: { backgroundColor: '#e8f0fb' }, fileIcon: { height: 43, width: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, filename: { fontSize: 12, color: '#354a67', fontWeight: '600', lineHeight: 18 }, filemeta: { fontSize: 10, color: '#94a2b5', marginTop: 3 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 16, minHeight: 160 }, bigIcon: { width: 90, height: 90, borderRadius: 30, backgroundColor: '#e5edfc', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-7deg' }] }, previewHeader: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }, selection: { backgroundColor: '#e7f0ff', padding: 8, gap: 5 }, selectionTitle: { fontSize: 11, color: '#5073a4' }, trashRow: { padding: 9, gap: 5 },
  navFrame: { margin: 12, marginBottom: 5 }, nav: { flexDirection: 'row', padding: 7 }, navItem: { flex: 1, alignItems: 'center', gap: 4, padding: 2 }, navIcon: { paddingHorizontal: 25, paddingVertical: 6, borderRadius: 20 }, navIconActive: { backgroundColor: '#d9e8ff' }, navLabel: { fontSize: 10, color: '#8b9ab0' },
  notice: { backgroundColor: '#304b70', marginHorizontal: 16, marginTop: 7, borderRadius: 13, padding: 10 }, noticeText: { color: '#fff', fontSize: 12 }, busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#edf4ff99', alignItems: 'center', justifyContent: 'center', gap: 10 },
  chat: { flex: 1, marginHorizontal: 12 }, segment: { flexDirection: 'row', marginHorizontal: 14, padding: 4, borderRadius: 18, backgroundColor: '#e9f0fa' }, segmentItem: { flex: 1, alignItems: 'center', padding: 10, borderRadius: 14 }, segmentActive: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d4e3fa' }, messages: { padding: 14, gap: 10, flexGrow: 1 }, bubble: { maxWidth: '88%', padding: 12, borderRadius: 19, minWidth: 120 }, bubbleMine: { alignSelf: 'flex-end', backgroundColor: '#dceaff', borderBottomRightRadius: 5 }, bubbleOther: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 5 }, sender: { fontSize: 10, color: '#7791b4', marginBottom: 5 }, messageText: { fontSize: 14, lineHeight: 21, color: '#304560' }, time: { fontSize: 9, color: '#8d9fb9', textAlign: 'right', marginTop: 7 }, attachment: { flexDirection: 'row', gap: 9, alignItems: 'center', backgroundColor: '#ffffff88', padding: 10, borderRadius: 12, marginTop: 5 }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, padding: 10, borderTopWidth: 1, borderColor: '#e1eafa' }, messageInput: { flex: 1, maxHeight: 110, color: '#304560', fontSize: 13, backgroundColor: '#edf3fc', borderRadius: 18, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 12 }, send: { backgroundColor: '#578cda', padding: 11, borderRadius: 18 }, pending: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8 },
  modalBackdrop: { flex: 1, backgroundColor: '#152a4d55', justifyContent: 'center', alignItems: 'center', padding: 20 }, modalCard: { width: '100%', maxWidth: 440, padding: 22, gap: 14, borderRadius: 28, backgroundColor: '#f4f8ff' }, formInput: { backgroundColor: '#e6eefb', borderRadius: 14, padding: 14, fontSize: 14, color: '#304560' }, typeChip: { padding: 9, borderRadius: 12, backgroundColor: '#e1ebfa' }
});
