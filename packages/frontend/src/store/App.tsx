// packages/frontend/src/App.tsx
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { SnackbarProvider } from 'notistack';
import { HelmetProvider } from 'react-helmet-async';

import { store } from './store';
import { useAppSelector } from './hooks/redux';
import { createAppTheme } from './utils/theme';
import { AuthProvider } from './providers/AuthProvider';
import { SocketProvider } from './providers/SocketProvider';

// Layouts
import MainLayout from './layouts/MainLayout';
import AuthLayout from './layouts/AuthLayout';
import ClientPortalLayout from './layouts/ClientPortalLayout';

// Public Pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import VerifyEmail from './pages/auth/VerifyEmail';

// Protected Pages
import Dashboard from './pages/Dashboard';
import Bookings from './pages/bookings/Bookings';
import BookingDetails from './pages/bookings/BookingDetails';
import CreateBooking from './pages/bookings/CreateBooking';
import Calendar from './pages/bookings/Calendar';
import Clients from './pages/clients/Clients';
import ClientDetails from './pages/clients/ClientDetails';
import Equipment from './pages/equipment/Equipment';
import EquipmentDetails from './pages/equipment/EquipmentDetails';
import Rooms from './pages/rooms/Rooms';
import RoomDetails from './pages/rooms/RoomDetails';
import Projects from './pages/projects/Projects';
import ProjectDetails from './pages/projects/ProjectDetails';
import Invoices from './pages/invoices/Invoices';
import InvoiceDetails from './pages/invoices/InvoiceDetails';
import Payments from './pages/payments/Payments';
import Reports from './pages/reports/Reports';
import Team from './pages/team/Team';
import Settings from './pages/settings/Settings';
import Profile from './pages/Profile';

// Client Portal Pages
import ClientPortal from './pages/portal/ClientPortal';
import ClientBookings from './pages/portal/ClientBookings';
import ClientGalleries from './pages/portal/ClientGalleries';
import ClientInvoices from './pages/portal/ClientInvoices';

// Error Pages
import NotFound from './pages/errors/NotFound';
import Forbidden from './pages/errors/Forbidden';

// Route Guards
import PrivateRoute from './components/guards/PrivateRoute';
import RoleGuard from './components/guards/RoleGuard';

function AppContent() {
  const { theme, locale } = useAppSelector((state) => state.ui);
  const { studio } = useAppSelector((state) => state.auth);

  const muiTheme = React.useMemo(() => {
    return createAppTheme(theme, studio?.primaryColor, studio?.secondaryColor);
  }, [theme, studio]);

  return (
    <ThemeProvider theme={muiTheme}>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
        <CssBaseline />
        <SnackbarProvider
          maxSnack={3}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right',
          }}
          autoHideDuration={5000}
        >
          <SocketProvider>
            <Routes>
              {/* Auth Routes */}
              <Route path="/auth" element={<AuthLayout />}>
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route path="forgot-password" element={<ForgotPassword />} />
                <Route path="reset-password" element={<ResetPassword />} />
                <Route path="verify-email" element={<VerifyEmail />} />
              </Route>

              {/* Client Portal Routes */}
              <Route
                path="/portal"
                element={
                  <PrivateRoute>
                    <RoleGuard allowedRoles={['CLIENT']}>
                      <ClientPortalLayout />
                    </RoleGuard>
                  </PrivateRoute>
                }
              >
                <Route index element={<ClientPortal />} />
                <Route path="bookings" element={<ClientBookings />} />
                <Route path="galleries" element={<ClientGalleries />} />
                <Route path="galleries/:id" element={<ProjectDetails />} />
                <Route path="invoices" element={<ClientInvoices />} />
                <Route path="invoices/:id" element={<InvoiceDetails />} />
              </Route>

              {/* Main App Routes */}
              <Route
                path="/"
                element={
                  <PrivateRoute>
                    <MainLayout />
                  </PrivateRoute>
                }
              >
                <Route index element={<Dashboard />} />
                
                {/* Bookings */}
                <Route path="bookings">
                  <Route index element={<Bookings />} />
                  <Route path="calendar" element={<Calendar />} />
                  <Route
                    path="create"
                    element={
                      <RoleGuard allowedRoles={['STUDIO_ADMIN', 'MANAGER', 'PHOTOGRAPHER', 'VIDEOGRAPHER']}>
                        <CreateBooking />
                      </RoleGuard>
                    }
                  />
                  <Route path=":id" element={<BookingDetails />} />
                </Route>

                {/* Clients */}
                <Route path="clients">
                  <Route index element={<Clients />} />
                  <Route path=":id" element={<ClientDetails />} />
                </Route>

                {/* Equipment */}
                <Route path="equipment">
                  <Route index element={<Equipment />} />
                  <Route path=":id" element={<EquipmentDetails />} />
                </Route>

                {/* Rooms */}
                <Route path="rooms">
                  <Route index element={<Rooms />} />
                  <Route path=":id" element={<RoomDetails />} />
                </Route>

                {/* Projects */}
                <Route path="projects">
                  <Route index element={<Projects />} />
                  <Route path=":id" element={<ProjectDetails />} />
                </Route>

                {/* Financial */}
                <Route path="invoices">
                  <Route index element={<Invoices />} />
                  <Route path=":id" element={<InvoiceDetails />} />
                </Route>
                <Route path="payments" element={<Payments />} />

                {/* Reports */}
                <Route
                  path="reports"
                  element={
                    <RoleGuard allowedRoles={['STUDIO_ADMIN', 'MANAGER']}>
                      <Reports />
                    </RoleGuard>
                  }
                />

                {/* Team */}
                <Route
                  path="team"
                  element={
                    <RoleGuard allowedRoles={['STUDIO_ADMIN', 'MANAGER']}>
                      <Team />
                    </RoleGuard>
                  }
                />

                {/* Settings */}
                <Route
                  path="settings/*"
                  element={
                    <RoleGuard allowedRoles={['STUDIO_ADMIN']}>
                      <Settings />
                    </RoleGuard>
                  }
                />

                {/* Profile */}
                <Route path="profile" element={<Profile />} />

                {/* Error Pages */}
                <Route path="forbidden" element={<Forbidden />} />
                <Route path="404" element={<NotFound />} />
              </Route>

              {/* Catch all */}
              <Route path="*" element={<Navigate to="/404" replace />} />
            </Routes>
          </SocketProvider>
        </SnackbarProvider>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

function App() {
  return (
    <HelmetProvider>
      <Provider store={store}>
        <BrowserRouter>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </BrowserRouter>
      </Provider>
    </HelmetProvider>
  );
}

export default App;

// packages/frontend/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Configure dayjs
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import isBetween from 'dayjs/plugin/isBetween';
import duration from 'dayjs/plugin/duration';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);
dayjs.extend(isBetween);
dayjs.extend(duration);

// Initialize app
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// packages/frontend/src/index.css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}

::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #555;
}

/* Leaflet map fixes */
.leaflet-container {
  font-family: inherit;
}

/* MUI overrides */
.MuiCssBaseline-root {
  scrollbar-color: #888 #f1f1f1;
  scrollbar-width: thin;
}

/* Loading spinner */
.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: #3f51b5;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Print styles */
@media print {
  .no-print {
    display: none !important;
  }
  
  .print-only {
    display: block !important;
  }
  
  body {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing