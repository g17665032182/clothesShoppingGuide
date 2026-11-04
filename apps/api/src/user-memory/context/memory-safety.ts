import { containsSensitiveText } from '../../common/security/sensitive-text.js';

export function containsSensitiveMemoryText(text: string): boolean {
  return containsSensitiveText(text);
}
