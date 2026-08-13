import React, { useState, useEffect } from 'react';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Overview from './pages/Overview';
import Plans from './pages/Plans';
import Payments from './pages/Payments';
import AuditLogs from './pages/AuditLogs';
import { LogOut, Activity, LayoutDashboard, Building2, Layers, CreditCard, ScrollText } from 'lucide-react';

const NAV = [
  { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
  { id: 'providers', label: 'Gestão de Provedores', icon: Building2 },
  { id: 'plans', label: 'Planos', icon: Layers },
  { id: 'payments', label: 'Pagamentos', icon: CreditCard },
  { id: 'audit', label: 'Auditoria', icon: ScrollText },
];

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [page, setPage] = useState('overview');

  useEffect(() => {
    if (api.token) setIsAuthenticated(true);
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
    <div className="saas-layout">
      <aside className="saas-sidebar">
        <div className="saas-brand">
          <Activity size={22} color="var(--primary-color)" />
          <span>Acesseweb <b>Admin</b></span>
        </div>
        <nav className="saas-nav">
          {NAV.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`saas-nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button className="saas-nav-item saas-logout" onClick={handleLogout}>
          <LogOut size={18} />
          Sair
        </button>
      </aside>

      <main className="saas-main">
        {page === 'overview' && <Overview />}
        {page === 'providers' && <Dashboard />}
        {page === 'plans' && <Plans />}
        {page === 'payments' && <Payments />}
        {page === 'audit' && <AuditLogs />}
      </main>
    </div>
  );
}

export default App;
