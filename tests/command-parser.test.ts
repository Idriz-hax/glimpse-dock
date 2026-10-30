import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command-parser';

describe('parseCommand', () => {
  it.each([
    ['set tasks to 1', { type: 'tasks', value: 1 }],
    ['set tools to 1234567', { type: 'tools', value: 1234567 }],
    ['set progress to 0', { type: 'progress', value: 0 }],
    ['set progress to 100', { type: 'progress', value: 100 }],
    ['complete task', { type: 'complete' }],
    ['  SET TASKS TO 42  ', { type: 'tasks', value: 42 }],
  ])('accepts %s', (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it.each(['', '   ', 'unknown', 'set tasks to 12345678', 'set progress to 101', 'set progress to 999'])('rejects %j', input => {
    expect(parseCommand(input)).toBeNull();
  });
});
