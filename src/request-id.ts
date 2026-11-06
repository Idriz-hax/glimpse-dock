// Request correlation IDs are not credentials; fall back outside secure browser contexts.
export function requestId(cryptoApi: Pick<Crypto, 'randomUUID'> | undefined = globalThis.crypto): string {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
