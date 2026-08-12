import React, { useState, useEffect } from 'react';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { LogOut, Activity } from 'lucide-react';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check if token exists
    if (api.token) {
      setIsAuthenticated(true);
    }
    setIsChecking(false);
  }, []);

  const handleLogout = () => {
    api.setToken(null);
    setIsAuthenticated(false);
  };

  if (isChecking) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>Carregando...</div>;
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="app-container">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '600' }}>
          <Activity size={24} color="var(--primary-color)" />
          <span>Acesseweb <span style={{ color: 'var(--primary-color)' }}>Admin</span></span>
        </div>
        <button className="btn" onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
          <LogOut size={16} />
          Sair
        </button>
      </header>
      
      <Dashboard />
    </div>
  );
}

export default App;
