import crypto from 'node:crypto';
import { query } from './postgres.js';

export async function listPlans() {
  const { rows } = await query('SELECT * FROM plans ORDER BY monthly_price ASC');
  return rows;
}

export async function createPlan(data) {
  const id = crypto.randomUUID();
  const { rows } = await query(
    `INSERT INTO plans (id, name, description, monthly_price, active)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, data.name, data.description || '', Number(data.monthlyPrice || 0), data.active !== false]
  );
  return rows[0];
}

export async function listPayments() {
  const { rows } = await query(
    `SELECT payments.*, providers.name AS provider_name, plans.name AS plan_name
     FROM payments
     JOIN providers ON providers.id = payments.provider_id
     JOIN plans ON plans.id = payments.plan_id
     ORDER BY payments.due_date DESC`
  );
  return rows;
}

export async function createPayment(data) {
  const id = crypto.randomUUID();
  const { rows } = await query(
    `INSERT INTO payments (id, provider_id, plan_id, amount, due_date, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, data.providerId, data.planId, Number(data.amount || 0), data.dueDate, data.status || 'PENDING', data.notes || '']
  );
  return rows[0];
}

export async function listMetrics() {
  const [providers, plans, payments] = await Promise.all([
    query(`SELECT COUNT(*) FILTER (WHERE status='ACTIVE')::int AS active,
                  COUNT(*) FILTER (WHERE status='BLOCKED')::int AS blocked,
                  COUNT(*) FILTER (WHERE status='OVERDUE')::int AS overdue,
                  COUNT(*)::int AS total
           FROM providers`),
    query('SELECT COUNT(*)::int AS total FROM plans WHERE active'),
    query(`SELECT COUNT(*) FILTER (WHERE status='PAID')::int AS paid,
                  COUNT(*) FILTER (WHERE status='PENDING')::int AS pending,
                  COUNT(*) FILTER (WHERE status='OVERDUE')::int AS overdue,
                  COALESCE(SUM(amount) FILTER (WHERE status='PAID'), 0)::float AS received
           FROM payments`)
  ]);
  return {
    providers: providers.rows[0],
    plans: plans.rows[0],
    payments: payments.rows[0]
  };
}

export async function listAuditLogs() {
  const { rows } = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
  return rows;
}

export async function addAuditLog(action, details, actor = 'admin') {
  await query(
    'INSERT INTO audit_logs (id, actor, action, details) VALUES ($1, $2, $3, $4)',
    [crypto.randomUUID(), actor, action, details || '']
  );
}
