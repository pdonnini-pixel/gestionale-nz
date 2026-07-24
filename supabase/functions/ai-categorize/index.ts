import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface CategoryMatch {
  categoryId: string;
  categoryName: string;
  confidence: number;
  method: string;
  matchedOn: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Non autenticato' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Non autenticato' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const companyId = user.app_metadata?.company_id;
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'company_id mancante' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    if (req.method === 'GET') {
      const { data: movements } = await admin
        .from('cash_movements')
        .select('cost_category_id, ai_category_id, ai_confidence, ai_method')
        .eq('company_id', companyId);

      const total = movements?.length || 0;
      const manualCat = movements?.filter(m => m.cost_category_id).length || 0;
      const aiCat = movements?.filter(m => m.ai_category_id && !m.cost_category_id).length || 0;
      const uncategorized = total - manualCat - aiCat;
      const avgConfidence = movements
        ?.filter(m => m.ai_confidence)
        ?.reduce((s, m) => s + Number(m.ai_confidence), 0) / (aiCat || 1);

      const byMethod: Record<string, number> = {};
      for (const m of (movements || [])) {
        if (m.ai_method) byMethod[m.ai_method] = (byMethod[m.ai_method] || 0) + 1;
      }

      return new Response(JSON.stringify({
        data: { total, manualCat, aiCat, uncategorized, avgConfidence: Math.round(avgConfidence * 100) / 100, byMethod },
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { mode } = body;

    const { data: categories } = await admin
      .from('cost_categories')
      .select('id, name, matching_keywords, macro_group')
      .eq('company_id', companyId)
      .eq('is_active', true);

    const { data: rules } = await admin
      .from('ai_categorization_rules')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('times_confirmed', { ascending: false });

    function categorizeMovement(description: string, counterpart: string, amount: number, type: string): CategoryMatch | null {
      // Sign-aware (#2/#3): un incasso (entrata) non e' mai un costo.
      if (type === 'entrata') return null;

      const descLower = (description || '').toLowerCase();
      const counterLower = (counterpart || '').toLowerCase();
      const matches: CategoryMatch[] = [];

      for (const rule of (rules || [])) {
        let ruleMatches = false;
        if (rule.rule_type === 'counterpart' && rule.counterpart_pattern) {
          ruleMatches = counterLower.includes(rule.counterpart_pattern.toLowerCase());
        } else if (rule.rule_type === 'description_pattern' && rule.description_pattern) {
          ruleMatches = descLower.includes(rule.description_pattern.toLowerCase());
        } else if (rule.rule_type === 'amount_range') {
          ruleMatches = amount >= (rule.amount_min || -Infinity) && amount <= (rule.amount_max || Infinity);
        } else if (rule.rule_type === 'combined') {
          const descMatch = !rule.description_pattern || descLower.includes(rule.description_pattern.toLowerCase());
          const counterMatch = !rule.counterpart_pattern || counterLower.includes(rule.counterpart_pattern.toLowerCase());
          ruleMatches = descMatch && counterMatch;
        }
        if (ruleMatches) {
          const cat = categories?.find(c => c.id === rule.category_id);
          if (cat) {
            matches.push({
              categoryId: rule.category_id,
              categoryName: cat.name,
              confidence: Math.min(0.95, Number(rule.confidence) + (rule.times_confirmed > 5 ? 0.05 : 0)),
              method: 'learned_rule',
              matchedOn: `rule: ${rule.rule_type} (confirmed ${rule.times_confirmed}x)`,
            });
          }
        }
      }

      for (const cat of (categories || [])) {
        const keywords = cat.matching_keywords || [];
        for (const kw of keywords) {
          const kwLower = kw.toLowerCase();
          if (descLower.includes(kwLower) || counterLower.includes(kwLower)) {
            const specificity = kwLower.length > 5 ? 0.85 : 0.75;
            const alreadyMatched = matches.find(m => m.categoryId === cat.id);
            if (!alreadyMatched) {
              matches.push({
                categoryId: cat.id,
                categoryName: cat.name,
                confidence: specificity,
                method: 'keyword',
                matchedOn: `keyword: "${kw}"`,
              });
            }
          }
        }
      }

      if (matches.length === 0) {
        if (counterLower.includes('pos') || counterLower.includes('incasso') || descLower.includes('accredito pos')) {
          const cat = categories?.find(c => c.name.toLowerCase().includes('commissioni'));
          if (cat && amount < 0) {
            matches.push({ categoryId: cat.id, categoryName: cat.name, confidence: 0.70, method: 'pattern', matchedOn: 'pattern: POS commission' });
          }
        }
        if (counterLower.includes('sdd') || descLower.includes('addebito sdd')) {
          const sddMatch = descLower.match(/a favore\s+([a-z\s]+?)\s+(codice|importo)/i);
          if (sddMatch) {
            const beneficiary = sddMatch[1].trim();
            for (const cat of (categories || [])) {
              for (const kw of (cat.matching_keywords || [])) {
                if (beneficiary.includes(kw.toLowerCase())) {
                  matches.push({ categoryId: cat.id, categoryName: cat.name, confidence: 0.75, method: 'pattern', matchedOn: `pattern: SDD to "${beneficiary}"` });
                }
              }
            }
          }
        }
      }

      if (matches.length === 0) return null;
      matches.sort((a, b) => b.confidence - a.confidence);
      return matches[0];
    }

    if (mode === 'batch') {
      // Sign-aware: solo le uscite (costi). Gli incassi (entrate) sono ricavi.
      const { data: uncategorized } = await admin
        .from('cash_movements')
        .select('id, description, counterpart, amount, type')
        .eq('company_id', companyId)
        .eq('type', 'uscita')
        .is('cost_category_id', null)
        .is('ai_category_id', null)
        .order('date', { ascending: false })
        .limit(1000);

      let categorized = 0;
      let skipped = 0;
      const now = new Date().toISOString();

      for (const mov of (uncategorized || [])) {
        const match = categorizeMovement(mov.description, mov.counterpart, Number(mov.amount), mov.type);
        if (match && match.confidence >= 0.65) {
          const { error } = await admin
            .from('cash_movements')
            .update({
              ai_category_id: match.categoryId,
              ai_confidence: match.confidence,
              ai_categorized_at: now,
              ai_method: match.method,
            })
            .eq('id', mov.id);
          if (!error) categorized++;
        } else {
          skipped++;
        }
      }

      console.log(`[ai-categorize] Batch: ${categorized} categorized, ${skipped} skipped out of ${uncategorized?.length || 0}`);

      return new Response(JSON.stringify({
        categorized, skipped, total: uncategorized?.length || 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'single') {
      const { movementId } = body;
      const { data: mov } = await admin
        .from('cash_movements')
        .select('id, description, counterpart, amount, type')
        .eq('id', movementId)
        .eq('company_id', companyId)
        .single();
      if (!mov) {
        return new Response(JSON.stringify({ error: 'Movimento non trovato' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const match = categorizeMovement(mov.description, mov.counterpart, Number(mov.amount), mov.type);
      return new Response(JSON.stringify({ data: { movement: mov, suggestion: match } }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'confirm') {
      const { movementId, categoryId } = body;
      if (!movementId || !categoryId) {
        return new Response(JSON.stringify({ error: 'movementId e categoryId richiesti' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: mov } = await admin
        .from('cash_movements')
        .select('description, counterpart, amount')
        .eq('id', movementId)
        .eq('company_id', companyId)
        .single();

      if (!mov) {
        return new Response(JSON.stringify({ error: 'Movimento non trovato' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      await admin
        .from('cash_movements')
        .update({
          cost_category_id: categoryId,
          ai_method: 'manual',
          ai_confidence: 1.0,
          ai_categorized_at: new Date().toISOString(),
        })
        .eq('id', movementId);

      const counterpart = (mov.counterpart || '').trim();
      if (counterpart) {
        const { data: existing } = await admin
          .from('ai_categorization_rules')
          .select('id, times_confirmed')
          .eq('company_id', companyId)
          .eq('category_id', categoryId)
          .eq('rule_type', 'counterpart')
          .eq('counterpart_pattern', counterpart)
          .maybeSingle();

        if (existing) {
          await admin
            .from('ai_categorization_rules')
            .update({ times_confirmed: existing.times_confirmed + 1, last_used_at: new Date().toISOString() })
            .eq('id', existing.id);
        } else {
          await admin
            .from('ai_categorization_rules')
            .insert({
              company_id: companyId,
              category_id: categoryId,
              rule_type: 'counterpart',
              counterpart_pattern: counterpart,
              confidence: 0.85,
              times_confirmed: 1,
            });
        }
      }

      const descLower = (mov.description || '').toLowerCase();
      const sddMatch = descLower.match(/a favore\s+([a-z\s]+?)\s+(codice|importo)/i);
      if (sddMatch) {
        const beneficiary = sddMatch[1].trim();
        if (beneficiary.length > 3) {
          const { data: existingDesc } = await admin
            .from('ai_categorization_rules')
            .select('id, times_confirmed')
            .eq('company_id', companyId)
            .eq('category_id', categoryId)
            .eq('rule_type', 'description_pattern')
            .eq('description_pattern', beneficiary)
            .maybeSingle();

          if (existingDesc) {
            await admin
              .from('ai_categorization_rules')
              .update({ times_confirmed: existingDesc.times_confirmed + 1, last_used_at: new Date().toISOString() })
              .eq('id', existingDesc.id);
          } else {
            await admin
              .from('ai_categorization_rules')
              .insert({
                company_id: companyId,
                category_id: categoryId,
                rule_type: 'description_pattern',
                description_pattern: beneficiary,
                confidence: 0.80,
                times_confirmed: 1,
              });
          }
        }
      }

      return new Response(JSON.stringify({ data: { confirmed: true, movementId, categoryId } }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'anomalies') {
      const anomalies: Array<{ type: string; severity: string; description: string; entityId: string; entityType: string; details: Record<string, unknown> }> = [];

      const { data: movements } = await admin
        .from('cash_movements')
        .select('id, date, amount, description, counterpart')
        .eq('company_id', companyId)
        .order('date', { ascending: false })
        .limit(500);

      const seen = new Map<string, { id: string; description: string }>();
      for (const m of (movements || [])) {
        const key = `${m.date}_${m.amount}`;
        if (seen.has(key)) {
          const prev = seen.get(key)!;
          anomalies.push({
            type: 'duplicate',
            severity: 'medium',
            description: `Possibile duplicato: stesso importo (${m.amount}) e data (${m.date})`,
            entityId: m.id,
            entityType: 'cash_movement',
            details: { originalId: prev.id, amount: m.amount, date: m.date },
          });
        }
        seen.set(key, { id: m.id, description: m.description });
      }

      const amounts = (movements || []).map(m => Math.abs(Number(m.amount)));
      if (amounts.length > 10) {
        const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const std = Math.sqrt(amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length);
        const threshold = mean + 3 * std;
        for (const m of (movements || [])) {
          if (Math.abs(Number(m.amount)) > threshold) {
            anomalies.push({
              type: 'unusual_amount',
              severity: 'high',
              description: `Importo insolito: EUR ${Number(m.amount).toFixed(2)} (media: EUR ${mean.toFixed(2)}, soglia: EUR ${threshold.toFixed(2)})`,
              entityId: m.id,
              entityType: 'cash_movement',
              details: { amount: m.amount, mean: mean.toFixed(2), threshold: threshold.toFixed(2) },
            });
          }
        }
      }

      const { data: overdue } = await admin
        .from('payables')
        .select('id, invoice_number, gross_amount, due_date, status')
        .eq('company_id', companyId)
        .lt('due_date', new Date().toISOString().split('T')[0])
        .in('status', ['da_pagare', 'in_scadenza', 'scaduto'])
        .limit(50);

      for (const p of (overdue || [])) {
        anomalies.push({
          type: 'overdue_payable',
          severity: 'high',
          description: `Fattura scaduta: ${p.invoice_number || '?'} EUR ${Number(p.gross_amount).toFixed(2)} scaduta il ${p.due_date}`,
          entityId: p.id,
          entityType: 'payable',
          details: { invoice: p.invoice_number, amount: p.gross_amount, dueDate: p.due_date },
        });
      }

      // BUG-FIX: la colonna reale e' is_resolved (non resolved).
      for (const a of anomalies) {
        const { data: existing } = await admin
          .from('ai_anomaly_log')
          .select('id')
          .eq('company_id', companyId)
          .eq('entity_id', a.entityId)
          .eq('anomaly_type', a.type)
          .eq('is_resolved', false)
          .maybeSingle();

        if (!existing) {
          await admin.from('ai_anomaly_log').insert({
            company_id: companyId,
            entity_type: a.entityType,
            entity_id: a.entityId,
            anomaly_type: a.type,
            severity: a.severity,
            description: a.description,
            details: a.details,
          });
        }
      }

      console.log(`[ai-categorize] Anomalies detected: ${anomalies.length}`);

      return new Response(JSON.stringify({ data: { anomalies, total: anomalies.length } }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Mode non valido. Usa: batch, single, confirm, anomalies' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[ai-categorize] Error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      code: 'AI_CATEGORIZE_ERROR',
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
