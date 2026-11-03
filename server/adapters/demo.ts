import { initialState, type State, type Level } from '../../src/demo-state.ts';
import type { CommandRequest } from '../../src/shared/protocol.ts';

const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function createDemoState(): State {
  const state = initialState();
  state.logs = [
    { id: 3, time: stamp(), title: 'Connection established', detail: 'Local simulation is active', level: 'success' },
    { id: 2, time: stamp(), title: 'Agent started a task', detail: state.task, level: 'info' },
    { id: 1, time: stamp(), title: 'Widget data updated', detail: 'Tool calls refreshed by demo agent', level: 'success' },
  ];
  return state;
}

export function transitionDemo(state: State, command: CommandRequest): State {
  let next = { ...state, widgets: state.widgets.map(widget => ({ ...widget })), logs: [...state.logs] };
  const addLog = (title: string, detail: string, level: Level = 'info') => {
    next.logs.unshift({ id: Math.max(0, ...next.logs.map(log => log.id)) + 1, time: stamp(), title, detail, level });
    next.logs = next.logs.slice(0, 40);
  };
  const startFreshTask = () => {
    next.task = 'Preparing visual summary for the workspace';
    next.progress = 0;
    next.activity = 'thinking';
  };

  if (command.type === 'demo.reset') return createDemoState();
  if (command.type === 'widget.create') {
    if (next.widgets.length >= 32) return next;
    next.widgets.push({ ...command.payload.widget, owner: 'demo', visible: true, createdAt: Date.now(), updatedAt: Date.now() });
    addLog('Widget created', 'Added a new custom metric', 'success');
    return next;
  }
   if (command.type === 'demo.set-enabled') {
    next.running = command.payload.enabled;
    if (next.running && (next.activity === 'completed' || next.activity === 'error')) startFreshTask();
    else if (!next.running) next.activity = next.progress === 100 && next.activity === 'completed' ? 'completed' : 'waiting';
    else next.activity = 'thinking';
    addLog(next.running ? 'Demo resumed' : 'Demo paused', `Automatic demo updates ${next.running ? 'enabled' : 'disabled'}`);
    return next;
  }
  if (command.type !== 'demo.simulate') return next;
  if (next.activity === 'completed' || next.activity === 'error') {
    startFreshTask();
    addLog('New task started', next.task);
    return next;
  }

  const actions = [
    () => { next.progress = Math.min(100, (next.progress ?? 0) + 11); next.activity = next.progress === 100 ? 'completed' : 'thinking'; addLog(next.activity === 'completed' ? 'Task completed' : 'Task progress updated', `Current task advanced to ${next.progress}%`, 'success'); },
    () => { const widget = next.widgets.find(item => item.id === 'tools'); if (widget?.content.kind === 'metric') widget.content = { ...widget.content, value: String(Number(widget.content.value) + 3) }; next.activity = 'tool-use'; addLog('Tool calls updated', 'Demo agent executed three simulated tools'); },
    () => { const widget = next.widgets.find(item => item.id === 'tasks'); if (widget?.content.kind === 'metric') widget.content = { ...widget.content, value: String(Number(widget.content.value) + 1) }; next.progress = 100; next.activity = 'completed'; addLog('Task completed', 'Demo agent finished a mock action', 'success'); },
    () => { startFreshTask(); next.progress = 28; addLog('New task started', next.task); },
  ];
  actions[Math.floor(Math.random() * actions.length)]();
  return next;
}
