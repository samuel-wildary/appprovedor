import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { ScrollText } from 'lucide-react';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auditLogs().then(setLogs).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className="animate-fade-in">
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <ScrollText size={26} color="var(--primary-color)" /> Auditoria
      </h1>
      <p className="page-subtitle">Histórico de ações administrativas.</p>

      <div className="glass-panel">
        <div className="table-container">
          {loading ? (
            <div className="loading-box">Carregando registros...</div>
          ) : logs.length === 0 ? (
            <div className="loading-box">Nenhum registro.</div>
          ) : (
            <table>
              <thead><tr><th>Data</th><th>Responsável</th><th>Ação</th><th>Detalhes</th></tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td>{new Date(l.created_at).toLocaleString('pt-BR')}</td>
                    <td>{l.actor}</td>
                    <td><span className="badge badge-trial">{l.action}</span></td>
                    <td>{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
