import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectAddress } from '../features/github/projectAddress.ts';

test('discovery opens GitHub HTTPS, bare and SSH project addresses including subpages', () => {
  for (const value of ['https://github.com/FuFu-Flash/EasyHub', 'github.com/FuFu-Flash/EasyHub/issues', 'git@github.com:FuFu-Flash/EasyHub.git']) {
    assert.deepEqual(parseProjectAddress(value), { owner: 'FuFu-Flash', name: 'EasyHub' });
  }
});
test('discovery rejects lookalike hosts, credentials, traversal and search phrases', () => {
  for (const value of ['https://github.com.evil.test/owner/repo', 'https://name@github.com/owner/repo', 'https://github.com/owner/%2e%2e', 'easyhub search', 'https://github.com/owner']) assert.equal(parseProjectAddress(value), null);
});
