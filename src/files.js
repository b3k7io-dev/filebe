import * as FS from 'expo-file-system/legacy';
import * as Picker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { assertInside, validName } from './pathPolicy.mjs';
export { validName };

export const ROOT = `${FS.documentDirectory}FileBe/`;
export const TRASH = `${FS.documentDirectory}FileBeTrash/`;
export const ATTACHMENTS = `${FS.documentDirectory}FileBeAttachments/`;
const STATE = `${FS.documentDirectory}FileBeState/`;
const JOURNAL = `${STATE}save.json`;
export const MAX_TEXT = 1024 * 1024;
export const MAX_UPLOAD = 8 * 1024 * 1024;
export function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
export function inside(uri) { return assertInside(ROOT, uri); }
function notRoot(uri) { inside(uri); if (uri === ROOT) throw new Error('Нельзя изменять корень FileBe.'); return uri; }
function directory(uri) { inside(uri); if (!uri.endsWith('/')) throw new Error('Ожидалась папка.'); return uri; }
export function parent(uri) { inside(uri); if (uri === ROOT) return ROOT; const clean = uri.replace(/\/$/, ''); return clean.slice(0, clean.lastIndexOf('/') + 1); }
export function formatSize(n = 0) { if (n < 1024) return `${n} Б`; if (n < 1048576) return `${(n / 1024).toFixed(1)} КБ`; return `${(n / 1048576).toFixed(1)} МБ`; }
function bytes(text) { return encodeURIComponent(text).replace(/%[A-F\d]{2}|./g, 'x').length; }
async function exists(uri) { return (await FS.getInfoAsync(uri)).exists; }
async function remove(uri) { await FS.deleteAsync(uri, { idempotent: true }); }
export async function ensureAbsent(uri) { if (await exists(uri)) throw new Error('Такое имя уже существует. Выберите другое.'); }
async function readJSON(uri) { return JSON.parse(await FS.readAsStringAsync(uri)); }
async function recoverSave() {
  if (!(await exists(JOURNAL))) return;
  const j = await readJSON(JOURNAL);
  notRoot(j.uri);
  if (!j.backup?.startsWith(STATE) || !j.temp?.startsWith(STATE)) throw new Error('Повреждён журнал сохранения. Не удаляйте FileBeState до восстановления.');
  if (!(await exists(j.uri))) {
    if (!(await exists(j.backup))) throw new Error('Не найдена резервная копия. Требуется ручное восстановление.');
    await FS.copyAsync({ from: j.backup, to: j.uri });
  }
  await remove(j.backup); await remove(j.temp); await remove(JOURNAL);
}
export async function initFiles() {
  for (const dir of [ROOT, TRASH, ATTACHMENTS, STATE]) await FS.makeDirectoryAsync(dir, { intermediates: true });
  await recoverSave();
}
export async function listFiles(dir) {
  directory(dir);
  const names = await FS.readDirectoryAsync(dir);
  const result = [];
  // Bounded concurrency: no unbounded Promise.all for a large directory.
  for (let i = 0; i < names.length; i += 24) {
    const batch = await Promise.all(names.slice(i, i + 24).map(async name => {
      const uri = inside(dir + name); const info = await FS.getInfoAsync(uri);
      if (!info.exists) return null;
      return { name, uri: info.isDirectory ? uri + '/' : uri, directory: !!info.isDirectory, size: info.size || 0, modified: info.modificationTime || 0 };
    }));
    result.push(...batch.filter(Boolean));
  }
  return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}
