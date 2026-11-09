<script setup lang="ts">
import { ShieldCheck, UsersRound } from '@lucide/vue';
import UserTable from './components/UserTable.vue';
import { useAdminUsersPage } from './page';
import { auth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const {
  loading,
  loadUsers,
  search,
  status,
  setRole,
  toggleStatus,
  updatingUserId,
  users,
  visibleUsers,
} = useAdminUsersPage();
</script>

<template>
  <section class="flex flex-col gap-8 py-10 md:py-16">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-muted-foreground">管理</p>
        <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">用户</h1>
        <p class="text-muted-foreground">查看账户并管理访问状态与角色。</p>
      </div>
      <Badge variant="secondary">
        <UsersRound data-icon="inline-start" />
        {{ users.length }} 个账户
      </Badge>
    </div>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <ShieldCheck class="size-4" />
          账户访问
        </CardTitle>
        <CardDescription>搜索用户，调整角色，或更新账户状态。</CardDescription>
      </CardHeader>
      <UserTable
        :current-user-id="auth.state.user?.id"
        :failed="status === 'error'"
        :loading="loading"
        :search="search"
        :updating-user-id="updatingUserId"
        :users="users"
        :visible-users="visibleUsers"
        @refresh="loadUsers"
        @set-role="setRole"
        @toggle-status="toggleStatus"
        @update:search="search = $event"
      />
    </Card>
  </section>
</template>
