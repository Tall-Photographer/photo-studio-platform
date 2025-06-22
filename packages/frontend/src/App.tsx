// packages/frontend/src/App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <header className="App-header">
          <h1>Shootlinks V3 - Photography Studio Management</h1>
          <p>React frontend coming soon...</p>
        </header>
        
        <Routes>
          <Route path="/" element={
            <div>
              <h2>Welcome to Shootlinks V3</h2>
              <p>Your photography studio management platform</p>
            </div>
          } />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;