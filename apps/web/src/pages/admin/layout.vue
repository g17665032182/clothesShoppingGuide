<script setup lang="ts">
import { ClipboardCheck, PackageSearch, Truck, UsersRound } from '@lucide/vue';
import { cn } from '@/lib/utils';

const sections = [
  { name: 'admin-products', label: '商品目录', icon: PackageSearch },
  { name: 'admin-orders', label: '订单履约', icon: Truck },
  { name: 'admin-return-refunds', label: '退货退款', icon: ClipboardCheck },
  { name: 'admin-users', label: '用户管理', icon: UsersRound },
] as const;
</script>

<template>
  <div class="flex min-w-0 flex-col py-5 md:py-8">
    <nav
      aria-label="管理员导航"
      class="flex flex-wrap items-center gap-1 border-b pb-4"
    >
      <span class="mr-4 text-sm font-semibold">管理中心</span>
      <RouterLink
        v-for="section in sections"
        :key="section.name"
        v-slot="{ href, navigate, isActive }"
        :to="{ name: section.name }"
        custom
      >
        <a
          :href="href"
          :aria-current="isActive ? 'page' : undefined"
          :class="
            cn(
              'inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted',
              isActive && 'bg-muted font-medium',
            )
          "
          @click="navigate"
        >
          <component :is="section.icon" class="size-4" aria-hidden="true" />
          {{ section.label }}
        </a>
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
