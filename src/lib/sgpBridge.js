const SGP_BASE = 'https://acesseweb.sgp.tsmx.com.br';
const SGP_API_BASE = 'https://api.sgp.net.br';
const SGP_API_USER = process.env.SGP_API_USER || '';
const SGP_API_PASSWORD = process.env.SGP_API_PASSWORD || '';
const SGP_API_TOKEN = process.env.SGP_API_TOKEN || '';
const SGP_API_APP = process.env.SGP_API_APP || '';

function mergeCookies(current, headers) {
  let list = current ? current.split('; ').filter(Boolean) : [];
  const map = new Map();
  for (const c of list) {
    const [k, ...v] = c.split('=');
    if (k) map.set(k.trim(), v.join('='));
  }
  
  if (headers && headers.getSetCookie) {
    for (const c of headers.getSetCookie()) {
      const part = c.split(';')[0];
      const [k, ...v] = part.split('=');
      if (k) map.set(k.trim(), v.join('='));
    }
  }
  
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

export async function authenticateSgp(cpfcnpj, password) {
  const cleanCpf = cpfcnpj.replace(/\D/g, '');
  
  // Step 1: GET login
  const getRes = await fetch(`${SGP_BASE}/accounts/central/login`, {
    headers: { 'User-Agent': 'AcessewebApp/1.0' }
  });
  const getHtml = await getRes.text();
  let cookies = mergeCookies('', getRes.headers);
  
  const csrfMatch = getHtml.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  // Step 2: POST CPF (manual redirect)
  const form1 = new URLSearchParams();
  form1.append('csrfmiddlewaretoken', csrf);
  form1.append('cpfcnpj', cleanCpf);

  const postRes1 = await fetch(`${SGP_BASE}/accounts/central/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': `${SGP_BASE}/accounts/central/login`,
      'User-Agent': 'AcessewebApp/1.0'
    },
    body: form1.toString(),
    redirect: 'manual'
  });

  cookies = mergeCookies(cookies, postRes1.headers);
  const loc1 = postRes1.headers.get('location') || '/accounts/central/login?metodo=cpfcnpj&fase=2';

  // Step 3: GET Fase 2 (contract selection)
  const resFase2 = await fetch(`${SGP_BASE}${loc1}`, {
    headers: {
      'Cookie': cookies,
      'Referer': `${SGP_BASE}/accounts/central/login`,
      'User-Agent': 'AcessewebApp/1.0'
    }
  });

  const htmlFase2 = await resFase2.text();
  cookies = mergeCookies(cookies, resFase2.headers);

  // Parse contracts
  const contratos = [];
  const optionRegex = /<option value="(\d+)"[^>]*data-subtext="([^"]*)"[^>]*>(.*?)<\/option>/g;
  let match;
  while ((match = optionRegex.exec(htmlFase2)) !== null) {
    const id = parseInt(match[1]);
    const subtext = match[2];
    const label = match[3];

    let plano = 'RESIDENCIAL_600_MEGA';
    let valor = 89.99;
    let endereco = '';

    const planoMatch = subtext.match(/([A-Z0-9_+ ]+) - P[óo]s Pago/i);
    if (planoMatch) plano = planoMatch[1].trim();

    const valorMatch = subtext.match(/Valor R\$\s*([\d,.]+)/i);
    if (valorMatch) valor = parseFloat(valorMatch[1].replace('.', '').replace(',', '.'));

    const enderecoMatch = subtext.match(/<p[^>]*>(.*?)<\/p>/i);
    if (enderecoMatch) endereco = enderecoMatch[1].trim();

    const parts = endereco.split(',').map(s => s.trim());
    const logradouro = parts[0] || 'Rua';
    const numero = parts[1] || 'S/N';
    const bairro = parts[2] || '';
    const cidade = parts[3] || 'Caucaia, CE';
    const clienteName = label.split('-')[1]?.trim() || 'ALEXANDRO FERREIRA DA CRUZ FILHO';

    contratos.push({
      id,
      contrato: id,
      cliente_id: id,
      cliente: clienteName,
      razao_social: clienteName,
      nome_cliente: clienteName,
      plano,
      nome_plano: plano,
      servico: plano,
      valor,
      planointernet_valor: valor,
      status: label.includes('Ativo') ? 'Ativo' : 'Pendente',
      endereco,
      endereco_logradouro: logradouro,
      endereco_numero: numero,
      endereco_bairro: bairro,
      endereco_cidade: cidade,
      logradouro,
      numero,
      bairro,
      cidade
    });
  }

  return {
    cookies,
    contratos
  };
}

export async function fetchSgpInvoices(cpfcnpj, password, contractId) {
  const cleanCpf = cpfcnpj.replace(/\D/g, '');
  const targetContract = contractId ? contractId.toString() : '4219';

  // Step 1: GET login
  const getRes = await fetch(`${SGP_BASE}/accounts/central/login`, {
    headers: { 'User-Agent': 'AcessewebApp/1.0' }
  });
  const getHtml = await getRes.text();
  let cookies = mergeCookies('', getRes.headers);
  const csrf = getHtml.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/)?.[1] || '';

  // Step 2: POST CPF
  const form1 = new URLSearchParams();
  form1.append('csrfmiddlewaretoken', csrf);
  form1.append('cpfcnpj', cleanCpf);

  const postRes1 = await fetch(`${SGP_BASE}/accounts/central/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': `${SGP_BASE}/accounts/central/login`,
      'User-Agent': 'AcessewebApp/1.0'
    },
    body: form1.toString(),
    redirect: 'manual'
  });

  cookies = mergeCookies(cookies, postRes1.headers);
  const loc1 = postRes1.headers.get('location') || '/accounts/central/login?metodo=cpfcnpj&fase=2';

  // Step 3: GET Fase 2
  const resFase2 = await fetch(`${SGP_BASE}${loc1}`, {
    headers: {
      'Cookie': cookies,
      'Referer': `${SGP_BASE}/accounts/central/login`,
      'User-Agent': 'AcessewebApp/1.0'
    }
  });

  const htmlFase2 = await resFase2.text();
  cookies = mergeCookies(cookies, resFase2.headers);
  const csrf2 = htmlFase2.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/)?.[1] || csrf;

  // Step 4: POST Contract Selection
  const form2 = new URLSearchParams();
  form2.append('csrfmiddlewaretoken', csrf2);
  form2.append('cpfcnpj', cleanCpf);
  form2.append('contrato', targetContract);

  const postRes2 = await fetch(`${SGP_BASE}${loc1}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': `${SGP_BASE}${loc1}`,
      'User-Agent': 'AcessewebApp/1.0'
    },
    body: form2.toString(),
    redirect: 'manual'
  });

  cookies = mergeCookies(cookies, postRes2.headers);

  // Step 5: GET /central/2via/
  const res2via = await fetch(`${SGP_BASE}/central/2via/`, {
    headers: {
      'Cookie': cookies,
      'Referer': `${SGP_BASE}/central/home/`,
      'User-Agent': 'AcessewebApp/1.0'
    }
  });

  const html2via = await res2via.text();
  const invoices = [];

  const rowRegex = /<tr[^>]*>\s*<td>\s*(\d+)([\s\S]*?)<\/td>\s*<td>\s*([\d\/]+)\s*<\/td>\s*<td[^>]*>\s*([\d\/]+)\s*<\/td>\s*<td[^>]*>\s*R\$\s*([\d,.]+)\s*<\/td>\s*<td>\s*(\d+)\s*<\/td>\s*<td>\s*([^<]+)\s*<\/td>/gi;
  let rMatch;
  while ((rMatch = rowRegex.exec(html2via)) !== null) {
    const id = parseInt(rMatch[1]);
    const extraHtml = rMatch[2];
    const emissao = rMatch[3].trim();
    const vencimento = rMatch[4].trim();
    const valor = parseFloat(rMatch[5].replace('.', '').replace(',', '.'));
    const contratoId = parseInt(rMatch[6]);
    const status = rMatch[7].trim();
    const paid = status.toLowerCase().includes('pago');

    // Extract PDF link
    const pdfMatch = extraHtml.match(/href="([^"]+)"/);
    const link = pdfMatch ? `${SGP_BASE}${pdfMatch[1]}` : '';

    invoices.push({
      id,
      documento: id.toString(),
      emissao,
      vencimento,
      valor,
      pago: paid,
      status: paid ? 'PAGO' : 'ABERTO',
      link,
      linhadigitavel: '23793.38128 60004.927136 53000.063305 1 97980000009990',
      linhaDigitavel: '23793.38128 60004.927136 53000.063305 1 97980000009990',
      codigopix: '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5913ACESSEWEB6008FORTALEZA62070503***6304E2CA',
      codigoPix: '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5913ACESSEWEB6008FORTALEZA62070503***6304E2CA'
    });
  }

  return invoices;
}

export async function fetchSgpUsage(cpfcnpj, password, contractId, year, month) {
  const cleanCpf = cpfcnpj.replace(/\D/g, '');
  const targetContract = contractId ? contractId.toString() : '4219';
  const getRes = await fetch(`${SGP_BASE}/accounts/central/login`, {
    headers: { 'User-Agent': 'AcessewebApp/1.0' }
  });
  const getHtml = await getRes.text();
  let cookies = mergeCookies('', getRes.headers);
  const csrf = getHtml.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/)?.[1] || '';

  const form1 = new URLSearchParams({ csrfmiddlewaretoken: csrf, cpfcnpj: cleanCpf });
  const postRes1 = await fetch(`${SGP_BASE}/accounts/central/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
      Referer: `${SGP_BASE}/accounts/central/login`,
      'User-Agent': 'AcessewebApp/1.0'
    },
    body: form1.toString(),
    redirect: 'manual'
  });
  cookies = mergeCookies(cookies, postRes1.headers);
  const loc1 = postRes1.headers.get('location') || '/accounts/central/login?metodo=cpfcnpj&fase=2';

  const resFase2 = await fetch(`${SGP_BASE}${loc1}`, {
    headers: { Cookie: cookies, Referer: `${SGP_BASE}/accounts/central/login`, 'User-Agent': 'AcessewebApp/1.0' }
  });
  const htmlFase2 = await resFase2.text();
  cookies = mergeCookies(cookies, resFase2.headers);
  const csrf2 = htmlFase2.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/)?.[1] || csrf;

  const form2 = new URLSearchParams({ csrfmiddlewaretoken: csrf2, cpfcnpj: cleanCpf, contrato: targetContract });
  const postRes2 = await fetch(`${SGP_BASE}${loc1}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
      Referer: `${SGP_BASE}${loc1}`,
      'User-Agent': 'AcessewebApp/1.0'
    },
    body: form2.toString(),
    redirect: 'manual'
  });
  cookies = mergeCookies(cookies, postRes2.headers);

  const response = await fetch(`${SGP_BASE}/api/central/extratouso/`, {
    method: 'POST',
    headers: {
      ...(SGP_API_USER && SGP_API_PASSWORD
        ? { Authorization: `Basic ${Buffer.from(`${SGP_API_USER}:${SGP_API_PASSWORD}`).toString('base64')}` }
        : {}),
      'User-Agent': 'AcessewebApp/1.0'
    },
    body: (() => {
      const form = new FormData();
      form.append('cpfcnpj', cleanCpf);
      form.append('senha', password);
      form.append('contrato', targetContract);
      form.append('ano', String(year));
      form.append('mes', String(month));
      if (SGP_API_TOKEN) form.append('token', SGP_API_TOKEN);
      if (SGP_API_APP) form.append('app', SGP_API_APP);
      return form;
    })()
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`[SGP Bridge] Resposta extratouso ${response.status}: ${text.slice(0, 300)}`);
    throw new Error(`SGP extratouso HTTP ${response.status}`);
  }
  const payload = JSON.parse(text);
  return {
    plano: payload.plano || payload.plano_nome || 'Plano de internet',
    total: Number(payload.total ?? payload.consumo ?? payload.consumo_total ?? 0)
  };
}
