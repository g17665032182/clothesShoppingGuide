<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ExternalLink, ImageOff, PackageSearch } from '@lucide/vue';
import type { AdminProductDetail } from '@/api/types/admin-products';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const props = defineProps<{
  open: boolean;
  loading: boolean;
  error: string;
  product: AdminProductDetail | null;
}>();
const failedImages = ref(new Set<string>());
const categoryLabel = computed(() => {
  const labels = {
    tops: '上装',
    bottoms: '下装',
    dresses: '连衣裙',
    outerwear: '外套',
    shoes: '鞋类',
  };
  return props.product ? labels[props.product.category] : '';
});

watch(
  () => props.product,
  () => {
    failedImages.value = new Set();
  },
);

function markImageFailed(skuId: string): void {
  failedImages.value = new Set([...failedImages.value, skuId]);
}

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (event: 'retry'): void;
}>();

function formatMoney(value: string) {
  return `¥${value}`;
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader class="min-w-0 pr-7">
        <DialogTitle class="wrap-break-word">{{
          product?.name || '商品详情'
        }}</DialogTitle>
        <DialogDescription class="wrap-break-word">{{
          product?.externalId || '商品详情'
        }}</DialogDescription>
      </DialogHeader>
      <div v-if="loading" class="flex flex-col gap-4">
        <Spinner />
        <Skeleton class="h-5 w-2/3" />
        <Skeleton class="h-24 w-full" />
      </div>
      <Alert v-else-if="error" variant="destructive">
        <AlertDescription role="status"
          >商品详情加载失败，请重试。</AlertDescription
        >
        <Button size="sm" variant="outline" @click="emit('retry')">重试</Button>
      </Alert>
      <div v-else-if="product" class="flex min-w-0 flex-col gap-5">
        <div class="grid min-w-0 gap-4 sm:grid-cols-2">
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">外部 ID</p>
            <p class="mt-1 break-all font-medium">{{ product.externalId }}</p>
          </div>
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">品牌 / 分类</p>
            <p class="mt-1 wrap-break-word font-medium">
              {{ product.brand || '无品牌' }} / {{ categoryLabel }}
            </p>
          </div>
          <div class="min-w-0 sm:col-span-2">
            <p class="text-xs text-muted-foreground">描述</p>
            <p class="mt-1 wrap-break-word whitespace-pre-wrap text-sm">
              {{ product.description || '暂无描述' }}
            </p>
          </div>
          <a
            v-if="safeUrl(product.productUrl)"
            class="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            :href="safeUrl(product.productUrl) ?? undefined"
            target="_blank"
            rel="noopener noreferrer"
          >
            查看商品链接
            <ExternalLink />
          </a>
        </div>
        <div
          v-if="
            product.styles.length ||
            product.occasions.length ||
            product.fits.length
          "
          class="flex flex-wrap gap-2"
        >
          <Badge
            v-for="tag in [
              ...new Set([
                ...product.styles,
                ...product.occasions,
                ...product.fits,
              ]),
            ]"
            :key="tag"
            variant="outline"
            >{{ tag }}</Badge
          >
        </div>
        <div class="overflow-x-auto rounded-lg border">
          <Table class="min-w-[760px]">
            <TableCaption class="sr-only">商品 SKU 库存</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>颜色 / 尺码</TableHead>
                <TableHead>价格</TableHead>
                <TableHead>实物库存</TableHead>
                <TableHead>预占</TableHead>
                <TableHead>可售</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="sku in product.skus" :key="sku.id">
                <TableCell>
                  <div class="flex min-w-0 items-center gap-2">
                    <img
                      v-if="safeUrl(sku.imageUrl) && !failedImages.has(sku.id)"
                      :src="safeUrl(sku.imageUrl) ?? undefined"
                      :alt="`${product.name} ${sku.color}`"
                      class="size-12 shrink-0 rounded object-cover"
                      loading="lazy"
                      @error="markImageFailed(sku.id)"
                    />
                    <span
                      v-else
                      class="flex size-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
                      role="img"
                      aria-label="暂无商品图片"
                      ><ImageOff class="size-4"
                    /></span>
                    <span
                      class="min-w-0 max-w-56 wrap-break-word whitespace-normal font-mono text-xs"
                      >{{ sku.externalSkuId }}</span
                    >
                  </div>
                </TableCell>
                <TableCell>{{ sku.color }} / {{ sku.size }}</TableCell>
                <TableCell>{{ formatMoney(sku.price) }}</TableCell>
                <TableCell>{{ sku.stock }}</TableCell>
                <TableCell>{{ sku.reservedStock }}</TableCell>
                <TableCell>{{ sku.availableStock }}</TableCell>
                <TableCell>
                  <Badge :variant="sku.isActive ? 'secondary' : 'outline'">
                    {{ sku.isActive ? '已启用' : '已停用' }}
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
      <div
        v-else
        class="flex flex-col items-center gap-3 py-10 text-muted-foreground"
      >
        <PackageSearch />
        暂无商品详情
      </div>
    </DialogContent>
  </Dialog>
</template>
