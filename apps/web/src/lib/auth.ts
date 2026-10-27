import { computed, reactive } from 'vue';
import { configureAuthTransport } from '@/api';
import {
  getCurrentUser,
  logout,
  refreshAccessToken,
  register,
  signIn,
} from '@/api/modules/auth';
import type { AuthResponse } from '@/api/types/auth';
import { getCurrentProfile } from '@/api/modules/users';
import type { User } from '@/api/types/users';

const tokenKey = 'clothes-guide.access-token';
const state = reactive<{
  token: string | null;
  user: User | null;
  ready: boolean;
}>({
  token: localStorage.getItem(tokenKey),
  user: null,
  ready: false,
});
let hydration: Promise<void> | null = null;

export const auth = {
  state,
  isAuthenticated: computed(() => Boolean(state.token && state.user)),
  isAdmin: computed(() => state.user?.role === 'admin'),

  async signIn(email: string, password: string) {
    const response = await signIn(email, password);
    this.setSession(response);
  },

  async refreshAccessToken(): Promise<string | null> {
    try {
      const response = await refreshAccessToken();
      this.setSession(response);
      return response.accessToken;
    } catch {
      return null;
    }
  },

  async register(email: string, password: string, displayName: string) {
    const response = await register(email, password, displayName);
    this.setSession(response);
  },

  setSession(response: AuthResponse) {
    state.token = response.accessToken;
    state.user = response.user;
    state.ready = true;
    localStorage.setItem(tokenKey, response.accessToken);
  },

  async hydrate() {
    if (state.ready) return;
    if (hydration) return hydration;

    hydration = (async () => {
      if (!state.token) {
        state.ready = true;
        return;
      }
      try {
        state.user = await getCurrentUser(state.token);
      } catch {
        this.signOut();
      } finally {
        state.ready = true;
      }
    })();
    return hydration;
  },

  signOut() {
    state.token = null;
    state.user = null;
    state.ready = true;
    localStorage.removeItem(tokenKey);
    void logout().catch(() => undefined);
  },

  async refreshUser() {
    if (!state.token) return;
    state.user = await getCurrentProfile(state.token);
  },
};

configureAuthTransport({
  refresh: () => auth.refreshAccessToken(),
  onUnauthorized: () => auth.signOut(),
});
