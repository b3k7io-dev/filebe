import AsyncStorage from '@react-native-async-storage/async-storage';
import { inside } from './files';
const PREFIX = 'filebe.draft.v2:';
let queue = Promise.resolve();
function serialized(fn) { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; }
export function saveDraft(uri, text, base) {
  inside(uri);
  return serialized(() => AsyncStorage.setItem(PREFIX + uri, JSON.stringify({ uri, text, base, updated: Date.now() })));
}
export function removeDraft(uri) { inside(uri); return serialized(() => AsyncStorage.removeItem(PREFIX + uri)); }
export async function readDraft(uri) {
  inside(uri); await queue;
  const value = await AsyncStorage.getItem(PREFIX + uri); if (!value) return null;
  const record = JSON.parse(value);
  if (record.uri !== uri || typeof record.text !== 'string' || typeof record.base !== 'string') throw new Error('Повреждён черновик.');
  return record;
}
