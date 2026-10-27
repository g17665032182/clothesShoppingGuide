import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// 统一合并 Tailwind 类名，避免组件组合时出现样式冲突。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
