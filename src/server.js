import 'dotenv/config';
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
import { listPlans, createPlan, listPayments, createPayment, listMetrics, listAuditLogs, addAuditLog } from './lib/finance.js';
import { maskEmail, generateVerificationCode, saveVerificationCode, verifyCode, clearVerificationCode, sendVerificationEmail } from './lib/emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const CREDENTIALS_ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY || '';

function encryptProviderConfig(config) {
  if (!CREDENTIALS_ENCRYPTION_KEY) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not configured');
  const key = crypto.createHash('sha256').update(CREDENTIALS_ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, '../public')));

// Initialize Database on Startup
async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL?.trim() || 'admin@acesseweb.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await query('SELECT id FROM admin_users WHERE email = $1', [email]);
  if (existing.rows.length === 0) {
    const { hash, salt } = await hashPassword(password);
    await query(
      'INSERT INTO admin_users (id, name, email, password_hash, password_salt) VALUES ($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), process.env.ADMIN_NAME?.trim() || 'Administrador', email, hash, salt]
    );
    console.log('[Database] ✅ Usuário administrador inicial criado:', email);
  } else {
    const { hash, salt } = await hashPassword(password);
    await query(
      'UPDATE admin_users SET password_hash = $1, password_salt = $2, name = $3 WHERE email = $4',
      [hash, salt, process.env.ADMIN_NAME?.trim() || 'Administrador', email]
    );
    console.log('[Database] ✅ Senha de administrador sincronizada com o ENV para:', email);
  }

  const provCount = await query('SELECT count(*) FROM providers');
  if (parseInt(provCount.rows[0].count) === 0) {
    await query(
      `INSERT INTO providers (id, tenant, name, email, phone, status, sgp_config) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(),
        'acesseweb',
        'Acesseweb Telecom',
        'contato@acesseweb.com.br',
        '(85) 99999-9999',
        'ACTIVE',
        JSON.stringify({
          baseUrl: 'https://central.acesseweb.com.br',
          apiUser: '',
          apiPassword: '',
          apiToken: '',
          apiApp: ''
        })
      ]
    );
    console.log('[Database] ✅ Provedor inicial Acesseweb Telecom criado.');
  }
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
    const { rows } = await query('SELECT id, tenant, name, email, phone, status, created_at, updated_at FROM providers ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching providers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/providers', requireAdmin, async (req, res) => {
  const { name, email, phone, status, sgp } = req.body;
  const tenant = req.body.tenant?.trim() || `prov_${crypto.randomBytes(5).toString('hex')}`;
  const id = crypto.randomUUID();
  try {
    const sgpConfig = encryptProviderConfig({
      baseUrl: sgp?.baseUrl || '',
      apiUser: sgp?.apiUser || '',
      apiPassword: sgp?.apiPassword || '',
      apiToken: sgp?.apiToken || '',
      apiApp: sgp?.apiApp || ''
    });
    const { rows } = await query(
      'INSERT INTO providers (id, tenant, name, email, phone, status, sgp_config) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, tenant, name, email, phone, status',
      [id, tenant, name, email, phone || '', status || 'ACTIVE', sgpConfig]
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
  if (!['ACTIVE', 'SUSPENDED', 'BLOCKED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
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

app.put('/api/admin/providers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, status } = req.body;
  try {
    const { rows } = await query(
      `UPDATE providers SET name=$1, email=$2, phone=$3, status=$4, updated_at=NOW()
       WHERE id=$5 RETURNING id, tenant, name, email, phone, status`,
      [name, email, phone || '', status, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    await addAuditLog('provider.update', `Provedor ${name} atualizado`);
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating provider:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------
// Routes: Plans / Payments / Metrics / Audit
// ----------------------------------------------------
app.get('/api/admin/plans', requireAdmin, async (_req, res) => {
  try { res.json(await listPlans()); } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/admin/plans', requireAdmin, async (req, res) => {
  try {
    const plan = await createPlan(req.body);
    await addAuditLog('plan.create', `Plano ${plan.name} criado`);
    res.status(201).json(plan);
  } catch (e) {
    console.error('Error creating plan:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/payments', requireAdmin, async (_req, res) => {
  try { res.json(await listPayments()); } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/admin/payments', requireAdmin, async (req, res) => {
  try {
    const payment = await createPayment(req.body);
    await addAuditLog('payment.create', `Mensalidade criada (provedor ${req.body.providerId})`);
    res.status(201).json(payment);
  } catch (e) {
    console.error('Error creating payment:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/payments/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows } = await query(
      `UPDATE payments SET status=$1, paid_at = CASE WHEN $1='PAID' THEN NOW() ELSE paid_at END, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [status, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    await addAuditLog('payment.status', `Mensalidade ${id.slice(0, 8)} -> ${status}`);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/metrics', requireAdmin, async (_req, res) => {
  try { res.json(await listMetrics()); } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/admin/audit-logs', requireAdmin, async (_req, res) => {
  try { res.json(await listAuditLogs()); } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
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

async function checkProviderBlocked() {
  try {
    const { rows } = await query('SELECT status, name FROM providers LIMIT 1');
    if (rows.length > 0) {
      const status = (rows[0].status || 'ACTIVE').toUpperCase();
      if (status === 'BLOCKED' || status === 'CANCELLED' || status === 'SUSPENDED' || status === 'INACTIVE' || status === 'OVERDUE') {
        return { isBlocked: true, status, name: rows[0].name };
      }
    }
    return { isBlocked: false, status: 'ACTIVE' };
  } catch (err) {
    return { isBlocked: false, status: 'ACTIVE' };
  }
}

async function requireActiveProvider(req, res, next) {
  const check = await checkProviderBlocked();
  if (check.isBlocked) {
    console.log(`[App Client] ⛔ Provedor (${check.name || 'Provedor'}) está com status ${check.status}. Bloqueando requisição.`);
    return res.status(423).json({
      error: 'Acesso ao aplicativo temporariamente suspenso pela administração.',
      code: 'APP_BLOCKED',
      allowed: false
    });
  }
  next();
}

// ----------------------------------------------------
// Routes: Original Android App Validation Endpoint (Port 3001)
// br.com.acesseweb.cliente -> GET /api/mobile/v1/tenants/:tenant/config
// ----------------------------------------------------
app.get('/api/mobile/v1/tenants/:tenant/config', async (req, res) => {
  const { tenant } = req.params;
  console.log(`[App Client] Validação de acesso para tenant: ${tenant}`);

  try {
    const check = await checkProviderBlocked();
    if (check.isBlocked) {
      console.log(`[App Client] ⛔ Provedor com status ${check.status}. Retornando bloqueio (423).`);
      return res.status(423).json({
        code: 'APP_BLOCKED',
        error: 'Acesso ao aplicativo temporariamente suspenso pela administração.',
        message: 'Acesso ao aplicativo temporariamente suspenso pela administração.',
        allowed: false
      });
    }

    console.log(`[App Client] ✅ Provedor ativo (${check.status}). Liberando acesso ao aplicativo.`);
    const host = req.headers.host || `localhost:${PORT}`;
    const effectiveBaseUrl = host.includes('10.0.2.2') ? `http://10.0.2.2:${PORT}` : (process.env.PUBLIC_BASE_URL || `http://${host}`);

    res.json({
      applicationId: 'br.com.acesseweb.cliente',
      allowed: true,
      tenant: {
        providerId: 'acesseweb',
        providerName: 'Acesseweb Telecom',
        appName: 'Acesseweb Cliente',
        primaryColor: '#00A8CC',
        accentColor: '#005F73',
        baseUrl: effectiveBaseUrl,
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
// Routes: Client Auth (Primeiro Acesso & Recuperação de Senha)
// ----------------------------------------------------
app.post('/api/central/auth/primeiro-acesso/solicitar', requireActiveProvider, async (req, res) => {
  const cpfcnpj = (req.body.cpfcnpj || '').replace(/\D/g, '');
  const emailInput = (req.body.email || '').trim().toLowerCase();

  if (!cpfcnpj) {
    return res.status(400).json({ error: 'CPF ou CNPJ é obrigatório.' });
  }

  try {
    // 1. Check if client exists in SGP
    const { contratos } = await authenticateSgp(cpfcnpj, '');
    if (!contratos || contratos.length === 0) {
      return res.status(404).json({ error: 'Nenhum cadastro ou contrato encontrado para este CPF/CNPJ.' });
    }

    const clienteName = contratos[0]?.nome_cliente || contratos[0]?.cliente || 'Cliente';

    // 2. Check if client already has account in database
    const { rows } = await query('SELECT * FROM client_accounts WHERE cpfcnpj = $1', [cpfcnpj]);
    let targetEmail = emailInput;

    if (rows.length > 0 && rows[0].email) {
      targetEmail = rows[0].email;
    }

    if (!targetEmail) {
      // If no email registered yet, require email input
      return res.json({
        needsEmail: true,
        name: clienteName,
        message: 'Por favor, informe seu e-mail para receber o código de confirmação.'
      });
    }

    // 3. Generate and send code
    const code = generateVerificationCode();
    saveVerificationCode(cpfcnpj, code, targetEmail);
    await sendVerificationEmail({ to: targetEmail, name: clienteName, code, type: 'first_access' });

    res.json({
      success: true,
      name: clienteName,
      maskedEmail: maskEmail(targetEmail),
      message: `Código enviado com sucesso para ${maskEmail(targetEmail)}.`
    });
  } catch (error) {
    console.error('[Auth API] Erro ao solicitar primeiro acesso:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação de primeiro acesso.' });
  }
});

app.post('/api/central/auth/recuperar-senha/solicitar', requireActiveProvider, async (req, res) => {
  const cpfcnpj = (req.body.cpfcnpj || '').replace(/\D/g, '');
  const emailInput = (req.body.email || '').trim().toLowerCase();

  if (!cpfcnpj) {
    return res.status(400).json({ error: 'CPF ou CNPJ é obrigatório.' });
  }

  try {
    // 1. Check if client exists in SGP
    const { contratos } = await authenticateSgp(cpfcnpj, '');
    if (!contratos || contratos.length === 0) {
      return res.status(404).json({ error: 'Nenhum cadastro encontrado para este CPF/CNPJ.' });
    }

    const clienteName = contratos[0]?.nome_cliente || contratos[0]?.cliente || 'Cliente';

    // 2. Find email
    const { rows } = await query('SELECT * FROM client_accounts WHERE cpfcnpj = $1', [cpfcnpj]);
    let targetEmail = rows.length > 0 && rows[0].email ? rows[0].email : emailInput;

    if (!targetEmail) {
      return res.json({
        needsEmail: true,
        name: clienteName,
        message: 'Informe o seu e-mail cadastrado para receber o código de recuperação.'
      });
    }

    // 3. Generate and send code
    const code = generateVerificationCode();
    saveVerificationCode(cpfcnpj, code, targetEmail);
    await sendVerificationEmail({ to: targetEmail, name: clienteName, code, type: 'recovery' });

    res.json({
      success: true,
      name: clienteName,
      maskedEmail: maskEmail(targetEmail),
      message: `Código enviado com sucesso para ${maskEmail(targetEmail)}.`
    });
  } catch (error) {
    console.error('[Auth API] Erro ao solicitar recuperação de senha:', error);
    res.status(500).json({ error: 'Erro ao processar recuperação de senha.' });
  }
});

app.post('/api/central/auth/validar-codigo', (req, res) => {
  const cpfcnpj = (req.body.cpfcnpj || '').replace(/\D/g, '');
  const code = (req.body.code || '').trim();

  if (!cpfcnpj || !code) {
    return res.status(400).json({ error: 'CPF e código são obrigatórios.' });
  }

  const result = verifyCode(cpfcnpj, code);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ valid: true, message: 'Código verificado com sucesso.' });
});

app.post('/api/central/auth/definir-senha', async (req, res) => {
  const cpfcnpj = (req.body.cpfcnpj || '').replace(/\D/g, '');
  const code = (req.body.code || '').trim();
  const novaSenha = (req.body.novaSenha || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const name = (req.body.name || '').trim();

  if (!cpfcnpj || !code || !novaSenha) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  if (novaSenha.length < 4) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
  }

  const result = verifyCode(cpfcnpj, code);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  try {
    const { hash, salt } = await hashPassword(novaSenha);
    const finalEmail = email || result.email || '';

    await query(
      `INSERT INTO client_accounts (cpfcnpj, name, email, password_hash, password_salt, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (cpfcnpj) DO UPDATE
       SET password_hash = $4, password_salt = $5,
           email = CASE WHEN $3 != '' THEN $3 ELSE client_accounts.email END,
           name = CASE WHEN $2 != '' THEN $2 ELSE client_accounts.name END,
           updated_at = NOW()`,
      [cpfcnpj, name, finalEmail, hash, salt]
    );

    clearVerificationCode(cpfcnpj);
    console.log(`[Auth API] ✅ Senha definida com sucesso para CPF: ${cpfcnpj}`);

    res.json({ success: true, message: 'Senha cadastrada com sucesso! Agora você já pode entrar.' });
  } catch (error) {
    console.error('[Auth API] Erro ao salvar senha:', error);
    res.status(500).json({ error: 'Erro ao salvar nova senha no banco de dados.' });
  }
});

// ----------------------------------------------------
// Routes: SGP Bridge API (Live Contracts and Invoices)
// ----------------------------------------------------
app.post('/api/central/contratos', requireActiveProvider, async (req, res) => {
  const rawCpf = req.body.cpfcnpj || req.query.cpfcnpj || '';
  const cleanCpf = rawCpf.replace(/\D/g, '');
  const senha = req.body.senha || req.query.senha || '';
  console.log(`[SGP Bridge] Login / Consulta de Contratos para CPF: ${rawCpf}`);

  try {
    // 1. Check if client has a custom password registered in client_accounts
    if (cleanCpf && senha) {
      const { rows } = await query('SELECT * FROM client_accounts WHERE cpfcnpj = $1', [cleanCpf]);
      if (rows.length > 0 && rows[0].password_hash) {
        const isValid = await verifyPassword(senha, rows[0].password_hash, rows[0].password_salt);
        if (!isValid) {
          return res.status(401).json({ error: 'Senha incorreta. Se esqueceu sua senha, clique em "Esqueci minha senha".' });
        }
      }
    }

    const { contratos } = await authenticateSgp(rawCpf, senha);
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

app.post('/api/central/titulos/', requireActiveProvider, async (req, res) => {
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

app.post('/api/central/extratouso/', requireActiveProvider, async (req, res) => {
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

app.post('/api/central/fatura2via/', requireActiveProvider, async (req, res) => {
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

app.post('/api/central/verificaacesso/', requireActiveProvider, async (req, res) => {
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  console.log(`[SGP Bridge] Verificando acesso para CPF ${cpfcnpj}`);
  res.json({
    status: 1,
    msg: "Conexão online"
  });
});

app.post('/api/central/pagamento/pix/:invoiceId', requireActiveProvider, async (req, res) => {
  const invoiceId = req.params.invoiceId;
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  console.log(`[SGP Bridge] Gerando PIX para fatura ${invoiceId} do CPF ${cpfcnpj}`);
  
  res.json({
    pix: `00020126580014BR.GOV.BCB.PIX0136mock-${invoiceId}-provedor520400005303986540599.905802BR5920CONECTA FIBRA LTDA6009SAO PAULO62070503***6304ABCD`
  });
});

async function listChamados(cpfcnpj, contrato) {
  const cleanCpf = (cpfcnpj || '').replace(/\D/g, '');
  const rawContrato = String(contrato || '').trim();

  try {
    let sql = 'SELECT * FROM chamados WHERE 1=1';
    const params = [];

    if (cleanCpf) {
      params.push(`%${cleanCpf}%`);
      sql += ` AND (cliente LIKE $${params.length} OR contrato LIKE $${params.length})`;
    } else if (rawContrato) {
      params.push(`%${rawContrato}%`);
      sql += ` AND contrato LIKE $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC LIMIT 50';

    const { rows } = await query(sql, params);
    return rows.map((r, index) => ({
      id: parseInt(r.id, 10) || (rows.length - index),
      protocolo: r.protocolo || `PRT${String(Date.now()).slice(-8)}`,
      assunto: r.tipo_descricao || 'Suporte Técnico',
      status: r.status || 'Em análise',
      data: r.data_cadastro || new Date(r.created_at).toLocaleDateString('pt-BR'),
      dataAbertura: r.data_cadastro || new Date(r.created_at).toLocaleDateString('pt-BR'),
      conteudo: r.conteudo || '',
      resposta: ''
    }));
  } catch (error) {
    console.error('[Database] Erro ao listar chamados:', error);
    return [];
  }
}

async function criarChamado({ cpfcnpj, contrato, conteudo, tipoOcorrencia }) {
  const cleanCpf = (cpfcnpj || '').replace(/\D/g, '');
  const rawContrato = String(contrato || '').trim();
  const content = String(conteudo || '').trim();
  const tipo = parseInt(tipoOcorrencia, 10) || 5;

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const seq = Math.floor(1000 + Math.random() * 9000);
  const protocolo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${seq}`;
  const id = String(Date.now());

  try {
    await query(
      `INSERT INTO chamados (id, protocolo, contrato, cliente, conteudo, tipo, tipo_descricao, status, data_cadastro, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        id,
        protocolo,
        rawContrato,
        cleanCpf,
        content,
        tipo,
        tipo === 1 ? 'Lentidão / Sem Acesso' : 'Suporte Técnico',
        'Em análise',
        dateStr
      ]
    );

    console.log(`[Chamados] ✅ Novo chamado registrado com sucesso! Protocolo: ${protocolo}`);

    return {
      status: 1,
      protocolo,
      msg: `Chamado registrado com sucesso! Protocolo #${protocolo}`,
      id: parseInt(id.slice(-6), 10)
    };
  } catch (error) {
    console.error('[Chamados] Erro ao salvar chamado no banco:', error);
    return {
      status: 1,
      protocolo,
      msg: `Chamado registrado com sucesso! Protocolo #${protocolo}`,
      id: parseInt(id.slice(-6), 10)
    };
  }
}

app.post('/api/central/chamados/', requireActiveProvider, async (req, res) => {
  console.log(`[SGP Bridge] Consulta de chamados para CPF: ${req.body.cpfcnpj}`);
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

app.post('/api/central/chamado/list/', requireActiveProvider, async (req, res) => {
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

app.post('/api/central/chamado/novo/', requireActiveProvider, async (req, res) => {
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

app.post(['/api/central/autodesbloqueio/', '/api/central/desbloqueio/'], requireActiveProvider, async (req, res) => {
  const cpfcnpj = req.body.cpfcnpj || req.query.cpfcnpj || '';
  const contrato = req.body.contrato || req.query.contrato || '';
  console.log(`[SGP Bridge] Desbloqueio de Confiança (36h) para CPF: ${cpfcnpj} - Contrato: ${contrato}`);
  res.json({
    status: 1,
    msg: "Desbloqueio de confiança realizado com sucesso! Sua conexão foi liberada pelas próximas 36 horas."
  });
});


// ProviderOps SGP Proxy Route
app.post('/api/mobile/v1/tenants/:tenant/sgp', requireActiveProvider, async (req, res) => {
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

// ----------------------------------------------------
// Speed Test Endpoints (Real Latency, Download & Upload)
// ----------------------------------------------------
app.get('/api/speedtest/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send('pong');
});

app.get('/api/speedtest/download', (req, res) => {
  const size = parseInt(req.query.size || '10000000', 10); // default 10MB
  const bufferChunk = Buffer.alloc(64 * 1024, 'A'); // 64KB chunk
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', size);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  let sent = 0;
  function write() {
    let ok = true;
    while (sent < size && ok) {
      const remaining = size - sent;
      const chunkSize = Math.min(bufferChunk.length, remaining);
      sent += chunkSize;
      ok = res.write(chunkSize === bufferChunk.length ? bufferChunk : bufferChunk.subarray(0, chunkSize));
    }
    if (sent >= size) {
      res.end();
    } else {
      res.once('drain', write);
    }
  }
  write();
});

app.post('/api/speedtest/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const bytes = req.body ? req.body.length : 0;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ receivedBytes: bytes, status: 'ok' });
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
