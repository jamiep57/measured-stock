import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { decryptToken, encryptToken, signState, verifySquareSignature, verifyState } from './crypto.js';

test('token encryption round-trips and rejects the wrong key', () => {
  const packed = encryptToken('sq0at-secret', 'key-one');
  assert.equal(decryptToken(packed, 'key-one'), 'sq0at-secret');
  assert.throws(() => decryptToken(packed, 'key-two'));
});

test('oauth state expires and detects tampering', () => {
  const token = signState({ orgId: 'org-1', redirectUri: 'https://app.example/api/square/callback' }, 'state-key', 1000);
  const payload = verifyState(token, 'state-key');
  assert.equal(payload.orgId, 'org-1');
  assert.equal(verifyState(token, 'other-key'), null);
  const expired = signState({ orgId: 'org-1' }, 'state-key', -1000);
  assert.equal(verifyState(expired, 'state-key'), null);
});

test('webhook signature covers the notification url and body', () => {
  const body = '{"type":"order.updated"}';
  const url = 'https://app.example/api/square/webhook';
  const signature = createHmac('sha256', 'whsec').update(url + body).digest('base64');
  assert.equal(verifySquareSignature({
    signature,
    notificationUrl: url,
    body,
    signatureKey: 'whsec',
  }), true);
  assert.equal(verifySquareSignature({
    signature,
    notificationUrl: 'https://other.example/api/square/webhook',
    body,
    signatureKey: 'whsec',
  }), false);
});
