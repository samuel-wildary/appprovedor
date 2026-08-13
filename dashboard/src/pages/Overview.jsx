import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Building2, Layers, CreditCard, DollarSign, AlertTriangle } from 'lucide-react';

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone || ''}`}><Icon size={22} /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

export default function Overview() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.metrics().then(setMetrics).catch(() => setError('Erro ao carregar métricas.'));
  }, []);

  const money = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

  return (
    <div className="animate-fade-in">
      <h1>Visão Geral</h1>
      <p className="page-subtitle">Resumo do sistema em tempo real.</p>
      {error && <div className="error-box">{error}</div>}
      {!metrics ? (
        <div className="loading-box">Carregando métricas...</div>
      ) : (
        <div className="stat-grid">
          <StatCard icon={Building2} label="Provedores ativos" value={metrics.providers.active} tone="green" />
          <StatCard icon={AlertTriangle} label="Inadimplentes" value={metrics.providers.overdue} tone="yellow" />
          <StatCard icon={Building2} label="Bloqueados" value={metrics.providers.blocked} tone="red" />
          <StatCard icon={Layers} label="Planos ativos" value={metrics.plans.total} tone="blue" />
          <StatCard icon={CreditCard} label="Mensalidades pendentes" value={metrics.payments.pending} tone="yellow" />
          <StatCard icon={DollarSign} label="Recebido" value={money(metrics.payments.received)} tone="green" />
        </div>
      )}
    </div>
  );
}
