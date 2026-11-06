export type SessionInfo = { role: 'owner' | 'display' | null; csrf?: string; demoEnabled?: boolean; setupRequired?: boolean; identityUpgradeRequired?: boolean; ownerAutoAccess?: boolean; transport?: { mode: 'loopback' | 'http-insecure' | 'https'; lan: boolean; secure: boolean } };
type Request = (path: string, body?: unknown) => Promise<Record<string, unknown>>;

export async function bootstrapSession(request: Request): Promise<SessionInfo> {
  let session = await request('/api/session') as SessionInfo;
  if (session.role) return session;
  try {
    await request('/api/local-auto-access', {});
    session = await request('/api/session') as SessionInfo;
  } catch {
    // Auto-access is optional; rejected or unavailable routes fall through to the regular gate.
  }
  return session;
}
