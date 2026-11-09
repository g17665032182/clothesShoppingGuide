<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, RefreshCw, Shirt } from '@lucide/vue';
import { useRouter } from 'vue-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import TryOnPhotoPicker from './components/TryOnPhotoPicker.vue';
import TryOnConsentDialog from './components/TryOnConsentDialog.vue';
import TryOnTaskList from './components/TryOnTaskList.vue';
import { useMyTryOnsPage } from './page';

const router = useRouter();
const {
  product,
  tasks,
  resultImageUrls,
  savedPhotos,
  listStatus,
  photoStatus,
  photoError,
  selectedPhotoId,
  selectedColor,
  consentOpen,
  submitting,
  actionTaskId,
  deletingPhotoId,
  activeTask,
  canSubmit,
  loadTasks,
  loadSavedPhotos,
  uploadPhoto,
  submitTask,
  confirmConsent,
  downloadTask,
  deleteTask,
  deletePhoto,
  markRead,
} = useMyTryOnsPage();

const supportedProduct = computed(
  () =>
    product.value &&
    ['tops', 'bottoms', 'dresses', 'outerwear'].includes(
      product.value.category,
    ),
);

function returnToChat() {
  void router.push('/chat');
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-6">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-sm font-medium text-muted-foreground">账户</p>
        <h1 class="text-2xl font-semibold">我的试穿</h1>
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label="刷新试穿历史"
        title="刷新试穿历史"
        :disabled="listStatus === 'loading'"
        @click="loadTasks"
      >
        <RefreshCw />
      </Button>
    </header>

    <section v-if="product" class="space-y-4 border-y py-5">
      <div class="flex flex-wrap items-start gap-4">
        <img
          v-if="product.imageUrl"
          :src="product.imageUrl"
          :alt="product.name"
          class="size-20 rounded-sm object-cover"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm text-muted-foreground">当前商品</p>
          <h2 class="wrap-break-word text-lg font-semibold">
            {{ product.name }}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            生成结果仅供视觉参考，不代表实际商品效果、尺码或合身程度。
          </p>
        </div>
      </div>

      <Alert v-if="!supportedProduct" variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>该商品暂不支持试穿</AlertTitle>
        <AlertDescription>目前仅支持服装商品，不支持鞋类。</AlertDescription>
      </Alert>

      <template v-else>
        <div class="grid gap-5 lg:grid-cols-2">
          <div class="space-y-3">
            <h3 class="font-medium">选择颜色和照片</h3>
            <FieldGroup>
              <Field>
                <FieldLabel for="try-on-color">商品颜色</FieldLabel>
                <Select
                  :model-value="selectedColor"
                  :disabled="
                    !product.colors.length || submitting || Boolean(activeTask)
                  "
                  @update:model-value="selectedColor = String($event)"
                >
                  <SelectTrigger id="try-on-color">
                    <SelectValue placeholder="选择颜色" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        v-for="color in product.colors"
                        :key="color"
                        :value="color"
                      >
                        {{ color }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p
                  v-if="!product.colors.length"
                  class="text-sm text-destructive"
                >
                  当前商品没有可用颜色，请从商品卡重新发起试穿。
                </p>
              </Field>
            </FieldGroup>
            <TryOnPhotoPicker
              :photos="savedPhotos"
              :selected-photo-id="selectedPhotoId"
              :disabled="submitting || Boolean(activeTask)"
              :deleting-photo-id="deletingPhotoId"
              @update:selected-photo-id="selectedPhotoId = $event"
              @upload="uploadPhoto"
              @delete="deletePhoto"
            />
            <p
              v-if="photoStatus === 'loading'"
              class="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner />正在加载保存的照片
            </p>
            <Alert v-if="photoError" variant="destructive">
              <AlertDescription role="status"
                >照片列表需要重新读取。</AlertDescription
              >
              <Button variant="outline" size="sm" @click="loadSavedPhotos"
                >重试</Button
              >
            </Alert>
            <Button
              :disabled="!canSubmit || !supportedProduct"
              @click="submitTask"
            >
              {{
                submitting
                  ? '提交中'
                  : activeTask
                    ? '已有任务处理中'
                    : '生成试穿图'
              }}
            </Button>
            <p
              v-if="activeTask"
              class="text-sm text-muted-foreground"
              role="status"
            >
              你已有一个进行中的试穿任务，完成后可再次提交。
            </p>
          </div>
          <div
            class="space-y-3 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"
          >
            <h3 class="font-medium">照片与隐私</h3>
            <p class="text-sm leading-6 text-muted-foreground">
              仅上传你有权使用的单人照片。支持 JPEG、PNG、WebP，最大 10
              MiB，最长边 4,096 像素。未选择保存的照片会在任务结束后删除。
            </p>
            <p class="text-sm leading-6 text-muted-foreground">
              首次生成前会展示第三方处理说明并征求同意。结果仅本人可见，可下载或删除。
            </p>
          </div>
        </div>
      </template>
    </section>
    <Empty v-else class="border-y py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Shirt /></EmptyMedia>
        <EmptyTitle>从商品卡开始试穿</EmptyTitle>
        <EmptyDescription>试穿仅支持现有目录中的服装商品。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" @click="returnToChat">返回商品</Button>
      </EmptyContent>
    </Empty>

    <div
      v-if="listStatus === 'loading' && !tasks.length"
      class="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Spinner />正在加载试穿历史
    </div>
    <Empty
      v-else-if="listStatus === 'error'"
      class="border-y py-10"
      role="alert"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia>
        <EmptyTitle>试穿历史加载失败</EmptyTitle>
        <EmptyDescription>请刷新试穿历史重试。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" @click="loadTasks"
          ><RefreshCw data-icon="inline-start" />重试</Button
        >
      </EmptyContent>
    </Empty>
    <Empty v-else-if="listStatus === 'empty'" class="border-y py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Shirt /></EmptyMedia>
        <EmptyTitle>还没有试穿记录</EmptyTitle>
        <EmptyDescription
          >从支持的服装商品卡发起试穿后，任务会显示在这里。</EmptyDescription
        >
      </EmptyHeader>
    </Empty>
    <TryOnTaskList
      v-else-if="tasks.length"
      :tasks="tasks"
      :result-image-urls="resultImageUrls"
      :busy-task-id="actionTaskId"
      @refresh="loadTasks"
      @download="downloadTask"
      @delete="deleteTask"
      @read="markRead"
    />

    <TryOnConsentDialog
      v-model:open="consentOpen"
      :busy="submitting"
      @confirm="confirmConsent"
    />
  </section>
</template>
