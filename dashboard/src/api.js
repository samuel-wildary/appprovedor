const API_URL = import.meta.env.VITE_API_URL || 'https://sistema-app-provedor.5mos1l.easypanel.host/api';

class AdminApi {
  constructor() { 
    this.token = localStorage.getItem('acesseweb.admin.token') || ''; 
  }
  
  setToken(token) {
    this.token = token || '';
    if (token) localStorage.setItem('acesseweb.admin.token', token);
    else localStorage.removeItem('acesseweb.admin.token');
  }
  
  async request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 
        'Content-Type': 'application/json', 
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), 
        ...options.headers 
      }
    });
    
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Falha ao processar a solicitacao');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  
  login(email, password) { 
    return this.request('/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }); 
  }
  
  providers() { 
    return this.request('/admin/providers'); 
  }
  
  createProvider(data) { 
    return this.request('/admin/providers', { method: 'POST', body: JSON.stringify(data) }); 
  }
  
  updateStatus(id, status) { 
    return this.request(`/admin/providers/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) }); 
  }
}

export const api = new AdminApi();
