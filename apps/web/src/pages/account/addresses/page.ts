import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { toast } from 'vue-sonner';
import { ApiError } from '@/api';
import {
  createUserAddress,
  deleteUserAddress,
  listUserAddresses,
  updateUserAddress,
} from '@/api/modules/user-addresses';
import type {
  CreateUserAddressPayload,
  UserAddress,
  UserAddressFormValue,
  UserAddressPage,
} from '@/api/types/user-addresses';
import { auth } from '@/lib/auth';
import { useErrorToast } from '@/composables/use-error-toast';

type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
type MutationStatus = 'idle' | 'submitting' | 'unknown' | 'error';

const PAGE_SIZE = 20;

function emptyPage(page = 1): UserAddressPage {
  return { items: [], total: 0, page, pageSize: PAGE_SIZE };
}

function normalizedForm(value: UserAddressFormValue): UserAddressFormValue {
  return {
    recipientName: value.recipientName.trim(),
    phone: value.phone.trim(),
    address: value.address.trim(),
    label: value.label?.trim() || null,
    isDefault: value.isDefault ?? false,
  };
}

export function useUserAddressesPage() {
  const query = reactive({ page: 1, pageSize: PAGE_SIZE });
  const pageData = ref<UserAddressPage>(emptyPage());
  const listStatus = ref<AsyncStatus>('idle');
  const listError = ref('');
  const mutationStatus = ref<MutationStatus>('idle');
  const mutationError = ref('');
  const formOpen = ref(false);
  const editingAddress = ref<UserAddress | null>(null);
  const deletingAddress = ref<UserAddress | null>(null);
  const busyAddressId = ref<string | null>(null);
  const totalPages = computed(() =>
    Math.max(1, Math.ceil(pageData.value.total / query.pageSize)),
  );
  useErrorToast(() => listError.value);
  useErrorToast(() => mutationError.value);

  let listController: AbortController | null = null;
  let mutationController: AbortController | null = null;
  let listVersion = 0;
  let identityVersion = 0;
  let disposed = false;
  let pendingCreate: { fingerprint: string; requestKey: string } | undefined;

  function currentIdentity(
    version: number,
    userId: string | undefined,
  ): boolean {
    return (
      !disposed &&
      version === identityVersion &&
      userId === (auth.state.token ? auth.state.user?.id : undefined)
    );
  }

  function clearSensitiveState(): void {
    pageData.value = emptyPage();
    editingAddress.value = null;
    deletingAddress.value = null;
    formOpen.value = false;
    mutationError.value = '';
    mutationStatus.value = 'idle';
    pendingCreate = undefined;
    busyAddressId.value = null;
    listStatus.value = 'idle';
    listError.value = '';
    query.page = 1;
  }

  watch(
    () => (auth.state.token ? auth.state.user?.id : null),
    () => {
      identityVersion += 1;
      listVersion += 1;
      listController?.abort();
      mutationController?.abort();
      listController = null;
      mutationController = null;
      clearSensitiveState();
      if (auth.state.token) void loadAddresses();
    },
    { flush: 'sync' },
  );

  async function loadAddresses(): Promise<void> {
    const token = auth.state.token;
    if (!token) return;
    const versionIdentity = identityVersion;
    const userId = auth.state.user?.id;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    const version = ++listVersion;
    listStatus.value = 'loading';
    listError.value = '';
    try {
      const result = await listUserAddresses(
        token,
        { ...query },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        version !== listVersion ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      pageData.value = result;
      listStatus.value = result.items.length ? 'success' : 'empty';
    } catch (error) {
      if (
        !controller.signal.aborted &&
        version === listVersion &&
        currentIdentity(versionIdentity, userId)
      ) {
        listStatus.value = 'error';
        listError.value =
          error instanceof Error ? error.message : '地址列表加载失败';
      }
    } finally {
      if (listController === controller) listController = null;
    }
  }

  function openCreate(): void {
    if (
      mutationStatus.value === 'submitting' ||
      mutationStatus.value === 'unknown'
    )
      return;
    editingAddress.value = null;
    mutationStatus.value = 'idle';
    mutationError.value = '';
    pendingCreate = undefined;
    formOpen.value = true;
  }

  function openEdit(address: UserAddress): void {
    if (
      mutationStatus.value === 'submitting' ||
      mutationStatus.value === 'unknown'
    )
      return;
    editingAddress.value = address;
    mutationStatus.value = 'idle';
    mutationError.value = '';
    formOpen.value = true;
  }

  function closeForm(open: boolean): void {
    if (!open && mutationStatus.value === 'submitting') return;
    if (!open && mutationStatus.value === 'unknown' && pendingCreate) return;
    formOpen.value = open;
    if (!open) {
      editingAddress.value = null;
      mutationStatus.value = 'idle';
      mutationError.value = '';
      pendingCreate = undefined;
    }
  }

  async function submitAddress(value: UserAddressFormValue): Promise<void> {
    const token = auth.state.token;
    if (!token || mutationStatus.value === 'submitting') return;
    const data = normalizedForm(value);
    const editing = editingAddress.value;
    const versionIdentity = identityVersion;
    const userId = auth.state.user?.id;
    const controller = new AbortController();
    mutationController?.abort();
    mutationController = controller;
    mutationStatus.value = 'submitting';
    mutationError.value = '';
    try {
      if (editing) {
        await updateUserAddress(token, editing.id, data, controller.signal);
      } else {
        const fingerprint = JSON.stringify(data);
        const requestKey =
          pendingCreate?.fingerprint === fingerprint
            ? pendingCreate.requestKey
            : crypto.randomUUID();
        pendingCreate = { fingerprint, requestKey };
        const payload: CreateUserAddressPayload = { ...data, requestKey };
        await createUserAddress(token, payload, controller.signal);
      }
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      toast.success(editing ? '收货地址已更新' : '收货地址已保存');
      pendingCreate = undefined;
      mutationStatus.value = 'idle';
      closeForm(false);
      await loadAddresses();
    } catch (error) {
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      mutationStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      mutationError.value =
        error instanceof Error ? error.message : '保存地址失败，请重试';
    } finally {
      if (mutationController === controller) mutationController = null;
    }
  }

  function requestDelete(address: UserAddress): void {
    if (mutationStatus.value === 'submitting') return;
    deletingAddress.value = address;
    mutationError.value = '';
    mutationStatus.value = 'idle';
  }

  function cancelDelete(): void {
    if (
      mutationStatus.value === 'submitting' ||
      mutationStatus.value === 'unknown'
    )
      return;
    deletingAddress.value = null;
    mutationStatus.value = 'idle';
    mutationError.value = '';
  }

  async function confirmDelete(): Promise<void> {
    const token = auth.state.token;
    const address = deletingAddress.value;
    if (!token || !address || mutationStatus.value === 'submitting') return;
    const versionIdentity = identityVersion;
    const userId = auth.state.user?.id;
    const controller = new AbortController();
    mutationController?.abort();
    mutationController = controller;
    busyAddressId.value = address.id;
    mutationStatus.value = 'submitting';
    mutationError.value = '';
    try {
      await deleteUserAddress(token, address.id, controller.signal);
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      toast.success('收货地址已删除');
      deletingAddress.value = null;
      mutationStatus.value = 'idle';
      if (pageData.value.items.length === 1 && query.page > 1) query.page -= 1;
      await loadAddresses();
    } catch (error) {
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      mutationStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      mutationError.value =
        error instanceof Error ? error.message : '删除地址失败，请重试';
    } finally {
      if (mutationController === controller) mutationController = null;
      if (busyAddressId.value === address.id) busyAddressId.value = null;
    }
  }

  async function setDefault(address: UserAddress): Promise<void> {
    const token = auth.state.token;
    if (!token || address.isDefault || mutationStatus.value === 'submitting')
      return;
    const versionIdentity = identityVersion;
    const userId = auth.state.user?.id;
    const controller = new AbortController();
    mutationController?.abort();
    mutationController = controller;
    busyAddressId.value = address.id;
    mutationStatus.value = 'submitting';
    mutationError.value = '';
    try {
      await updateUserAddress(
        token,
        address.id,
        { isDefault: true },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      toast.success('默认地址已更新');
      mutationStatus.value = 'idle';
      await loadAddresses();
    } catch (error) {
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      mutationStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      mutationError.value =
        error instanceof Error ? error.message : '设置默认地址失败';
    } finally {
      if (mutationController === controller) mutationController = null;
      if (busyAddressId.value === address.id) busyAddressId.value = null;
    }
  }

  function goToPage(page: number): void {
    if (
      page < 1 ||
      page > totalPages.value ||
      page === query.page ||
      mutationStatus.value === 'submitting'
    )
      return;
    query.page = page;
    void loadAddresses();
  }

  onMounted(() => void loadAddresses());
  onBeforeUnmount(() => {
    disposed = true;
    listController?.abort();
    mutationController?.abort();
    clearSensitiveState();
  });

  return {
    query,
    pageData,
    listStatus,
    listError,
    mutationStatus,
    mutationError,
    formOpen,
    editingAddress,
    deletingAddress,
    busyAddressId,
    totalPages,
    loadAddresses,
    openCreate,
    openEdit,
    closeForm,
    submitAddress,
    requestDelete,
    cancelDelete,
    confirmDelete,
    setDefault,
    goToPage,
  };
}
