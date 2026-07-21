import axios from 'axios';
import { ElMessage } from 'element-plus';

const service = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

service.interceptors.request.use(
  (config) => {
    // const token = localStorage.getItem('token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => {
    console.error('Request failed before sending:', error);
    return Promise.reject(error);
  }
);

service.interceptors.response.use(
  (response) => {
    const res = response.data;
    if (res.code && res.code !== 200) {
      ElMessage.error(res.message || 'リクエストエラー');
      return Promise.reject(new Error(res.message || 'Error'));
    } else {
      return res;
    }
  },
  (error) => {
    console.error('Response failed:', error);
    let message = error.message;
    if (error.response && error.response.data && error.response.data.message) {
      message = error.response.data.message;
    }
    ElMessage.error(message || 'ネットワークエラーが発生しました。しばらくしてから再試行してください');
    return Promise.reject(error);
  }
);

export default service;
