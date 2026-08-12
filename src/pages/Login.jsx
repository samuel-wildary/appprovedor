import React, { useState } from 'react';
import { api } from '../api';
import { ShieldAlert, LogIn, Activity } from 'lucide-react';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const { token } = await api.login(email, password);
      api.setToken(token);
      onLogin();
    } catch (err) {
      setError(err.message || 'Credenciais inválidas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Activity size={48} color="var(--primary-color)" style={{ marginBottom: '1rem' }} />
          <h2>Acesseweb Admin</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Acesso exclusivo para plataforma</p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid var(--danger-color)', padding: '1rem', borderRadius: '4px', marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <ShieldAlert size={18} color="var(--danger-color)" />
            <span style={{ fontSize: '0.875rem', color: '#fca5a5' }}>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">E-mail Administrativo</label>
            <input 
              type="email" 
              className="input-field" 
              placeholder="admin@acesseweb.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="input-group" style={{ marginBottom: '2rem' }}>
            <label className="input-label">Senha</label>
            <input 
              type="password" 
              className="input-field" 
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1rem' }} disabled={loading}>
            {loading ? 'Autenticando...' : (
              <>
                <LogIn size={18} />
                Entrar no Painel
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
