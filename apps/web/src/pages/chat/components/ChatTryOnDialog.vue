<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlertTriangle, RefreshCw } from '@lucide/vue';
import { ApiError } from '@/api';
import {
  deleteTryOnPhoto,
  listSavedTryOnPhotos,
  uploadTryOnPhoto,
} from '@/api/modules/try-on';
import type { TryOnPhoto, TryOnPhotoPage } from '@/api/types/try-on';
import type { ChatProductCard, ChatTryOnAction } from '@/api/types/chat';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { auth } from '@/lib/auth';
import TryOnConsentDialog from '../../my-try-ons/components/TryOnConsentDialog.vue';
import TryOnPhotoPicker from '../../my-try-ons/components/TryOnPhotoPicker.vue';

const props = defineProps<{
  open: boolean;
  product: ChatProductCard | null;
  busy?: boolean;
}>();
const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (
    event: 'submit',
    request: { content: string; action: ChatTryOnAction },
  ): void;
}>();

const route = useRoute();
const router = useRouter();
const photos = ref<TryOnPhoto[]>([]);
const availability = ref<TryOnPhotoPage['availability'] | null>(null);
const photoStatus = ref<'idle' | 'loading' | 'success' | 'empty' | 'error'>(
  'idle',
);
const photoError = ref('');
const actionError = ref('');
const selectedPhotoId = ref<string | null>(null);
const selectedColor = ref('');
const consentOpen = ref(false);
const submitting = ref(false);
const deletingPhotoId = ref<string | null>(null);
let photoController: AbortController | null = null;
let actionController: AbortController | null = null;
let identityVersion = 0;

const canUpload = computed(
  () =>
    ['success', 'empty'].includes(photoStatus.value) &&
    (availability.value === 'available' || availability.value === 'test_only'),
);
const canSubmit = computed(
  () =>
    canUpload.value &&
    Boolean(props.product) &&
    Boolean(selectedColor.value) &&
    Boolean(selectedPhotoId.value) &&
    photos.value.some((photo) => photo.id === selectedPhotoId.value) &&
    !props.busy &&
    !submitting.value &&
    !deletingPhotoId.value,
);
const availabilityMessage = computed(() => {
  switch (availability.value) {
    case 'disabled':
      return '当前环境尚未开放试穿，暂不能上传照片或生成试穿图。';
    case 'test_images_unconfigured':
      return '当前环境尚未配置测试图片，暂不能上传照片或生成试穿图。';
    case 'test_only':
      return '当前仅支持已登记的合成或公开测试图片，暂不接收真实用户照片。';
    default:
      return '';
  }
});

watch(
  () => props.product?.externalId,
  () => {
    selectedColor.value = props.product?.colors[0] ?? '';
    actionError.value = '';
  },
  { immediate: true },
);

watch(
  () => [props.open, auth.state.user?.id] as const,
  ([open, userId]) => {
    if (!open) {
      // 关闭或切换账号时清理请求和照片引用，避免旧身份的数据留在弹窗状态中。
      identityVersion += 1;
      photoController?.abort();
      photoController = null;
      actionController?.abort();
      actionController = null;
      photos.value = [];
      selectedPhotoId.value = null;
      availability.value = null;
      photoStatus.value = 'idle';
      photoError.value = '';
      actionError.value = '';
      consentOpen.value = false;
      return;
    }
    if (!userId || !auth.state.token) {
      const destination = route.fullPath || '/chat';
      emit('update:open', false);
      void router.push({
        path: '/login',
        query: { redirect: destination },
      });
      return;
    }
    identityVersion += 1;
    actionController?.abort();
    photos.value = [];
    selectedPhotoId.value = null;
    availability.value = null;
    photoStatus.value = 'idle';
    actionError.value = '';
    void loadPhotos(userId, identityVersion);
  },
  { flush: 'sync' },
);

onBeforeUnmount(() => {
  photoController?.abort();
  actionController?.abort();
});

async function loadPhotos(userId: string, version: number) {
  const token = auth.state.token;
  if (!token) return;
  photoController?.abort();
  const controller = new AbortController();
  photoController = controller;
  photoStatus.value = 'loading';
  photoError.value = '';
  try {
    const result = await listSavedTryOnPhotos(token, controller.signal);
    if (
      controller.signal.aborted ||
      !props.open ||
      version !== identityVersion ||
      userId !== auth.state.user?.id
    )
      return;
    photos.value = result.items;
    availability.value = result.availability;
    photoStatus.value = result.items.length ? 'success' : 'empty';
  } catch (error) {
    if (
      !controller.signal.aborted &&
      version === identityVersion &&
      userId === auth.state.user?.id
    ) {
      photoStatus.value = 'error';
      photoError.value =
        error instanceof Error ? error.message : '照片列表加载失败';
    }
  } finally {
    if (photoController === controller) photoController = null;
  }
}

function retryLoadPhotos() {
  const userId = auth.state.user?.id;
  if (userId) void loadPhotos(userId, identityVersion);
}

function currentIdentity() {
  const userId = auth.state.user?.id;
  const token = auth.state.token;
  const version = identityVersion;
  return {
    userId,
    token,
    isCurrent: () =>
      props.open &&
      version === identityVersion &&
      Boolean(userId) &&
      userId === auth.state.user?.id,
  };
}

