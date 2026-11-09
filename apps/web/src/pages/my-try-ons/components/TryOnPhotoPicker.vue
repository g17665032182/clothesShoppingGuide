<script setup lang="ts">
import { computed, ref } from 'vue';
import { ImagePlus, Trash2, Upload } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { TryOnPhoto } from '@/api/types/try-on';

const props = defineProps<{
  photos: TryOnPhoto[];
  selectedPhotoId: string | null;
  disabled?: boolean;
  deletingPhotoId?: string | null;
}>();
const emit = defineEmits<{
  (event: 'update:selectedPhotoId', value: string | null): void;
  (event: 'upload', file: File, save: boolean): void;
  (event: 'delete', id: string): void;
}>();
const fileInput = ref<HTMLInputElement | null>(null);
const saveUpload = ref(false);
const selectedFileName = ref('');
const selectedFile = ref<File | null>(null);
const uploadDisabled = computed(() => props.disabled || !selectedFile.value);

function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null;
  selectedFile.value = file;
  selectedFileName.value = file?.name ?? '';
}

function upload() {
  if (!selectedFile.value) return;
  emit('upload', selectedFile.value, saveUpload.value);
  selectedFile.value = null;
  selectedFileName.value = '';
  if (fileInput.value) fileInput.value.value = '';
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div class="flex min-w-0 items-center gap-2">
        <Input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          :disabled="disabled"
          @change="chooseFile"
        />
        <span
          v-if="selectedFileName"
          class="truncate text-xs text-muted-foreground"
        >
          {{ selectedFileName }}
        </span>
      </div>
      <Button :disabled="uploadDisabled" @click="upload">
        <Upload data-icon="inline-start" />上传照片
      </Button>
    </div>
    <label class="flex items-center gap-2 text-sm">
      <Checkbox v-model="saveUpload" :disabled="disabled" />
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
