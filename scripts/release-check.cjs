const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const pkg = read('package.json');
const app = read('app.json').expo;
const eas = read('eas.json');
if (!fs.existsSync(path.join(root, 'package-lock.json'))) throw new Error('Сначала выполните npm install и добавьте package-lock.json в git.');
if (pkg.version !== app.version) throw new Error('Версии package.json и app.json различаются.');
if (app.ios.bundleIdentifier !== app.android.package) throw new Error('iOS bundleIdentifier и Android package должны соответствовать.');
for (const profile of Object.values(eas.build || {})) {
  if (profile.env?.EXPO_PUBLIC_ENABLE_CLOUD !== 'false') throw new Error('Каждый EAS-профиль должен явно выключать общий Supabase-чат.');
}
if (app.ios.bundleIdentifier === 'com.filebe.app') console.warn('ПРЕДУПРЕЖДЕНИЕ: замените демонстрационный application id на уникальный идентификатор, которым владеете.');
console.log('Release preflight OK: lockfile, версии, идентификаторы и cloud gate проверены. Это не подпись/публикация и не device QA.');
