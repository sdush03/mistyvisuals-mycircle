const { pool } = require('../db')

async function createInvoiceFromSnapshot(projectId, leadId, snapshotId, client) {
  // 1. Guard check
  const existing = await client.query('SELECT id FROM invoices WHERE lead_id = $1 LIMIT 1', [leadId]);
  if (existing.rows.length > 0) {
    console.log(`[invoices] Invoice already exists for lead ${leadId}, returning existing`);
    return { invoiceId: existing.rows[0].id, totalAmount: null, advanceAmount: null, balanceAmount: null };
  }

  // 2. Fetch proposal snapshot
  const snapRes = await client.query('SELECT snapshot_json, quote_version_id FROM proposal_snapshots WHERE id = $1', [snapshotId]);
  if (snapRes.rows.length === 0) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }
  let snapshotJson = snapRes.rows[0].snapshot_json;
  if (typeof snapshotJson === 'string') {
    try { snapshotJson = JSON.parse(snapshotJson); } catch (e) {}
  }
  const quoteVersionId = snapRes.rows[0].quote_version_id;

  // Fetch quote version
  const qvRes = await client.query('SELECT quote_group_id, target_price, calculated_price, sales_override_price FROM quote_versions WHERE id = $1', [quoteVersionId]);
  const qv = qvRes.rows[0] || {};

  // 3. Extract TOTAL AMOUNT
  let totalAmount = null;
  
  const draftData = snapshotJson.draftData || snapshotJson.draft_data || {};
  
  const possibleTotals = [
    snapshotJson.targetPrice,
    snapshotJson.calculatedPrice,
    snapshotJson.finalPrice,
    snapshotJson.totalAmount,
    snapshotJson.discountedTotal,
    draftData.targetPrice,
    draftData.calculatedPrice,
    draftData.finalPrice,
    draftData.totalAmount,
    draftData.discountedTotal,
    qv.target_price,
    qv.sales_override_price,
    qv.calculated_price
  ];

  for (const t of possibleTotals) {
    const num = Number(t);
    if (!isNaN(num) && num > 0) {
      if (totalAmount === null || num < totalAmount) {
        totalAmount = num;
      }
    }
  }
  
  if (totalAmount === null) totalAmount = 0;

  // Extract ADVANCE AMOUNT
  let advanceAmount = 0;
  const advanceCands = [
    snapshotJson.advance,
    snapshotJson.advanceAmount,
    snapshotJson.advance_amount,
    draftData.advance,
    draftData.advanceAmount,
    draftData.advance_amount
  ];
  for (const a of advanceCands) {
    const num = Number(a);
    if (!isNaN(num) && num > 0) {
      advanceAmount = num;
      break;
    }
  }
  
  if (advanceAmount === 0 && draftData.paymentSchedule && Array.isArray(draftData.paymentSchedule)) {
    const advanceStage = draftData.paymentSchedule.find(s => s.stage && s.stage.toLowerCase().includes('advance'));
    if (advanceStage && advanceStage.amount) {
      advanceAmount = Number(advanceStage.amount) || 0;
    }
  }

  if (advanceAmount === 0) {
    console.log(`[invoices] Warning: Could not determine advance amount for lead ${leadId}, defaulting to 0`);
  }

  // Calculate balance
  const balanceAmount = totalAmount - advanceAmount;

  // Extract LINE ITEMS
  const lineItems = [];
  const items = snapshotJson.items || draftData.pricingItems || draftData.items || [];
  for (const item of items) {
    if (item.type === 'DELIVERABLE' || item.type === 'TEAM' || item.itemType === 'DELIVERABLE' || item.itemType === 'TEAM_ROLE') {
      const amount = Number(item.price || item.rate || item.amount || item.unitPrice || item.totalPrice || 0);
      const quantity = Number(item.quantity || item.qty || 1);
      const description = item.title || item.name || item.label || 'Item';
      
      if (amount > 0) {
        lineItems.push({ description, amount, quantity });
      }
    }
  }

  // Check for discount
  const discountAmount = Number(snapshotJson.discount || draftData.discount || 0);
  if (discountAmount > 0) {
    lineItems.push({ description: 'Package Discount', amount: -discountAmount, quantity: 1 });
  }

  // 5. INSERT into invoices (with share_token for proforma sharing)
  const invRes = await client.query(
    `INSERT INTO invoices (lead_id, project_id, quote_group_id, total_amount, advance_amount, balance_amount, status, share_token, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', gen_random_uuid(), $7, NOW())
     RETURNING id, share_token`,
    [
      leadId,
      projectId,
      qv.quote_group_id || null,
      totalAmount,
      advanceAmount,
      balanceAmount,
      JSON.stringify({ source: 'auto_generated', snapshot_id: snapshotId })
    ]
  );
  
  const invoiceId = invRes.rows[0].id;
  const shareToken = invRes.rows[0].share_token;

  // 6. INSERT line items
  for (const item of lineItems) {
    const lineTotal = Number(item.amount || 0) * Number(item.quantity || 1);
    await client.query(
      `INSERT INTO invoice_line_items (invoice_id, description, amount, quantity, unit_price, line_total)
       VALUES ($1, $2, $3, $4, $3, $5)`,
       [invoiceId, item.description, item.amount, item.quantity, lineTotal]
    );
  }

  // 7. Populate payment schedule from snapshot
  const paymentSchedule = draftData.paymentSchedule || draftData.payment_schedule || snapshotJson.paymentSchedule || [];
  if (Array.isArray(paymentSchedule) && paymentSchedule.length > 0) {
    for (let i = 0; i < paymentSchedule.length; i++) {
      const step = paymentSchedule[i];
      const label = step.stage || step.label || step.name || `Payment ${i + 1}`;
      const pct = Number(step.percentage || step.percent || 0);
      const amt = Number(step.amount || 0) || (pct > 0 ? (pct / 100) * totalAmount : 0);
      let dueDate = step.dueDate || step.due_date || null;
      if (dueDate && isNaN(Date.parse(dueDate))) {
        // If it's a string like "Upon Booking", it's not a valid postgres date, so use null
        dueDate = null;
      }
      const isAdvance = label.toLowerCase().includes('advance') || label.toLowerCase().includes('booking');
      const status = isAdvance ? 'paid' : 'pending';

      await client.query(
        `INSERT INTO invoice_payment_schedule (invoice_id, label, percentage, amount, due_date, step_order, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceId, label, pct || null, amt, dueDate || null, i + 1, status]
      );
    }
  } else {
    // Fallback: create a basic 2-step schedule (advance + balance)
    if (advanceAmount > 0) {
      await client.query(
        `INSERT INTO invoice_payment_schedule (invoice_id, label, percentage, amount, due_date, step_order, status)
         VALUES ($1, 'Booking Advance', $2, $3, NULL, 1, 'paid')`,
        [invoiceId, totalAmount > 0 ? Math.round((advanceAmount / totalAmount) * 100) : 0, advanceAmount]
      );
    }
    if (balanceAmount > 0) {
      await client.query(
        `INSERT INTO invoice_payment_schedule (invoice_id, label, percentage, amount, due_date, step_order, status)
         VALUES ($1, 'Balance Payment', $2, $3, NULL, 2, 'pending')`,
        [invoiceId, totalAmount > 0 ? Math.round((balanceAmount / totalAmount) * 100) : 0, balanceAmount]
      );
    }
  }

  // 8. UPDATE projects
  await client.query(
    `UPDATE projects SET invoice_id = $1 WHERE id = $2`,
    [invoiceId, projectId]
  );

  return { invoiceId, shareToken, totalAmount, advanceAmount, balanceAmount };
}

module.exports = { createInvoiceFromSnapshot };
