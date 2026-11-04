import { containsSensitiveText } from '../../common/security/sensitive-text.js';

export function containsSensitivePreferenceText(value: unknown): boolean {
  if (typeof value === 'string') return containsSensitiveText(value);
  const record =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const textValues = [
    record.garment,
    record.label,
    record.system,
    record.width,
    record.preference,
    record.notes,
    record.reason,
    ...(Array.isArray(record.items) ? record.items : []),
    ...(Array.isArray(record.terms) ? record.terms : []),
  ].filter((item): item is string => typeof item === 'string');
  return textValues.some(containsSensitiveText);
}
