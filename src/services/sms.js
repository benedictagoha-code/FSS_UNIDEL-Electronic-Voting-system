/**
 * Provider-neutral SMS boundary.
 * Add a gateway-specific implementation only after the institution selects a provider.
 * The caller must never expose OTP values in API responses or logs.
 */
export async function sendPasswordResetOtp({ to, code }) {
  if (process.env.SMS_PROVIDER !== 'configured') {
    throw new Error('SMS provider adapter is not configured.');
  }

  // Deliberately fail closed until a real provider adapter is implemented and tested.
  // Do not mark an OTP as delivered merely because a provider was selected in .env.
  throw new Error('The selected SMS provider adapter has not been implemented.');
}
