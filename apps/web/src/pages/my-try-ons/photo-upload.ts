const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function getPhotoUploadError(file: File): string | null {
  // 浏览器声明仅用于提前反馈，服务端仍按实际文件内容独立校验。
  if (!PHOTO_MIME_TYPES.has(file.type)) {
    return '仅支持 JPEG、PNG 或 WebP 图片，不支持 GIF';
  }
  if (file.size === 0) return '图片文件不能为空';
  if (file.size > MAX_PHOTO_BYTES) return '图片大小不能超过 10 MiB';
  return null;
}
