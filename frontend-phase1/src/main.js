import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css'; // Element Plus 样式
import App from './App.vue';
import router from './router';

// 创建 Vue 应用实例
const app = createApp(App);

// 安装 Pinia 状态管理
app.use(createPinia());

// 安装 Vue Router
app.use(router);

// 安装 Element Plus 组件库
app.use(ElementPlus);

// 挂载应用到 DOM
app.mount('#app');