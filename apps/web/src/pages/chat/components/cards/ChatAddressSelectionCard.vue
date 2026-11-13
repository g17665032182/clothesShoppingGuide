<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Check, RefreshCw } from '@lucide/vue';
import { ApiError } from '@/api';
import { getPurchaseDraft } from '@/api/modules/chat-purchase';
import { listUserAddresses } from '@/api/modules/user-addresses';
import type {
  ChatAddressSelectionActionStatus,
  ChatAddressSelectionCard as AddressSelectionReference,
} from '@/api/types/chat';
import type { UserAddress } from '@/api/types/user-addresses';
import { auth } from '@/lib/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const props = defineProps<{
  card: AddressSelectionReference;
  conversationId: string | null;
  disabled?: boolean;
  selectionStatus?: ChatAddressSelectionActionStatus;
  selectionError?: string;
}>();

const emit = defineEmits<{
  (
    event: 'select',
    request: AddressSelectionReference & {
      addressId: string;
      conversationId: string;
    },
  ): void;
  (event: 'refreshDraft', conversationId: string): void;
}>();

// 卡片只保存地址展示与临时选择，不把收件信息写入共享 Store 或持久化。
const addresses = ref<UserAddress[]>([]);
const selectedAddressId = ref<string | null>(null);
const loadStatus = ref<
  'loading' | 'ready' | 'empty' | 'error' | 'stale' | 'unavailable' | 'complete'
>('loading');
const loadError = ref('');
let controller: AbortController | null = null;
let requestVersion = 0;
let disposed = false;

const isSubmitting = computed(() => props.selectionStatus === 'submitting');
const canSelect = computed(
  () =>
    loadStatus.value === 'ready' &&
    !props.disabled &&
    !isSubmitting.value &&
    props.selectionStatus !== 'stale' &&
    props.selectionStatus !== 'conflict' &&
    selectedAddressId.value !== null,
);

watch(
  () =>
    [
      props.card.draftId,
      props.card.draftVersion,
      props.conversationId,
      auth.state.user?.id,
      auth.state.token,
    ] as const,
  () => {
    void loadCardData();
  },
  { immediate: true, flush: 'sync' },
);

