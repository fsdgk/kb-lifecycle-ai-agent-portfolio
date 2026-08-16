import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateStartupFunding,
  forecastCashflow,
  detectFinancialRisks,
  roundKrw,
} from '../src/domain/finance-engine.mjs';
import { loadBusinessProfile } from '../src/data/repository.mjs';

test('startup funding gap uses deterministic KRW arithmetic', () => {
  const result = calculateStartupFunding(loadBusinessProfile());

  assert.deepEqual(result, {
    plannedCost: 112_000_000,
    ownCapital: 60_000_000,
    fundingGap: 52_000_000,
    recommendedBuffer: 16_800_000,
  });
});

test('cash-flow risk exposes a date and range, not an invented approval claim', () => {
  const result = forecastCashflow(7_000_000, [1_000_000, -3_000_000, -6_000_000], 3);

  assert.deepEqual(result.daily, [
    { day: 1, balance: 8_000_000 },
    { day: 2, balance: 5_000_000 },
    { day: 3, balance: -1_000_000 },
  ]);
  assert.equal(result.minimumBalance, -1_000_000);
  assert.equal(result.shortfallDate, 'DAY_3');
  assert.deepEqual(result.shortfallRange, { low: 900_000, high: 1_100_000 });
  assert.equal(detectFinancialRisks(result)[0].type, 'CASH_SHORTFALL');
});

test('cash-flow forecast rejects a non-positive day count', () => {
  assert.throws(
    () => forecastCashflow(1_000_000, [0], 0),
    { name: 'RangeError' },
  );
});

test('cash-flow forecast rejects non-integer and non-finite KRW inputs', () => {
  assert.throws(
    () => forecastCashflow(1_000_000.5, [0], 1),
    { name: 'TypeError' },
  );
  assert.throws(
    () => forecastCashflow(1_000_000, [Number.POSITIVE_INFINITY], 1),
    { name: 'TypeError' },
  );
});

test('KRW rounding uses decimal half-up away from zero at both half boundaries', () => {
  assert.equal(roundKrw(1.5), 2);
  assert.equal(roundKrw(-1.5), -2);
});
