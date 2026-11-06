export type Level = 'info' | 'success' | 'warning';
export type Activity = { id: number; time: string; title: string; detail: string; level: Level };
import { DisplayPreferencesSchema, WidgetSchema, type Widget as ProtocolWidget } from './shared/protocol';
export type Widget = ProtocolWidget;
export type State = { agent: string; task: string; toolCategory: 'shell' | 'code' | 'search' | null; progress: number | null; running: boolean; activity: 'idle' | 'thinking' | 'tool-use' | 'responding' | 'waiting' | 'completed' | 'error'; turnStartedAt: number | null; displayStyle: 'quiet' | 'ambient'; displayPreferences: ReturnType<typeof DisplayPreferencesSchema.parse>; widgets: Widget[]; logs: Activity[] };

const defaults: Widget[] = [
  { version: 1, id: 'tasks', owner: 'demo', title: 'Tasks completed', content: { kind: 'metric', label: 'Tasks completed', value: '24', caption: '+6 in this session' }, placement: 'primary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null },
  { version: 1, id: 'tools', owner: 'demo', title: 'Tool calls', content: { kind: 'metric', label: 'Tool calls', value: '128', caption: 'All systems nominal' }, placement: 'primary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null },
  { version: 1, id: 'runtime', owner: 'demo', title: 'Session uptime', content: { kind: 'metric', label: 'Session uptime', value: '02:34', caption: 'Local demo session' }, placement: 'primary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null },
];

export function initialState(): State {
  return { agent: 'Hermes (Demo)', task: 'Analysing workspace and preparing next actions', toolCategory: null, progress: 64, running: true, activity: 'thinking', turnStartedAt: null, displayStyle: 'quiet', displayPreferences: DisplayPreferencesSchema.parse({}), widgets: defaults.map(w => ({ ...w })), logs: [] };
}

export const maxLogId = (logs: readonly Pick<Activity, 'id'>[], current = 0) => Math.max(current, ...logs.map(log => log.id));

export function validateState(value: unknown): State | null {
  if (typeof value !== 'object' || value === null) return null;
  const state = value as Record<string, unknown>;
  if (typeof state.agent !== 'string' || typeof state.task !== 'string' || typeof state.running !== 'boolean' ||
      !(state.progress === null || typeof state.progress === 'number' && Number.isFinite(state.progress) && state.progress >= 0 && state.progress <= 100) ||
      !['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'].includes(String(state.activity)) || !['quiet', 'ambient'].includes(String(state.displayStyle)) ||
      !(state.toolCategory === undefined || state.toolCategory === null || ['shell', 'code', 'search'].includes(String(state.toolCategory))) ||
      !Array.isArray(state.widgets) || !Array.isArray(state.logs) || state.logs.length > 40) return null;
  if (state.widgets.length > 32) return null;
  const widgets = state.widgets.map(item => {
    if (typeof item !== 'object' || item === null) return null;
    const w = item as Record<string, unknown>;
    if (Object.keys(w).sort().join(',') === 'id,label,sub,tone,value' && typeof w.id === 'string' && typeof w.label === 'string' && typeof w.value === 'string' && typeof w.sub === 'string' && ['purple', 'cyan', 'green', 'amber'].includes(String(w.tone))) {
      return WidgetSchema.safeParse({ version: 1, id: w.id, owner: 'owner', title: w.label, content: { kind: 'metric', label: w.label, value: w.value, caption: w.sub }, placement: 'secondary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null }).success ? { version: 1, id: w.id, owner: 'owner', title: w.label, content: { kind: 'metric', label: w.label, value: w.value, caption: w.sub }, placement: 'secondary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null } : null;
    }
    return WidgetSchema.safeParse(item).success ? item : null;
  });
  if (widgets.some(widget => widget === null)) return null;
  const logs = state.logs as unknown[];
  if (!logs.every(item => {
    if (typeof item !== 'object' || item === null) return false;
    const log = item as Record<string, unknown>;
    return typeof log.id === 'number' && Number.isSafeInteger(log.id) && log.id >= 0 && typeof log.time === 'string' && typeof log.title === 'string' && typeof log.detail === 'string' && ['info', 'success', 'warning'].includes(String(log.level));
  })) return null;
  const preferences = DisplayPreferencesSchema.safeParse(Object.hasOwn(state, 'displayPreferences') ? state.displayPreferences : {});
  if (!preferences.success) return null;
  return { ...(value as State), toolCategory: state.toolCategory as State['toolCategory'] ?? null, displayPreferences: preferences.data, widgets: widgets as Widget[] };
}

export function loadState(saved: string | null, fallback: State = initialState()): State {
  if (saved === null) return fallback;
  try {
    const parsed = JSON.parse(saved);
    const state = validateState({ ...parsed, activity: parsed.activity ?? 'idle', displayStyle: parsed.displayStyle ?? 'quiet' });
    return state ? { ...state, agent: 'Hermes (Demo)' } : fallback;
  } catch { return fallback; }
}
