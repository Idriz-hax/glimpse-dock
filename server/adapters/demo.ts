import { initialState, type State, type Level } from '../../src/demo-state.ts';
import type { CommandRequest } from '../../src/shared/protocol.ts';
import { createWidget, removeWidget, updateWidget } from '../widgets.ts';

const stamp = (now: number) => new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function createDemoState(now = Date.now()): State {
  const state = initialState();
  state.turnStartedAt = now;
  state.widgets = [];
  for (const widget of initialState().widgets) {
    const { owner: _owner, visible: _visible, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = widget;
    const result = createWidget(state.widgets, input, 'demo', now);
    if (result.ok) state.widgets = result.widgets;
  }
  state.logs = [
    { id: 3, time: stamp(now), title: 'Connection established', detail: 'Local simulation is active', level: 'success' },
    { id: 2, time: stamp(now), title: 'Agent started a task', detail: state.task, level: 'info' },
    { id: 1, time: stamp(now), title: 'Widget data updated', detail: 'Tool calls refreshed by demo agent', level: 'success' },
  ];
  return state;
}

export function transitionDemo(state: State, command: CommandRequest, now = Date.now()): State {
  let next = { ...state, widgets: state.widgets.map(widget => ({ ...widget })), logs: [...state.logs] };
  const addLog = (title: string, detail: string, level: Level = 'info') => {
    next.logs.unshift({ id: Math.max(0, ...next.logs.map(log => log.id)) + 1, time: stamp(now), title, detail, level });
    next.logs = next.logs.slice(0, 40);
  };
  const startFreshTask = () => {
    next.task = 'Preparing visual summary for the workspace';
    next.progress = 0;
    next.activity = 'thinking';
  };
  const finish = () => {
    next.turnStartedAt = ['thinking', 'tool-use', 'responding', 'waiting'].includes(next.activity)
      ? ['thinking', 'tool-use', 'responding', 'waiting'].includes(state.activity) ? state.turnStartedAt : now
      : null;
    return next;
  };

  if (command.type === 'demo.reset') return createDemoState(now);
   if (command.type === 'demo.set-enabled') {
    next.running = command.payload.enabled;
    if (next.running && (next.activity === 'completed' || next.activity === 'error')) startFreshTask();
    else if (!next.running) next.activity = next.progress === 100 && next.activity === 'completed' ? 'completed' : 'waiting';
    else next.activity = 'thinking';
    addLog(next.running ? 'Demo resumed' : 'Demo paused', `Automatic demo updates ${next.running ? 'enabled' : 'disabled'}`);
    return finish();
  }
  if (command.type !== 'demo.simulate') return next;
  if (next.activity === 'completed' || next.activity === 'error') {
    startFreshTask();
    addLog('New task started', next.task);
    return finish();
  }

  const actions = [
    () => { next.progress = Math.min(100, (next.progress ?? 0) + 11); next.activity = next.progress === 100 ? 'completed' : 'thinking'; addLog(next.activity === 'completed' ? 'Task completed' : 'Task progress updated', `Current task advanced to ${next.progress}%`, 'success'); },
    () => { const widget = next.widgets.find(item => item.id === 'tools'); if (widget?.content.kind === 'metric') { const result = updateWidget(next.widgets, widget.id, { content: { ...widget.content, value: String(Number(widget.content.value) + 3) } }, 'demo', now); if (result.ok) next.widgets = result.widgets; } next.activity = 'tool-use'; addLog('Tool calls updated', 'Demo agent executed three simulated tools'); },
    () => { const widget = next.widgets.find(item => item.id === 'tasks'); if (widget?.content.kind === 'metric') { const result = updateWidget(next.widgets, widget.id, { content: { ...widget.content, value: String(Number(widget.content.value) + 1) } }, 'demo', now); if (result.ok) next.widgets = result.widgets; } next.progress = 100; next.activity = 'completed'; addLog('Task completed', 'Demo agent finished a mock action', 'success'); },
    () => { startFreshTask(); next.progress = 28; addLog('New task started', next.task); },
    () => {
      const widget = { version: 1, id: 'demo-status', title: 'Demo status', content: { kind: 'metric', label: 'Demo status', value: 'Active' }, placement: 'secondary', expiresAt: null };
      const existing = next.widgets.find(item => item.id === 'demo-status');
      const result = existing
        ? updateWidget(next.widgets, existing.id, { content: { ...existing.content, value: existing.content.kind === 'metric' && existing.content.value === 'Active' ? 'Ready' : 'Active' } }, 'demo', now)
        : createWidget(next.widgets, widget, 'demo', now);
      if (result.ok) next.widgets = result.widgets;
      addLog(existing ? 'Demo widget updated' : 'Demo widget created', 'Demo status sample changed');
    },
    () => {
      const result = removeWidget(next.widgets, 'demo-status', 'demo');
      if (result.ok) next.widgets = result.widgets;
      addLog('Demo widget removed', 'Demo status sample removed');
    },
  ];
  actions[Math.floor(Math.random() * actions.length)]();
  return finish();
}
