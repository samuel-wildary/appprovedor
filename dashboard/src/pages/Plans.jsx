import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Layers, Plus } from 'lucide-react';

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', monthlyPrice: '' });
  const [saving, setSaving] = useState(false);

  const load = () => api.plans().then(setPlans).catch(console.error);
  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createPlan({ name: form.name, description: form.description, monthlyPrice: form.monthlyPrice });
      setShowNew(false);
      setForm({ name: '', description: '', monthlyPrice: '' });
      load();
    } catch (err) {
      alert('Erro ao criar plano: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={26} color="var(--primary-color)" /> Planos
          </h1>
          <p className="page-subtitle">Planos de assinatura do aplicativo.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={18} /> Novo Plano</button>
      </div>

      <div className="glass-panel">
        <div className="table-container">
          {plans.length === 0 ? (
            <div className="loading-box">Nenhum plano cadastrado.</div>
          ) : (
            <table>
              <thead><tr><th>Plano</th><th>Descrição</th><th>Valor mensal</th><th>Status</th></tr></thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500, color: 'white' }}>{p.name}</td>
                    <td>{p.description}</td>
                    <td>R$ {Number(p.monthly_price).toFixed(2).replace('.', ',')}</td>
                    <td><span className={`badge ${p.active ? 'badge-active' : 'badge-cancelled'}`}>{p.active ? 'Ativo' : 'Inativo'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showNew && (
        <div className="modal-overlay">
          <div className="glass-panel modal-panel">
            <h2 style={{ marginBottom: '1.5rem' }}>Novo Plano</h2>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label className="input-label">Nome</label>
                <input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="input-group">
                <label className="input-label">Descrição</label>
                <input className="input-field" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: '2rem' }}>
                <label className="input-label">Valor mensal (R$)</label>
                <input type="number" step="0.01" className="input-field" value={form.monthlyPrice} onChange={e => setForm({ ...form, monthlyPrice: e.target.value })} required />
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-danger" onClick={() => setShowNew(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Criar Plano'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
