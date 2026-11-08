<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  PackageCheck,
  RefreshCw,
  Save,
  Trash2,
} from '@lucide/vue';
import type {
  PurchaseDraft,
  PurchaseIssue,
  PurchaseRecipient,
} from '@/api/types/chat-purchase';
import type { OrderDetail } from '@/api/types/orders';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  }>(),
  { errorMessage: '' },
);
const emit = defineEmits<{
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
}>();

const name = ref('');
const phone = ref('');
const address = ref('');
const quantity = ref(1);
const selectedSkuId = ref<string | null>(null);
const collapsed = ref(false);
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
  () =>
    Boolean(props.draft) &&
    !isTerminal.value &&
    !isBusy.value &&
    props.status !== 'streaming',
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
  if (!draft || !isEditable.value || !isDirty.value) return;
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
  <section
    class="max-h-[min(42dvh,24rem)] overflow-y-auto rounded-md border border-border bg-background p-3"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="text-sm font-medium">本次购买</h2>
        <Badge v-if="draft" variant="secondary">{{ statusLabel }}</Badge>
      </div>
      <Button
        size="icon"
        variant="ghost"
        :aria-label="collapsed ? '展开购买信息' : '收起购买信息'"
        :title="collapsed ? '展开购买信息' : '收起购买信息'"
        @click="collapsed = !collapsed"
      >
        <ChevronDown v-if="collapsed" />
        <ChevronUp v-else />
      </Button>
    </div>
    <div v-if="!collapsed" class="mt-3 flex flex-col gap-3">
      <p v-if="draft" class="break-all text-xs text-muted-foreground">
        {{ draft.productExternalId }}
      </p>
      <Alert v-if="order">
        <AlertDescription
          class="flex flex-wrap items-center justify-between gap-2"
        >
          <span
            >已生成订单 <strong class="break-all">{{ order.orderNo }}</strong
            >，当前状态：{{
              order.status === 'pending_payment' ? '待支付' : order.status
            }}。</span
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
      <Alert v-if="errorMessage" variant="destructive">
        <AlertDescription role="alert">{{ errorMessage }}</AlertDescription>
      </Alert>
      <div
        v-if="status === 'loading' && !draft"
        class="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Spinner />正在读取购买草稿
      </div>
      <div
        v-else-if="status === 'empty' && !draft"
        class="text-sm text-muted-foreground"
      >
        当前会话没有进行中的购买。
      </div>
      <template v-else-if="draft && !isTerminal">
        <FieldGroup class="grid gap-2 sm:grid-cols-2">
          <Field>
            <FieldLabel for="purchase-name">收件人</FieldLabel>
            <Input id="purchase-name" v-model="name" :disabled="!isEditable" />
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
              id="purchase-sku"
              :model-value="selectedSkuId ?? undefined"
              :disabled="!isEditable"
              @update:model-value="
                (value) => {
                  selectedSkuId = String(value);
                }
              "
            >
              <SelectTrigger
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
        <p v-if="isDirty" class="text-xs text-muted-foreground">
          有未保存的购买信息变更；保存后才能确认下单。
        </p>
        <div
          v-if="draft.confirmation"
          class="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm"
        >
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
      </template>
      <p v-else-if="draft" class="text-sm text-muted-foreground">
        此购买草稿已{{ statusLabel }}，不能继续编辑。
      </p>
      <div class="flex flex-wrap justify-between gap-2">
        <Button
          v-if="draft && !isTerminal"
          variant="ghost"
          :disabled="!isEditable"
          @click="emit('discard')"
        >
          <Trash2 data-icon="inline-start" />放弃本次购买
        </Button>
        <div class="flex flex-wrap gap-2">
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
            :disabled="!isEditable || !isDirty"
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
      </div>
    </div>
  </section>
</template>
