<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Check,
  CreditCard,
  PackageCheck,
  RefreshCw,
  Save,
  ShoppingBag,
  Trash2,
} from '@lucide/vue';
import type {
  PurchaseDraft,
  PurchaseIssue,
  PurchaseRecipient,
} from '@/api/types/chat-purchase';
import type { OrderDetail } from '@/api/types/orders';
import type { UserAddress } from '@/api/types/user-addresses';
import OrderStatusBadge from '@/components/shared/orders/OrderStatusBadge.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    draft: PurchaseDraft | null;
    order: OrderDetail | null;
    status:
      | 'idle'
      | 'loading'
      | 'success'
      | 'empty'
      | 'error'
      | 'submitting'
      | 'unknown'
      | 'streaming';
    errorMessage?: string;
    addresses: UserAddress[];
    addressStatus: 'idle' | 'loading' | 'success' | 'error';
    addressSaveStatus: 'idle' | 'submitting' | 'unknown' | 'error';
  }>(),
  {
    errorMessage: '',
    addresses: () => [],
    addressStatus: 'idle',
    addressSaveStatus: 'idle',
  },
);
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (
    event: 'update',
    payload: {
      skuId?: string | null;
      quantity?: number;
      recipient?: Partial<PurchaseRecipient>;
    },
  ): void;
  (event: 'discard'): void;
  (event: 'confirm'): void;
  (event: 'retry'): void;
  (event: 'openOrder', orderId: string): void;
  (event: 'selectAddress', addressId: string): void;
  (event: 'saveAddress'): void;
  (event: 'retryAddresses'): void;
}>();

const name = ref('');
const phone = ref('');
const address = ref('');
const quantity = ref(1);
const selectedSkuId = ref<string | null>(null);
let previousFields: {
  draftId: string;
  name: string;
  phone: string;
  address: string;
  quantity: number;
  skuId: string | null;
} | null = null;

watch(
  () => props.draft,
  (draft) => {
    if (!draft || !['collecting', 'ready'].includes(draft.status)) {
      previousFields = null;
      name.value = '';
      phone.value = '';
      address.value = '';
      quantity.value = 1;
      selectedSkuId.value = null;
      return;
    }
    const nextFields = {
      draftId: draft.id,
      name: draft.recipient.name ?? '',
      phone: draft.recipient.phone ?? '',
      address: draft.recipient.address ?? '',
      quantity: draft.quantity,
      skuId: draft.skuId,
    };
    const previous = previousFields;
    const isNewDraft = previous?.draftId !== draft.id;
    // 后台刷新只同步未编辑字段；保存回执与本地值一致时也接受服务端规范化。
    if (
      isNewDraft ||
      name.value.trim() === previous?.name ||
      name.value.trim() === nextFields.name
    )
      name.value = nextFields.name;
    if (
      isNewDraft ||
      phone.value.trim() === previous?.phone ||
      phone.value.trim() === nextFields.phone
    )
      phone.value = nextFields.phone;
    if (
      isNewDraft ||
      address.value.trim() === previous?.address ||
      address.value.trim() === nextFields.address
    )
      address.value = nextFields.address;
    if (
      isNewDraft ||
      quantity.value === previous?.quantity ||
      quantity.value === nextFields.quantity
    )
      quantity.value = nextFields.quantity;
    if (
      isNewDraft ||
      selectedSkuId.value === previous?.skuId ||
      selectedSkuId.value === nextFields.skuId
    )
      selectedSkuId.value = nextFields.skuId;
    previousFields = nextFields;
  },
  { immediate: true },
);

