import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendPasswordResetOtp } from '../src/services/sms.js';

const savedEnv = {};
for (const key of ['SMS_PROVIDER','TERMII_API_KEY','TERMII_SENDER_ID','TERMII_BASE_URL']) {
  savedEnv[key] = process.env[key];
}

function setTermiiEnv() {
  process.env.SMS_PROVIDER = 'termii';
  process.env.TERMII_API_KEY = 'test-termii-key';
  process.env.TERMII_SENDER_ID = 'FSS-UNIDEL';
  process.env.TERMII_BASE_URL = 'https://api.ng.termii.com';
}

test('Termii adapter refuses to send when provider is not enabled', async () => {
  process.env.SMS_PROVIDER = 'unconfigured';
  await assert.rejects(
    sendPasswordResetOtp({ to: '+2348012345678', code: '123456' }),
    /not enabled/
  );
});

test('Termii adapter sends a transactional DND SMS using digits-only phone number', async () => {
  setTermiiEnv();
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      code: 'ok',
      message_id: 'test-message-123',
      message: 'Successfully Sent'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await sendPasswordResetOtp({ to: '+2348012345678', code: '004219' });
    assert.equal(request.url, 'https://api.ng.termii.com/api/sms/send');
    assert.equal(request.body.to, '2348012345678');
    assert.equal(request.body.from, 'FSS-UNIDEL');
    assert.equal(request.body.channel, 'dnd');
    assert.equal(request.body.type, 'plain');
    assert.match(request.body.sms, /004219/);
    assert.equal(result.messageId, 'test-message-123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Termii adapter rejects provider errors without exposing provider response details', async () => {
  setTermiiEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 'error',
    message: 'sensitive provider diagnostic'
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(
      sendPasswordResetOtp({ to: '+2348012345678', code: '123456' }),
      error => {
        assert.match(error.message, /Termii SMS request failed/);
        assert.doesNotMatch(error.message, /sensitive provider diagnostic/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Termii adapter rejects malformed OTPs, missing base URL and insecure base URLs', async () => {
  setTermiiEnv();
  delete process.env.TERMII_BASE_URL;
  await assert.rejects(
    sendPasswordResetOtp({ to: '+2348012345678', code: '123456' }),
    /TERMII_BASE_URL is not configured/
  );
  process.env.TERMII_BASE_URL = 'https://api.ng.termii.com';
  await assert.rejects(
    sendPasswordResetOtp({ to: '+2348012345678', code: '12345' }),
    /six-digit/
  );
  process.env.TERMII_BASE_URL = 'http://api.ng.termii.com';
  await assert.rejects(
    sendPasswordResetOtp({ to: '+2348012345678', code: '123456' }),
    /HTTPS/
  );
});

test.after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
