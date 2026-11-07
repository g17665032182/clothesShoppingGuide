import { watch } from 'vue';
import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteLocationRaw,
} from 'vue-router';
import { auth } from '@/lib/auth';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/home/index.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/auth/index.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/pages/auth/index.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/account',
      component: () => import('@/pages/account/layout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          redirect: { name: 'account-profile' },
        },
        {
          path: 'profile',
          name: 'account-profile',
          component: () => import('@/pages/account/index.vue'),
        },
        {
          path: 'memories',
          name: 'account-memories',
          component: () => import('@/pages/memories/index.vue'),
        },
      ],
    },
    {
      path: '/memories',
      name: 'memories',
      redirect: (to) => ({ name: 'account-memories', query: to.query }),
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('@/pages/chat/index.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin',
      component: () => import('@/pages/admin/layout.vue'),
      meta: { requiresAuth: true, adminOnly: true },
      children: [
        { path: '', redirect: { name: 'admin-products' } },
        {
          path: 'users',
          name: 'admin-users',
          component: () => import('@/pages/admin-users/index.vue'),
        },
        {
          path: 'products',
          name: 'admin-products',
          component: () => import('@/pages/admin-products/index.vue'),
        },
        {
          path: 'orders',
          name: 'admin-orders',
          component: () => import('@/pages/admin-orders/index.vue'),
        },
      ],
    },
  ],
});

function accessRedirect(
  to: RouteLocationNormalized,
): RouteLocationRaw | undefined {
  if (to.meta.guestOnly && auth.isAuthenticated.value) {
    return '/chat';
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated.value) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.adminOnly && !auth.isAdmin.value) {
    return { name: 'account-profile' };
  }
}

router.beforeEach(async (to) => {
  await auth.hydrate();
  return accessRedirect(to) ?? true;
});

// 刷新令牌失效或角色被收回时，立即卸载受保护视图，不等待下一次手动导航。
watch(
  [auth.isAuthenticated, auth.isAdmin],
  ([authenticated, admin], [wasAuthenticated, wasAdmin]) => {
    if (!auth.state.ready) return;
    if (!(wasAuthenticated && !authenticated) && !(wasAdmin && !admin)) return;
    const redirect = accessRedirect(router.currentRoute.value);
    if (redirect) void router.replace(redirect);
  },
);
