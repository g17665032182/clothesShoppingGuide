/** 通过最终展示绑定把模型 trace 轮次关联到真实消息资格，不能混用两套消息 ID。 */
export function eligibleSummaryTraceIds(
  traces: Array<{
    runId: string;
    sequence: number;
    messageId: string | null;
    payload: unknown;
  }>,
  messages: Array<{ id: string; memoryExtractionEligible: boolean }>,
): Set<string> {
  const visible = new Map(
    messages.map((message) => [
      message.id,
      message.memoryExtractionEligible !== false,
    ]),
  );
  const runEligibility = new Map<string, boolean>();
  for (const trace of traces) {
    const payload = trace.payload as {
      publicDisplay?: { assistantMessageId?: unknown };
    } | null;
    const id = payload?.publicDisplay?.assistantMessageId;
    if (typeof id === 'string' && visible.has(id))
      runEligibility.set(trace.runId, visible.get(id)!);
  }
  const allowed = new Set<string>();
  for (const trace of traces) {
    const eligible =
      runEligibility.get(trace.runId) ??
      (trace.messageId ? visible.get(trace.messageId) : false);
    // 未绑定的失败/取消运行不作为摘要来源，避免从未完成轮次重建收货细节。
    if (eligible)
      allowed.add(
        `${trace.runId}:${trace.messageId ?? `trace-${trace.sequence}`}`,
      );
  }
  return allowed;
}
