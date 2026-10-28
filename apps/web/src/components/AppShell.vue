<script setup lang="ts">
import { LogOut, Shirt, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { auth } from '@/lib/auth';

const route = useRoute();
const router = useRouter();
const isChatPage = computed(() => route.name === 'chat');

function signOut() {
  auth.signOut();
  void router.push('/login');
}
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
        <RouterLink v-if="auth.state.user" class="account-link" to="/account">
          <UserRound :size="16" />
          <span>{{ auth.state.user.displayName }}</span>
        </RouterLink>
        <button
          v-if="auth.state.user"
          class="icon-button"
          aria-label="退出登录"
          type="button"
          title="退出登录"
          @click="signOut"
        >
          <LogOut :size="17" />
        </button>
        <RouterLink v-else class="text-link" to="/login">登录</RouterLink>
      </div>
    </header>
    <main :class="isChatPage ? 'shell-main-chat' : 'shell-main'">
      <RouterView />
    </main>
  </div>
</template>
