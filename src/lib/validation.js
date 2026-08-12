export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function requiredText(value, field, max = 180) {
  const text = String(value || '').trim();
  if (!text) throw new ApiError(400, `${field} e obrigatorio`);
  if (text.length > max) throw new ApiError(400, `${field} excede ${max} caracteres`);
  return text;
}

export function optionalText(value, max = 500) {
  const text = String(value || '').trim();
  if (text.length > max) throw new ApiError(400, `Texto excede ${max} caracteres`);
  return text;
}

export function positiveNumber(value, field, options = {}) {
  const number = Number(value);
  const min = options.min ?? 0.001;
  const max = options.max ?? 1_000_000;
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, `${field} precisa estar entre ${min} e ${max}`);
  }
  return number;
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ApiError(400, `${field} invalido`);
  return value;
}

export function normalizeEmail(value) {
  const email = requiredText(value, 'E-mail', 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'E-mail invalido');
  return email;
}

export function normalizeDocument(value, field = 'Documento') {
  const digits = requiredText(value, field, 30).replace(/\D/g, '');
  if (![11, 14].includes(digits.length)) throw new ApiError(400, `${field} precisa ser um CPF (11 digitos) ou CNPJ (14 digitos)`);
  return digits;
}

export function slugify(value) {
  return requiredText(value, 'Nome').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
