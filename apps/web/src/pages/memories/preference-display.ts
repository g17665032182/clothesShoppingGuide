import type { MemoryCategory, MemoryRecord } from '@/api/types/memories';
import { itemPresets, presetLabel } from './preference-options';

export const memoryCategories: Array<{ value: MemoryCategory; label: string }> =
  [
    { value: 'size', label: '服装尺码' },
    { value: 'shoe_size', label: '鞋码' },
    { value: 'fit', label: '版型' },
    { value: 'style', label: '风格' },
    { value: 'color', label: '颜色' },
    { value: 'occasion', label: '穿着场景' },
    { value: 'budget', label: '预算' },
    { value: 'avoidance', label: '避开偏好' },
    { value: 'purchase_preference', label: '购买偏好' },
  ];

export function categoryLabel(category: MemoryCategory): string {
  return memoryCategories.find((item) => item.value === category)?.label ?? '';
}

const garmentLabels: Record<string, string> = {
  top: '上装',
  bottom: '下装',
  dress: '连衣裙',
  outerwear: '外套',
  unknown: '',
};
const fitLabels: Record<string, string> = {
  loose: '宽松',
  regular: '合身',
  slim: '修身',
};
const widthLabels: Record<string, string> = {
  narrow: '偏窄',
  regular: '标准鞋宽',
  wide: '偏宽',
};
const systemLabels: Record<string, string> = {
  CN: '中国码',
  US: '美国码',
  EU: '欧洲码',
  UK: '英国码',
  INT: '国际码',
  OTHER: '其他尺码',
};

export function formatMemoryValue(memory: MemoryRecord): string {
  const value = memory.value as Record<string, unknown>;
  const system =
    systemLabels[String(value.system)] ?? String(value.system ?? '');
  switch (memory.category) {
    case 'size':
      return [
        garmentLabels[String(value.garment)] ?? value.garment,
        value.label,
        system,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'shoe_size':
      return [
        value.value,
        system,
        widthLabels[String(value.width ?? 'regular')] ?? value.width,
      ]
        .filter((item) => item !== undefined && item !== '')
        .join(' · ');
    case 'fit':
      return [
        fitLabels[String(value.preference)] ?? value.preference,
        value.notes,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'budget': {
      const currency = value.currency === 'USD' ? '美元' : '元';
      const amount = (input: unknown) => Number(input).toLocaleString('zh-CN');
      // 单边预算使用自然语言，避免把“不限”当成区间端点。
      if (value.min === undefined)
        return `${amount(value.max)} ${currency}以内`;
      if (value.max === undefined) return `${amount(value.min)} ${currency}起`;
      return `${amount(value.min)} – ${amount(value.max)} ${currency}`;
    }
    case 'avoidance':
      return [(value.terms as string[]).join('、'), value.reason]
        .filter(Boolean)
        .join(' · ');
    default: {
      const items = Array.isArray(value.items)
        ? value.items
            .map((item) =>
              presetLabel(String(item), itemPresets[memory.category] ?? []),
            )
            .join('、')
        : '';
      return memory.category === 'color'
        ? `${value.mode === 'avoid' ? '避免' : '喜欢'} · ${items}`
        : items;
    }
  }
}

export function formatMemorySource(memory: MemoryRecord): string {
  if (!memory.source) return '手动添加';
  if (memory.source.status === 'deleted') return '原聊天已删除';
  if (memory.source.status === 'unavailable') return '来源不可用';
  return '聊天提取';
}

export function formatMemoryDate(date: string): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
