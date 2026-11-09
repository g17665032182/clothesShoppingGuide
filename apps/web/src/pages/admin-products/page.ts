import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import { useErrorToast } from '@/composables/use-error-toast';
import {
  getAdminProduct,
  listAdminProducts,
} from '@/api/modules/admin-products';
import type {
  AdminProductCategory,
  AdminProductDetail,
  AdminProductQuery,
  AdminProductSummary,
} from '@/api/types/admin-products';
import { auth } from '@/lib/auth';

type RequestStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

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
  const error = ref('');
  const detailError = ref('');
  useErrorToast(() => error.value);
  useErrorToast(() => detailError.value);
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
  let pendingQuery: LocationQueryRaw | null = null;
  let querySyncRunning = false;
  let disposed = false;

  const loading = computed(() => listStatus.value === 'loading');
  const detailLoading = computed(() => detailStatus.value === 'loading');
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
      if (controller.signal.aborted || version !== detailRequestVersion.value)
        return;
      selectedProduct.value = detail;
      detailStatus.value = 'success';
    } catch (cause) {
      if (controller.signal.aborted || version !== detailRequestVersion.value)
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
    selectedProduct.value = null;
    selectedProductId.value = null;
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
    selectedProduct,
    setPage,
    total,
    totalPages,
  };
}
