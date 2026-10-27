import { createRouter, createWebHistory } from 'vue-router';
import { auth } from '@/lib/auth';
import AccountView from '@/views/AccountView.vue';
import AdminUsersView from '@/views/AdminUsersView.vue';
import AuthView from '@/views/AuthView.vue';
import HomeView from '@/views/HomeView.vue';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/login',
      name: 'login',
      component: AuthView,
      meta: { guestOnly: true },
    },
    {
      path: '/register',
      name: 'register',
      component: AuthView,
      meta: { guestOnly: true },
    },
    {
      path: '/account',
      name: 'account',
      component: AccountView,
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: AdminUsersView,
      meta: { requiresAuth: true, adminOnly: true },
    },
  ],
});

router.beforeEach(async (to) => {
  await auth.hydrate();
  if (to.meta.guestOnly && auth.isAuthenticated.value) {
    return auth.isAdmin.value ? '/admin/users' : '/account';
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated.value) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.adminOnly && !auth.isAdmin.value) {
    return '/account';
  }
  return true;
});
