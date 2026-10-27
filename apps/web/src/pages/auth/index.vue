<script setup lang="ts">
import AuthIntro from './components/AuthIntro.vue';
import { useAuthPage } from './page';

const { displayName, email, error, isRegister, password, pending, submit } =
  useAuthPage();
</script>

<template>
  <section class="auth-layout">
    <AuthIntro />
    <form class="form-panel" @submit.prevent="submit">
      <div>
        <p class="eyebrow">
          {{ isRegister ? '创建账户' : '账户登录' }}
        </p>
        <h2>
          {{ isRegister ? '加入衣橱指南' : '登录你的账户' }}
        </h2>
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
      <p v-if="error" class="form-error" role="alert">
        {{ error }}
      </p>
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
