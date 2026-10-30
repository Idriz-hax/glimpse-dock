export type Level = 'info' | 'success' | 'warning';
export type Activity = { id: number; time: string; title: string; detail: string; level: Level };
export type Widget = { id: string; label: string; value: string; sub: string; tone: 'purple' | 'cyan' | 'green' | 'amber' };
export type State = { agent: string; task: string; progress: number; running: boolean; widgets: Widget[]; logs: Activity[] };

const defaults: Widget[] = [
  { id: 'tasks', label: 'Tasks completed', value: '24', sub: '+6 in this session', tone: 'purple' },
  { id: 'tools', label: 'Tool calls', value: '128', sub: 'All systems nominal', tone: 'cyan' },
  { id: 'runtime', label: 'Session uptime', value: '02:34', sub: 'Local demo session', tone: 'green' },
];

export function initialState(): State {
  return { agent: 'Hermes (Demo)', task: 'Analysing workspace and preparing next actions', progress: 64, running: true, widgets: defaults.map(w => ({ ...w })), logs: [] };
}

export const maxLogId = (logs: readonly Pick<Activity, 'id'>[], current = 0) => Math.max(current, ...logs.map(log => log.id));

export function validateState(value: unknown): State | null {
  if (typeof value !== 'object' || value === null) return null;
  const state = value as Record<string, unknown>;
  if (typeof state.agent !== 'string' || typeof state.task !== 'string' || typeof state.running !== 'boolean' ||
      typeof state.progress !== 'number' || !Number.isFinite(state.progress) || state.progress < 0 || state.progress > 100 ||
      !Array.isArray(state.widgets) || !Array.isArray(state.logs) || state.logs.length > 40) return null;
  const widgets = state.widgets as unknown[];
  if (!widgets.every(item => {
    if (typeof item !== 'object' || item === null) return false;
    const w = item as Record<string, unknown>;
    return typeof w.id === 'string' && typeof w.label === 'string' && typeof w.value === 'string' && typeof w.sub === 'string' && ['purple', 'cyan', 'green', 'amber'].includes(String(w.tone));
  })) return null;
  const logs = state.logs as unknown[];
  if (!logs.every(item => {
    if (typeof item !== 'object' || item === null) return false;
    const log = item as Record<string, unknown>;
    return typeof log.id === 'number' && Number.isSafeInteger(log.id) && log.id >= 0 && typeof log.time === 'string' && typeof log.title === 'string' && typeof log.detail === 'string' && ['info', 'success', 'warning'].includes(String(log.level));
  })) return null;
  return value as State;
}

export function loadState(saved: string | null, fallback: State = initialState()): State {
  if (saved === null) return fallback;
  try {
    const state = validateState(JSON.parse(saved));
    return state ? { ...state, agent: 'Hermes (Demo)' } : fallback;
  } catch { return fallback; }
}
