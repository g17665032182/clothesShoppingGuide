import { z } from 'zod';

import { containsSensitiveMemoryText } from './memory-safety.js';

export const MEMORY_DOCUMENT_MAX_BYTES = 32 * 1024;

function hasValidUnicode(content: string): boolean {
  for (let index = 0; index < content.length; index += 1) {
    const codeUnit = content.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = content.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export const memoryDocumentContentSchema = z
  .string()
  .refine(
    (content) =>
      Buffer.byteLength(content, 'utf8') <= MEMORY_DOCUMENT_MAX_BYTES,
    '记忆文档不能超过 32 KiB',
  )
  .refine(hasValidUnicode, '记忆文档包含不合法 Unicode')
  .refine((content) => !content.includes('\u0000'), '记忆文档包含非法字符')
  .refine((content) => !containsSensitiveMemoryText(content), {
    message: '记忆文档包含不允许保存的信息',
  });

export const updateMemoryDocumentSchema = z.strictObject({
  content: memoryDocumentContentSchema,
  expectedRevision: z.number().int().min(0),
});

export type UpdateMemoryDocumentInput = z.infer<
  typeof updateMemoryDocumentSchema
>;
