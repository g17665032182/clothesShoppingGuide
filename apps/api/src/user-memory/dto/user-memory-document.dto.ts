import { ApiProperty } from '@nestjs/swagger';

import type { UpdateMemoryDocumentInput } from '../context/memory-document.schema.js';

export type UserMemoryDocumentResponse = {
  content: string;
  revision: number;
  updatedAt: string | null;
};

export class UserMemoryDocumentDto implements UserMemoryDocumentResponse {
  @ApiProperty({ type: String })
  public content!: string;

  @ApiProperty({ type: Number, minimum: 0 })
  public revision!: number;

  @ApiProperty({ type: String, nullable: true })
  public updatedAt!: string | null;
}

export class UpdateUserMemoryDocumentDto implements UpdateMemoryDocumentInput {
  @ApiProperty({ type: String, description: '完整 Markdown 记忆文档' })
  public content!: string;

  @ApiProperty({ type: Number, minimum: 0, description: '编辑前的文档版本' })
  public expectedRevision!: number;
}

export type { UpdateMemoryDocumentInput };
export { updateMemoryDocumentSchema } from '../context/memory-document.schema.js';
