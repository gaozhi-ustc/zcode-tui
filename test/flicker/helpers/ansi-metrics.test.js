import { test, expect } from 'vitest';
import { countOccurrences, countFullClears, countEraseLineUps } from './ansi-metrics.js';

test('countOccurrences 统计子串次数', () => {
  expect(countOccurrences('aaaa', 'aa')).toBe(2);
  expect(countOccurrences('', 'a')).toBe(0);
  expect(countOccurrences('abc', '')).toBe(0);
});

test('countFullClears 识别 ESC[2J', () => {
  expect(countFullClears('\x1b[2J\x1b[3J\x1b[Habc')).toBe(1);
  expect(countFullClears('\x1b[2Kabc')).toBe(0);
});

test('countEraseLineUps 识别 eraseLines 指纹 ESC[1A', () => {
  expect(countEraseLineUps('\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K')).toBe(2);
});
