<script setup lang="ts">
import type { User } from '@/api/types/users';

defineProps<{
  displayName: string;
  error: string;
  password: string;
  pending: boolean;
  status: 'idle' | 'loading' | 'success' | 'error';
  user: User;
}>();

const emit = defineEmits<{
  (event: 'update:displayName', value: string): void;
  (event: 'update:password', value: string): void;
  (event: 'submit'): void;
}>();
</script>

<template>
  <form class="settings-form" @submit.prevent="emit('submit')">
    <div class="identity-row">
      <div class="avatar">{{ user.displayName.slice(0, 1) }}</div>
      <div class="identity-copy">
        <strong>{{ user.displayName }}</strong>
        <span>{{ user.email }}</span>
      </div>
      <span class="role-label">
        {{ user.role === 'admin' ? '管理员' : '用户' }}
      </span>
    </div>
    <label class="field">
      <span>昵称</span>
      <input
        :value="displayName"
        maxlength="100"
        minlength="1"
        required
        @input="
          emit('update:displayName', ($event.target as HTMLInputElement).value)
        "
      />
    </label>
    <label class="field">
      <span>新密码</span>
      <input
        :value="password"
        autocomplete="new-password"
        maxlength="128"
        minlength="8"
        placeholder="留空表示不修改"
        type="password"
        @input="
          emit('update:password', ($event.target as HTMLInputElement).value)
        "
      />
    </label>
    <p v-if="status === 'success'" class="form-success" role="status">
      账户资料已更新。
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="form-actions">
      <button class="primary-button" :disabled="pending" type="submit">
        {{ pending ? '保存中…' : '保存更改' }}
      </button>
    </div>
  </form>
</template>
