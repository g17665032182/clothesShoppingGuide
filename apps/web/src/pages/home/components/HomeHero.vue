<script setup lang="ts">
import {
  ArrowRight,
  Check,
  CircleUserRound,
  Compass,
  MessageCircle,
  Palette,
  ShieldCheck,
  Sparkles,
} from '@lucide/vue';
import type { User } from '@/api/types/users';
import styleImage from '@/assets/home-style.jpg';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

defineProps<{
  user: User | null;
  isAdmin: boolean;
}>();
</script>

<template>
  <section class="flex flex-col gap-12 py-10 md:gap-16 md:py-16">
    <div
      class="grid gap-8 rounded-lg border border-border bg-card p-5 shadow-sm sm:p-7 md:gap-10 md:p-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:items-center lg:p-12"
    >
      <div class="flex flex-col gap-8">
        <div class="flex flex-col gap-5">
          <Badge class="w-fit" variant="secondary">
            <Sparkles data-icon="inline-start" />
            CLOTHES SHOPPING GUIDE
          </Badge>
          <div class="flex flex-col gap-4">
            <h1
              class="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
            >
              穿得更像自己。
            </h1>
            <p
              class="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg"
            >
              从场合、风格和预算出发，把复杂的服装选择整理成清晰的下一步。
            </p>
          </div>
        </div>

        <div class="flex flex-wrap gap-3">
          <Button v-if="!user" as-child size="lg">
            <RouterLink to="/register">
              开始建立风格
              <ArrowRight data-icon="inline-end" />
            </RouterLink>
          </Button>
          <Button v-else as-child size="lg">
            <RouterLink to="/chat">
              <MessageCircle data-icon="inline-start" />
              继续探索
              <ArrowRight data-icon="inline-end" />
            </RouterLink>
          </Button>
          <Button v-if="user" as-child size="lg" variant="outline">
            <RouterLink to="/account">
              <CircleUserRound data-icon="inline-start" />
              个人资料
            </RouterLink>
          </Button>
          <Button v-if="isAdmin" as-child size="lg" variant="outline">
            <RouterLink to="/admin/users">
              <ShieldCheck data-icon="inline-start" />
              用户管理
            </RouterLink>
          </Button>
        </div>

        <div
          class="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground"
        >
          <span class="inline-flex items-center gap-2">
            <Check class="text-primary" />
            记录你的偏好
          </span>
          <span class="inline-flex items-center gap-2">
            <Check class="text-primary" />
            逐步缩小选择
          </span>
        </div>
      </div>

      <figure class="flex min-w-0 flex-col gap-2">
        <img
          :src="styleImage"
          alt="明黄色运动套装的街头穿搭示例"
          class="aspect-[16/10] w-full rounded-lg object-cover object-center lg:aspect-[4/5]"
        />
        <figcaption class="flex items-center justify-between gap-3 px-1">
          <span class="text-sm font-medium">风格灵感</span>
          <Badge variant="secondary">
            <Palette data-icon="inline-start" />
            明亮色彩
          </Badge>
        </figcaption>
      </figure>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <Card class="bg-background shadow-none">
        <CardHeader>
          <Compass class="text-muted-foreground" />
          <CardTitle class="text-lg">明确你的场景</CardTitle>
          <CardDescription>把“想买衣服”变成可回答的具体问题。</CardDescription>
        </CardHeader>
      </Card>
      <Card class="bg-background shadow-none">
        <CardHeader>
          <Palette class="text-muted-foreground" />
          <CardTitle class="text-lg">建立你的偏好</CardTitle>
          <CardDescription
            >记录颜色、版型和材质，减少反复试错。</CardDescription
          >
        </CardHeader>
      </Card>
      <Card class="bg-background shadow-none">
        <CardHeader>
          <MessageCircle class="text-muted-foreground" />
          <CardTitle class="text-lg">得到下一步建议</CardTitle>
          <CardDescription
            >通过对话逐渐形成属于自己的选择方法。</CardDescription
          >
        </CardHeader>
      </Card>
    </div>
  </section>
</template>
