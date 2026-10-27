import { createApp } from 'vue';
import App from './App.vue';
import { auth } from './lib/auth';
import { router } from './router';
import './assets/main.css';

void auth.hydrate();
createApp(App).use(router).mount('#app');
