import { ApiError } from './api.js';

// Both entry paths use the existing password-status contract before mounting
// any page that reads permissions or business materials.
export async function readAuthenticatedSession(api, { signal } = {}) {
  const user = await api.request('/api/org/me', { signal });
  const status = await api.request('/api/org/me/password-status', { signal });
  if (typeof status?.is_default_password !== 'boolean') {
    throw new ApiError(502, 'INVALID_PASSWORD_STATUS');
  }
  return { state: status.is_default_password ? 'password-required' : 'ready', user };
}
