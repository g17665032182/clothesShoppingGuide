import { createRouter, createWebHistory } from 'vue-router';
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
      name: 'account',
      component: () => import('@/pages/account/index.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('@/pages/chat/index.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: () => import('@/pages/admin-users/index.vue'),
      meta: { requiresAuth: true, adminOnly: true },
    },
  ],
});

router.beforeEach(async (to) => {
  await auth.hydrate();
  if (to.meta.guestOnly && auth.isAuthenticated.value) {
    return '/chat';
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated.value) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.adminOnly && !auth.isAdmin.value) {
    return '/account';
  }
  return true;
});
