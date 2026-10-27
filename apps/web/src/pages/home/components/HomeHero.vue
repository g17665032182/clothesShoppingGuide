<script setup lang="ts">
import type { User } from '@/api/types/users';

defineProps<{
  user: User | null;
  isAdmin: boolean;
}>();
</script>

<template>
  <section class="home-hero">
    <div class="hero-copy">
      <p class="eyebrow">CLOTHES SHOPPING GUIDE</p>
      <h1>找到更适合自己的穿着选择。</h1>
      <p class="intro">从了解自己的需求开始，逐步探索服装与搭配。</p>
      <div class="hero-actions">
        <RouterLink v-if="!user" class="primary-button" to="/register">
          开始使用
        </RouterLink>
        <RouterLink v-else class="primary-button" to="/account">
          查看个人资料
        </RouterLink>
        <RouterLink v-if="isAdmin" class="secondary-button" to="/admin/users">
          管理用户
        </RouterLink>
      </div>
    </div>
    <aside class="hero-aside">
      <div class="aside-line"></div>
      <p>你的衣橱，从一次更有意识的选择开始。</p>
      <span>01 / 账户</span>
    </aside>
  </section>
</template>