export async function createEntry(dir, name, isDirectory = false) {
  directory(dir); const uri = inside(dir + validName(name)); await ensureAbsent(uri);
  if (isDirectory) await FS.makeDirectoryAsync(uri); else await FS.writeAsStringAsync(uri, ''); return uri;
}
export async function createProject(dir, name) {
  directory(dir); const title = validName(name); const project = inside(dir + title + '/'); await ensureAbsent(project);
  await FS.makeDirectoryAsync(project);
  try {
    await FS.writeAsStringAsync(project + 'README.md', `# ${title}\n\nСоздано в FileBe.\n`);
    await FS.writeAsStringAsync(project + 'index.js', '// Ваш проект\nconsole.log("Hello, FileBe!");\n');
    await FS.writeAsStringAsync(project + 'package.json', JSON.stringify({ name: 'filebe-project', version: '1.0.0', private: true, main: 'index.js' }, null, 2));
  } catch (error) { await remove(project); throw error; }
  return project;
}
export async function importFiles(dir) {
  directory(dir); const result = await Picker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }); if (result.canceled) return 0;
  let count = 0;
  try { for (const asset of result.assets) {
    const name = validName(asset.name); let target = dir + name;
    if (await exists(target)) target = dir + uid() + '-' + name;
    await FS.copyAsync({ from: asset.uri, to: target }); count++;
  } } catch (error) { throw new Error(`Импортировано ${count}. ${error.message}`); }
  return count;
}
export async function renameEntry(entry, name) {
  notRoot(entry.uri); const target = inside(parent(entry.uri) + validName(name) + (entry.directory ? '/' : ''));
  if (target === entry.uri) return target; await ensureAbsent(target); await FS.moveAsync({ from: entry.uri, to: target }); return target;
}
export async function pasteEntries(entries, dir, move) {
  directory(dir); const targets = new Set();
  for (const entry of entries) {
    notRoot(entry.uri); const target = inside(dir + validName(entry.name) + (entry.directory ? '/' : ''));
    if (entry.directory && dir.startsWith(entry.uri.endsWith('/') ? entry.uri : entry.uri + '/')) throw new Error('Нельзя вложить папку в саму себя.');
    if (entry.uri === target || targets.has(target)) throw new Error('Повторяющееся назначение или источник совпадает с назначением.');
    if (!(await exists(entry.uri))) throw new Error('Источник больше не существует.'); await ensureAbsent(target); targets.add(target);
  }
  let count = 0;
  try { for (const entry of entries) { const target = dir + entry.name + (entry.directory ? '/' : ''); await FS[move ? 'moveAsync' : 'copyAsync']({ from: entry.uri, to: target }); count++; } }
  catch (error) { throw new Error(`Обработано ${count} из ${entries.length}. Обновите папку перед повтором. ${error.message}`); }
}
export async function loadTrash(legacy = []) {
  const names = (await FS.readDirectoryAsync(STATE)).filter(x => x.startsWith('trash-') && x.endsWith('.json'));
  const records = [];
  for (const name of names) {
    const record = await readJSON(STATE + name); notRoot(record.uri);
    if (typeof record.trashUri !== 'string' || !record.trashUri.startsWith(TRASH) || /[%\\]|\.\./.test(record.trashUri.slice(TRASH.length))) throw new Error('Повреждён индекс корзины.');
    if (await exists(record.trashUri)) records.push(record);
  }
  const known = new Set(records.map(record => record.trashUri));
  for (const old of legacy) {
    if (!old || old.id || typeof old.trashUri !== 'string' || !old.trashUri.startsWith(TRASH) || /[%\\]|\.\./.test(old.trashUri.slice(TRASH.length))) continue;
    notRoot(old.uri);
    if (known.has(old.trashUri) || !(await exists(old.trashUri))) continue;
    const record = { ...old, id: uid(), deletedAt: old.deletedAt || Date.now() };
    await FS.writeAsStringAsync(STATE + 'trash-' + record.id + '.json', JSON.stringify(record));
    records.push(record); known.add(record.trashUri);
  }
  return records.sort((a, b) => (a.deletedAt || 0) - (b.deletedAt || 0));
}
export async function trashEntries(entries) {
  const records = [];
  for (const entry of entries) {
    notRoot(entry.uri); const id = uid(); const record = { ...entry, id, deletedAt: Date.now(), trashUri: TRASH + id + '-' + validName(entry.name) + (entry.directory ? '/' : '') };
    await FS.writeAsStringAsync(STATE + 'trash-' + id + '.json', JSON.stringify(record));
    await FS.moveAsync({ from: entry.uri, to: record.trashUri }); records.push(record);
  }
  return records;
}
export async function restoreEntries(records) {
  for (const record of records) {
    notRoot(record.uri);
    // Only use trusted records loaded from disk; reject a substituted trash URI.
    const actual = (await loadTrash()).find(x => x.id === record.id && x.uri === record.uri && x.trashUri === record.trashUri);
    if (!actual) throw new Error('Запись корзины не найдена.');
    await ensureAbsent(record.uri); await FS.makeDirectoryAsync(parent(record.uri), { intermediates: true });
    await FS.moveAsync({ from: record.trashUri, to: record.uri }); await remove(STATE + 'trash-' + record.id + '.json');
  }
}
export function isText(name) { return /\.(js|jsx|ts|tsx|json|md|txt|html|css|scss|py|yml|yaml|xml|csv|sh|c|cpp|h|java|kt|swift|sql|toml|ini|env|gitignore)$/i.test(name) || !name.includes('.'); }
export function isImage(name) { return /\.(png|jpe?g|webp|gif)$/i.test(name); }
export async function readText(entry) {
  const info = await FS.getInfoAsync(notRoot(entry.uri)); if (!info.exists || info.isDirectory) throw new Error('Текстовый файл не найден.');
  if (info.size > MAX_TEXT) throw new Error('Редактор открывает текстовые файлы до 1 МБ.');
  const text = await FS.readAsStringAsync(entry.uri); if (text.includes('\u0000')) throw new Error('Бинарный файл. Используйте экспорт.'); return text;
}
let saving = false;
export async function saveText(uri, text, expected) {
  notRoot(uri); if (bytes(text) > MAX_TEXT) throw new Error('Текст больше 1 МБ.');
  if (saving) throw new Error('Дождитесь завершения сохранения.'); saving = true;
  try {
    await recoverSave();
    if (!(await exists(uri))) throw new Error('Файл перемещён или удалён.');
    if (expected !== undefined && await FS.readAsStringAsync(uri) !== expected) throw new Error('Файл изменён вне редактора. Экспортируйте черновик и откройте файл заново.');
    const id = uid(); const j = { uri, temp: STATE + id + '.tmp', backup: STATE + id + '.bak' };
    await FS.writeAsStringAsync(j.temp, text);
    if (await FS.readAsStringAsync(j.temp) !== text) throw new Error('Проверка записи не пройдена.');
    await FS.copyAsync({ from: uri, to: j.backup });
    await FS.writeAsStringAsync(JOURNAL, JSON.stringify(j));
    try { await remove(uri); await FS.moveAsync({ from: j.temp, to: uri }); }
    catch (error) { if (!(await exists(uri))) await FS.copyAsync({ from: j.backup, to: uri }); throw error; }
    await remove(JOURNAL); await remove(j.backup);
  } finally { saving = false; }
}
export async function shareFile(uri) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Системное меню отправки недоступно.'); await Sharing.shareAsync(uri);
}
export async function attachLocal() {
  const result = await Picker.getDocumentAsync({ copyToCacheDirectory: true }); if (result.canceled) return null;
  const asset = result.assets[0]; const info = await FS.getInfoAsync(asset.uri);
  if (!info.exists || info.size > MAX_UPLOAD) throw new Error('Максимальный размер вложения — 8 МБ.');
  const name = validName(asset.name); const uri = ATTACHMENTS + uid() + '-' + name;
  await FS.copyAsync({ from: asset.uri, to: uri }); return { name, uri, size: info.size || 0, mime: asset.mimeType || 'application/octet-stream' };
}
export { FS };
