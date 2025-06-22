// packages/frontend/src/App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline, createTheme } from '@mui/material';
import { Box, Container, Typography, Paper, Button } from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
});

const LandingPage: React.FC = () => {
  return (
    <Container maxWidth="lg">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 4,
        }}
      >
        <PhotoCameraIcon sx={{ fontSize: 80, color: 'primary.main' }} />
        
        <Typography variant="h2" component="h1" gutterBottom>
          Shootlinks V3
        </Typography>
        
        <Typography variant="h5" color="text.secondary" gutterBottom>
          Photography Studio Management Platform
        </Typography>
        
        <Paper
          elevation={3}
          sx={{
            p: 4,
            maxWidth: 600,
            width: '100%',
            mt: 2,
          }}
        >
          <Typography variant="h6" gutterBottom>
            🚀 Platform Features
          </Typography>
          
          <Box sx={{ textAlign: 'left', mt: 2 }}>
            <Typography variant="body1" sx={{ mb: 1 }}>
              ✅ Booking Management System
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              ✅ Client Database & CRM
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              ✅ Equipment Tracking
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              ✅ Financial Management
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              ✅ Project Workflow Management
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              ✅ Multi-tenant SaaS Architecture
            </Typography>
          </Box>
          
          <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button variant="contained" size="large">
              Login
            </Button>
            <Button variant="outlined" size="large">
              Sign Up
            </Button>
          </Box>
        </Paper>
        
        <Typography variant="body2" color="text.secondary">
          Backend API: <code>http://localhost:3001/api/v1</code>
        </Typography>
        
        <Typography variant="body2" color="text.secondary">
          Status: Frontend Ready • Backend Ready • Database Connected
        </Typography>
      </Box>
    </Container>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route 
            path="/dashboard" 
            element={
              <Container>
                <Typography variant="h4" sx={{ mt: 4 }}>
                  Dashboard Coming Soon
                </Typography>
              </Container>
            } 
          />
          <Route 
            path="*" 
            element={
              <Container>
                <Typography variant="h4" sx={{ mt: 4 }}>
                  Page Not Found
                </Typography>
              </Container>
            } 
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;