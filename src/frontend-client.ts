import { StateMessageSchema, ProtocolStateSchema, type CommandRequest } from './shared/protocol';
import { validateState, type State } from './demo-state';
import { parseCommand } from './command-parser';

export function parseStateMessage(value: unknown) {
  const parsed = StateMessageSchema.safeParse(value);
  if (!parsed.success || !validateState(parsed.data.state)) return null;
  return { ...parsed.data, state: ProtocolStateSchema.parse(parsed.data.state) as State };
}

export function commandForInput(value: string, requestId: string): Omit<CommandRequest, 'v'> | null {
  const parsed = parseCommand(value);
  if (!parsed) return null;
  if (parsed.type === 'tasks' || parsed.type === 'tools') return { requestId, type: 'metric.set-value', payload: { id: parsed.type, value: parsed.value } };
  if (parsed.type === 'progress') return { requestId, type: 'state.set-progress', payload: { progress: parsed.value } };
  return { requestId, type: 'task.complete', payload: {} };
}

export const validSnapshot = (value: unknown): State | null => {
  const message = parseStateMessage(value);
  return message?.type === 'snapshot' ? message.state : null;
};
