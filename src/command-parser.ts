export type ParsedCommand =
  | { type: 'tasks' | 'tools' | 'progress'; value: number }
  | { type: 'complete' };

export function parseCommand(value: string): ParsedCommand | null {
  const command = value.trim().toLowerCase();
  const match = command.match(/^set (tasks|tools) to (\d{1,7})$/);
  if (match) return { type: match[1] as 'tasks' | 'tools', value: Number(match[2]) };
  const progress = command.match(/^set progress to (\d{1,3})$/);
  if (progress && Number(progress[1]) <= 100) return { type: 'progress', value: Number(progress[1]) };
  if (command === 'complete task') return { type: 'complete' };
  return null;
}
