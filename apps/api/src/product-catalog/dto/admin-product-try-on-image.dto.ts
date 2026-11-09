import { z } from 'zod';

/** multipart 文件由图片处理服务校验，额外文本字段仍使用统一 Zod 管道拒绝。 */
export const adminProductTryOnImageBodySchema = z.strictObject({}).default({});
