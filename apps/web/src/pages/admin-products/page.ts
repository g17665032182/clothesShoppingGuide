import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import { toast } from 'vue-sonner';
import { ApiError } from '@/api';
import { useErrorToast } from '@/composables/use-error-toast';
import {
  getAdminProduct,
  listAdminProducts,
  updateAdminProductTryOn,
} from '@/api/modules/admin-products';
import type {
  AdminProductCategory,
  AdminProductDetail,
  AdminProductQuery,
  AdminProductSummary,
} from '@/api/types/admin-products';
import { auth } from '@/lib/auth';

type RequestStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
type SaveStatus = 'idle' | 'loading' | 'success' | 'error';

const categories: Array<{ value: AdminProductCategory; label: string }> = [
  { value: 'tops', label: '上装' },
  { value: 'bottoms', label: '下装' },
  { value: 'dresses', label: '连衣裙' },
  { value: 'outerwear', label: '外套' },
  { value: 'shoes', label: '鞋类' },
];

export function useAdminProductsPage() {
  const route = useRoute();
  const router = useRouter();
  const products = ref<AdminProductSummary[]>([]);
  const selectedProduct = ref<AdminProductDetail | null>(null);
  const listStatus = ref<RequestStatus>('idle');
  const detailStatus = ref<RequestStatus>('idle');
  const tryOnDraft = ref(false);
  const tryOnSaveStatus = ref<SaveStatus>('idle');
  const tryOnSaveError = ref('');
  const tryOnSaveResultUnknown = ref(false);
  const error = ref('');
  const detailError = ref('');
  useErrorToast(() => error.value);
  useErrorToast(() => detailError.value);
  useErrorToast(() => tryOnSaveError.value);
  const filters = reactive<{
    keyword: string;
    category: AdminProductCategory | 'all';
    isActive: 'all' | 'true' | 'false';
    inStock: 'all' | 'true' | 'false';
  }>({
    keyword: '',
    category: 'all',
    isActive: 'all',
    inStock: 'all',
  });
  const page = ref(1);
  const pageSize = ref(20);
  const total = ref(0);
  const detailOpen = ref(false);
  const selectedProductId = ref<string | null>(null);
  const listRequestVersion = ref(0);
  const detailRequestVersion = ref(0);
  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let tryOnSaveController: AbortController | null = null;
  let tryOnSaveVersion = 0;
  let pendingQuery: LocationQueryRaw | null = null;
  let querySyncRunning = false;
  let disposed = false;

  const loading = computed(() => listStatus.value === 'loading');
  const detailLoading = computed(() => detailStatus.value === 'loading');
  const tryOnSaving = computed(() => tryOnSaveStatus.value === 'loading');
  const tryOnDisabledReason = computed(() => {
    const product = selectedProduct.value;
    if (!product) return '';
    if (!product.isActive) return '商品已停用，不能开启试穿。';
    if (product.category === 'shoes') return '鞋类暂不支持试穿。';
    const activeSkus = product.skus.filter(
      (sku) => sku.isActive && sku.currency === 'CNY' && sku.color.trim(),
    );
    if (activeSkus.length === 0) return '商品缺少有效的颜色规格。';
    if (!activeSkus.some((sku) => hasProductImage(sku.imageUrl)))
      return '商品缺少可用于试穿的图片。';
    return '';
  });
  const tryOnSwitchDisabled = computed(
    () =>
      tryOnSaving.value ||
      (!tryOnDraft.value && Boolean(tryOnDisabledReason.value)),
  );
  const canSaveTryOn = computed(
    () =>
      detailStatus.value === 'success' &&
      selectedProduct.value !== null &&
      tryOnDraft.value !== selectedProduct.value.tryOnEnabled &&
      !tryOnSaving.value &&
      (!tryOnDraft.value || !tryOnDisabledReason.value),
  );
  const totalPages = computed(() =>
    Math.max(1, Math.ceil(total.value / pageSize.value)),
  );
  const hasPreviousPage = computed(() => page.value > 1);
  const hasNextPage = computed(() => page.value < totalPages.value);

  function restoreQuery(): void {
    const query = route.query;
    filters.keyword =
      typeof query.keyword === 'string' ? query.keyword.slice(0, 160) : '';
    filters.category = categories.some((item) => item.value === query.category)
      ? (query.category as AdminProductCategory)
      : 'all';
    filters.isActive =
      query.isActive === 'true' || query.isActive === 'false'
        ? query.isActive
        : 'all';
    filters.inStock =
      query.inStock === 'true' || query.inStock === 'false'
        ? query.inStock
        : 'all';
    const requestedPage =
      typeof query.page === 'string' ? Number(query.page) : NaN;
    page.value =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
    const requestedPageSize =
      typeof query.pageSize === 'string' ? Number(query.pageSize) : NaN;
    pageSize.value =
      Number.isSafeInteger(requestedPageSize) &&
      requestedPageSize >= 1 &&
      requestedPageSize <= 100
        ? requestedPageSize
        : 20;
  }

  function writeQuery(): void {
    const query = toQuery();
    pendingQuery = {
      page: String(query.page),
      pageSize: String(query.pageSize),
      ...(query.keyword ? { keyword: query.keyword } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.isActive !== undefined
        ? { isActive: String(query.isActive) }
        : {}),
      ...(query.inStock !== undefined
        ? { inStock: String(query.inStock) }
        : {}),
    };
    if (!querySyncRunning) void syncQueuedQuery();
  }

  async function syncQueuedQuery(): Promise<void> {
    querySyncRunning = true;
    try {
      // 合并快速输入的中间导航；自身路由回写不能覆盖最新筛选草稿。
      while (pendingQuery && !disposed) {
        const query = pendingQuery;
        pendingQuery = null;
        await router.replace({ query });
      }
    } catch {
      if (!disposed) error.value = '筛选条件未能同步到地址栏，请重试。';
    } finally {
      querySyncRunning = false;
    }
  }

  function toQuery(): AdminProductQuery {
    return {
      page: page.value,
      pageSize: pageSize.value,
      ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
      ...(filters.category !== 'all' ? { category: filters.category } : {}),
      ...(filters.isActive !== 'all'
        ? { isActive: filters.isActive === 'true' }
        : {}),
      ...(filters.inStock !== 'all'
        ? { inStock: filters.inStock === 'true' }
        : {}),
    };
  }

  async function loadProducts(): Promise<void> {
    if (!auth.state.token) return;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    const version = ++listRequestVersion.value;
    listStatus.value = 'loading';
    error.value = '';
    try {
      const response = await listAdminProducts(
        auth.state.token,
        toQuery(),
        controller.signal,
      );
      if (controller.signal.aborted || version !== listRequestVersion.value)
        return;
      // 保留筛选条件，目录变化导致页码越界时回到最后一页。
      const lastPage = Math.max(1, Math.ceil(response.total / pageSize.value));
      if (page.value > lastPage) {
        page.value = lastPage;
        writeQuery();
        void loadProducts();
        return;
      }
      products.value = response.items;
      total.value = response.total;
      listStatus.value = response.items.length === 0 ? 'empty' : 'success';
    } catch (cause) {
      if (controller.signal.aborted || version !== listRequestVersion.value)
        return;
      listStatus.value = 'error';
      error.value =
        cause instanceof Error ? cause.message : '无法读取商品列表。';
    }
  }

  function resetPageAndLoad(): void {
    page.value = 1;
    writeQuery();
    void loadProducts();
  }

  function setPage(nextPage: number): void {
    const safePage = Math.min(Math.max(1, nextPage), totalPages.value);
    if (safePage === page.value) return;
    page.value = safePage;
    writeQuery();
    void loadProducts();
  }

  async function loadDetail(productId: string): Promise<void> {
    if (!auth.state.token) return;
    invalidateTryOnSave();
    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    const version = ++detailRequestVersion.value;
    selectedProduct.value = null;
    detailOpen.value = true;
    detailStatus.value = 'loading';
    detailError.value = '';
    try {
      const detail = await getAdminProduct(
        auth.state.token,
        productId,
        controller.signal,
      );
      if (
        disposed ||
        controller.signal.aborted ||
        version !== detailRequestVersion.value
      )
        return;
      selectedProduct.value = detail;
      tryOnDraft.value = detail.tryOnEnabled;
      detailStatus.value = 'success';
    } catch (cause) {
      if (
        disposed ||
        controller.signal.aborted ||
        version !== detailRequestVersion.value
      )
        return;
      detailStatus.value = 'error';
      detailError.value =
        cause instanceof Error ? cause.message : '无法读取商品详情。';
    }
  }

  function openDetail(product: AdminProductSummary): void {
    selectedProductId.value = product.id;
    void loadDetail(product.id);
  }

  function retryDetail(): void {
    if (selectedProductId.value) void loadDetail(selectedProductId.value);
  }

  function closeDetail(): void {
    detailOpen.value = false;
    detailController?.abort();
    detailRequestVersion.value++;
    invalidateTryOnSave();
    selectedProduct.value = null;
    selectedProductId.value = null;
    detailStatus.value = 'idle';
  }

  function invalidateTryOnSave(): void {
    // 取消前端等待不代表服务端未写入，再次打开详情始终重新读取当前设置。
    tryOnSaveController?.abort();
    tryOnSaveController = null;
    tryOnSaveVersion++;
    tryOnSaveStatus.value = 'idle';
    tryOnSaveError.value = '';
    tryOnSaveResultUnknown.value = false;
    tryOnDraft.value = false;
  }

  function setTryOnDraft(value: boolean): void {
    if (tryOnSwitchDisabled.value) return;
    tryOnDraft.value = value;
    tryOnSaveError.value = '';
    if (!tryOnSaveResultUnknown.value) tryOnSaveStatus.value = 'idle';
  }

  async function saveTryOn(): Promise<void> {
    const product = selectedProduct.value;
    if (!auth.state.token || !product || !canSaveTryOn.value) return;
    const controller = new AbortController();
    tryOnSaveController = controller;
    const version = ++tryOnSaveVersion;
    const productId = product.id;
    tryOnSaveStatus.value = 'loading';
    tryOnSaveError.value = '';
    const isCurrent = () =>
      !disposed &&
      !controller.signal.aborted &&
      version === tryOnSaveVersion &&
      detailOpen.value &&
      selectedProductId.value === productId;
    try {
      const detail = await updateAdminProductTryOn(
        auth.state.token,
        productId,
        tryOnDraft.value,
        controller.signal,
      );
      if (!isCurrent()) return;
      selectedProduct.value = detail;
      tryOnDraft.value = detail.tryOnEnabled;
      tryOnSaveStatus.value = 'success';
      tryOnSaveResultUnknown.value = false;
      products.value = products.value.map((item) =>
        item.id === detail.id
          ? {
              ...item,
              tryOnEnabled: detail.tryOnEnabled,
              updatedAt: detail.updatedAt,
            }
          : item,
      );
      toast.success('商品试穿设置已保存。');
      void loadProducts();
    } catch (cause) {
      if (!isCurrent()) return;
      tryOnSaveStatus.value = 'error';
      // 服务端可能已完成写入；保留草稿并让管理员核实状态，不假定请求已回滚。
      tryOnSaveResultUnknown.value =
        !(cause instanceof ApiError) ||
        cause.status === 0 ||
        cause.status >= 500;
      tryOnSaveError.value =
        cause instanceof Error ? cause.message : '商品试穿设置保存失败。';
    } finally {
      if (version === tryOnSaveVersion) tryOnSaveController = null;
    }
  }

  onMounted(() => {
    restoreQuery();
    void loadProducts();
  });

  watch(
    () => route.query,
    () => {
      if (querySyncRunning || disposed) return;
      const current = JSON.stringify(toQuery());
      restoreQuery();
      if (JSON.stringify(toQuery()) !== current) void loadProducts();
    },
    { flush: 'sync' },
  );

  onBeforeUnmount(() => {
    disposed = true;
    pendingQuery = null;
    listController?.abort();
    detailController?.abort();
    invalidateTryOnSave();
  });

  return {
    categories,
    closeDetail,
    detailError,
    detailLoading,
    detailOpen,
    detailStatus,
    error,
    filters,
    hasNextPage,
    hasPreviousPage,
    listStatus,
    loadProducts,
    loading,
    openDetail,
    page,
    pageSize,
    products,
    resetPageAndLoad,
    retryDetail,
    saveTryOn,
    selectedProduct,
    setTryOnDraft,
    setPage,
    total,
    totalPages,
    canSaveTryOn,
    tryOnDisabledReason,
    tryOnDraft,
    tryOnSaveResultUnknown,
    tryOnSaveStatus,
    tryOnSaving,
    tryOnSwitchDisabled,
  };
}

function hasProductImage(value: string | null): boolean {
  if (!value) return false;
  try {
    // 图片已由服务端公开地址规则过滤；页面只作基本协议与凭据防御。
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
