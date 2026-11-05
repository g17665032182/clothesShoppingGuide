import { createApp } from 'vue';
import { createPinia, disposePinia } from 'pinia';
import App from './App.vue';
import { auth } from './lib/auth';
import { router } from './router';
import './assets/main.css';

void auth.hydrate();
const app = createApp(App);
const pinia = createPinia();
// 站内路由切换保留任务，整个应用销毁时才释放 Store 持有的请求和计时器。
app.onUnmount(() => disposePinia(pinia));
app.use(pinia).use(router).mount('#app');
