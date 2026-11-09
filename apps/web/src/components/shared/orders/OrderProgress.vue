<script setup lang="ts">
import { computed } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import {
  Check,
  CircleCheck,
  ClipboardList,
  CreditCard,
  Truck,
  X,
} from '@lucide/vue';
import type { OrderSummary } from '@/api/types/orders';
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@/components/ui/stepper';
import { cn } from '@/lib/utils';

type ProgressOrder = Pick<
  OrderSummary,
  | 'status'
  | 'createdAt'
  | 'expiresAt'
  | 'paidAt'
  | 'shippedAt'
  | 'completedAt'
  | 'closedAt'
>;

const props = defineProps<{ order: ProgressOrder }>();
const horizontal = useMediaQuery('(min-width: 640px)');
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function formatTimestamp(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  const parts = dateFormatter.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}:${part('second')}`,
  };
}

const steps = computed(() => {
  const order = props.order;
  const nodes = [
    {
      key: 'created',
      title: '创建订单',
      timestamp: order.createdAt,
      pending: '时间未记录',
      icon: ClipboardList,
    },
    {
      key: 'paid',
      title: '支付订单',
      timestamp: order.paidAt,
      pending: '待支付',
      icon: CreditCard,
    },
    {
      key: 'shipped',
      title: '商家发货',
      timestamp: order.shippedAt,
      pending: '待发货',
      icon: Truck,
    },
    {
      key: 'completed',
      title: '确认收货',
      timestamp: order.completedAt,
      pending: '待收货',
      icon: CircleCheck,
    },
  ];
  // 关闭是终止分支，仅保留实际发生的节点，避免误示为已支付、已发货或已完成。
  if (order.status === 'closed') {
    return [
      ...nodes.filter((node) => node.key === 'created' || node.timestamp),
      {
        key: 'closed',
        title: '订单关闭',
        timestamp: order.closedAt,
        pending: '关闭时间未记录',
        icon: X,
      },
    ].map((node) => ({ ...node, formatted: formatTimestamp(node.timestamp) }));
  }
  return nodes.map((node) => ({
    ...node,
    formatted: formatTimestamp(node.timestamp),
  }));
});

const activeStep = computed(() => {
  const status = props.order.status;
  if (status === 'closed') return steps.value.length;
  return {
    pending_payment: 2,
    pending_shipment: 3,
    pending_receipt: 4,
    completed: 4,
  }[status];
});
const paymentDeadline = computed(() => formatTimestamp(props.order.expiresAt));
</script>

<template>
  <section class="flex min-w-0 flex-col gap-4" aria-label="订单进度">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 class="text-sm font-medium">订单进度</h3>
      <p
        v-if="paymentDeadline"
        class="flex flex-wrap gap-x-2 text-xs text-muted-foreground"
      >
        <span>支付截止</span>
        <time :datetime="order.expiresAt" class="tabular-nums">
          {{ paymentDeadline.date }} {{ paymentDeadline.time }}
        </time>
      </p>
    </div>
    <Stepper
      :model-value="activeStep"
      :linear="false"
      :orientation="horizontal ? 'horizontal' : 'vertical'"
      aria-label="订单时间节点"
      class="w-full flex-col gap-0 sm:flex-row"
    >
      <StepperItem
        v-for="(step, index) in steps"
        :key="step.key"
        :step="index + 1"
        :completed="Boolean(step.timestamp) && step.key !== 'closed'"
        class="relative min-w-0 flex-1 items-start gap-3 pb-5 last:pb-0 sm:flex-col sm:items-center sm:gap-2 sm:pb-0"
      >
        <!-- 进度来自服务端；触发器仅用于组件注册，不提供切换订单状态的交互。 -->
        <StepperTrigger
          as="div"
          :tabindex="-1"
          aria-hidden="true"
          class="pointer-events-none shrink-0 p-0"
        >
          <StepperIndicator
            :class="
              cn(
                step.key === 'closed' &&
                  'bg-destructive/10 text-destructive group-data-[state=active]:bg-destructive/10 group-data-[state=active]:text-destructive',
              )
            "
          >
            <Check v-if="step.timestamp && step.key !== 'closed'" />
            <component :is="step.icon" v-else />
          </StepperIndicator>
        </StepperTrigger>
        <StepperSeparator
          v-if="index < steps.length - 1"
          class="absolute bottom-1 left-4 top-9 w-px sm:bottom-auto sm:left-[calc(50%+24px)] sm:right-[calc(-50%+24px)] sm:top-4 sm:h-px sm:w-auto"
        />
        <div
          class="flex min-w-0 flex-col gap-1 pt-1 sm:items-center sm:pt-0 sm:text-center"
        >
          <StepperTitle as="p">{{ step.title }}</StepperTitle>
          <StepperDescription as="div">
            <time
              v-if="step.formatted && step.timestamp"
              :datetime="step.timestamp"
              class="flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums sm:flex-col"
            >
              <span>{{ step.formatted.date }}</span>
              <span>{{ step.formatted.time }}</span>
            </time>
            <span v-else>{{ step.pending }}</span>
          </StepperDescription>
        </div>
      </StepperItem>
    </Stepper>
  </section>
</template>
