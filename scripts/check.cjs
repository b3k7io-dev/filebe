const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const jsonFiles = ['package.json', 'app.json', 'eas.json'];
for (const name of jsonFiles) {
  JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  console.log('JSON OK:', name);
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (app.version !== pkg.version) throw new Error('expo.version должен совпадать с package.json version');
const sourceFiles = [
  'App.js', 'src/Editor.js', 'src/files.js', 'src/cloud.js', 'src/drafts.js',
  'src/ErrorBoundary.js', 'src/pathPolicy.mjs', 'scripts/check.cjs', 'scripts/release-check.cjs',
  'tests/pathPolicy.test.mjs'
];
for (const name of sourceFiles) {
  const code = fs.readFileSync(path.join(root, name), 'utf8');
  parser.parse(code, { sourceType: name.endsWith('.cjs') ? 'script' : 'module', plugins: ['jsx'] });
  console.log('JS syntax OK:', name);
}
console.log('Статическая проверка пройдена; это не заменяет native build или device QA.');
