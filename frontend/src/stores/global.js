import { defineStore } from 'pinia';

export const useGlobalStore = defineStore('global', {
  state: () => ({
    isLoading: false,
    error: null,
  }),
  actions: {
    setLoading(status) {
      this.isLoading = status;
    },
    setError(message) {
      this.error = message;
    },
    clearError() {
      this.error = null;
    },
  },
});
