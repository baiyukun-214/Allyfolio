import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEnvValue, validPaddleId } from '../../src/config.ts';

test('docker env_file inline comments are stripped', () => {
  assert.equal(cleanEnvValue('# override Paddle API base (tests); default derived from PADDLE_ENV'), '');
  assert.equal(cleanEnvValue('1                       # run the job worker'), '1');
  assert.equal(cleanEnvValue('https://sandbox-api.paddle.com'), 'https://sandbox-api.paddle.com');
  assert.equal(cleanEnvValue('pri_01m5en8g4q4ts27ab5yzwr23ws'), 'pri_01m5en8g4q4ts27ab5yzwr23ws');
  assert.equal(cleanEnvValue('a#b'), 'a#b'); // '#' inside a value is kept
  assert.equal(cleanEnvValue(undefined), undefined);
});
test('placeholder Paddle discount ids are ignored', () => {
  assert.equal(validPaddleId('dsc_xxx', 'dsc'), '');
  assert.equal(validPaddleId('', 'dsc'), '');
  assert.equal(validPaddleId('dsc_01m5en8g4q4ts27ab5yzwr23ws', 'dsc'), 'dsc_01m5en8g4q4ts27ab5yzwr23ws');
});
