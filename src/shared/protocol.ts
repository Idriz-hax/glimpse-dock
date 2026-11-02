import { z } from 'zod';

const RequestIdSchema = z.string().min(1).max(64);
const EmptyPayloadSchema = z.object({}).strict();
const ProgressSchema = z.number().finite().min(0).max(100);
const TaskSchema = z.string().min(1).max(2048);
export const ActivitySchema = z.enum(['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error']);
export const ActivityTransitions = {
  idle: ['idle', 'thinking', 'waiting', 'error'],
  thinking: ['thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  'tool-use': ['thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  responding: ['thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  waiting: ['thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  completed: ['completed', 'idle', 'thinking'],
  error: ['error', 'idle', 'thinking'],
} as const satisfies Record<z.infer<typeof ActivitySchema>, readonly z.infer<typeof ActivitySchema>[]>;
export function canTransitionActivity(from: z.infer<typeof ActivitySchema>, to: z.infer<typeof ActivitySchema>): boolean {
  return ActivityTransitions[from].includes(to as never);
}
export const DisplayStyleSchema = z.enum(['quiet', 'ambient']);

const command = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ v: z.literal(1), requestId: RequestIdSchema, type: z.literal(type), payload }).strict();

export const CommandRequestSchema = z.discriminatedUnion('type', [
  command('demo.simulate', EmptyPayloadSchema),
  command('demo.set-enabled', z.object({ enabled: z.boolean() }).strict()),
  command('demo.reset', EmptyPayloadSchema),
  command('demo.add-widget', EmptyPayloadSchema),
  command('state.set-progress', z.object({ progress: ProgressSchema.nullable() }).strict()),
  command('state.set-activity', z.object({ activity: ActivitySchema }).strict()),
  command('task.update', z.object({ task: TaskSchema }).strict()),
  command('task.complete', EmptyPayloadSchema),
  command('metric.set-value', z.object({ id: z.enum(['tasks', 'tools']), value: z.number().int().min(0).max(9_999_999) }).strict()),
  command('display.set-style', z.object({ style: DisplayStyleSchema }).strict()),
]);

export const ProtocolStateSchema = z.object({
  agent: z.string().max(256),
  task: z.string().max(2048),
  progress: ProgressSchema.nullable().default(null),
  running: z.boolean(),
  activity: ActivitySchema.default('idle'),
  displayStyle: DisplayStyleSchema.default('quiet'),
  widgets: z.array(z.object({
    id: z.string().min(1).max(64),
    label: z.string().max(256),
    value: z.string().max(256),
    sub: z.string().max(256),
    tone: z.enum(['purple', 'cyan', 'green', 'amber']),
  }).strict()).max(32),
  logs: z.array(z.object({
    id: z.number().int().safe().nonnegative(),
    time: z.string().max(32),
    title: z.string().max(256),
    detail: z.string().max(2048),
    level: z.enum(['info', 'success', 'warning']),
  }).strict()).max(40),
}).strict();

export const StateMessageSchema = z.object({
  v: z.literal(1),
  type: z.enum(['snapshot', 'state']),
  revision: z.number().int().safe().nonnegative(),
  source: z.enum(['demo', 'owner', 'agent']),
  state: ProtocolStateSchema,
}).strict();

export const ErrorResponseSchema = z.object({
  v: z.literal(1),
  error: z.object({
    code: z.enum(['UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_COMMAND', 'INVALID_INPUT', 'CONFLICT', 'RATE_LIMITED', 'PERSISTENCE_FAILED', 'UNAVAILABLE']),
    message: z.string().min(1).max(256),
    requestId: RequestIdSchema,
  }).strict(),
}).strict();

export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type StateMessage = z.infer<typeof StateMessageSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
