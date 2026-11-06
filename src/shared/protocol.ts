import { z } from 'zod';

const RequestIdSchema = z.string().min(1).max(64);
const EmptyPayloadSchema = z.object({}).strict();
const ProgressSchema = z.number().finite().min(0).max(100);
const TaskSchema = z.string().min(1).max(2048);
const ToolCategorySchema = z.enum(['shell', 'code', 'search']);
const WidgetIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
const EpochSchema = z.number().int().safe().nonnegative();
const ColorSchema = z.enum(['cyan', 'mint', 'blue', 'purple', 'amber', 'muted', 'white']);
const CoordinateSchema = z.number().finite().min(0).max(100);
const VisualPrimitiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), x: CoordinateSchema, y: CoordinateSchema, text: z.string().max(256), color: ColorSchema, size: z.number().finite().min(0).max(20) }).strict(),
  z.object({ kind: z.literal('rect'), x: CoordinateSchema, y: CoordinateSchema, width: CoordinateSchema, height: CoordinateSchema, color: ColorSchema }).strict(),
  z.object({ kind: z.literal('circle'), cx: CoordinateSchema, cy: CoordinateSchema, radius: CoordinateSchema, color: ColorSchema }).strict(),
  z.object({ kind: z.literal('line'), x1: CoordinateSchema, y1: CoordinateSchema, x2: CoordinateSchema, y2: CoordinateSchema, color: ColorSchema, width: z.number().finite().min(0).max(20) }).strict(),
]);
export const WidgetContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(4096) }).strict(),
  z.object({ kind: z.literal('status'), label: z.string().max(256), tone: z.enum(['neutral', 'info', 'success', 'warning', 'error']) }).strict(),
  z.object({ kind: z.literal('metric'), label: z.string().max(256), value: z.string().max(256), unit: z.string().max(32).optional(), caption: z.string().max(256).optional() }).strict(),
  z.object({ kind: z.literal('progress'), label: z.string().max(256), value: ProgressSchema.nullable() }).strict(),
  z.object({ kind: z.literal('visual'), primitives: z.array(VisualPrimitiveSchema).max(64) }).strict(),
]).superRefine((content, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(content)).length > 4096) ctx.addIssue({ code: 'custom', message: 'Content exceeds 4096 bytes' });
});
export const WidgetSchema = z.object({ version: z.literal(1), id: WidgetIdSchema, owner: z.string().max(256), title: z.string().max(256), content: WidgetContentSchema, placement: z.enum(['primary', 'secondary', 'notification']), visible: z.boolean(), createdAt: EpochSchema, updatedAt: EpochSchema, expiresAt: EpochSchema.nullable() }).strict();
export const WidgetCreateSchema = z.object({ version: z.literal(1), id: WidgetIdSchema, title: z.string().max(256), content: WidgetContentSchema, placement: z.enum(['primary', 'secondary', 'notification']), expiresAt: EpochSchema.nullable() }).strict();
export const ActivitySchema = z.enum(['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error']);
export const ActivityTransitions = {
  idle: ['idle', 'thinking', 'waiting', 'error'],
  thinking: ['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  'tool-use': ['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  responding: ['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  waiting: ['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'],
  completed: ['completed', 'idle', 'thinking'],
  error: ['error', 'idle', 'thinking'],
} as const satisfies Record<z.infer<typeof ActivitySchema>, readonly z.infer<typeof ActivitySchema>[]>;
export function canTransitionActivity(from: z.infer<typeof ActivitySchema>, to: z.infer<typeof ActivitySchema>): boolean {
  return ActivityTransitions[from].includes(to as never);
}
export const DisplayStyleSchema = z.enum(['quiet', 'ambient']);
export const DisplayPreferencesValueSchema = z.object({
  scale: z.enum(['compact', 'normal', 'large']),
  reducedMotion: z.boolean(),
  intensity: z.enum(['subtle', 'balanced', 'vivid']),
  showClock: z.boolean(),
  showWidgets: z.boolean(),
  layout: z.enum(['balanced', 'compact']),
}).strict();
export const DisplayPreferencesSchema = DisplayPreferencesValueSchema.extend({
  scale: DisplayPreferencesValueSchema.shape.scale.default('normal'),
  reducedMotion: DisplayPreferencesValueSchema.shape.reducedMotion.default(false),
  intensity: DisplayPreferencesValueSchema.shape.intensity.default('balanced'),
  showClock: DisplayPreferencesValueSchema.shape.showClock.default(true),
  showWidgets: DisplayPreferencesValueSchema.shape.showWidgets.default(true),
  layout: DisplayPreferencesValueSchema.shape.layout.default('balanced'),
}).strict();

const command = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ v: z.literal(1), requestId: RequestIdSchema, type: z.literal(type), payload }).strict();

