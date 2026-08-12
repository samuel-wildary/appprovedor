import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Shield, Ban, CheckCircle, Clock, AlertTriangle, Plus, Search, ServerOff } from 'lucide-react';

export default function Dashboard() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // New provider modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newProv, setNewProv] = useState({ name: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const data = await api.providers();
      setProviders(data);
    } catch (err) {
      setError('Erro ao carregar provedores. Verifique se o backend está rodando.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleStatusChange = async (id, newStatus) => {
    try {
      await api.updateStatus(id, newStatus);
      fetchProviders(); // Refresh
    } catch (err) {
      alert('Erro ao atualizar status: ' + err.message);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createProvider({ ...newProv, status: 'ACTIVE' });
      setShowNewModal(false);
      setNewProv({ name: '', email: '', phone: '' });
      fetchProviders();
    } catch (err) {
      alert('Erro ao criar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status) => {
    const map = {
      ACTIVE: { class: 'badge-active', icon: CheckCircle, label: 'Ativo' },
      BLOCKED: { class: 'badge-blocked', icon: Ban, label: 'Bloqueado' },
      TRIAL: { class: 'badge-trial', icon: Clock, label: 'Teste' },
      OVERDUE: { class: 'badge-overdue', icon: AlertTriangle, label: 'Inadimplente' },
      CANCELLED: { class: 'badge-cancelled', icon: ServerOff, label: 'Cancelado' }
    };
    const conf = map[status] || map.ACTIVE;
    const Icon = conf.icon;
    return (
      <span className={`badge ${conf.class}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <Icon size={12} />
        {conf.label}
      </span>
    );
  };

  return (
    <div className="main-content animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={28} color="var(--primary-color)" />
            Gestão de Provedores
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Administre o acesso dos provedores ao aplicativo Acesseweb Cliente.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
          <Plus size={18} /> Novo Provedor
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid var(--danger-color)', padding: '1rem', borderRadius: '4px', marginBottom: '1.5rem', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      <div className="glass-panel">
        <div className="table-container">
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando provedores...</div>
          ) : providers.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Nenhum provedor cadastrado.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Provedor</th>
                  <th>Contato</th>
                  <th>Status de Acesso</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(prov => (
                  <tr key={prov.id}>
                    <td>
                      <div style={{ fontWeight: '500', color: 'white' }}>{prov.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>ID: {prov.id.split('-')[0]}...</div>
                    </td>
                    <td>
                      <div>{prov.email}</div>
                      {prov.phone && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{prov.phone}</div>}
                    </td>
                    <td>{getStatusBadge(prov.status)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <select 
                        className="input-field" 
                        style={{ width: 'auto', padding: '0.4rem 2rem 0.4rem 0.8rem', fontSize: '0.875rem' }}
                        value={prov.status}
                        onChange={(e) => handleStatusChange(prov.id, e.target.value)}
                      >
                        <option value="ACTIVE">Ativar Acesso</option>
                        <option value="TRIAL">Em Teste</option>
                        <option value="OVERDUE">Inadimplente (Aviso)</option>
                        <option value="BLOCKED">Bloquear Acesso (App 403)</option>
                        <option value="CANCELLED">Cancelar Provedor</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showNewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '2rem' }}>
            <h2 style={{ marginBottom: '1.5rem' }}>Cadastrar Provedor</h2>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label className="input-label">Nome da Empresa</label>
                <input type="text" className="input-field" value={newProv.name} onChange={e => setNewProv({...newProv, name: e.target.value})} required />
              </div>
              <div className="input-group">
                <label className="input-label">E-mail</label>
                <input type="email" className="input-field" value={newProv.email} onChange={e => setNewProv({...newProv, email: e.target.value})} required />
              </div>
              <div className="input-group" style={{ marginBottom: '2rem' }}>
                <label className="input-label">Telefone (Opcional)</label>
                <input type="text" className="input-field" value={newProv.phone} onChange={e => setNewProv({...newProv, phone: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-danger" onClick={() => setShowNewModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Criar Provedor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
