<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/lib/api';
import { auth } from '@/lib/auth';

const route = useRoute();
const router = useRouter();
const isRegister = computed(() => route.name === 'register');
const email = ref('');
const password = ref('');
const displayName = ref('');
const error = ref('');
const pending = ref(false);

async function submit() {
  error.value = '';
  pending.value = true;
  try {
    if (isRegister.value) {
      await auth.register(email.value, password.value, displayName.value);
    } else {
      await auth.signIn(email.value, password.value);
    }
    await router.push(auth.isAdmin.value ? '/admin/users' : '/account');
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.status === 409
        ? '该邮箱已注册，请直接登录。'
        : cause instanceof Error
          ? cause.message
          : '操作失败，请稍后重试。';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section class="auth-layout">
    <div class="auth-intro">
      <p class="eyebrow">CLOTHES SHOPPING GUIDE</p>
      <h1>{{ isRegister ? '从认识自己的风格开始。' : '欢迎回来。' }}</h1>
      <p>整理穿衣需求，慢慢找到适合自己的选择。</p>
      <div class="auth-note">
        <span class="note-mark">衣</span>
        <span>让每一次选择，都更贴近自己。</span>
      </div>
    </div>
    <form class="form-panel" @submit.prevent="submit">
      <div>
        <p class="eyebrow">{{ isRegister ? '创建账户' : '账户登录' }}</p>
        <h2>{{ isRegister ? '加入衣橱指南' : '登录你的账户' }}</h2>
      </div>
      <label v-if="isRegister" class="field">
        <span>昵称</span>
        <input
          v-model.trim="displayName"
          autocomplete="name"
          maxlength="100"
          minlength="1"
          placeholder="怎么称呼你"
          required
        />
      </label>
      <label class="field">
        <span>邮箱</span>
        <input
          v-model.trim="email"
          autocomplete="email"
          maxlength="255"
          placeholder="name@example.com"
          required
          type="email"
        />
      </label>
      <label class="field">
        <span>密码</span>
        <input
          v-model="password"
          :autocomplete="isRegister ? 'new-password' : 'current-password'"
          maxlength="128"
          minlength="8"
          placeholder="至少 8 个字符"
          required
          type="password"
        />
      </label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="primary-button" :disabled="pending" type="submit">
        {{ pending ? '请稍候…' : isRegister ? '创建账户' : '登录' }}
      </button>
      <p class="form-switch">
        {{ isRegister ? '已经有账户？' : '还没有账户？' }}
        <RouterLink :to="isRegister ? '/login' : '/register'">
          {{ isRegister ? '返回登录' : '创建账户' }}
        </RouterLink>
      </p>
    </form>
  </section>
</template>
