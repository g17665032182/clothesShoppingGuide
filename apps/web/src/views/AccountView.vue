<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { auth } from '@/lib/auth';
import { apiRequest } from '@/lib/api';

const displayName = ref('');
const password = ref('');
const message = ref('');
const error = ref('');
const pending = ref(false);

onMounted(() => {
  displayName.value = auth.state.user?.displayName ?? '';
});

async function saveProfile() {
  pending.value = true;
  error.value = '';
  message.value = '';
  try {
    const body: { displayName?: string; password?: string } = {
      displayName: displayName.value,
    };
    if (password.value) body.password = password.value;
    await apiRequest(
      '/users/me',
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
      auth.state.token ?? undefined,
    );
    password.value = '';
    await auth.refreshUser();
    message.value = '账户资料已更新。';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败。';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section class="content-section narrow-section">
    <div class="page-heading">
      <p class="eyebrow">账户</p>
      <h1>个人资料</h1>
      <p>管理你的账户信息。</p>
    </div>
    <form class="settings-form" @submit.prevent="saveProfile">
      <div class="identity-row">
        <div class="avatar">{{ auth.state.user?.displayName.slice(0, 1) }}</div>
        <div class="identity-copy">
          <strong>{{ auth.state.user?.displayName }}</strong>
          <span>{{ auth.state.user?.email }}</span>
        </div>
        <span class="role-label">{{
          auth.state.user?.role === 'admin' ? '管理员' : '用户'
        }}</span>
      </div>
      <label class="field">
        <span>昵称</span>
        <input
          v-model.trim="displayName"
          maxlength="100"
          minlength="1"
          required
        />
      </label>
      <label class="field">
        <span>新密码</span>
        <input
          v-model="password"
          autocomplete="new-password"
          maxlength="128"
          minlength="8"
          placeholder="留空表示不修改"
          type="password"
        />
      </label>
      <p v-if="message" class="form-success" role="status">{{ message }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button class="primary-button" :disabled="pending" type="submit">
          {{ pending ? '保存中…' : '保存更改' }}
        </button>
      </div>
    </form>
    <RouterLink v-if="auth.isAdmin.value" class="admin-link" to="/admin/users">
      管理用户
    </RouterLink>
  </section>
</template>
