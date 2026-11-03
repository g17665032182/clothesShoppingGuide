import type { MemoryCategory } from '@/api/types/memories';

export type PreferenceOption = { value: string; label: string };
const options = (entries: [string, string][]): PreferenceOption[] =>
  entries.map(([value, label]) => ({ value, label }));

export const itemPresets: Partial<Record<MemoryCategory, PreferenceOption[]>> =
  {
    style: options([
      ['minimal', '简约'],
      ['commute', '通勤'],
      ['street', '街头'],
      ['casual', '休闲'],
      ['formal', '正式'],
      ['sporty', '运动'],
      ['vintage', '复古'],
      ['outdoor', '户外'],
      ['other', '其他'],
    ]),
    occasion: options([
      ['commute', '日常通勤'],
      ['casual', '日常休闲'],
      ['formal', '正式场合'],
      ['outdoor', '户外活动'],
      ['travel', '旅行出游'],
      ['sport', '运动健身'],
      ['home', '居家'],
      ['party', '聚会'],
      ['other', '其他'],
    ]),
    color: options([
      ['黑色', '黑色'],
      ['白色', '白色'],
      ['灰色', '灰色'],
      ['蓝色', '蓝色'],
      ['米色', '米色'],
      ['绿色', '绿色'],
      ['红色', '红色'],
      ['粉色', '粉色'],
    ]),
    avoidance: options([
      ['紧身版型', '紧身版型'],
      ['大面积印花', '大面积印花'],
      ['荧光色', '荧光色'],
      ['易皱面料', '易皱面料'],
      ['不透气面料', '不透气面料'],
      ['难打理', '难打理'],
    ]),
    purchase_preference: options([
      ['quality', '品质优先'],
      ['price', '价格优先'],
      ['easy_care', '易打理'],
      ['sustainable', '环保可持续'],
      ['online', '线上购买'],
      ['offline', '线下购买'],
      ['durable', '耐穿耐用'],
      ['other', '其他'],
    ]),
  };

export const garmentPresets = options([
  ['top', '上装'],
  ['bottom', '下装'],
  ['dress', '连衣裙'],
  ['outerwear', '外套'],
  ['unknown', '未指定'],
]);
export const systemPresets = options([
  ['CN', '中国码'],
  ['US', '美国码'],
  ['EU', '欧洲码'],
  ['UK', '英国码'],
  ['INT', '国际码'],
  ['OTHER', '其他尺码'],
]);
export const fitPresets = options([
  ['loose', '宽松'],
  ['regular', '合身'],
  ['slim', '修身'],
]);
export const widthPresets = options([
  ['narrow', '偏窄'],
  ['regular', '标准鞋宽'],
  ['wide', '偏宽'],
]);
export const textPresets = (values: string[]): PreferenceOption[] =>
  values.map((value) => ({ value, label: value }));

export function presetLabel(
  value: string,
  presets: PreferenceOption[],
): string {
  return presets.find((option) => option.value === value)?.label ?? value;
}
export function presetValue(text: string, presets: PreferenceOption[]): string {
  const value = text.trim();
  return presets.find((option) => option.label === value)?.value ?? value;
}
export function splitPreferenceItems(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、\n]/u)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}
export function normalizePreferenceItems(
  text: string,
  presets: PreferenceOption[],
): string[] {
  return [
    ...new Set(
      splitPreferenceItems(text).map((value) => presetValue(value, presets)),
    ),
  ];
}
export function itemLimit(category: MemoryCategory): number {
  if (category === 'style' || category === 'occasion') return 5;
  return category === 'purchase_preference' ? 6 : 8;
}
