<script setup lang="ts">
import AccountNavigation from './components/AccountNavigation.vue';
</script>

<template>
  <div
    class="grid min-h-full grid-cols-1 content-start md:grid-cols-[352px_minmax(0,1fr)]"
  >
    <AccountNavigation />
    <main class="min-w-0 px-4 py-5 md:px-6 md:py-8">
      <RouterView />
    </main>
  </div>
</template>
