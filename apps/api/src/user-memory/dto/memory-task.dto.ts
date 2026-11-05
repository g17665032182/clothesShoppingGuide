import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const flushMemoryTasksSchema = z.strictObject({
  conversationId: z.uuid(),
});

export type FlushMemoryTasksInput = z.infer<typeof flushMemoryTasksSchema>;

export class FlushMemoryTasksDto implements FlushMemoryTasksInput {
  @ApiProperty({ format: 'uuid', description: '需要提前释放任务的会话 ID' })
  public conversationId!: string;
}
