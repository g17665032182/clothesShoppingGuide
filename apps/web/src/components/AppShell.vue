<script setup lang="ts">
import { ChevronDown, Shirt, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import AccountMenu from '@/components/shared/AccountMenu.vue';

const route = useRoute();
const isChatPage = computed(() => route.name === 'chat');
</script>

<template>
  <div :class="['app-shell', isChatPage && 'app-shell-chat']">
    <header v-if="!isChatPage" class="shell-header">
      <RouterLink class="brand" to="/">
        <span class="brand-icon"><Shirt :size="18" /></span>
        <span>衣橱指南</span>
      </RouterLink>
      <div class="header-actions">
        <RouterLink v-if="auth.state.user" class="text-link" to="/chat"
          >聊天</RouterLink
        >
        <AccountMenu v-if="auth.state.user">
          <Button aria-label="用户菜单" type="button" variant="ghost">
            <UserRound aria-hidden="true" data-icon="inline-start" />
            <span class="max-w-32 truncate">{{
              auth.state.user.displayName
            }}</span>
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </AccountMenu>
        <RouterLink v-else class="text-link" to="/login">登录</RouterLink>
      </div>
    </header>
    <main :class="isChatPage ? 'shell-main-chat' : 'shell-main'">
      <RouterView />
    </main>
  </div>
</template>
