<script setup lang="ts">
import {
  ArrowRight,
  CircleUserRound,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from '@lucide/vue';
import type { User } from '@/api/types/users';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

defineProps<{
  user: User | null;
  isAdmin: boolean;
}>();
</script>

<template>
  <section
    class="grid gap-8 py-12 md:py-20 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:items-center"
  >
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <Badge class="w-fit" variant="secondary">
          <Sparkles data-icon="inline-start" />
          CLOTHES SHOPPING GUIDE
        </Badge>
        <h1
          class="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
        >
          找到更适合自己的穿着选择。
        </h1>
        <p class="max-w-2xl text-lg leading-8 text-muted-foreground">
          从了解自己的需求开始，逐步探索服装与搭配，让每一次选择都更有把握。
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <Button v-if="!user" as-child size="lg">
          <RouterLink to="/register">
            开始使用
            <ArrowRight data-icon="inline-end" />
          </RouterLink>
        </Button>
        <Button v-else as-child size="lg">
          <RouterLink to="/chat">
            开始聊天
            <MessageCircle data-icon="inline-end" />
          </RouterLink>
        </Button>
        <Button v-if="user" as-child size="lg" variant="outline">
          <RouterLink to="/account">
            <CircleUserRound data-icon="inline-start" />
            查看个人资料
          </RouterLink>
        </Button>
        <Button v-if="isAdmin" as-child size="lg" variant="outline">
          <RouterLink to="/admin/users">
            <ShieldCheck data-icon="inline-start" />
            管理用户
          </RouterLink>
        </Button>
      </div>
    </div>

    <Card class="bg-muted/40">
      <CardHeader>
        <CardTitle class="flex items-center gap-3">
          <Avatar v-if="user" size="lg">
            <AvatarFallback>{{ user.displayName.slice(0, 1) }}</AvatarFallback>
          </Avatar>
          <span>{{
            user ? `欢迎回来，${user.displayName}` : '从一次有意识的选择开始'
          }}</span>
        </CardTitle>
        <CardDescription>
          {{
            user
              ? '继续你的探索，或随时更新账户资料。'
              : '创建账户后即可保存你的个人偏好。'
          }}
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <Separator />
        <p class="text-sm leading-6 text-muted-foreground">
          我们会把复杂的服装信息整理成更容易理解的下一步，陪你逐渐建立属于自己的选择方法。
        </p>
      </CardContent>
      <CardFooter>
        <Badge variant="outline">{{ user ? '账户已连接' : '准备开始' }}</Badge>
      </CardFooter>
    </Card>
  </section>
</template>
