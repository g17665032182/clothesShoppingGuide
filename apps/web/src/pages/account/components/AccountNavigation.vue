<script setup lang="ts">
import {
  BookOpen,
  SlidersHorizontal,
  UserRound,
  ShoppingBag,
} from '@lucide/vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { cn } from '@/lib/utils';

const route = useRoute();
const isDocumentView = computed(
  () => route.name === 'account-memories' && route.query.view === 'document',
);
const isPreferencesView = computed(
  () => route.name === 'account-memories' && route.query.view !== 'document',
);
</script>

<template>
  <aside class="border-b px-4 py-5 md:border-b-0 md:border-r md:px-5 md:py-8">
    <h1 class="mb-4 px-2 text-sm font-semibold">账户设置</h1>
    <nav aria-label="账户设置" class="flex gap-1 overflow-x-auto md:flex-col">
      <RouterLink
        v-slot="{ isActive, href, navigate }"
        :to="{ name: 'account-profile' }"
        custom
      >
        <a
          :aria-current="isActive ? 'page' : undefined"
          :class="
            cn(
              'flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted',
              isActive && 'bg-muted font-medium text-foreground',
            )
          "
          :href="href"
          @click="navigate"
        >
          <UserRound aria-hidden="true" class="size-4" />
          个人资料
        </a>
      </RouterLink>
      <RouterLink
        v-slot="{ isActive, href, navigate }"
        :to="{ name: 'account-orders' }"
        custom
      >
        <a
          :aria-current="isActive ? 'page' : undefined"
          :class="
            cn(
              'flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted',
              isActive && 'bg-muted font-medium text-foreground',
            )
          "
          :href="href"
          @click="navigate"
        >
          <ShoppingBag aria-hidden="true" class="size-4" />
          我的订单
        </a>
      </RouterLink>
      <RouterLink
        v-slot="{ href, navigate }"
        :to="{ name: 'account-memories', query: { view: 'document' } }"
        custom
      >
        <a
          :aria-current="isDocumentView ? 'page' : undefined"
          :class="
            cn(
              'flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted',
              isDocumentView && 'bg-muted font-medium text-foreground',
            )
          "
          :href="href"
          @click="navigate"
        >
          <BookOpen aria-hidden="true" class="size-4" />
          我的记忆
        </a>
      </RouterLink>
      <RouterLink
        v-slot="{ href, navigate }"
        :to="{ name: 'account-memories', query: { view: 'preferences' } }"
        custom
      >
        <a
          :aria-current="isPreferencesView ? 'page' : undefined"
          :class="
            cn(
              'flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted',
              isPreferencesView && 'bg-muted font-medium text-foreground',
            )
          "
          :href="href"
          @click="navigate"
        >
          <SlidersHorizontal aria-hidden="true" class="size-4" />
          我的偏好
        </a>
      </RouterLink>
    </nav>
  </aside>
</template>
