<script setup lang="ts">
import { Search, ShieldCheck, UserRound, UserRoundX } from '@lucide/vue';
import type { User, UserRole } from '@/api/types/users';

defineProps<{
  currentUserId?: string;
  error: string;
  loading: boolean;
  search: string;
  updatingUserId: string | null;
  users: User[];
  visibleUsers: User[];
}>();

const emit = defineEmits<{
  (event: 'refresh'): void;
  (event: 'update:search', value: string): void;
  (event: 'set-role', user: User, role: UserRole): void;
  (event: 'toggle-status', user: User): void;
}>();
</script>

<template>
  <div class="table-toolbar">
    <label class="search-box">
      <Search :size="17" aria-hidden="true" />
      <span class="sr-only">搜索用户</span>
      <input
        :value="search"
        aria-label="搜索用户"
        placeholder="搜索昵称或邮箱"
        @input="
          emit('update:search', ($event.target as HTMLInputElement).value)
        "
      />
    </label>
    <button class="subtle-button" type="button" @click="emit('refresh')">
      刷新列表
    </button>
  </div>

  <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  <div class="table-frame">
    <table class="user-table">
      <caption class="sr-only">
        用户管理列表
      </caption>
      <thead>
        <tr>
          <th scope="col">用户</th>
          <th scope="col">角色</th>
          <th scope="col">状态</th>
          <th scope="col">注册时间</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="5" class="table-message">正在加载用户…</td>
        </tr>
        <tr v-else-if="visibleUsers.length === 0">
          <td colspan="5" class="table-message">没有找到匹配的用户。</td>
        </tr>
        <template v-else>
          <tr v-for="user in visibleUsers" :key="user.id">
            <td>
              <div class="table-user">
                <span class="table-avatar">{{
                  user.displayName.slice(0, 1)
                }}</span>
                <span class="table-user-copy">
                  <strong>{{ user.displayName }}</strong>
                  <small>{{ user.email }}</small>
                </span>
              </div>
            </td>
            <td>
              <label class="sr-only" :for="`role-${user.id}`">
                设置 {{ user.displayName }} 的角色
              </label>
              <select
                :id="`role-${user.id}`"
                :disabled="updatingUserId === user.id"
                :value="user.role"
                class="compact-select"
                @change="
                  emit(
                    'set-role',
                    user,
                    ($event.target as HTMLSelectElement).value as UserRole,
                  )
                "
              >
                <option value="user">用户</option>
                <option value="admin">管理员</option>
              </select>
            </td>
            <td>
              <span class="status-label" :class="user.status">
                {{ user.status === 'active' ? '正常' : '已禁用' }}
              </span>
            </td>
            <td>{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</td>
            <td>
              <button
                class="table-action"
                :disabled="
                  updatingUserId === user.id || user.id === currentUserId
                "
                :title="
                  user.id === currentUserId
                    ? '不能在此处禁用当前账户'
                    : user.status === 'active'
                      ? '禁用账户'
                      : '恢复账户'
                "
                type="button"
                @click="emit('toggle-status', user)"
              >
                <component
                  :is="user.status === 'active' ? UserRoundX : ShieldCheck"
                  :size="16"
                  aria-hidden="true"
                />
                {{ user.status === 'active' ? '禁用' : '恢复' }}
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
  <div class="list-summary">
    <UserRound :size="16" aria-hidden="true" />
    显示 {{ visibleUsers.length }} / {{ users.length }} 个账户
  </div>
</template>
