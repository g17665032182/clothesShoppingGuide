<script setup lang="ts">
import { computed, ref } from 'vue';
import { RefreshCw, Sparkles, Trash2 } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecommendationSettingsPage } from './page';

const {
  profile,
  pageStatus,
  mutationStatus,
  errorMessage,
  mutationError,
  isLoading,
  isMutating,
  load,
  setEnabled,
  clear,
} = useRecommendationSettingsPage();

const clearOpen = ref(false);
const clearResultUnknown = computed(() => mutationStatus.value === 'unknown');

function openClear(): void {
  if (!isMutating.value) clearOpen.value = true;
}

async function confirmClear(): Promise<void> {
  await clear();
  if (mutationStatus.value === 'idle') clearOpen.value = false;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '尚未形成画像';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
}

function confidenceLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="grid min-w-0 gap-1">
        <p class="text-sm font-medium text-muted-foreground">账户</p>
        <h1 class="text-2xl font-semibold">推荐学习</h1>
        <p class="text-sm text-muted-foreground">
          管理根据你明确反馈形成的个人推荐画像。
        </p>
      </div>
      <Button
        size="icon"
        variant="outline"
        title="刷新推荐画像"
        aria-label="刷新推荐画像"
        :disabled="isLoading"
        @click="load"
      >
        <RefreshCw />
      </Button>
    </div>

    <Alert v-if="pageStatus === 'error'" variant="destructive">
      <AlertTitle>推荐画像加载失败</AlertTitle>
      <AlertDescription
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <span>{{ errorMessage || '请检查网络后重试。' }}</span>
        <Button size="sm" variant="outline" @click="load">
          <RefreshCw data-icon="inline-start" />
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <Skeleton v-if="isLoading" class="h-48" />

    <template v-else>
      <Card class="rounded-md">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <Sparkles class="size-4" />
            个性化推荐学习
          </CardTitle>
          <CardDescription>
            只使用你主动提交的“合适 /
            不合适”反馈，不会修改你的结构化偏好或长期记忆。
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-4">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="grid gap-1">
              <span class="text-sm font-medium">允许保存新的推荐反馈</span>
              <span class="text-xs text-muted-foreground">
                关闭后仍可继续使用推荐，但反馈不会保存。
              </span>
            </div>
            <Switch
              :model-value="profile.learningEnabled"
              :disabled="isMutating"
              aria-label="允许保存新的推荐反馈"
              @update:model-value="setEnabled(Boolean($event))"
            />
          </div>
          <p v-if="mutationError" class="text-sm text-destructive" role="alert">
            {{ mutationError }}
          </p>
        </CardContent>
      </Card>

      <Card class="rounded-md">
        <CardHeader>
          <CardTitle>当前画像</CardTitle>
          <CardDescription>
            {{ profile.evidenceCount }} 条有效反馈 · 更新于
            {{ formatUpdatedAt(profile.updatedAt) }}
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <div class="grid gap-2">
            <h2 class="text-sm font-medium">偏好风格</h2>
            <div
              v-if="profile.preferredStyles.length"
              class="flex flex-wrap gap-2"
            >
              <Badge
                v-for="tag in profile.preferredStyles"
                :key="tag.label"
                variant="secondary"
              >
                {{ tag.label }} {{ confidenceLabel(tag.confidence) }}
              </Badge>
            </div>
            <p v-else class="text-sm text-muted-foreground">
              反馈积累后会显示。
            </p>
          </div>
          <div class="grid gap-2">
            <h2 class="text-sm font-medium">倾向避开</h2>
            <div
              v-if="profile.avoidedStyles.length"
              class="flex flex-wrap gap-2"
            >
              <Badge
                v-for="tag in profile.avoidedStyles"
                :key="tag.label"
                variant="outline"
              >
                {{ tag.label }} {{ confidenceLabel(tag.confidence) }}
              </Badge>
            </div>
            <p v-else class="text-sm text-muted-foreground">暂无记录。</p>
          </div>
          <div class="flex flex-wrap justify-between gap-3 border-t pt-4">
            <p class="text-xs text-muted-foreground">
              清空会删除推荐反馈学习数据，但保留聊天正文和历史卡片。
            </p>
            <Button variant="outline" :disabled="isMutating" @click="openClear">
              <Trash2 data-icon="inline-start" />
              清空画像
            </Button>
          </div>
        </CardContent>
      </Card>
    </template>

    <AlertDialog v-model:open="clearOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>清空推荐画像？</AlertDialogTitle>
          <AlertDialogDescription>
            这会删除尚未汇总的反馈和当前画像，聊天记录与推荐卡片不会被删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isMutating && !clearResultUnknown">
            返回
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="isMutating && !clearResultUnknown"
            @click.prevent="confirmClear"
          >
            <RefreshCw v-if="clearResultUnknown" data-icon="inline-start" />
            <Trash2 v-else data-icon="inline-start" />
            {{ clearResultUnknown ? '重试清空' : '确认清空' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
