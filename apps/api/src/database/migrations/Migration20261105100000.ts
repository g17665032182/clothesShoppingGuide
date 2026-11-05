import { Migration } from '@mikro-orm/migrations';

export class Migration20261105100000 extends Migration {
  override name = 'Migration20261105100000';

  override up(): void {
    this.addSql(
      'alter table user_memory_tasks add column source_turns jsonb null;',
    );
    this.addSql(`
      alter table user_memory_tasks
      add constraint user_memory_tasks_source_turns_array_check
      check (source_turns is null or jsonb_typeof(source_turns) = 'array');
    `);
  }

  override down(): void {
    this.addSql(`
      do $$
      begin
        if exists (
          select 1 from user_memory_tasks
          where jsonb_typeof(source_turns) = 'array'
            and jsonb_array_length(source_turns) > 1
            and status in ('pending', 'processing', 'failed')
            and attempts < 4
        ) then
          raise exception 'ACTIVE_MEMORY_BATCHES_REQUIRE_FORWARD_MIGRATION';
        end if;
      end $$;
    `);
    this.addSql(
      'alter table user_memory_tasks drop constraint user_memory_tasks_source_turns_array_check;',
    );
    this.addSql('alter table user_memory_tasks drop column source_turns;');
  }
}
