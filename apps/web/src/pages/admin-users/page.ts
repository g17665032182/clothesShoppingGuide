import { computed, onMounted, ref } from 'vue';
import { disableUser, listUsers, updateUser } from '@/api/modules/users';
import type { User, UserRole } from '@/api/types/users';
import { auth } from '@/lib/auth';

export function useAdminUsersPage() {
  const users = ref<User[]>([]);
  const search = ref('');
  const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
  const error = ref('');
  const updatingUserId = ref<string | null>(null);

  const visibleUsers = computed(() => {
    const query = search.value.trim().toLowerCase();
    if (!query) return users.value;
    return users.value.filter((user) =>
      `${user.displayName} ${user.email}`.toLowerCase().includes(query),
    );
  });

  const loading = computed(() => status.value === 'loading');

  async function loadUsers() {
    if (!auth.state.token) return;

    status.value = 'loading';
    error.value = '';
    try {
      users.value = await listUsers(auth.state.token);
      status.value = 'success';
    } catch (cause) {
      status.value = 'error';
      error.value =
        cause instanceof Error ? cause.message : '无法读取用户列表。';
    }
  }

  async function setRole(user: User, role: UserRole) {
    if (!auth.state.token || user.role === role) return;

    updatingUserId.value = user.id;
    error.value = '';
    try {
      const updated = await updateUser(auth.state.token, user.id, { role });
      users.value = users.value.map((item) =>
        item.id === user.id ? updated : item,
      );
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '更新角色失败。';
    } finally {
      updatingUserId.value = null;
    }
  }

  async function toggleStatus(user: User) {
    if (!auth.state.token || user.id === auth.state.user?.id) return;

    updatingUserId.value = user.id;
    error.value = '';
    try {
      const updated =
        user.status === 'active'
          ? await disableUser(auth.state.token, user.id)
          : await updateUser(auth.state.token, user.id, { status: 'active' });
      users.value = users.value.map((item) =>
        item.id === user.id ? updated : item,
      );
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '更新状态失败。';
    } finally {
      updatingUserId.value = null;
    }
  }

  onMounted(() => {
    void loadUsers();
  });

  return {
    error,
    loading,
    loadUsers,
    search,
    setRole,
    status,
    toggleStatus,
    updatingUserId,
    users,
    visibleUsers,
  };
}
