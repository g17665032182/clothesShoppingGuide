<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { toast } from 'vue-sonner';
import { ImagePlus, Trash2, Upload } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { TryOnPhoto } from '@/api/types/try-on';
import { Field, FieldLabel } from '@/components/ui/field';
import { getPhotoUploadError } from '../photo-upload';

const props = defineProps<{
  photos: TryOnPhoto[];
  selectedPhotoId: string | null;
  disabled?: boolean;
  uploadDisabled?: boolean;
  deletingPhotoId?: string | null;
}>();
const emit = defineEmits<{
  (event: 'update:selectedPhotoId', value: string | null): void;
  (event: 'upload', file: File, save: boolean): void;
  (event: 'delete', id: string): void;
}>();
const fileInput = shallowRef<HTMLInputElement | null>(null);
const saveUpload = ref(false);
const selectedFile = ref<File | null>(null);
const fileInvalid = ref(false);
const uploadDisabled = computed(
  () => props.disabled || props.uploadDisabled || !selectedFile.value,
);

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  fileInput.value = input;
  const file = input.files?.[0] ?? null;
  fileInvalid.value = false;
  const error = file && getPhotoUploadError(file);
  if (error) {
    selectedFile.value = null;
    input.value = '';
    fileInvalid.value = true;
    toast.error(error);
    return;
  }
  selectedFile.value = file;
}

function upload() {
  if (uploadDisabled.value || !selectedFile.value) return;
  emit('upload', selectedFile.value, saveUpload.value);
}

// 仅在父级确认上传成功后清空，失败时保留文件以便重试。
watch(
  () => props.selectedPhotoId,
  (id) => {
    if (!id) return;
    selectedFile.value = null;
    fileInvalid.value = false;
    if (fileInput.value) fileInput.value.value = '';
  },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <Field
        :data-invalid="fileInvalid || undefined"
        :data-disabled="disabled || props.uploadDisabled || undefined"
      >
        <FieldLabel for="try-on-photo" class="sr-only">试穿照片</FieldLabel>
        <Input
          id="try-on-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          :aria-invalid="fileInvalid || undefined"
          :disabled="disabled || props.uploadDisabled"
          @change="chooseFile"
        />
      </Field>
      <Button :disabled="uploadDisabled" @click="upload">
        <Upload data-icon="inline-start" />上传照片
      </Button>
    </div>
    <label class="flex items-center gap-2 text-sm">
      <Checkbox
        v-model="saveUpload"
        :disabled="disabled || props.uploadDisabled"
      />
      保存这张照片，方便下次复用
    </label>
    <div v-if="photos.length" class="grid gap-2 sm:grid-cols-2">
      <div
        v-for="photo in photos"
        :key="photo.id"
        class="flex items-center justify-between gap-3 rounded-md border p-3"
        :class="
          selectedPhotoId === photo.id ? 'border-primary bg-primary/5' : ''
        "
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
          :disabled="disabled"
          @click="emit('update:selectedPhotoId', photo.id)"
        >
          <ImagePlus class="size-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ photo.width }} × {{ photo.height }}</span>
          <span class="text-xs text-muted-foreground">{{
            photo.mimeType
          }}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          :disabled="disabled || deletingPhotoId === photo.id"
          aria-label="删除保存的照片"
          title="删除保存的照片"
          @click="emit('delete', photo.id)"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
    <p v-else class="text-sm text-muted-foreground">
      还没有保存的照片。上传后可选择保存，未保存的照片只用于当前任务。
    </p>
  </div>
</template>
