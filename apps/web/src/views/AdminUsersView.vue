<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Search, ShieldCheck, UserRound, UserRoundX } from '@lucide/vue';
import { apiRequest, type User } from '@/lib/api';
import { auth } from '@/lib/auth';

const users = ref<User[]>([]);
const search = ref('');
const loading = ref(true);
const error = ref('');
const updating = ref<string | null>(null);

const visibleUsers = () => {
  const query = search.value.trim().toLowerCase();
  return users.value.filter((user) =>
    `${user.displayName} ${user.email}`.toLowerCase().includes(query),
  );
};

async function loadUsers() {
  loading.value = true;
  error.value = '';
  try {
    users.value = await apiRequest<User[]>(
      '/users',
      {},
      auth.state.token ?? undefined,
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取用户列表。';
  } finally {
    loading.value = false;
  }
}

async function setRole(user: User, role: User['role']) {
  updating.value = user.id;
  try {
    const updated = await apiRequest<User>(
      `/users/${user.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      },
      auth.state.token ?? undefined,
    );
    users.value = users.value.map((item) =>
      item.id === user.id ? updated : item,
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '更新角色失败。';
  } finally {
    updating.value = null;
  }
}

async function toggleStatus(user: User) {
  if (user.id === auth.state.user?.id) return;
  updating.value = user.id;
  try {
    const updated =
      user.status === 'active'
        ? await apiRequest<User>(
            `/users/${user.id}`,
            { method: 'DELETE' },
            auth.state.token ?? undefined,
          )
        : await apiRequest<User>(
            `/users/${user.id}`,
            {
              method: 'PATCH',
              body: JSON.stringify({ status: 'active' }),
            },
            auth.state.token ?? undefined,
          );
    users.value = users.value.map((item) =>
      item.id === user.id ? updated : item,
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '更新状态失败。';
  } finally {
    updating.value = null;
  }
}

onMounted(loadUsers);
</script>

<template>
  <section class="content-section">
    <div class="page-heading admin-heading">
      <div>
        <p class="eyebrow">管理</p>
        <h1>用户</h1>
        <p>查看账户并管理访问状态与角色。</p>
      </div>
      <div class="user-count">{{ users.length }} 个账户</div>
    </div>

    <div class="table-toolbar">
      <label class="search-box">
        <Search :size="17" />
        <input
          v-model="search"
          aria-label="搜索用户"
          placeholder="搜索昵称或邮箱"
        />
      </label>
      <button class="subtle-button" @click="loadUsers">刷新列表</button>
    </div>

    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="table-frame">
      <table class="user-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="table-message">正在加载用户…</td>
          </tr>
          <tr v-else-if="visibleUsers().length === 0">
            <td colspan="5" class="table-message">没有找到匹配的用户。</td>
          </tr>
          <tr v-for="user in visibleUsers()" v-else :key="user.id">
            <td>
              <div class="table-user">
                <span class="table-avatar">{{
                  user.displayName.slice(0, 1)
                }}</span>
                <span class="table-user-copy"
                  ><strong>{{ user.displayName }}</strong
                  ><small>{{ user.email }}</small></span
                >
              </div>
            </td>
            <td>
              <label class="sr-only" :for="`role-${user.id}`"
                >设置 {{ user.displayName }} 的角色</label
              >
              <select
                :id="`role-${user.id}`"
                :value="user.role"
                :disabled="updating === user.id"
                class="compact-select"
                @change="
                  setRole(
                    user,
                    ($event.target as HTMLSelectElement).value as User['role'],
                  )
                "
              >
                <option value="user">用户</option>
                <option value="admin">管理员</option>
              </select>
            </td>
            <td>
              <span class="status-label" :class="user.status">{{
                user.status === 'active' ? '正常' : '已禁用'
              }}</span>
            </td>
            <td>{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</td>
            <td>
              <button
                class="table-action"
                :disabled="
                  updating === user.id || user.id === auth.state.user?.id
                "
                :title="
                  user.id === auth.state.user?.id
                    ? '不能在此处禁用当前账户'
                    : user.status === 'active'
                      ? '禁用账户'
                      : '恢复账户'
                "
                @click="toggleStatus(user)"
              >
                <component
                  :is="user.status === 'active' ? UserRoundX : ShieldCheck"
                  :size="16"
                />
                {{ user.status === 'active' ? '禁用' : '恢复' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="list-summary">
      <UserRound :size="16" />
      显示 {{ visibleUsers().length }} / {{ users.length }} 个账户
    </div>
  </section>
</template>
