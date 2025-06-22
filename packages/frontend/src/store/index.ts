// packages/frontend/src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';
import authReducer from './slices/authSlice';
import uiReducer from './slices/uiSlice';
import bookingReducer from './slices/bookingSlice';
import notificationReducer from './slices/notificationSlice';

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    auth: authReducer,
    ui: uiReducer,
    booking: bookingReducer,
    notification: notificationReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST'],
      },
    }).concat(api.middleware),
});

setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// packages/frontend/src/store/api.ts
import { createApi, fetchBaseQuery, retry } from '@reduxjs/toolkit/query/react';
import type { RootState } from './index';

const baseQuery = fetchBaseQuery({
  baseUrl: '/api/v1',
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    const studioId = (getState() as RootState).auth.studio?.id;
    if (studioId) {
      headers.set('x-studio-id', studioId);
    }
    return headers;
  },
});

const baseQueryWithRetry = retry(baseQuery, { maxRetries: 2 });

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithRetry,
  tagTypes: [
    'Auth',
    'User',
    'Studio',
    'Client',
    'Booking',
    'Equipment',
    'Room',
    'Project',
    'Invoice',
    'Payment',
    'File',
    'Notification',
    'EmailCampaign',
    'Settings',
    'Report',
  ],
  endpoints: () => ({}),
});

// packages/frontend/src/store/slices/authSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatar?: string;
  phone?: string;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  hourlyRate?: number;
  skills?: string[];
  specializations?: string[];
}

interface Studio {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  defaultCurrency: string;
  timezone: string;
  features: Record<string, any>;
  subscriptionStatus: string;
}

interface AuthState {
  user: User | null;
  studio: Studio | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  studio: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{
        user: User;
        studio: Studio;
        accessToken: string;
        refreshToken?: string;
      }>
    ) => {
      state.user = action.payload.user;
      state.studio = action.payload.studio;
      state.accessToken = action.payload.accessToken;
      if (action.payload.refreshToken) {
        state.refreshToken = action.payload.refreshToken;
      }
      state.isAuthenticated = true;
      state.isLoading = false;
      state.error = null;

      // Store tokens
      localStorage.setItem('accessToken', action.payload.accessToken);
      if (action.payload.refreshToken) {
        localStorage.setItem('refreshToken', action.payload.refreshToken);
      }
    },
    logout: (state) => {
      state.user = null;
      state.studio = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      state.error = null;

      // Clear tokens
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.isLoading = false;
    },
    updateUser: (state, action: PayloadAction<Partial<User>>) => {
      if (state.user) {
        state.user = { ...state.user, ...action.payload };
      }
    },
    updateStudio: (state, action: PayloadAction<Partial<Studio>>) => {
      if (state.studio) {
        state.studio = { ...state.studio, ...action.payload };
      }
    },
  },
});

export const { setCredentials, logout, setLoading, setError, updateUser, updateStudio } =
  authSlice.actions;

export default authSlice.reducer;

// Auth API endpoints
export const authApi = api.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<
      {
        user: User;
        studio: Studio;
        tokens: { accessToken: string; expiresIn: number };
      },
      { email: string; password: string; remember?: boolean }
    >({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
      invalidatesTags: ['Auth'],
    }),
    register: builder.mutation<
      { message: string; user: Partial<User> },
      {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        studioId: string;
        role: string;
        phone?: string;
      }
    >({
      query: (data) => ({
        url: '/auth/register',
        method: 'POST',
        body: data,
      }),
    }),
    logout: builder.mutation<void, void>({
      query: () => ({
        url: '/auth/logout',
        method: 'POST',
      }),
      invalidatesTags: ['Auth'],
    }),
    refreshToken: builder.mutation<
      { tokens: { accessToken: string; expiresIn: number } },
      string
    >({
      query: (refreshToken) => ({
        url: '/auth/refresh',
        method: 'POST',
        body: { refreshToken },
      }),
    }),
    getMe: builder.query<{ user: User; studio: Studio }, void>({
      query: () => '/auth/me',
      providesTags: ['Auth'],
    }),
    verifyEmail: builder.mutation<{ message: string }, string>({
      query: (token) => ({
        url: '/auth/verify-email',
        method: 'POST',
        body: { token },
      }),
    }),
    forgotPassword: builder.mutation<{ message: string }, string>({
      query: (email) => ({
        url: '/auth/forgot-password',
        method: 'POST',
        body: { email },
      }),
    }),
    resetPassword: builder.mutation<
      { message: string },
      { token: string; password: string }
    >({
      query: (data) => ({
        url: '/auth/reset-password',
        method: 'POST',
        body: data,
      }),
    }),
    changePassword: builder.mutation<
      { message: string },
      { currentPassword: string; newPassword: string }
    >({
      query: (data) => ({
        url: '/auth/change-password',
        method: 'POST',
        body: data,
      }),
    }),
    setup2FA: builder.mutation<{ secret: string; qrCode: string }, void>({
      query: () => ({
        url: '/auth/2fa/setup',
        method: 'POST',
      }),
    }),
    verify2FASetup: builder.mutation<{ message: string }, string>({
      query: (token) => ({
        url: '/auth/2fa/verify-setup',
        method: 'POST',
        body: { token },
      }),
      invalidatesTags: ['Auth'],
    }),
    verify2FA: builder.mutation<
      { message: string },
      { userId: string; token: string }
    >({
      query: (data) => ({
        url: '/auth/2fa/verify',
        method: 'POST',
        body: data,
      }),
    }),
    disable2FA: builder.mutation<
      { message: string },
      { password: string; token: string }
    >({
      query: (data) => ({
        url: '/auth/2fa/disable',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['Auth'],
    }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useRefreshTokenMutation,
  useGetMeQuery,
  useVerifyEmailMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useChangePasswordMutation,
  useSetup2FAMutation,
  useVerify2FASetupMutation,
  useVerify2FAMutation,
  useDisable2FAMutation,
} = authApi;

// packages/frontend/src/store/slices/uiSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  locale: string;
  loading: {
    [key: string]: boolean;
  };
  modals: {
    [key: string]: boolean;
  };
}

const initialState: UIState = {
  sidebarOpen: true,
  theme: (localStorage.getItem('theme') as 'light' | 'dark') || 'light',
  locale: localStorage.getItem('locale') || 'en',
  loading: {},
  modals: {},
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
    setTheme: (state, action: PayloadAction<'light' | 'dark'>) => {
      state.theme = action.payload;
      localStorage.setItem('theme', action.payload);
    },
    setLocale: (state, action: PayloadAction<string>) => {
      state.locale = action.payload;
      localStorage.setItem('locale', action.payload);
    },
    setLoading: (state, action: PayloadAction<{ key: string; value: boolean }>) => {
      state.loading[action.payload.key] = action.payload.value;
    },
    openModal: (state, action: PayloadAction<string>) => {
      state.modals[action.payload] = true;
    },
    closeModal: (state, action: PayloadAction<string>) => {
      state.modals[action.payload] = false;
    },
    toggleModal: (state, action: PayloadAction<string>) => {
      state.modals[action.payload] = !state.modals[action.payload];
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  setTheme,
  setLocale,
  setLoading,
  openModal,
  closeModal,
  toggleModal,
} = uiSlice.actions;

export default uiSlice.reducer;