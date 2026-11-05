<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppNavigation from '@/components/shared/AppNavigation.vue';

const route = useRoute();
const isChatPage = computed(() => route.name === 'chat');
const isAccountArea = computed(() =>
  route.matched.some((record) => record.path === '/account'),
);
</script>

<template>
  <div
    :class="[
      'app-shell',
      isChatPage && 'app-shell-chat',
      isAccountArea && 'app-shell-account',
    ]"
  >
    <AppNavigation />
    <main
      :class="[
        isChatPage
          ? 'shell-main-chat'
          : isAccountArea
            ? 'shell-main-account'
            : 'shell-main',
      ]"
    >
      <RouterView />
    </main>
  </div>
</template>
