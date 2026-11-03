<script setup lang="ts">
import { BookOpen, LogOut, SlidersHorizontal, UserRound } from '@lucide/vue';
import { useRouter } from 'vue-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { auth } from '@/lib/auth';

withDefaults(
  defineProps<{
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
  }>(),
  { side: 'bottom', align: 'end' },
);

const router = useRouter();

function signOut() {
  auth.signOut();
  void router.push('/login');
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuContent :align="align" :side="side" class="min-w-44">
      <DropdownMenuGroup>
        <DropdownMenuItem as-child>
          <RouterLink to="/account">
            <UserRound aria-hidden="true" />
            个人资料
          </RouterLink>
        </DropdownMenuItem>
        <DropdownMenuItem as-child>
          <RouterLink :to="{ name: 'memories', query: { view: 'document' } }">
            <BookOpen aria-hidden="true" />
            我的记忆
          </RouterLink>
        </DropdownMenuItem>
        <DropdownMenuItem as-child>
          <RouterLink
            :to="{ name: 'memories', query: { view: 'preferences' } }"
          >
            <SlidersHorizontal aria-hidden="true" />
            我的偏好
          </RouterLink>
        </DropdownMenuItem>
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
</template>
