import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import { FS, MAX_UPLOAD, uid, validName } from './files';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const cloudEnabled = process.env.EXPO_PUBLIC_ENABLE_CLOUD === 'true';
const secureAuthStorage = {
  getItem: keyName => SecureStore.getItemAsync(keyName),
  setItem: (keyName, value) => SecureStore.setItemAsync(keyName, value),
  removeItem: keyName => SecureStore.deleteItemAsync(keyName)
};
export const cloud = cloudEnabled && url && key ? createClient(url, key, {
  auth: { storage: secureAuthStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;
export async function fetchMessages() {
  if (!cloud) throw new Error('Облачный чат отключён или не настроен.');
  const { data, error } = await cloud.from('messages').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data.reverse();
}
export async function sendCloud(text, attachment, user) {
  if (!cloud) throw new Error('Облачный чат отключён или не настроен.');
  let path = null;
  if (attachment) {
    if (attachment.size > MAX_UPLOAD) throw new Error('Для облачной отправки максимум 8 МБ.');
    path = `${user.id}/${uid()}`;
    const base64 = await FS.readAsStringAsync(attachment.uri, { encoding: FS.EncodingType.Base64 });
    const { error } = await cloud.storage.from('attachments').upload(path, decode(base64), { contentType: attachment.mime, upsert: false });
    if (error) throw error;
  }
  const { error } = await cloud.from('messages').insert({
    sender: user.id, body: text, attachment_path: path,
    attachment_name: attachment?.name || null, attachment_size: attachment?.size || null
  });
  if (error) {
    if (path) {
      const cleanup = await cloud.storage.from('attachments').remove([path]);
      if (cleanup.error) throw new Error(`${error.message}. Не удалось убрать незавершённую загрузку: ${cleanup.error.message}`);
    }
    throw error;
  }
}
export async function downloadAttachment(message) {
  if (!cloud) throw new Error('Облачный чат отключён или не настроен.');
  if (!message.attachment_path) throw new Error('Нет вложения.');
  const { data, error } = await cloud.storage.from('attachments').createSignedUrl(message.attachment_path, 60);
  if (error) throw error;
  const name = validName(message.attachment_name || 'attachment');
  const destination = `${FS.cacheDirectory}${uid()}-${name}`;
  await FS.downloadAsync(data.signedUrl, destination);
  return destination;
}
