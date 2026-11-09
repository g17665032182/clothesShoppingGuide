<script setup lang="ts">
import {
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundX,
  UsersRound,
} from '@lucide/vue';
import type { User, UserRole } from '@/api/types/users';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{
  currentUserId?: string;
  failed: boolean;
  loading: boolean;
  search: string;
  updatingUserId: string | null;
  users: User[];
  visibleUsers: User[];
}>();

const emit = defineEmits<{
  (event: 'refresh'): void;
  (event: 'update:search', value: string): void;
  (event: 'set-role', user: User, role: UserRole): void;
  (event: 'toggle-status', user: User): void;
}>();

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN');
}

function updateRole(user: User, value: unknown) {
  if (value === 'user' || value === 'admin') {
    emit('set-role', user, value as UserRole);
  }
}
</script>

<template>
  <div class="flex flex-col gap-5 px-6 pb-6">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="relative w-full sm:max-w-sm">
        <Search
          class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          :model-value="search"
          aria-label="搜索用户"
          class="pl-8"
          placeholder="搜索昵称或邮箱"
          @update:model-value="emit('update:search', String($event))"
        />
      </div>
      <Button
        :disabled="loading"
        size="sm"
        variant="outline"
        @click="emit('refresh')"
      >
        <RefreshCw data-icon="inline-start" />
        刷新列表
      </Button>
    </div>

    <div class="overflow-x-auto rounded-lg border">
      <Table class="min-w-[760px]">
        <TableCaption class="sr-only">用户管理列表</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>用户</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>注册时间</TableHead>
            <TableHead class="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="loading">
            <TableCell :colspan="5">
              <div
                class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
              >
                <Spinner />
                正在加载用户
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-else-if="visibleUsers.length === 0">
            <TableCell :colspan="5">
              <Empty class="border-0 py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><UsersRound /></EmptyMedia>
                  <EmptyTitle>{{
                    failed ? '用户列表加载失败' : '没有找到匹配的用户'
                  }}</EmptyTitle>
                  <EmptyDescription
                    >尝试调整搜索条件，或刷新列表。</EmptyDescription
                  >
                </EmptyHeader>
              </Empty>
            </TableCell>
          </TableRow>
          <TableRow v-for="user in visibleUsers" v-else :key="user.id">
            <TableCell>
              <div class="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>{{
                    user.displayName.slice(0, 1)
                  }}</AvatarFallback>
                </Avatar>
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-medium">{{
                    user.displayName
                  }}</span>
                  <span class="truncate text-xs text-muted-foreground">{{
                    user.email
                  }}</span>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Select
                :disabled="updatingUserId === user.id"
                :model-value="user.role"
                @update:model-value="updateRole(user, $event)"
              >
                <SelectTrigger
                  :aria-label="`设置 ${user.displayName} 的角色`"
                  class="w-[96px]"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="user">用户</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              <Badge
                :variant="
                  user.status === 'active' ? 'secondary' : 'destructive'
                "
              >
                <CheckCircle2
                  v-if="user.status === 'active'"
                  data-icon="inline-start"
                />
                {{ user.status === 'active' ? '正常' : '已禁用' }}
              </Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{
              formatDate(user.createdAt)
            }}</TableCell>
            <TableCell class="text-right">
              <Button
                :disabled="
                  updatingUserId === user.id || user.id === currentUserId
                "
                :title="
                  user.id === currentUserId
                    ? '不能在此处禁用当前账户'
                    : user.status === 'active'
                      ? '禁用账户'
                      : '恢复账户'
                "
                size="sm"
                variant="outline"
                @click="emit('toggle-status', user)"
              >
                <UserRoundX
                  v-if="user.status === 'active'"
                  data-icon="inline-start"
                />
                <ShieldCheck v-else data-icon="inline-start" />
                {{ user.status === 'active' ? '禁用' : '恢复' }}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <UsersRound class="size-4" />
      显示 {{ visibleUsers.length }} / {{ users.length }} 个账户
    </div>
  </div>
</template>
