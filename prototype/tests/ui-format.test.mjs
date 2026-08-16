import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKrw } from '../public/views/lifecycle.js';

test('formatKrw presents startup funding amounts in Korean large-number units', () => {
  assert.equal(formatKrw(112_000_000), '1억 1,200만원');
  assert.equal(formatKrw(60_000_000), '6,000만원');
  assert.equal(formatKrw(52_000_000), '5,200만원');
});