const skuOptions = computed(
  () => props.draft?.skuOptions ?? props.draft?.availableSkus ?? [],
);
const isBusy = computed(() =>
  ['loading', 'submitting', 'unknown', 'error'].includes(props.status),
);
const isTerminal = computed(() =>
  Boolean(
    props.draft &&
    ['submitted', 'cancelled', 'expired'].includes(props.draft.status),
  ),
);
const isEditable = computed(
  () => Boolean(props.draft) && !isTerminal.value && !isBusy.value,
);
const canPersist = computed(
  () => isEditable.value && props.status !== 'streaming',
);
const isDirty = computed(() => {
  const draft = props.draft;
  return Boolean(
    draft &&
    (name.value.trim() !== (draft.recipient.name ?? '') ||
      phone.value.trim() !== (draft.recipient.phone ?? '') ||
      address.value.trim() !== (draft.recipient.address ?? '') ||
      quantity.value !== draft.quantity ||
      selectedSkuId.value !== draft.skuId),
  );
});
const canConfirm = computed(
  () =>
    props.draft?.status === 'ready' &&
    Boolean(props.draft.confirmation) &&
    !isBusy.value &&
    props.status !== 'streaming' &&
    !isDirty.value,
);
const statusLabel = computed(() => {
  switch (props.draft?.status) {
    case 'ready':
      return '待确认';
    case 'collecting':
      return '补充信息';
    case 'submitted':
      return '已生成订单';
    case 'cancelled':
      return '已放弃';
    case 'expired':
      return '已过期';
    default:
      return '';
  }
});

const hasPurchase = computed(
  () =>
    Boolean(props.draft || props.order) ||
    ['submitting', 'error', 'unknown'].includes(props.status),
);

function issueText(issue: PurchaseIssue): string {
  if (issue.code === 'missing_field') {
    const fields: Record<
      Extract<PurchaseIssue, { code: 'missing_field' }>['field'],
      string
    > = {
      'recipient.name': '收件人',
      'recipient.phone': '手机号',
      'recipient.address': '收货地址',
    };
    return `请填写${fields[issue.field]}`;
  }
  const messages: Record<
    Exclude<PurchaseIssue['code'], 'missing_field'>,
    string
  > = {
    sku_selection_required: '请选择商品规格',
    product_unavailable: '商品暂不可购买',
    sku_unavailable: '所选规格已下架或不可购买',
    insufficient_stock: '所选规格库存不足',
    price_changed: '商品价格已变化，请核对后再确认',
    specification_changed: '商品规格信息已变化，请重新选择',
    expired: '购买草稿已过期，请重新发起购买',
  };
  return messages[issue.code];
}

function saveChanges(): void {
  const draft = props.draft;
  if (!draft || !canPersist.value || !isDirty.value) return;
  const payload: {
    skuId?: string | null;
    quantity?: number;
    recipient?: Partial<PurchaseRecipient>;
  } = {};
  if (selectedSkuId.value !== draft.skuId) payload.skuId = selectedSkuId.value;
  if (quantity.value !== draft.quantity) payload.quantity = quantity.value;
  const recipient: Partial<PurchaseRecipient> = {};
  if (name.value.trim() !== (draft.recipient.name ?? ''))
    recipient.name = name.value.trim() || null;
  if (phone.value.trim() !== (draft.recipient.phone ?? ''))
    recipient.phone = phone.value.trim() || null;
  if (address.value.trim() !== (draft.recipient.address ?? ''))
    recipient.address = address.value.trim() || null;
  if (Object.keys(recipient).length) payload.recipient = recipient;
  emit('update', payload);
}

function updateQuantity(value: string): void {
  quantity.value = Math.min(99, Math.max(1, Number.parseInt(value, 10) || 1));
}
</script>

