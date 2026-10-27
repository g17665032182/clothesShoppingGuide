<script setup lang="ts">
import ProfileForm from './components/ProfileForm.vue';
import { useAccountPage } from './page';

const { displayName, error, password, pending, saveProfile, status, user } =
  useAccountPage();
</script>

<template>
  <section class="content-section narrow-section">
    <div class="page-heading">
      <p class="eyebrow">账户</p>
      <h1>个人资料</h1>
      <p>管理你的账户信息。</p>
    </div>
    <ProfileForm
      v-if="user"
      :display-name="displayName"
      :error="error"
      :password="password"
      :pending="pending"
      :status="status"
      :user="user"
      @submit="saveProfile"
      @update:display-name="displayName = $event"
      @update:password="password = $event"
    />
    <RouterLink
      v-if="user?.role === 'admin'"
      class="admin-link"
      to="/admin/users"
    >
      管理用户
    </RouterLink>
  </section>
</template>
