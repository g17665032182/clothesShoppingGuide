<template>
  <AppShell />
  <Toaster
    position="top-right"
    close-button
    :duration="4500"
    :visible-toasts="3"
    :mobile-offset="16"
    container-aria-label="操作提示"
    :toast-options="{ closeButtonAriaLabel: '关闭提示' }"
  />
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { toast } from 'vue-sonner';
import 'vue-sonner/style.css';
import AppShell from '@/components/AppShell.vue';
import { Toaster } from '@/components/ui/sonner';
import { auth } from '@/lib/auth';

watch(
  () => auth.state.user?.id,
  () => toast.dismiss(),
  { flush: 'sync' },
);
</script>
