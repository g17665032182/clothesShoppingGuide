import type { GrammarState } from 'shiki/core';
import type { MaybeRefOrGetter } from 'vue';
import type { HighlightedToken, Highlighter } from './highlighter';
import { computed, shallowRef, toValue, watch } from 'vue';
import { loadHighlighter } from './highlighter';

export function useHighlightedCode(
  value: MaybeRefOrGetter<string>,
  language: MaybeRefOrGetter<string>,
) {
  const highlighter = shallowRef<Highlighter | null>(null);

  watch(
    () => toValue(language),
    (lang, _, onCleanup) => {
      // 仅在浏览器运行高亮，服务端保留纯文本。
      if (typeof window === 'undefined') return;

      let cancelled = false;
      onCleanup(() => (cancelled = true));
      highlighter.value = null;

      loadHighlighter(lang)
        .then((next) => {
          if (!cancelled) highlighter.value = next;
        })
        .catch(() => {});
    },
    { immediate: true },
  );

  // 缓存完整行与末行语法状态，流式追加时只重新处理新增部分。
  let done: {
    highlighter: Highlighter | null;
    text: string;
    lines: HighlightedToken[][];
    state?: GrammarState;
  } = { highlighter: null, text: '', lines: [] };

  return computed<HighlightedToken[][]>(() => {
    const raw = toValue(value);
    // 尾部换行不额外占用一个空白行。
    const code = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    const current = highlighter.value;

    if (!current)
      return code.split('\n').map((line) => (line ? [{ content: line }] : []));

    if (done.highlighter !== current || !code.startsWith(done.text))
      done = { highlighter: current, text: '', lines: [] };

    const end = code.lastIndexOf('\n') + 1;

    if (end > done.text.length) {
      const result = current.highlight(
        code.slice(done.text.length, end - 1),
        done.state,
      );

      done = {
        highlighter: current,
        text: code.slice(0, end),
        lines: [...done.lines, ...result.lines],
        state: result.state,
      };
    }

    // 末行尚未结束，随每次增量重新分词。
    const tail = current.highlight(code.slice(end), done.state).lines[0] ?? [];

    return [...done.lines, tail];
  });
}
