import {
  Catch,
  PayloadTooLargeException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

/** Multer 的内存大小门槛保持生效，仅将状态码映射到已确认的图片上传契约。 */
@Catch(PayloadTooLargeException)
export class ProductTryOnImageSizeFilter implements ExceptionFilter {
  public catch(
    _exception: PayloadTooLargeException,
    host: ArgumentsHost,
  ): void {
    host
      .switchToHttp()
      .getResponse<{
        status(code: number): { json(body: unknown): void };
      }>()
      .status(400)
      .json({ statusCode: 400, message: '图片文件不能超过 10 MiB' });
  }
}
