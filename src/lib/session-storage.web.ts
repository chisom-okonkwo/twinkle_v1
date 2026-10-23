// The mobile app uses SecureStore. Web development uses per-tab session storage.
// Do not access browser storage during server rendering.
export const sessionStorage = {
  async getItem(key: string) {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
  },
  async setItem(key: string, value: string) {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(key, value);
  },
  async removeItem(key: string) {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(key);
  },
};
