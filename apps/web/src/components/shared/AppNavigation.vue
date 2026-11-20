<script setup lang="ts">
import {
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  LogOut,
  PackageSearch,
  Shirt,
  ShoppingBag,
  SlidersHorizontal,
  Truck,
  UserRound,
} from '@lucide/vue';
import { useRouter } from 'vue-router';
import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const router = useRouter();
const isAdmin = auth.isAdmin;

function signOut() {
  auth.signOut();
  void router.push('/login');
}
</script>

<template>
  <header class="shell-header">
    <RouterLink class="brand" to="/">
      <span class="brand-icon"><Shirt :size="18" /></span>
      <span>衣橱指南</span>
    </RouterLink>
    <div class="header-actions">
      <RouterLink v-if="auth.state.user" class="text-link" to="/chat">
        聊天
      </RouterLink>
      <DropdownMenu v-if="auth.state.user">
        <DropdownMenuTrigger as-child>
          <Button aria-label="用户菜单" type="button" variant="ghost">
            <UserRound aria-hidden="true" data-icon="inline-start" />
            <span class="max-w-32 truncate">{{
              auth.state.user.displayName
            }}</span>
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem as-child>
              <RouterLink :to="{ name: 'account-profile' }">
                <UserRound aria-hidden="true" />
                个人资料
              </RouterLink>
            </DropdownMenuItem>
            <DropdownMenuItem as-child>
              <RouterLink :to="{ name: 'account-orders' }">
                <ShoppingBag aria-hidden="true" />
                我的订单
              </RouterLink>
            </DropdownMenuItem>
            <DropdownMenuItem as-child>
              <RouterLink :to="{ name: 'my-try-ons' }">
                <Shirt aria-hidden="true" />
                我的试穿
              </RouterLink>
            </DropdownMenuItem>
            <DropdownMenuItem as-child>
              <RouterLink
                :to="{ name: 'account-memories', query: { view: 'document' } }"
              >
                <BookOpen aria-hidden="true" />
                我的记忆
              </RouterLink>
            </DropdownMenuItem>
            <DropdownMenuItem as-child>
              <RouterLink
                :to="{
                  name: 'account-memories',
                  query: { view: 'preferences' },
                }"
              >
                <SlidersHorizontal aria-hidden="true" />
                我的偏好
              </RouterLink>
            </DropdownMenuItem>
            <template v-if="isAdmin">
              <DropdownMenuItem as-child>
                <RouterLink :to="{ name: 'admin-products' }">
                  <PackageSearch />
                  商品目录
                </RouterLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child>
                <RouterLink :to="{ name: 'admin-orders' }">
                  <Truck />
                  订单履约
                </RouterLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child>
                <RouterLink :to="{ name: 'admin-return-refunds' }">
                  <ClipboardCheck />
                  退货退款
                </RouterLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child>
                <RouterLink :to="{ name: 'admin-users' }">
                  <UserRound />
                  用户管理
                </RouterLink>
              </DropdownMenuItem>
            </template>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @select="signOut">
              <LogOut aria-hidden="true" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <RouterLink v-else class="text-link" to="/login">登录</RouterLink>
    </div>
  </header>
</template>