<template>
  <Dialog :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogTrigger v-if="hasPurchase" as-child>
      <Button size="sm" variant="outline" type="button">
        <ShoppingBag data-icon="inline-start" />
        本次购买
        <Badge v-if="draft" variant="secondary" class="hidden sm:inline-flex">
          {{ statusLabel }}
        </Badge>
      </Button>
    </DialogTrigger>
    <DialogContent
      class="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
    >
      <DialogHeader class="pr-8">
        <DialogTitle class="flex flex-wrap items-center gap-2">
          本次购买
          <Badge v-if="draft" variant="secondary">{{ statusLabel }}</Badge>
        </DialogTitle>
        <DialogDescription class="break-all">
          {{
            draft?.confirmation?.name ?? draft?.productExternalId ?? '购买信息'
          }}
        </DialogDescription>
      </DialogHeader>
      <div class="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <p
          v-if="status === 'error' || status === 'unknown'"
          role="status"
          class="text-sm text-muted-foreground"
        >
          {{
            status === 'unknown'
              ? '购买结果尚未确认，请重新读取核实。'
              : '购买操作未完成，可重新读取后继续。'
          }}
        </p>
        <Alert v-if="order">
          <AlertDescription
            class="flex flex-wrap items-center justify-between gap-2"
          >
            <span
              >已生成订单 <strong class="break-all">{{ order.orderNo }}</strong
              >，当前状态：<OrderStatusBadge :status="order.status" />。</span
            >
            <Button
              size="sm"
              variant="outline"
              @click="emit('openOrder', order.id)"
            >
              <CreditCard data-icon="inline-start" />查看 / 处理
            </Button>
          </AlertDescription>
        </Alert>
        <div
          v-if="status === 'loading' || status === 'submitting'"
          class="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner />{{
            status === 'loading' ? '正在读取购买草稿' : '正在提交购买信息'
          }}
        </div>
        <Empty v-else-if="status === 'empty' && !draft">
          <EmptyHeader>
            <EmptyTitle>当前会话没有进行中的购买</EmptyTitle>
          </EmptyHeader>
        </Empty>
        <template v-if="draft && !isTerminal">
          <FieldGroup class="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel for="purchase-name">收件人</FieldLabel>
              <Input
                id="purchase-name"
                v-model="name"
                :disabled="!isEditable"
              />
            </Field>
            <Field>
              <FieldLabel for="purchase-phone">手机号</FieldLabel>
              <Input
                id="purchase-phone"
                v-model="phone"
                inputmode="tel"
                :disabled="!isEditable"
              />
            </Field>
            <Field class="sm:col-span-2">
              <FieldLabel for="purchase-address">收货地址</FieldLabel>
              <Input
                id="purchase-address"
                v-model="address"
                :disabled="!isEditable"
              />
            </Field>
            <Field v-if="skuOptions.length" class="sm:col-span-2">
              <FieldLabel for="purchase-sku">规格</FieldLabel>
              <Select
                :model-value="selectedSkuId ?? undefined"
                :disabled="!isEditable"
                @update:model-value="
                  (value) => {
                    selectedSkuId = String(value);
                  }
                "
              >
                <SelectTrigger id="purchase-sku" class="w-full"
                  ><SelectValue placeholder="选择颜色和尺码"
                /></SelectTrigger>
                <SelectContent
                  ><SelectGroup>
                    <SelectItem
                      v-for="sku in skuOptions"
                      :key="sku.skuId"
                      :value="sku.skuId"
                      :disabled="!sku.inStock"
                    >
                      {{ sku.color }} / {{ sku.size }} · ¥{{ sku.unitPrice
                      }}{{ sku.inStock ? '' : '（无货）' }}
                    </SelectItem>
                  </SelectGroup></SelectContent
                >
              </Select>
            </Field>
            <Field>
              <FieldLabel for="purchase-quantity">数量</FieldLabel>
              <Input
                id="purchase-quantity"
                :model-value="quantity"
                type="number"
                min="1"
                max="99"
                :disabled="!isEditable"
                @update:model-value="updateQuantity(String($event))"
              />
            </Field>
          </FieldGroup>
          <section
            v-if="addressStatus !== 'idle'"
            class="flex flex-col gap-3 border-t pt-4"
            aria-labelledby="purchase-address-book-title"
          >
            <div class="flex items-center justify-between gap-3">
              <h3 id="purchase-address-book-title" class="text-sm font-medium">
                地址簿
              </h3>
              <span
                v-if="addressStatus === 'loading'"
                class="flex items-center gap-2 text-xs text-muted-foreground"
                role="status"
              >
                <Spinner />正在加载
              </span>
              <Button
                v-else-if="addressStatus === 'error'"
                size="sm"
                variant="outline"
                @click="emit('retryAddresses')"
              >
                <RefreshCw data-icon="inline-start" />重试加载
              </Button>
            </div>
            <p
              v-if="addressStatus === 'error'"
              class="text-sm text-muted-foreground"
            >
              地址簿暂时无法加载，可稍后重试。
            </p>
            <p
              v-else-if="addressStatus === 'success' && addresses.length === 0"
              class="text-sm text-muted-foreground"
            >
              地址簿为空；可在“账户设置”中添加地址。
            </p>
            <ul v-else-if="addresses.length" class="flex flex-col gap-2">
              <li
                v-for="savedAddress in addresses"
                :key="savedAddress.id"
                class="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div class="min-w-0 flex-1">
                  <p class="wrap-break-word text-sm font-medium">
                    {{ savedAddress.label || savedAddress.recipientName }}
                    <span class="font-normal text-muted-foreground">
                      · {{ savedAddress.phone }}
                    </span>
                  </p>
                  <p class="wrap-break-word text-sm text-muted-foreground">
                    {{ savedAddress.address }}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  :disabled="!canPersist"
                  @click="emit('selectAddress', savedAddress.id)"
                >
                  使用此地址
                </Button>
              </li>
            </ul>
          </section>
          <p
            v-if="isDirty && status === 'streaming'"
            class="text-xs text-muted-foreground"
            role="status"
          >
            助手仍在回复，当前填写暂存在表单中；回复完成后可保存信息并确认下单。
          </p>
          <p v-else-if="isDirty" class="text-xs text-muted-foreground">
            有未保存的购买信息变更；保存后才能确认下单。
          </p>
          <div v-if="draft.confirmation" class="flex flex-col gap-2 text-sm">
            <div class="flex items-center gap-2 font-medium">
              <PackageCheck aria-hidden="true" />确认卡
            </div>
            <p class="break-all">
              {{ draft.confirmation.name }} · {{ draft.confirmation.color }} /
              {{ draft.confirmation.size }}
            </p>
            <p>
              数量 {{ draft.confirmation.quantity }} · ¥{{
                draft.confirmation.unitPrice
              }}
            </p>
            <p class="font-medium">
              应付 ¥{{ draft.confirmation.payableAmount }}
              {{ draft.confirmation.currency }}
            </p>
            <p class="break-all text-muted-foreground">
              {{ draft.confirmation.recipient.name }} ·
              {{ draft.confirmation.recipient.phone }} ·
              {{ draft.confirmation.recipient.address }}
            </p>
          </div>
          <ul
            v-if="draft.issues.length"
            class="flex flex-col gap-1 text-sm text-muted-foreground"
          >
            <li
              v-for="issue in draft.issues"
              :key="`${issue.code}-${issue.code === 'missing_field' ? issue.field : ''}`"
            >
              {{ issueText(issue) }}
            </li>
          </ul>
          <div
            v-if="
              draft.recipient.name &&
              draft.recipient.phone &&
              draft.recipient.address
            "
            class="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
          >
            <p class="text-sm text-muted-foreground">
              将当前已保存草稿中的收件信息加入本人地址簿。
            </p>
            <Button
              variant="outline"
              :disabled="
                !canPersist || isDirty || addressSaveStatus === 'submitting'
              "
              @click="emit('saveAddress')"
            >
              <Spinner
                v-if="addressSaveStatus === 'submitting'"
                data-icon="inline-start"
              />
              {{
                addressSaveStatus === 'unknown'
                  ? '重试保存地址'
                  : addressSaveStatus === 'submitting'
                    ? '正在保存'
                    : '保存到地址簿'
              }}
            </Button>
          </div>
        </template>
        <p v-else-if="draft && !order" class="text-sm text-muted-foreground">
          此购买草稿已{{ statusLabel }}，不能继续编辑。
        </p>
      </div>
      <DialogFooter class="flex-wrap">
        <Button
          v-if="draft && !isTerminal"
          variant="ghost"
          class="sm:mr-auto"
          :disabled="!canPersist"
          @click="emit('discard')"
        >
          <Trash2 data-icon="inline-start" />放弃本次购买
        </Button>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" @click="emit('update:modelValue', false)">
            关闭
          </Button>
          <Button
            v-if="status === 'error' || status === 'unknown'"
            variant="outline"
            @click="emit('retry')"
          >
            <RefreshCw data-icon="inline-start" />重新读取核实
          </Button>
          <Button
            v-if="draft && !isTerminal"
            variant="outline"
            :disabled="!canPersist || !isDirty"
            @click="saveChanges"
          >
            <Save data-icon="inline-start" />保存信息
          </Button>
          <Button
            v-if="draft && !isTerminal"
            :disabled="!canConfirm"
            @click="emit('confirm')"
          >
            <Check data-icon="inline-start" />确认下单
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
