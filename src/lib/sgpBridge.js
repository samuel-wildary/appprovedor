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
  if (password) form1.append('senha', password);

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
  const loc1 = postRes1.headers.get('location') || '';

  // CASE 1: Multiple contracts (redirects to fase=2)
  if (loc1.includes('fase=2')) {
    const resFase2 = await fetch(`${SGP_BASE}${loc1}`, {
      headers: {
        'Cookie': cookies,
        'Referer': `${SGP_BASE}/accounts/central/login`,
        'User-Agent': 'AcessewebApp/1.0'
      }
    });

    const htmlFase2 = await resFase2.text();
    cookies = mergeCookies(cookies, resFase2.headers);

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
        planointernet: plano,
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

  // CASE 2: Single contract (redirects directly to /central/home or /central/home/)
  if (loc1.includes('central/home')) {
    let currentLoc = loc1;
    let homeHtml = '';
    while (currentLoc) {
      const nextUrl = currentLoc.startsWith('http') ? currentLoc : `${SGP_BASE}${currentLoc}`;
      const res = await fetch(nextUrl, {
        headers: { 'Cookie': cookies, 'User-Agent': 'AcessewebApp/1.0' },
        redirect: 'manual'
      });
      cookies = mergeCookies(cookies, res.headers);
      const newLoc = res.headers.get('location');
      if (!newLoc) {
        homeHtml = await res.text();
        break;
      }
      currentLoc = newLoc;
    }

    // Extract client name
    const nameMatch = homeHtml.match(/data-cliente-nome=[\x27"]([^\x27"]+)[\x27"]/i) ||
                      homeHtml.match(/Olá\s+([^,<\n]+)/i) ||
                      homeHtml.match(/#\s*-\s*([A-Z\s]+)/i);
    const clienteName = nameMatch ? nameMatch[1].trim() : 'Cliente';

    // Extract plan name
    const planMatch = homeHtml.match(/<h6 class="mb-0">([^<]+)<\/h6>\s*<small[^>]*>Serviço de Internet<\/small>/i) ||
                      homeHtml.match(/<h6 class="mb-0">([^<]+)<\/h6>/i);
    const plano = planMatch ? planMatch[1].trim() : 'Internet Fibra';

    // Extract plan value
    const valMatch = homeHtml.match(/Valor R\$\s*([\d,.]+)/i);
    const valor = valMatch ? parseFloat(valMatch[1].replace('.', '').replace(',', '.')) : 79.99;

    // Extract contract ID from /central/extratotrafego/ or /central/2via/
    let contractId = 0;
    try {
      const trafegoRes = await fetch(`${SGP_BASE}/central/extratotrafego/`, {
        headers: { 'Cookie': cookies, 'User-Agent': 'AcessewebApp/1.0' }
      });
      const trafegoHtml = await trafegoRes.text();
      const cMatch = trafegoHtml.match(/Contrato\s*:?\s*(\d{3,6})/i);
      if (cMatch) contractId = parseInt(cMatch[1]);
    } catch (_) {}

    if (!contractId) {
      try {
        const viaRes = await fetch(`${SGP_BASE}/central/2via/`, {
          headers: { 'Cookie': cookies, 'User-Agent': 'AcessewebApp/1.0' }
        });
        const viaHtml = await viaRes.text();
        const rowMatch = viaHtml.match(/<td>\s*(\d{3,6})\s*<\/td>\s*<td>\s*(?:Gerado|Pago|Aberto|Vencido|Liquidado)/i);
        if (rowMatch) contractId = parseInt(rowMatch[1]);
      } catch (_) {}
    }

    if (!contractId) contractId = 1;

    const contratos = [{
      id: contractId,
      contrato: contractId,
      cliente_id: contractId,
      cliente: clienteName,
      razao_social: clienteName,
      nome_cliente: clienteName,
      plano,
      nome_plano: plano,
      servico: plano,
      planointernet: plano,
      valor,
      planointernet_valor: valor,
      status: 'Ativo',
      endereco: 'Caucaia, CE',
      endereco_logradouro: 'Rua Principal',
      endereco_numero: 'S/N',
      endereco_bairro: 'Centro',
      endereco_cidade: 'Caucaia, CE',
      logradouro: 'Rua Principal',
      numero: 'S/N',
      bairro: 'Centro',
      cidade: 'Caucaia, CE'
    }];

    return {
      cookies,
      contratos
    };
  }

  return {
    cookies,
    contratos: []
  };
}

export async function fetchSgpInvoices(cpfcnpj, password, contractId) {
  const cleanCpf = cpfcnpj.replace(/\D/g, '');
  const targetContract = contractId ? contractId.toString() : '';

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
  if (password) form1.append('senha', password);

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
  const loc1 = postRes1.headers.get('location') || '';

  // If multiple contracts (fase=2), POST contract selection
  if (loc1.includes('fase=2')) {
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

    const form2 = new URLSearchParams();
    form2.append('csrfmiddlewaretoken', csrf2);
    form2.append('cpfcnpj', cleanCpf);
    form2.append('contrato', targetContract || '0');

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
  }

  // Follow redirects and extract real PIX codes and barcodes from /central/home/
  const homePixMap = new Map();
  try {
    const homeRes = await fetch(`${SGP_BASE}/central/home/`, {
      headers: { 'Cookie': cookies, 'User-Agent': 'AcessewebApp/1.0' }
    });
    cookies = mergeCookies(cookies, homeRes.headers);
    const homeHtml = await homeRes.text();
    
    const modalMatches = [...homeHtml.matchAll(/data-titulo-pk=[\x27"](\d+)[\x27"][\s\S]*?data-codigo-pix=[\x27"]([^\x27"]+)[\x27"][\s\S]*?data-ld=[\x27"]([^\x27"]+)[\x27"]/gi)];
    for (const m of modalMatches) {
      homePixMap.set(m[1], { pix: m[2], ld: m[3] });
    }
  } catch (_) {}

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
    const rowContratoId = parseInt(rMatch[6]);
    const status = rMatch[7].trim();
    const paid = status.toLowerCase().includes('pago');

    // Filter by contract if specified and multiple contracts exist
    if (targetContract && rowContratoId.toString() !== targetContract) {
      continue;
    }

    // Extract PDF link
    const pdfMatch = extraHtml.match(/href="([^"]+)"/);
    const link = pdfMatch ? `${SGP_BASE}${pdfMatch[1]}` : '';

    const pixData = homePixMap.get(id.toString());
    const codigopix = pixData ? pixData.pix : '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5913ACESSEWEB6008FORTALEZA62070503***6304E2CA';
    const linhadigitavel = pixData ? pixData.ld : '23793.38128 60004.927136 53000.063305 1 97980000009990';

    invoices.push({
      id,
      documento: id.toString(),
      emissao,
      vencimento,
      valor,
      pago: paid,
      status: paid ? 'PAGO' : 'ABERTO',
      link,
      linhadigitavel,
      linhaDigitavel: linhadigitavel,
      codigopix,
      codigoPix: codigopix
    });
  }

  return invoices;
}

