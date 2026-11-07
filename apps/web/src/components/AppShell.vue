<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppNavigation from '@/components/shared/AppNavigation.vue';
import { auth } from '@/lib/auth';

const route = useRoute();
const isChatPage = computed(() => route.name === 'chat');
const isAccountArea = computed(() =>
  route.matched.some((record) => record.path === '/account'),
);
const canViewRoute = computed(
  () =>
    (!route.meta.requiresAuth || auth.isAuthenticated.value) &&
    (!route.meta.adminOnly || auth.isAdmin.value),
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
      <RouterView v-if="canViewRoute" />
    </main>
  </div>
</template>
