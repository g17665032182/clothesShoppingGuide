import { randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

import { z } from 'zod';

import type { LlmUsage } from '../../llm/graph/llm.state.js';
import type {
  ChatActivity,
  ChatContextUsage,
  ChatDisplayData,
  ChatSource,
  PublicDisplayEnvelope,
} from './chat-display.types.js';

export const MAX_DISPLAY_BYTES = 16_384;
export const MAX_TRACE_PAYLOAD_BYTES = 32_768;
const BINDING_ID_RESERVATION = '00000000-0000-4000-8000-000000000000';

const activitySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool'),
    id: z.string().trim().min(1),
    toolName: z.string(),
    status: z.enum(['running', 'success', 'error', 'interrupted']),
  }),
  z.object({
    type: z.literal('reasoning'),
    id: z.string().trim().min(1),
    summary: z.string().trim().min(1),
  }),
]);

const envelopeSchema = z.object({
  version: z.literal(1),
  assistantMessageId: z.uuid(),
  activities: z.array(activitySchema),
  sources: z.array(
    z.object({
      id: z.string().trim().min(1),
      title: z.string(),
      url: z.string(),
    }),
  ),
  context: z
    .object({
      contextWindowTokens: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER),
      inputTokens: z.unknown(),
      outputTokens: z.unknown(),
      usedTokens: z.unknown(),
    })
    .nullable(),
});

const privateIpv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  privateIpv4.addSubnet(address, prefix, 'ipv4');
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const reservedIpv6 = new BlockList();
reservedIpv6.addSubnet('2001::', 23, 'ipv6');
reservedIpv6.addSubnet('2001:db8::', 32, 'ipv6');
reservedIpv6.addSubnet('2002::', 16, 'ipv6');

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function safeToolName(name: string): string {
  return name === 'local_echo_tool' || name === '本地验证工具'
    ? '本地验证工具'
    : '工具';
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function projectContext(
  contextWindowTokens: number,
  usage: Pick<LlmUsage, 'inputTokens' | 'outputTokens'> | null,
): ChatContextUsage {
  const inputTokens = tokenCount(usage?.inputTokens);
  const outputTokens = tokenCount(usage?.outputTokens);
  const sum =
    inputTokens === null || outputTokens === null
      ? null
      : inputTokens + outputTokens;
  return {
    contextWindowTokens,
    inputTokens,
    outputTokens,
    usedTokens: tokenCount(sum),
  };
}

export function publicSourceUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) {
    return null;
  }

  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  const family = isIP(hostname);
  if (family === 4) {
    return privateIpv4.check(hostname, 'ipv4') ? null : parsed;
  }
  if (family === 6) {
    return globalIpv6.check(hostname, 'ipv6') &&
      !reservedIpv6.check(hostname, 'ipv6')
      ? parsed
      : null;
  }
  // 只检查字面地址与保留域名，不做 DNS、预览或 favicon 网络请求。
  if (
    !hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/i.test(
      hostname,
    )
  ) {
    return null;
  }
  return parsed;
}

export function projectSources(
  sources: Array<{ id: string; title: string; url: string }>,
  identities: Map<string, string>,
  preserveIds = false,
  createId: (url: string) => string = () => randomUUID(),
): ChatSource[] {
  const result: ChatSource[] = [];
  const positions = new Map<string, number>();
  const usedIds = new Set<string>();
  for (const source of sources) {
    const parsed = publicSourceUrl(source.url);
    if (!parsed) continue;
    const url = parsed.toString();
    const title = source.title.trim() || parsed.hostname;
    const position = positions.get(url);
    if (position !== undefined) {
      if (source.title.trim()) result[position]!.title = title;
      continue;
    }

    const id = identities.get(url) ?? (preserveIds ? source.id : createId(url));
    // 历史中的不同来源共用 ID 会破坏前端稳定键，拒绝恢复该快照。
    if (usedIds.has(id)) throw new Error('来源标识重复');
    identities.set(url, id);
    usedIds.add(id);
    positions.set(url, result.length);
    result.push({ id, title, url });
  }
  return result;
}

export function displayEnvelope(
  data: ChatDisplayData,
  assistantMessageId = BINDING_ID_RESERVATION,
): PublicDisplayEnvelope {
  return {
    version: 1,
    assistantMessageId,
    activities: data.activities,
    sources: data.sources,
    context: data.context,
  };
}

export function reservedDisplayBytes(data: ChatDisplayData): number {
  return jsonBytes(
    displayEnvelope({
      activities: data.activities,
      sources: data.sources,
      // 在发送活动前预留最终用量数字，避免实时成功而最终绑定超限。
      context: {
        contextWindowTokens:
          data.context?.contextWindowTokens ?? Number.MAX_SAFE_INTEGER,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: Number.MAX_SAFE_INTEGER,
        usedTokens: Number.MAX_SAFE_INTEGER,
      },
    }),
  );
}

export function restoreDisplay(value: unknown): PublicDisplayEnvelope | null {
  if (!isRecord(value)) return null;
  if (jsonBytes(value) > MAX_DISPLAY_BYTES) return null;
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const source = parsed.data;
  const activityIds = new Set<string>();
  const activities: ChatActivity[] = [];
  for (const activity of source.activities) {
    if (activityIds.has(activity.id)) return null;
    activityIds.add(activity.id);
    activities.push(
      activity.type === 'tool'
        ? {
            type: 'tool',
            id: activity.id,
            toolName: safeToolName(activity.toolName),
            status: activity.status,
            input: null,
            output: null,
          }
        : {
            type: 'reasoning',
            id: activity.id,
            summary: activity.summary,
          },
    );
  }
  const sources = projectSources(source.sources, new Map(), true);
  const context = source.context
    ? projectContext(source.context.contextWindowTokens, {
        inputTokens: tokenCount(source.context.inputTokens),
        outputTokens: tokenCount(source.context.outputTokens),
      })
    : null;
  return displayEnvelope(
    { activities, sources, context },
    source.assistantMessageId,
  );
}
