<script setup lang="ts">
import { ArrowLeft, Save, ShieldCheck } from '@lucide/vue';
import ProfileForm from './components/ProfileForm.vue';
import { useAccountPage } from './page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const { displayName, error, password, pending, saveProfile, status, user } =
  useAccountPage();
</script>

<template>
  <section class="flex flex-col gap-8 py-10 md:py-16">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-muted-foreground">账户</p>
        <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
          个人资料
        </h1>
        <p class="text-muted-foreground">管理你的账户信息和登录凭据。</p>
      </div>
    </div>

    <div
      v-if="user"
      class="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]"
    >
      <ProfileForm
        :display-name="displayName"
        :error="error"
        :password="password"
        :status="status"
        :user="user"
        @submit="saveProfile"
        @update:display-name="displayName = $event"
        @update:password="password = $event"
      />
      <Card class="h-fit">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <ShieldCheck class="size-4" />
            账户概览
          </CardTitle>
          <CardDescription>当前账户的访问信息。</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 text-sm">
          <div class="flex items-center justify-between gap-4">
            <span class="text-muted-foreground">邮箱</span>
            <span class="max-w-60 truncate text-right font-medium">{{
              user.email
            }}</span>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-muted-foreground">角色</span>
            <span class="font-medium">{{
              user.role === 'admin' ? '管理员' : '用户'
            }}</span>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-muted-foreground">状态</span>
            <span class="font-medium">{{
              user.status === 'active' ? '正常' : '已禁用'
            }}</span>
          </div>
          <Button
            v-if="user.role === 'admin'"
            as-child
            class="mt-2"
            variant="outline"
          >
            <RouterLink to="/admin/users">管理用户</RouterLink>
          </Button>
        </CardContent>
      </Card>
    </div>
    <div v-if="user" class="flex justify-center gap-3 pt-2">
      <Button as-child variant="outline">
        <RouterLink to="/">
          <ArrowLeft data-icon="inline-start" />
          返回首页
        </RouterLink>
      </Button>
      <Button :disabled="pending" form="account-profile-form" type="submit">
        <Spinner v-if="pending" data-icon="inline-start" />
        <Save v-else data-icon="inline-start" />
        {{ pending ? '保存中' : '保存更改' }}
      </Button>
    </div>
  </section>
</template>