watch(
  () => props.selectionStatus,
  (status) => {
    if (status === 'success') {
      clearAddressDetails();
      loadStatus.value = 'complete';
    } else if (
      status === 'conflict' ||
      status === 'unknown' ||
      status === 'stale'
    ) {
      void loadCardData();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  requestVersion += 1;
  controller?.abort();
  clearAddressDetails();
});

function clearAddressDetails(): void {
  addresses.value = [];
  selectedAddressId.value = null;
}

async function loadCardData(): Promise<void> {
  // 地址明细仅留在卡片局部内存；身份、会话或草稿版本变化时立即清理。
  controller?.abort();
  clearAddressDetails();
  loadError.value = '';
  const token = auth.state.token;
  const userId = auth.state.user?.id;
  const conversationId = props.conversationId;
  const draftId = props.card.draftId;
  const draftVersion = props.card.draftVersion;
  const localVersion = ++requestVersion;
  const requestController = new AbortController();
  controller = requestController;

  if (!token || !userId || !conversationId) {
    loadStatus.value = 'unavailable';
    return;
  }

  loadStatus.value = 'loading';
  const isCurrent = () =>
    !disposed &&
    !requestController.signal.aborted &&
    localVersion === requestVersion &&
    userId === auth.state.user?.id &&
    conversationId === props.conversationId &&
    draftId === props.card.draftId &&
    draftVersion === props.card.draftVersion &&
    props.selectionStatus !== 'success';

  try {
    const current = await getPurchaseDraft(
      token,
      conversationId,
      requestController.signal,
    );
    if (!isCurrent()) return;
    if (
      !current.draft ||
      current.draft.id !== draftId ||
      current.draft.conversationId !== conversationId ||
      current.draft.version !== draftVersion ||
      !['collecting', 'ready'].includes(current.draft.status)
    ) {
      loadStatus.value = 'stale';
      return;
    }

    const results: UserAddress[] = [];
    let page = 1;
    let total = 0;
    do {
      const result = await listUserAddresses(
        token,
        { page, pageSize: 100 },
        requestController.signal,
      );
      if (!isCurrent()) return;
      results.push(...result.items);
      total = result.total;
      page += 1;
      if (!result.items.length) break;
    } while (results.length < total);

    if (!isCurrent()) return;
    addresses.value = results;
    loadStatus.value = results.length ? 'ready' : 'empty';
  } catch (error) {
    if (!isCurrent()) return;
    if (
      error instanceof ApiError &&
      [401, 403, 404, 410].includes(error.status)
    ) {
      loadStatus.value = 'stale';
      return;
    }
    loadError.value =
      error instanceof Error ? error.message : '地址加载失败，请稍后重试';
    loadStatus.value = 'error';
  } finally {
    if (controller === requestController) controller = null;
  }
}

function toggleAddress(addressId: string): void {
  if (props.disabled || isSubmitting.value) return;
  selectedAddressId.value =
    selectedAddressId.value === addressId ? null : addressId;
}

function submitSelection(): void {
  const addressId = selectedAddressId.value;
  const conversationId = props.conversationId;
  if (!canSelect.value || !addressId || !conversationId) return;
  emit('select', {
    ...props.card,
    addressId,
    conversationId,
  });
}

function refreshDraft(): void {
  if (props.conversationId) emit('refreshDraft', props.conversationId);
}
</script>

<template>
  <Card class="rounded-md">
    <CardHeader>
      <CardTitle class="text-base">选择收货地址</CardTitle>
      <CardDescription>请为本次购买选择一个已保存的地址。</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-3">
      <div
        v-if="loadStatus === 'loading'"
        class="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Spinner />
        正在验证购买草稿并加载地址
      </div>
      <p
        v-else-if="loadStatus === 'empty'"
        class="text-sm text-muted-foreground"
        role="status"
      >
        地址簿中没有已保存的地址。
      </p>
      <p
        v-else-if="loadStatus === 'complete'"
        class="text-sm text-muted-foreground"
        role="status"
      >
        地址已应用到当前购买草稿。
      </p>
      <div
        v-else-if="loadStatus === 'stale'"
        class="flex flex-wrap items-center justify-between gap-3"
        role="status"
      >
        <p class="text-sm text-muted-foreground">
          此地址卡引用的购买草稿已变化或不再可编辑。
        </p>
        <Button type="button" size="sm" variant="outline" @click="refreshDraft">
          <RefreshCw aria-hidden="true" data-icon="inline-start" />
          刷新购买草稿
        </Button>
      </div>
      <div v-else-if="loadStatus === 'unavailable'" role="status">
        <p class="text-sm text-muted-foreground">
          登录后才能查看和选择收货地址。
        </p>
      </div>
      <div v-else-if="loadStatus === 'error'" class="grid gap-2">
        <Alert variant="destructive">
          <AlertDescription>{{ loadError }}</AlertDescription>
        </Alert>
        <Button
          type="button"
          class="justify-self-start"
          size="sm"
          variant="outline"
          @click="loadCardData"
        >
          <RefreshCw aria-hidden="true" data-icon="inline-start" />
          重试
        </Button>
      </div>
      <fieldset
        v-else-if="loadStatus === 'ready'"
        class="grid gap-2"
        :disabled="disabled || isSubmitting"
      >
        <legend class="sr-only">收货地址</legend>
        <button
          v-for="address in addresses"
          :key="address.id"
          type="button"
          class="grid min-w-0 grid-cols-[1fr_auto] items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
          :class="
            selectedAddressId === address.id
              ? 'border-primary bg-muted/40'
              : 'border-border'
          "
          :aria-pressed="selectedAddressId === address.id"
          @click="toggleAddress(address.id)"
        >
          <span class="grid min-w-0 gap-1">
            <span class="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
              <span class="break-words font-medium">
                {{ address.label || address.recipientName }}
              </span>
              <span class="text-muted-foreground">{{ address.phone }}</span>
              <span
                v-if="address.isDefault"
                class="text-xs text-muted-foreground"
              >
                默认地址
              </span>
            </span>
            <span class="break-words text-sm text-muted-foreground">
              {{ address.address }}
            </span>
          </span>
          <span
            class="flex size-5 items-center justify-center rounded-full border"
            :class="
              selectedAddressId === address.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted-foreground/40'
            "
          >
            <Check
              v-if="selectedAddressId === address.id"
              aria-hidden="true"
              class="size-3.5"
            />
          </span>
        </button>
      </fieldset>
      <p
        v-if="selectionStatus === 'submitting'"
        class="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Spinner />
        正在更新本次购买地址
      </p>
      <Alert
        v-else-if="
          selectionStatus === 'stale' || selectionStatus === 'conflict'
        "
        variant="destructive"
      >
        <AlertDescription>
          草稿版本已变化，此卡片不能继续提交地址；请查看最新购买草稿。
        </AlertDescription>
      </Alert>
      <Alert
        v-else-if="selectionStatus === 'unknown' || selectionStatus === 'error'"
        variant="destructive"
      >
        <AlertDescription>
          {{
            selectionError ||
            (selectionStatus === 'unknown'
              ? '提交结果暂未确认，已重新核实草稿状态。'
              : '提交地址失败，请检查草稿状态后重试。')
          }}
        </AlertDescription>
      </Alert>
    </CardContent>
    <CardFooter
      v-if="
        (loadStatus === 'ready' &&
          selectionStatus !== 'stale' &&
          selectionStatus !== 'conflict') ||
        isSubmitting
      "
      class="flex justify-end gap-2"
    >
      <Button
        type="button"
        variant="outline"
        :disabled="!canSelect"
        @click="submitSelection"
      >
        <Spinner v-if="isSubmitting" data-icon="inline-start" />
        {{ isSubmitting ? '正在提交' : '确认使用此地址' }}
      </Button>
    </CardFooter>
  </Card>
</template>
