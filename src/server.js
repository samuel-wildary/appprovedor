import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializePostgres, query } from './lib/postgres.js';
import { hashPassword, verifyPassword, generateToken, verifyToken } from './lib/auth.js';
import { authenticateSgp, fetchSgpInvoices, fetchSgpUsage } from './lib/sgpBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, '../public')));

// Initialize Database on Startup
async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await query('SELECT id FROM admin_users WHERE email = $1', [email]);
  if (existing.rows.length > 0) return;

  const { hash, salt } = await hashPassword(password);
  await query(
    'INSERT INTO admin_users (id, name, email, password_hash, password_salt) VALUES ($1, $2, $3, $4, $5)',
    [crypto.randomUUID(), process.env.ADMIN_NAME?.trim() || 'Administrador', email, hash, salt]
  );
  console.log('[Database] Usuário administrador inicial criado.');
}

initializePostgres().then(ensureAdminUser).catch(console.error);

// Auth Middleware
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  req.admin = payload;
  next();
}

// ----------------------------------------------------
// Routes: Admin Auth
// ----------------------------------------------------
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  
  try {
    const { rows } = await query('SELECT * FROM admin_users WHERE email = $1', [email]);
    if (rows.length === 0) {
      // For first time setup: create an admin if none exists
      const countRes = await query('SELECT count(*) FROM admin_users');
      if (parseInt(countRes.rows[0].count) === 0) {
        const id = crypto.randomUUID();
        const { hash, salt } = await hashPassword(password);
        await query(
          'INSERT INTO admin_users (id, name, email, password_hash, password_salt) VALUES ($1, $2, $3, $4, $5)',
          [id, 'Admin Master', email, hash, salt]
        );
        const token = generateToken({ id, role: 'admin' });
        return res.json({ token, user: { name: 'Admin Master', email } });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = rows[0];
    const isValid = await verifyPassword(password, user.password_hash, user.password_salt);
    
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = generateToken({ id: user.id, role: 'admin' });
    res.json({ token, user: { name: user.name, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------
// Routes: Manage Providers (Admin)
// ----------------------------------------------------
app.get('/api/admin/providers', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT id, name, email, phone, status, created_at, updated_at FROM providers ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching providers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/providers', requireAdmin, async (req, res) => {
  const { name, email, phone, status } = req.body;
  const id = crypto.randomUUID();
  try {
    const { rows } = await query(
      'INSERT INTO providers (id, name, email, phone, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, name, email, phone || '', status || 'ACTIVE']
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating provider:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/providers/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['TRIAL', 'ACTIVE', 'OVERDUE', 'BLOCKED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows } = await query(
      'UPDATE providers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating provider status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------
// Chamados helpers
// ----------------------------------------------------
const TIPO_CHAMADO = {
  1: 'Sem Conexão / Internet Caiu',
  2: 'Lentidão / Travamentos',
  3: 'Dúvida Financeira',
  4: 'Alteração de Senha / Wi-Fi',
  5: 'Outros'
};

function newProtocolo() {
  return String(Date.now()).slice(-9);
}

function mapChamado(t) {
  return {
    id: t.id,
    numero: t.protocolo,
    oc_protocolo: t.protocolo,
    os: t.id,
    tipo: t.tipo_descricao,
    oc_tipo_descricao: t.tipo_descricao,
    descricao: t.conteudo,
    conteudo: t.conteudo,
    status: t.status,
    oc_status_descricao: t.status,
    data_cadastro: t.data_cadastro,
    oc_data_cadastro: t.data_cadastro
  };
}

async function listChamados(cliente, contrato) {
  const params = [];
  const clauses = [];
  if (cliente) {
    params.push(cliente);
    clauses.push(`cliente = $${params.length}`);
  }
  if (contrato) {
    params.push(contrato);
    clauses.push(`contrato = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM chamados ${where} ORDER BY created_at DESC`, params);
  return rows.map(mapChamado);
}

async function criarChamado({ cpfcnpj, contrato, conteudo, tipoOcorrencia }) {
  const tipo = parseInt(tipoOcorrencia, 10) || 5;
  const id = crypto.randomUUID();
  const protocolo = newProtocolo();
  const tipoDescricao = TIPO_CHAMADO[tipo] || TIPO_CHAMADO[5];
  const dataCadastro = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO chamados (id, protocolo, contrato, cliente, conteudo, tipo, tipo_descricao, status, data_cadastro)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Em análise', $8)`,
    [id, protocolo, contrato || '', cpfcnpj || '', conteudo || '', tipo, tipoDescricao, dataCadastro]
  );
  return { status: 1, msg: `Chamado aberto. Protocolo ${protocolo}` };
}

// ----------------------------------------------------
// Routes: Original Android App Validation Endpoint (Port 3001)
// br.com.acesseweb.cliente -> GET /api/mobile/v1/tenants/:tenant/config
// ----------------------------------------------------
app.get('/api/mobile/v1/tenants/:tenant/config', async (req, res) => {
  const { tenant } = req.params;
  console.log(`[App Client] Validação de acesso para tenant: ${tenant}`);

  try {
    let providerStatus = 'ACTIVE';
    const { rows } = await query('SELECT status, name FROM providers LIMIT 1');
    if (rows.length > 0) {
      providerStatus = rows[0].status;
    }

    if (providerStatus === 'BLOCKED' || providerStatus === 'CANCELLED') {
      console.log(`[App Client] ⛔ Provedor com status ${providerStatus}. Retornando bloqueio (423).`);
      return res.status(423).json({
        code: 'APP_BLOCKED',
        message: 'Acesso ao aplicativo temporariamente suspenso pelo administrador.'
      });
    }

    console.log(`[App Client] ✅ Provedor ativo (${providerStatus}). Liberando acesso ao aplicativo.`);
    res.json({
      applicationId: 'br.com.acesseweb.cliente',
      allowed: true,
      tenant: {
        providerId: 'acesseweb',
        providerName: 'Acesseweb Telecom',
        appName: 'Acesseweb Cliente',
        primaryColor: '#00A8CC',
        accentColor: '#005F73',
        baseUrl: PUBLIC_BASE_URL,
        sgpApp: '',
        sgpToken: '',
        supportPhone: '(85) 99999-9999',
        demoMode: false
      }
    });
  } catch (error) {
    console.error('Error checking tenant config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------
// Routes: SGP Bridge API (Live Contracts and Invoices)
// ----------------------------------------------------
app.post('/api/central/contratos', async (req, res) => {
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  const senha = req.body.senha || req.query.senha || '';
  console.log(`[SGP Bridge] Login / Consulta de Contratos para CPF: ${cpfcnpj}`);

  try {
    const { contratos } = await authenticateSgp(cpfcnpj, senha);
    if (!contratos || contratos.length === 0) {
      return res.status(401).json({ error: 'Nenhum contrato encontrado para este CPF/CNPJ.' });
    }

    res.json({
      auth: true,
      contratos
    });
  } catch (error) {
    console.error('[SGP Bridge] Erro ao autenticar no SGP:', error);
    res.status(500).json({ error: 'Erro ao conectar ao SGP' });
  }
});

app.post('/api/central/titulos/', async (req, res) => {
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  const senha = req.body.senha || req.query.senha || '';
  const contrato = req.body.contrato || req.query.contrato || '';
  console.log(`[SGP Bridge] Consulta de Faturas para CPF ${cpfcnpj} - Contrato ${contrato}`);

  try {
    const invoices = await fetchSgpInvoices(cpfcnpj, senha, contrato);
    res.json(invoices);
  } catch (error) {
    console.error('[SGP Bridge] Erro ao buscar faturas no SGP:', error);
    res.status(500).json({ error: 'Erro ao buscar faturas' });
  }
});

async function buildBoletoLink(cpfcnpj, senha, contrato) {
  const invoices = await fetchSgpInvoices(cpfcnpj, senha, contrato);
  const invoice = invoices.find(i => !i.pago) || invoices[0] || null;
  if (!invoice || !invoice.linhadigitavel) {
    return '';
  }
  const params = new URLSearchParams({
    boleto: invoice.linhadigitavel,
    valor: String(invoice.valor ?? ''),
    venc: invoice.vencimento || '',
    documento: invoice.documento || '',
    cpfcnpj
  });
  return `${PUBLIC_BASE_URL}/public/boleto-modal.html?${params.toString()}`;
}

app.post('/api/central/extratouso/', async (req, res) => {
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  const contrato = req.body.contrato || req.query.contrato || '';
  const ano = req.body.ano || req.query.ano || '';
  const mes = req.body.mes || req.query.mes || '';
  console.log(`[SGP Bridge] Extrato de tráfego para CPF ${cpfcnpj} - Contrato ${contrato} - ${mes}/${ano}`);

  try {
    const usage = await fetchSgpUsage(cpfcnpj, req.body.senha || req.query.senha || '', contrato, ano, mes);
    res.json(usage);
  } catch (error) {
    console.error('[SGP Bridge] Erro ao buscar extrato de tráfego:', error);
    res.status(502).json({ error: 'Não foi possível consultar o extrato no SGP' });
  }
});

app.post('/api/central/fatura2via/', async (req, res) => {
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  const senha = req.body.senha || req.query.senha || '';
  const contrato = req.body.contrato || req.query.contrato || '';
  console.log(`[SGP Bridge] Consulta de 2ª Via para CPF ${cpfcnpj} - Contrato ${contrato}`);

  try {
    const link = await buildBoletoLink(cpfcnpj, senha, contrato);
    res.json({ link });
  } catch (error) {
    console.error('[SGP Bridge] Erro ao buscar faturas de 2ª via no SGP:', error);
    res.status(500).json({ error: 'Erro ao buscar faturas' });
  }
});

// (duplicate titulos route removed)

app.post('/api/central/verificaacesso/', async (req, res) => {
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  console.log(`[SGP Bridge] Verificando acesso para CPF ${cpfcnpj}`);
  res.json({
    status: 1,
    msg: "Conexão online"
  });
});

app.post('/api/central/pagamento/pix/:invoiceId', async (req, res) => {
  const invoiceId = req.params.invoiceId;
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  console.log(`[SGP Bridge] Gerando PIX para fatura ${invoiceId} do CPF ${cpfcnpj}`);
  
  res.json({
    pix: `00020126580014BR.GOV.BCB.PIX0136mock-${invoiceId}-provedor520400005303986540599.905802BR5920CONECTA FIBRA LTDA6009SAO PAULO62070503***6304ABCD`
  });
});

app.post('/api/central/chamados/', async (req, res) => {
  console.log(`[SGP Bridge] Consulta de chamados`);
  try {
    const tickets = await listChamados(
      req.body.cpfcnpj || req.query.cpfcnpj || '',
      req.body.contrato || req.query.contrato || ''
    );
    res.json(tickets);
  } catch (error) {
    console.error('Erro ao listar chamados:', error);
    res.status(500).json({ error: 'Erro ao listar chamados' });
  }
});

app.post('/api/central/chamado/list/', async (req, res) => {
  console.log(`[SGP Bridge] Consulta de chamados (list)`);
  try {
    const tickets = await listChamados(
      req.body.cpfcnpj || req.query.cpfcnpj || '',
      req.body.contrato || req.query.contrato || ''
    );
    res.json(tickets);
  } catch (error) {
    console.error('Erro ao listar chamados:', error);
    res.status(500).json({ error: 'Erro ao listar chamados' });
  }
});

app.post('/api/central/chamado/novo/', async (req, res) => {
  console.log(`[SGP Bridge] Novo chamado aberto:`, req.body);
  try {
    const result = await criarChamado({
      cpfcnpj: req.body.cpfcnpj || req.query.cpfcnpj || '',
      contrato: req.body.contrato || req.query.contrato || '',
      conteudo: req.body.conteudo || req.body.content || '',
      tipoOcorrencia: req.body.tipo_ocorrencia || req.body.occurrenceType
    });
    res.json(result);
  } catch (error) {
    console.error('Erro ao abrir chamado:', error);
    res.status(500).json({ error: 'Erro ao abrir chamado' });
  }
});


// ProviderOps SGP Proxy Route
app.post('/api/mobile/v1/tenants/:tenant/sgp', async (req, res) => {
  const action = req.body.action;
  const document = req.body.session ? req.body.session.document : req.body.document;
  const password = req.body.session ? req.body.session.password : req.body.password;
  const contract = req.body.session ? req.body.session.contractId : req.body.contract;
  console.log(`[ProviderOps SGP Proxy] Action: ${action} para doc: ${document} - contrato: ${contract}`);

  try {
    if (action === 'invoices' || action === 'titulos') {
      const invoices = await fetchSgpInvoices(document, password, contract);
      return res.json(invoices);
    }
    
    if (action === 'contracts' || action === 'contratos') {
      const { contratos } = await authenticateSgp(document, password);
      return res.json({ auth: true, contratos });
    }

    if (action === 'second_copy') {
      console.log(`[ProviderOps SGP Proxy] 2ª via solicitada para doc: ${document} - contrato: ${contract}`);
      const link = await buildBoletoLink(document, password, contract);
      return res.json({ success: true, link });
    }

    if (action === 'tickets') {
      console.log(`[ProviderOps SGP Proxy] Listando chamados para doc: ${document} - contrato: ${contract}`);
      const tickets = await listChamados(document, contract);
      return res.json(tickets);
    }

    if (action === 'create_ticket') {
      const result = await criarChamado({
        cpfcnpj: document,
        contrato: contract,
        conteudo: req.body.content || req.body.conteudo || '',
        tipoOcorrencia: req.body.occurrenceType || req.body.tipo_ocorrencia
      });
      return res.json(result);
    }

    // Default response
    res.json({ success: true });
  } catch (error) {
    console.error('[ProviderOps SGP Proxy] Erro:', error);
    res.status(500).json({ error: 'Erro no proxy SGP' });
  }
});

// ----------------------------------------------------
// Fallback status routes
// ----------------------------------------------------
app.get('/api/status/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const { rows } = await query('SELECT status FROM providers LIMIT 1');
    const status = rows.length > 0 ? rows[0].status : 'ACTIVE';
    if (status === 'BLOCKED' || status === 'CANCELLED') {
      return res.status(403).json({ error: 'Provedor bloqueado', status, active: false });
    }
    res.json({ slug, status, active: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  process.exit(0);
});

// Start HTTP Server
app.listen(PORT, () => {
  console.log(`HTTP Backend server running on http://localhost:${PORT}`);
});

// Start HTTPS Server
try {
  const keyPath = path.join(__dirname, '../key.pem');
  const certPath = path.join(__dirname, '../cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    https.createServer(options, app).listen(HTTPS_PORT, () => {
      console.log(`HTTPS Backend server running on https://localhost:${HTTPS_PORT}`);
    });
  }
} catch (err) {
  console.error('Failed to start HTTPS server:', err);
}
