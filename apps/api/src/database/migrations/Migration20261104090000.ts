import { Migration } from '@mikro-orm/migrations';

export class Migration20261104090000 extends Migration {
  override name = 'Migration20261104090000';

  override up(): void {
    // 旧版本没有保存候选，部分成功的可运行任务无法在新链路精确重放。
    this.addSql(`
      do $$
      begin
        if to_regclass('user_preferences') is not null
           or to_regclass('user_preference_tasks') is not null
           or to_regclass('user_preference_settings') is not null
           or to_regclass('user_preference_task_results') is not null then
          raise exception 'PREFERENCE_SEPARATION_TARGET_EXISTS';
        end if;
        if exists (
          select 1 from user_memory_tasks t
          where (t.status in ('pending', 'failed') and t.attempts < 4
                 or t.status = 'processing' and t.attempts < 4)
            and (exists (select 1 from user_memory_task_results r where r.task_id = t.id)
              or exists (select 1 from user_memory_document_task_results r where r.task_id = t.id))
        ) then
          raise exception 'LEGACY_PARTIAL_TASKS_MUST_BE_DRAINED';
        end if;
      end $$;
    `);
    this.addSql('alter table user_memories rename to user_preferences;');
    this.addSql(`
      create table user_preference_settings (
        user_id uuid primary key,
        enabled boolean not null default true,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        constraint user_preference_settings_user_id_foreign
          foreign key (user_id) references users(id) on update cascade on delete cascade
      );
      insert into user_preference_settings
        select user_id, enabled, created_at, updated_at from user_memory_settings;
    `);
    this.addSql(`
      create table user_preference_tasks (
        id uuid primary key,
        user_id uuid not null,
        conversation_id uuid null,
        user_message_id uuid null,
        assistant_message_id uuid null,
        deduplication_key varchar(180) not null,
        status text not null default 'pending',
        attempts int not null default 0,
        available_at timestamptz not null,
        locked_at timestamptz null,
        last_error_code varchar(80) null,
        candidate_operations jsonb null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        constraint user_preference_tasks_status_check
          check (status in ('pending', 'processing', 'succeeded', 'failed')),
        constraint user_preference_tasks_attempts_check check (attempts >= 0),
        constraint user_preference_tasks_user_id_foreign
          foreign key (user_id) references users(id) on update cascade on delete cascade,
        constraint user_preference_tasks_conversation_id_foreign
          foreign key (conversation_id) references chat_conversations(id) on update cascade on delete set null
      );
      create unique index user_preference_tasks_deduplication_key_unique
        on user_preference_tasks(deduplication_key);
      create index user_preference_tasks_claim_index
        on user_preference_tasks(status, available_at, created_at);
      create index user_preference_tasks_user_index
        on user_preference_tasks(user_id, created_at desc);
      insert into user_preference_tasks (
        id, user_id, conversation_id, user_message_id, assistant_message_id,
        deduplication_key, status, attempts, available_at, locked_at,
        last_error_code, created_at, updated_at
      )
      select id, user_id, conversation_id, user_message_id, assistant_message_id,
        deduplication_key, status, attempts, available_at, locked_at,
        last_error_code, created_at, updated_at
      from user_memory_tasks;
    `);
    this.addSql(`
      alter table user_memory_task_results rename to user_preference_task_results;
      alter table user_preference_task_results rename column memory_id to preference_id;
      alter table user_preference_task_results drop constraint user_memory_task_results_task_id_foreign;
      alter table user_preference_task_results add constraint user_preference_task_results_task_id_foreign
        foreign key (task_id) references user_preference_tasks(id) on update cascade on delete cascade;
      alter table user_memory_tasks add column candidate_operations jsonb null;
    `);
    // 只改属于重命名表的约束和索引，不重建数据或修改历史操作键。
    for (const [table, previous] of [
      ['user_preferences', 'user_memories'],
      ['user_preference_task_results', 'user_memory_task_results'],
    ]) {
      this.addSql(`
        do $$
        declare item record;
        begin
          for item in select conname from pg_constraint
            where conrelid = '${table}'::regclass
              and starts_with(conname, '${previous}_')
          loop
            execute format('alter table %I rename constraint %I to %I',
              '${table}', item.conname, replace(item.conname, '${previous}_', '${table}_'));
          end loop;
          for item in select indexname from pg_indexes
            where schemaname = current_schema() and tablename = '${table}'
              and starts_with(indexname, '${previous}_')
          loop
            execute format('alter index %I rename to %I',
              item.indexname, replace(item.indexname, '${previous}_', '${table}_'));
          end loop;
        end $$;
      `);
    }
    for (const table of ['user_preference_tasks', 'user_memory_tasks']) {
      this.addSql(`
        update ${table}
        set status = case when attempts < 4 then 'pending' else 'failed' end,
            available_at = case when attempts < 4 then greatest(available_at, now()) else available_at end,
            locked_at = null
        where status = 'processing';
      `);
    }
    this.addSql(`
      do $$
      begin
        if (select count(*) from user_preference_tasks) <> (select count(*) from user_memory_tasks)
           or exists (
             select 1 from user_memory_tasks m full join user_preference_tasks p using (id)
             where m.id is null or p.id is null
               or m.user_id <> p.user_id or m.attempts <> p.attempts
               or m.created_at <> p.created_at or m.updated_at <> p.updated_at
           )
           or exists (
             select 1 from user_memory_settings m full join user_preference_settings p using(user_id)
             where m.user_id is null or p.user_id is null
               or m.enabled <> p.enabled or m.updated_at <> p.updated_at
           ) then
          raise exception 'PREFERENCE_SEPARATION_INTEGRITY_FAILED';
        end if;
      end $$;
    `);
  }

  override down(): never {
    throw new Error('SEPARATION_REQUIRES_CONSISTENT_BACKUP_RESTORE');
  }
}
