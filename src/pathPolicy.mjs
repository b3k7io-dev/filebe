const INVALID_NAME = /[\/\\%?#:"<>|*\x00-\x1f\x7f]/;
const INVALID_PATH = /[%?#\\\x00-\x1f\x7f]/;
export function validName(value) {
  if (typeof value !== 'string') throw new Error('Введите имя.');
  const name = value.trim();
  if (!name || name === '.' || name === '..' || name.length > 120 || name.endsWith('.') || INVALID_NAME.test(name)) {
    throw new Error('Недопустимое имя: используйте 1–120 символов без разделителей пути и управляющих знаков.');
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Это зарезервированное системное имя.');
  return name;
}
export function assertInside(root, uri) {
  if (typeof root !== 'string' || !root.endsWith('/') || typeof uri !== 'string' || !uri.startsWith(root)) throw new Error('Путь вне рабочей папки.');
  const tail = uri.slice(root.length);
  if (!tail) return uri;
  if (INVALID_PATH.test(tail)) throw new Error('Недопустимый путь.');
  const segments = tail.split('/');
  if (segments.at(-1) === '') segments.pop();
  if (!segments.length || segments.some(part => !part || part === '.' || part === '..')) throw new Error('Недопустимый путь.');
  return uri;
}
