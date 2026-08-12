import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { CreditCard, Plus } from 'lucide-react';

const STATUS_LABELS = { PENDING: 'Pendente', PAID: 'Pago', OVERDUE: 'Vencido', CANCELLED: 'Cancelado' };
const STATUS_BADGE = { PENDING: 'badge-trial', PAID: 'badge-active', OVERDUE: 'badge-overdue', CANCELLED: 'badge-cancelled' };

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [providers, setProviders] = useState([]);
  const [plans, setPlans] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ providerId: '', planId: '', amount: '', dueDate: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = () => api.payments().then(setPayments).catch(console.error);
  useEffect(() => {
    load();
    api.providers().then(setProviders).catch(console.error);
    api.plans().then(setPlans).catch(console.error);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createPayment(form);
      setShowNew(false);
      setForm({ providerId: '', planId: '', amount: '', dueDate: '', notes: '' });
      load();
    } catch (err) {
      alert('Erro ao criar mensalidade: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id, status) => {
    try {
      await api.updatePaymentStatus(id, status);
      load();
    } catch (err) {
      alert('Erro ao atualizar: ' + err.message);
    }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '-';

  return (
    <div className="animate-fade-in">
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CreditCard size={26} color="var(--primary-color)" /> Pagamentos
          </h1>
          <p className="page-subtitle">Assinaturas e mensalidades dos provedores.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={18} /> Nova Mensalidade</button>
      </div>

      <div className="glass-panel">
        <div className="table-container">
          {payments.length === 0 ? (
            <div className="loading-box">Nenhuma mensalidade registrada.</div>
          ) : (
            <table>
              <thead><tr><th>Provedor</th><th>Plano</th><th>Valor</th><th>Vencimento</th><th>Status</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500, color: 'white' }}>{p.provider_name}</td>
                    <td>{p.plan_name}</td>
                    <td>R$ {Number(p.amount).toFixed(2).replace('.', ',')}</td>
                    <td>{fmtDate(p.due_date)}</td>
                    <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABELS[p.status] || p.status}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <select className="input-field select-compact" value={p.status} onChange={(e) => handleStatus(p.id, e.target.value)}>
                        <option value="PENDING">Pendente</option>
                        <option value="PAID">Marcar pago</option>
                        <option value="OVERDUE">Vencido</option>
                        <option value="CANCELLED">Cancelado</option>
                      </select>
                    </td>
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
            <h2 style={{ marginBottom: '1.5rem' }}>Nova Mensalidade</h2>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label className="input-label">Provedor</label>
                <select className="input-field" value={form.providerId} onChange={e => setForm({ ...form, providerId: e.target.value })} required>
                  <option value="">Selecione...</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Plano</label>
                <select className="input-field" value={form.planId} onChange={e => setForm({ ...form, planId: e.target.value })} required>
                  <option value="">Selecione...</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Valor (R$)</label>
                <input type="number" step="0.01" className="input-field" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div className="input-group">
                <label className="input-label">Vencimento</label>
                <input type="date" className="input-field" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} required />
              </div>
              <div className="input-group" style={{ marginBottom: '2rem' }}>
                <label className="input-label">Observações</label>
                <input className="input-field" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-danger" onClick={() => setShowNew(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
