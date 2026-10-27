<script setup lang="ts">
import { Save } from '@lucide/vue';
import type { User } from '@/api/types/users';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

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

function updateDisplayName(value: string | number) {
  emit('update:displayName', String(value));
}

function updatePassword(value: string | number) {
  emit('update:password', String(value));
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback>{{ user.displayName.slice(0, 1) }}</AvatarFallback>
        </Avatar>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle class="truncate">{{ user.displayName }}</CardTitle>
          <CardDescription class="truncate">{{ user.email }}</CardDescription>
        </div>
        <Badge variant="secondary">{{
          user.role === 'admin' ? '管理员' : '用户'
        }}</Badge>
      </div>
      <CardDescription>更新昵称或设置新的登录密码。</CardDescription>
    </CardHeader>
    <form @submit.prevent="emit('submit')">
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel for="account-display-name">昵称</FieldLabel>
            <Input
              id="account-display-name"
              :model-value="displayName"
              maxlength="100"
              minlength="1"
              required
              @update:model-value="updateDisplayName"
            />
          </Field>
          <Field>
            <FieldLabel for="account-password">新密码</FieldLabel>
            <Input
              id="account-password"
              :model-value="password"
              autocomplete="new-password"
              maxlength="128"
              minlength="8"
              placeholder="留空表示不修改"
              type="password"
              @update:model-value="updatePassword"
            />
            <FieldDescription
              >密码至少 8 位，留空表示保留当前密码。</FieldDescription
            >
          </Field>
        </FieldGroup>
        <Alert v-if="status === 'success'" class="mt-5">
          <AlertDescription role="status">账户资料已更新。</AlertDescription>
        </Alert>
        <Alert v-if="error" class="mt-5" variant="destructive">
          <AlertDescription role="alert">{{ error }}</AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter class="justify-end">
        <Button :disabled="pending" type="submit">
          <Spinner v-if="pending" data-icon="inline-start" />
          <Save v-else data-icon="inline-start" />
          {{ pending ? '保存中' : '保存更改' }}
        </Button>
      </CardFooter>
    </form>
  </Card>
</template>
