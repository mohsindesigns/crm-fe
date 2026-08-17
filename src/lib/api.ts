import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const isAuthEndpoint = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');
    const inactiveMsg = err.response?.data?.message || '';
    // Boots a signed-in user whose account was deactivated mid-session: the next
    // request 403s, we drop their tokens and send them to the login screen.
    //
    // It must NOT fire on /auth/login itself. A deactivated user signing in gets
    // the same 403, and redirecting to /login from /login is a full page reload
    // that wipes the error before it can be read — the login form just blanked
    // and retried forever. There's no session to clear on a login attempt anyway,
    // so the request is left alone and the login page renders the message.
    if (
      err.response?.status === 403
      && typeof inactiveMsg === 'string'
      && inactiveMsg.toLowerCase().includes('inactive')
      && typeof window !== 'undefined'
      && !isAuthEndpoint
      && !original?.url?.includes('/hr/me')
      && window.location.pathname !== '/login'
    ) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
      return Promise.reject(err);
    }
    if (err.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        const refresh = localStorage.getItem('refresh_token');
        if (!refresh) throw new Error('No refresh token');
        const { data } = await axios.post(
          `${API_URL}/auth/refresh`,
          { refreshToken: refresh }
        );
        localStorage.setItem('access_token', data.access);
        localStorage.setItem('refresh_token', data.refresh);
        original.headers.Authorization = `Bearer ${data.access}`;
        return api(original);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
