import test from 'node:test';
import assert from 'node:assert/strict';
import { assertInside, validName } from '../src/pathPolicy.mjs';
const root = 'file:///sandbox/FileBe/';
const backslash = String.fromCharCode(92);

test('accepts safe file and directory paths only below the application root', () => {
  assert.equal(assertInside(root, root), root);
  assert.equal(assertInside(root, root + 'notes/file.js'), root + 'notes/file.js');
  assert.equal(assertInside(root, root + 'notes/'), root + 'notes/');
});

test('rejects paths outside root, encoded separators, and traversal segments', () => {
  for (const uri of ['/tmp/file', root + '../outside', root + 'a/../b', root + '%2e%2e/secret', root + 'a//b', root + `a${backslash}b`]) {
    assert.throws(() => assertInside(root, uri));
  }
});

test('accepts portable names and rejects separators, reserved names, and controls', () => {
  assert.equal(validName('hello world.txt'), 'hello world.txt');
  assert.equal(validName('.env'), '.env');
  for (const name of ['', '.', '..', '../x', 'a/b', `a${backslash}b`, 'a%2f..', 'x?', 'COM1.txt', `bad${String.fromCharCode(10)}name`, 'x'.repeat(121)]) {
    assert.throws(() => validName(name));
  }
});