async function uploadPhoto(file: File, save: boolean) {
  const identity = currentIdentity();
  if (
    !identity.token ||
    !identity.userId ||
    !canUpload.value ||
    submitting.value
  )
    return;
  actionError.value = '';
  submitting.value = true;
  actionController?.abort();
  const controller = new AbortController();
  actionController = controller;
  try {
    const photo = await uploadTryOnPhoto(
      identity.token,
      file,
      save,
      controller.signal,
    );
    if (!identity.isCurrent()) return;
    photos.value = [
      photo,
      ...photos.value.filter((item) => item.id !== photo.id),
    ];
    photoStatus.value = 'success';
    selectedPhotoId.value = photo.id;
  } catch (error) {
    if (identity.isCurrent() && !controller.signal.aborted) {
      actionError.value =
        error instanceof ApiError && error.status === 409
          ? error.message
          : error instanceof Error
            ? error.message
            : '照片上传失败';
    }
  } finally {
    if (actionController === controller) actionController = null;
    submitting.value = false;
  }
}

async function deletePhoto(photoId: string) {
  const identity = currentIdentity();
  if (
    !photos.value.some(
      (photo) => photo.id === photoId && photo.kind === 'saved',
    )
  )
    return;
  if (!identity.token || !identity.isCurrent() || deletingPhotoId.value) return;
  deletingPhotoId.value = photoId;
  actionError.value = '';
  actionController?.abort();
  const controller = new AbortController();
  actionController = controller;
  try {
    await deleteTryOnPhoto(identity.token, photoId, controller.signal);
    if (!identity.isCurrent()) return;
    photos.value = photos.value.filter((photo) => photo.id !== photoId);
    if (selectedPhotoId.value === photoId) selectedPhotoId.value = null;
    photoStatus.value = photos.value.length ? 'success' : 'empty';
  } catch (error) {
    if (identity.isCurrent() && !controller.signal.aborted) {
      actionError.value =
        error instanceof Error ? error.message : '照片删除失败';
    }
  } finally {
    if (actionController === controller) actionController = null;
    deletingPhotoId.value = null;
  }
}

function requestConsent() {
  if (!canSubmit.value) return;
  consentOpen.value = true;
}

function confirmConsent() {
  const product = props.product;
  const photoId = selectedPhotoId.value;
  const color = selectedColor.value;
  if (!product || !photoId || !color || !canSubmit.value) return;
  // 仅在用户明确确认后发送结构化动作；照片 ID 和同意版本不进入消息正文。
  emit('submit', {
    content: `帮我试穿「${product.name}」（${color}）`,
    action: {
      productExternalId: product.externalId,
      color,
      photoId,
      consentVersion: 'v1',
    },
  });
  consentOpen.value = false;
  emit('update:open', false);
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>试穿商品</DialogTitle>
        <DialogDescription>
          选择商品颜色和本人照片。生成结果仅供视觉参考，不代表实际尺码或合身程度。
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-5">
        <Alert
          v-if="product && product.colors.length === 0"
          variant="destructive"
        >
          <AlertTriangle />
          <AlertTitle>没有可选试穿颜色</AlertTitle>
          <AlertDescription>
            当前商品没有可用颜色，请选择其他商品。
          </AlertDescription>
        </Alert>
        <FieldGroup>
          <Field>
            <FieldLabel for="chat-try-on-color">商品颜色</FieldLabel>
            <Select v-model="selectedColor">
              <SelectTrigger id="chat-try-on-color" class="w-full">
                <SelectValue placeholder="选择颜色" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem
                    v-for="color in product?.colors ?? []"
                    :key="color"
                    :value="color"
                  >
                    {{ color }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel for="try-on-photo">本人照片</FieldLabel>
            <TryOnPhotoPicker
              :photos="photos"
              :selected-photo-id="selectedPhotoId"
              :disabled="submitting || busy"
              :upload-disabled="
                photoStatus === 'loading' ||
                photoStatus === 'error' ||
                !canUpload
              "
              :deleting-photo-id="deletingPhotoId"
              @update:selected-photo-id="selectedPhotoId = $event"
              @upload="uploadPhoto"
              @delete="deletePhoto"
            />
          </Field>
        </FieldGroup>
        <Alert v-if="photoStatus === 'loading'" role="status">
          <AlertTitle>正在加载照片</AlertTitle>
        </Alert>
        <Alert v-if="availabilityMessage" variant="destructive">
          <AlertTriangle />
          <AlertTitle>试穿暂不可用</AlertTitle>
          <AlertDescription>{{ availabilityMessage }}</AlertDescription>
        </Alert>
        <Alert v-if="photoError || actionError" variant="destructive">
          <AlertTriangle />
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{{ photoError || actionError }}</AlertDescription>
          <Button
            v-if="photoError"
            variant="outline"
            size="sm"
            @click="retryLoadPhotos"
          >
            <RefreshCw data-icon="inline-start" />
            重试加载照片
          </Button>
        </Alert>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="submitting"
          @click="emit('update:open', false)"
        >
          取消
        </Button>
        <Button :disabled="!canSubmit" @click="requestConsent"> 继续 </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <TryOnConsentDialog
    :open="consentOpen"
    :busy="submitting || busy"
    @update:open="consentOpen = $event"
    @confirm="confirmConsent"
  />
</template>
