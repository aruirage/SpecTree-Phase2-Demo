import { createRouter, createWebHistory } from 'vue-router';
import routes from './routes'; // 导入路由定义

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes, // 使用导入的路由定义
});

export default router;