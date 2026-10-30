<script setup lang="ts">
import { AlertCircle, RefreshCw } from '@lucide/vue';
import { cn } from 'cn';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import AuthBrandPanel from './components/AuthBrandPanel.vue';
import { useAuthPage } from './page';

const {
  captchaAnswer,
  captchaCountdown,
  captchaImage,
  captchaPending,
  displayName,
  email,
  error,
  isRegister,
  password,
  pending,
  refreshCaptcha,
  submit,
} = useAuthPage();
</script>

<template>
  <section
    class="grid min-h-[calc(100vh-4.5rem)] items-center gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] lg:gap-16 lg:py-12"
  >
    <AuthBrandPanel />

    <Card class="w-full shadow-sm">
      <CardHeader class="gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
        <div class="flex flex-col gap-1">
          <CardTitle class="text-2xl">
            {{ isRegister ? '创建你的账户' : '欢迎回来' }}
          </CardTitle>
          <CardDescription>
            {{
              isRegister
                ? '注册后开始整理属于你的穿衣偏好。'
                : '登录后继续你的穿搭探索。'
            }}
          </CardDescription>
        </div>

        <div class="flex items-center gap-1 rounded-lg bg-muted p-1">
          <RouterLink
            :class="
              cn(
                'flex h-8 flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors',
                !isRegister && 'bg-background text-foreground shadow-sm',
                isRegister && 'text-muted-foreground hover:text-foreground',
              )
            "
            to="/login"
          >
            登录
          </RouterLink>
          <RouterLink
            :class="
              cn(
                'flex h-8 flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors',
                isRegister && 'bg-background text-foreground shadow-sm',
                !isRegister && 'text-muted-foreground hover:text-foreground',
              )
            "
            to="/register"
          >
            注册
          </RouterLink>
        </div>
      </CardHeader>

      <CardContent class="px-6 pb-6 sm:px-8 sm:pb-8">
        <form class="flex flex-col gap-6" @submit.prevent="submit">
          <FieldGroup>
            <Field v-if="isRegister">
              <FieldLabel for="auth-display-name">昵称</FieldLabel>
              <Input
                id="auth-display-name"
                v-model.trim="displayName"
                autocomplete="name"
                maxlength="100"
                minlength="1"
                placeholder="怎么称呼你"
                required
              />
            </Field>

            <Field>
              <FieldLabel for="auth-email">邮箱</FieldLabel>
              <Input
                id="auth-email"
                v-model.trim="email"
                autocomplete="email"
                maxlength="255"
                placeholder="name@example.com"
                required
                type="email"
              />
              <FieldDescription>用于登录和接收账户相关通知。</FieldDescription>
            </Field>

            <Field>
              <FieldLabel for="auth-password">密码</FieldLabel>
              <Input
                id="auth-password"
                v-model="password"
                :autocomplete="isRegister ? 'new-password' : 'current-password'"
                maxlength="128"
                minlength="8"
                placeholder="至少 8 个字符"
                required
                type="password"
              />
              <FieldDescription v-if="isRegister">
                密码长度需要在 8 到 128 个字符之间。
              </FieldDescription>
            </Field>

            <Field v-if="!isRegister">
              <FieldLabel for="auth-captcha">验证码</FieldLabel>
              <div class="flex items-center gap-3">
                <img
                  v-if="captchaImage"
                  :src="captchaImage"
                  alt="登录验证码"
                  class="h-10 w-[150px] shrink-0 rounded-md border bg-white object-contain"
                />
                <Button
                  :aria-label="captchaImage ? '刷新验证码' : '获取验证码'"
                  class="shrink-0"
                  :disabled="pending || captchaPending || captchaCountdown > 0"
                  :size="captchaImage ? 'icon' : 'default'"
                  :title="captchaImage ? '刷新验证码' : '获取验证码'"
                  type="button"
                  variant="outline"
                  @click="refreshCaptcha"
                >
                  <Spinner v-if="captchaPending" />
                  <RefreshCw v-else aria-hidden="true" />
                  <span v-if="!captchaImage">
                    {{ captchaPending ? '正在获取' : '获取验证码' }}
                  </span>
                </Button>
              </div>
              <div class="flex items-center gap-3">
                <Input
                  id="auth-captcha"
                  v-model.trim="captchaAnswer"
                  autocomplete="off"
                  inputmode="text"
                  maxlength="5"
                  minlength="1"
                  placeholder="输入图片中的字符"
                  required
                />
                <span
                  class="w-20 shrink-0 text-right text-xs text-muted-foreground"
                >
                  {{
                    captchaCountdown > 0 ? `${captchaCountdown} 秒后获取` : ''
                  }}
                </span>
              </div>
            </Field>
          </FieldGroup>

          <Alert v-if="error" variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <Button class="w-full" :disabled="pending" size="lg" type="submit">
            <Spinner v-if="pending" data-icon="inline-start" />
            {{ pending ? '正在提交' : isRegister ? '创建账户' : '登录' }}
          </Button>
        </form>
      </CardContent>

      <CardFooter class="justify-center px-6 py-4 sm:px-8">
        <p class="text-center text-sm text-muted-foreground">
          {{ isRegister ? '已经有账户？' : '还没有账户？' }}
          <RouterLink
            class="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            :to="isRegister ? '/login' : '/register'"
          >
            {{ isRegister ? '返回登录' : '创建账户' }}
          </RouterLink>
        </p>
      </CardFooter>
    </Card>
  </section>
</template>
