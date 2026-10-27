<script setup lang="ts">
import UserTable from './components/UserTable.vue';
import { useAdminUsersPage } from './page';
import { auth } from '@/lib/auth';

const {
  error,
  loading,
  loadUsers,
  search,
  setRole,
  toggleStatus,
  updatingUserId,
  users,
  visibleUsers,
} = useAdminUsersPage();
</script>

<template>
  <section class="content-section">
    <div class="page-heading admin-heading">
      <div>
        <p class="eyebrow">管理</p>
        <h1>用户</h1>
        <p>查看账户并管理访问状态与角色。</p>
      </div>
      <div class="user-count">{{ users.length }} 个账户</div>
    </div>

    <UserTable
      :current-user-id="auth.state.user?.id"
      :error="error"
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
  </section>
</template>
