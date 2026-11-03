/** 仅白名单正文块允许进入公开回答，未知块中的 text 不代表可公开文本。 */
export function visibleMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      if (typeof part !== 'object' || part === null) return '';
      const block = part as Record<string, unknown>;
      return (block.type === 'text' || block.type === 'output_text') &&
        typeof block.text === 'string'
        ? block.text
        : '';
    })
    .join('');
}
