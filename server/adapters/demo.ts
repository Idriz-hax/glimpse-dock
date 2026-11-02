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

  if (command.type === 'demo.reset') return createDemoState();
  if (command.type === 'demo.add-widget') {
    if (next.widgets.length >= 32) return next;
    const number = next.widgets.length + 1;
    next.widgets.push({ id: `custom${number}`, label: `Custom metric ${number - 3}`, value: '0', sub: 'Created locally', tone: 'amber' });
    addLog('Widget created', 'Added a new custom metric', 'success');
    return next;
  }
  if (command.type === 'demo.set-enabled') {
    next.running = command.payload.enabled;
    next.activity = next.running ? 'thinking' : 'waiting';
    addLog(next.running ? 'Demo resumed' : 'Demo paused', `Automatic demo updates ${next.running ? 'enabled' : 'disabled'}`);
    return next;
  }
  if (command.type !== 'demo.simulate') return next;

  const actions = [
    () => { next.progress = Math.min(100, (next.progress ?? 0) + 11); next.activity = next.progress === 100 ? 'completed' : 'thinking'; addLog(next.activity === 'completed' ? 'Task completed' : 'Task progress updated', `Current task advanced to ${next.progress}%`, 'success'); },
    () => { const widget = next.widgets.find(item => item.id === 'tools'); if (widget) widget.value = String(Number(widget.value) + 3); next.activity = 'tool-use'; addLog('Tool calls updated', 'Demo agent executed three simulated tools'); },
    () => { const widget = next.widgets.find(item => item.id === 'tasks'); if (widget) widget.value = String(Number(widget.value) + 1); next.progress = 100; next.activity = 'completed'; addLog('Task completed', 'Demo agent finished a mock action', 'success'); },
    () => { next.task = 'Preparing visual summary for the workspace'; next.progress = 28; next.activity = 'thinking'; addLog('New task started', next.task); },
  ];
  actions[Math.floor(Math.random() * actions.length)]();
  return next;
}