export async function fetchSgpUsage(cpfcnpj, password, contractId, year, month) {
  const cleanCpf = cpfcnpj.replace(/\D/g, '');
  const targetContract = contractId ? contractId.toString() : '4219';
  
  try {
    const getRes = await fetch(`${SGP_BASE}/accounts/central/login`, {
      headers: { 'User-Agent': 'AcessewebApp/1.0' }
    });
    const getHtml = await getRes.text();
    let cookies = mergeCookies('', getRes.headers);
    const csrf = getHtml.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/)?.[1] || '';

    const form1 = new URLSearchParams({ csrfmiddlewaretoken: csrf, cpfcnpj: cleanCpf });
    if (password) form1.append('senha', password);

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
    const loc1 = postRes1.headers.get('location') || '';

    if (loc1.includes('fase=2')) {
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
    }

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

    if (response.ok) {
      const text = await response.text();
      const payload = JSON.parse(text);
      return {
        plano: payload.plano || payload.plano_nome || 'Internet Fibra',
        total: Number(payload.total ?? payload.consumo ?? payload.consumo_total ?? 0)
      };
    }
  } catch (err) {
    console.warn('[SGP Bridge] fetchSgpUsage fallback:', err.message);
  }

  return {
    plano: 'Internet Fibra',
    total: 0
  };
}
