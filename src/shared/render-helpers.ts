export const escapeHTML = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function safeProgress(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Progress must be between 0 and 100');
  return value;
}