export const CommandRequestSchema = z.discriminatedUnion('type', [
  command('demo.simulate', EmptyPayloadSchema),
  command('demo.set-enabled', z.object({ enabled: z.boolean() }).strict()),
  command('demo.reset', EmptyPayloadSchema),
  command('widget.create', z.object({ widget: WidgetCreateSchema }).strict()),
  command('widget.update', z.object({ id: WidgetIdSchema, title: z.string().max(256).optional(), content: WidgetContentSchema.optional(), placement: z.enum(['primary', 'secondary', 'notification']).optional(), expiresAt: EpochSchema.nullable().optional() }).strict()),
  command('widget.set-visibility', z.object({ id: WidgetIdSchema, visible: z.boolean() }).strict()),
  command('widget.remove', z.object({ id: WidgetIdSchema }).strict()),
  command('state.set-progress', z.object({ progress: ProgressSchema.nullable() }).strict()),
  command('state.set-activity', z.object({ activity: ActivitySchema }).strict()),
  command('task.update', z.object({ task: TaskSchema, toolCategory: ToolCategorySchema.optional() }).strict()),
  command('task.complete', EmptyPayloadSchema),
  command('metric.set-value', z.object({ id: z.string().min(1).max(64), value: z.number().int().min(0).max(9_999_999) }).strict()),
  command('display.set-style', z.object({ style: DisplayStyleSchema }).strict()),
  command('display.preferences.set', z.object({ preferences: DisplayPreferencesValueSchema }).strict()),
]);

const normalizeLegacyWidget = (widget: Record<string, unknown>) => ({ version: 1, id: widget.id, owner: 'owner', title: widget.label, content: { kind: 'metric', label: widget.label, value: widget.value, caption: widget.sub }, placement: 'secondary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null });
export const ProtocolStateSchema = z.preprocess(value => {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as Record<string, unknown>).widgets)) return value;
  let visibleCount = 0;
  const widgets = (value as { widgets: unknown[] }).widgets.map(widget => {
    if (typeof widget !== 'object' || widget === null) return widget;
    const legacy = widget as Record<string, unknown>;
    if (!('label' in legacy) && !('value' in legacy) && !('sub' in legacy) && !('tone' in legacy)) {
      if (typeof legacy.visible === 'boolean' && legacy.visible) visibleCount++;
      return widget;
    }
    const exactKeys = Object.keys(legacy).sort().join(',') === 'id,label,sub,tone,value';
    if (!exactKeys || typeof legacy.id !== 'string' || typeof legacy.label !== 'string' || typeof legacy.value !== 'string' || typeof legacy.sub !== 'string' || !['purple', 'cyan', 'green', 'amber'].includes(String(legacy.tone))) return widget;
    const normalized = normalizeLegacyWidget(legacy);
    const result = { ...normalized, visible: visibleCount < 12 };
    if (result.visible) visibleCount++;
    return result;
  });
  return { ...value, widgets };
}, z.object({
  agent: z.string().max(256),
  task: z.string().max(2048),
  toolCategory: ToolCategorySchema.nullable().default(null),
  progress: ProgressSchema.nullable().default(null),
  turnStartedAt: z.number().int().safe().nonnegative().nullable().default(null),
  running: z.boolean(),
  activity: ActivitySchema.default('idle'),
  displayStyle: DisplayStyleSchema.default('quiet'),
  displayPreferences: DisplayPreferencesSchema.prefault({}),
  widgets: z.array(WidgetSchema).max(32),
  logs: z.array(z.object({
    id: z.number().int().safe().nonnegative(),
    time: z.string().max(32),
    title: z.string().max(256),
    detail: z.string().max(2048),
    level: z.enum(['info', 'success', 'warning']),
  }).strict()).max(40),
}).strict().superRefine((state, ctx) => {
  if (state.widgets.filter(widget => widget.visible).length > 12) ctx.addIssue({ code: 'custom', message: 'At most 12 widgets may be visible', path: ['widgets'] });
}));

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
    code: z.enum(['UNAUTHENTICATED', 'FORBIDDEN', 'PAIRING_INVALID', 'PAIRING_EXPIRED', 'NOT_FOUND', 'INVALID_COMMAND', 'INVALID_INPUT', 'CONFLICT', 'RATE_LIMITED', 'PERSISTENCE_FAILED', 'UNAVAILABLE']),
    message: z.string().min(1).max(256),
    requestId: RequestIdSchema,
  }).strict(),
}).strict();

export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type StateMessage = z.infer<typeof StateMessageSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
