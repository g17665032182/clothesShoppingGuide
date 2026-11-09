import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 仅由试穿适配器调用；不挂载静态路由，避免本地私有文件被目录遍历访问。 */
@Injectable()
export class LocalPrivateObjectStorageService {
  private readonly root: string;

  public constructor(config: ConfigService) {
    this.root = path.resolve(
      process.cwd(),
      config.get<string>('TRY_ON_LOCAL_STORAGE_PATH') ??
        './.local-private/try-on',
    );
  }

  public async put(key: string, body: Buffer): Promise<void> {
    const target = this.target(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, body, { flag: 'wx', mode: 0o600 });
  }

  public async get(key: string): Promise<Buffer> {
    return readFile(this.target(key));
  }

  public async delete(key: string): Promise<void> {
    try {
      await unlink(this.target(key));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return;
      throw error;
    }
  }

  private target(key: string): string {
    if (
      !/^[a-z0-9][a-z0-9/_-]*\.(?:jpg|png|webp)$/iu.test(key) ||
      key.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('invalid local object key');
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`))
      throw new Error('invalid local object key');
    return target;
  }
}
