import { computed, reactive } from 'vue';
import { apiRequest, type AuthResponse, type User } from './api';

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
    const response = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setSession(response);
  },

  async register(email: string, password: string, displayName: string) {
    const response = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
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
        state.user = await apiRequest<User>('/auth/me', {}, state.token);
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
  },

  async refreshUser() {
    if (!state.token) return;
    state.user = await apiRequest<User>('/users/me', {}, state.token);
  },
};
