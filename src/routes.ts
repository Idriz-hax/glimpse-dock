export type Route = 'admin' | 'display';

export function resolveRoute(pathname: string): Route {
  return pathname.replace(/\/$/, '') === '/admin' ? 'admin' : 'display';
}
