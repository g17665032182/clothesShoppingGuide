import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { disableUser, listUsers, updateUser } from '@/api/modules/users';
import type { User, UserRole } from '@/api/types/users';
import { auth } from '@/lib/auth';

export function useAdminUsersPage() {
  const users = ref<User[]>([]);
  const search = ref('');
  const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
  const error = ref('');
  useErrorToast(() => error.value);
  const updatingUserId = ref<string | null>(null);
  let disposed = false;
  onBeforeUnmount(() => {
    disposed = true;
  });

  function captureIdentity() {
    const userId = auth.state.user?.id;
    return () => !disposed && userId === auth.state.user?.id;
  }

  const visibleUsers = computed(() => {
    const query = search.value.trim().toLowerCase();
    if (!query) return users.value;
    return users.value.filter((user) =>
      `${user.displayName} ${user.email}`.toLowerCase().includes(query),
    );
  });

  const loading = computed(() => status.value === 'loading');

  async function loadUsers() {
    if (!auth.state.token || loading.value) return;
    const isCurrent = captureIdentity();

    status.value = 'loading';
    error.value = '';
    try {
      const result = await listUsers(auth.state.token);
      if (!isCurrent()) return;
      users.value = result;
      status.value = 'success';
    } catch (cause) {
      if (!isCurrent()) return;
      status.value = 'error';
      error.value =
        cause instanceof Error ? cause.message : '无法读取用户列表。';
    }
  }

  async function setRole(user: User, role: UserRole) {
    if (!auth.state.token || user.role === role || updatingUserId.value) return;
    const isCurrent = captureIdentity();

    updatingUserId.value = user.id;
    error.value = '';
    try {
      const updated = await updateUser(auth.state.token, user.id, { role });
      if (!isCurrent()) return;
      users.value = users.value.map((item) =>
        item.id === user.id ? updated : item,
      );
      toast.success('用户角色已更新');
    } catch (cause) {
      if (!isCurrent()) return;
      error.value = cause instanceof Error ? cause.message : '更新角色失败。';
    } finally {
      updatingUserId.value = null;
    }
  }

  async function toggleStatus(user: User) {
    if (
      !auth.state.token ||
      user.id === auth.state.user?.id ||
      updatingUserId.value
    )
      return;
    const isCurrent = captureIdentity();

    updatingUserId.value = user.id;
    error.value = '';
    try {
      const updated =
        user.status === 'active'
          ? await disableUser(auth.state.token, user.id)
          : await updateUser(auth.state.token, user.id, { status: 'active' });
      if (!isCurrent()) return;
      users.value = users.value.map((item) =>
        item.id === user.id ? updated : item,
      );
      toast.success(updated.status === 'active' ? '用户已启用' : '用户已禁用');
    } catch (cause) {
      if (!isCurrent()) return;
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
