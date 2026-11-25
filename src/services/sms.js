/**
 * Termii SMS adapter for password-reset OTPs.
 * OTP values and API credentials must never be logged or returned to clients.
 */
function termiiConfig() {
  if (process.env.SMS_PROVIDER !== 'termii') {
    throw new Error('Termii SMS is not enabled.');
  }

  const apiKey = process.env.TERMII_API_KEY?.trim();
  const senderId = process.env.TERMII_SENDER_ID?.trim();
  const baseUrl = (process.env.TERMII_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('TERMII_BASE_URL is not configured; use the base URL shown in the Termii dashboard.');

  if (!apiKey) throw new Error('TERMII_API_KEY is not configured.');
  if (!senderId || !/^[A-Za-z0-9 -]{3,11}$/.test(senderId)) {
    throw new Error('TERMII_SENDER_ID must be 3 to 11 alphanumeric characters.');
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('TERMII_BASE_URL is invalid.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('TERMII_BASE_URL must be a secure HTTPS base URL.');
  }

  return { apiKey, senderId, baseUrl };
}

function termiiPhoneNumber(phone) {
  // Database values are stored in E.164 form; Termii expects digits without "+".
  const digits = String(phone || '').replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(digits)) throw new Error('The registered phone number is invalid.');
  return digits;
}

export async function sendPasswordResetOtp({ to, code }) {
  const { apiKey, senderId, baseUrl } = termiiConfig();
  if (!/^\d{6}$/.test(String(code))) throw new Error('A six-digit password-reset code is required.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: termiiPhoneNumber(to),
        from: senderId,
        sms: `Your FSS@UNIDEL password-reset code is ${code}. It expires in 5 minutes. Do not share this code.`,
        type: 'plain',
        channel: 'dnd'
      }),
      signal: controller.signal
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Termii returned an unreadable response.');
    }

    if (!response.ok || (payload.code && String(payload.code).toLowerCase() !== 'ok')) {
      // Do not include provider response text: it may contain account or credential details.
      throw new Error(`Termii SMS request failed (HTTP ${response.status}).`);
    }
    if (!payload.message_id && !payload.message_id_str && !/successfully sent/i.test(payload.message || '')) {
      throw new Error('Termii did not confirm SMS acceptance.');
    }

    return { provider: 'termii', messageId: String(payload.message_id || payload.message_id_str || '') };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Termii SMS request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
