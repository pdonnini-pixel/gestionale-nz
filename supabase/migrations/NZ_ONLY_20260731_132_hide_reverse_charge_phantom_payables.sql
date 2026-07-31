-- NZ_ONLY_20260731_132_hide_reverse_charge_phantom_payables.sql
--
-- BONIFICA DATI STORICI (solo NEW ZAGO) collegata al fix 131.
-- Prima del fix 131 il bridge A-Cube aveva creato payable "fantasma" dai documenti
-- di integrazione/autofattura reverse charge (TD16/TD17/TD18/TD19), che NON sono
-- debiti verso il fornitore. Segnalati da Sabrina (luglio 2026).
--
-- Made e Zago NON hanno payable di questa classe (verificato) -> file NZ_ONLY.
--
-- STRATEGIA: soft-hide REVERSIBILE via is_placeholder=true (la view
-- v_payables_operative gia' filtra "WHERE NOT COALESCE(is_placeholder,false)",
-- quindi la riga sparisce da scadenzario e da totali aperto/pagato SENZA DELETE).
-- La fattura elettronica resta in electronic_invoices (per IVA/cassetto fiscale).
--
-- ESCLUSI: i payable gia' agganciati a un movimento bancario reale
-- (bank_transaction_id/cash_movement_id NON null) -> vanno ri-agganciati a mano
-- alla fattura vera prima di nasconderli, per non orfanare il movimento.
-- Attualmente: MILANI SPA 26/A e GABRIEL IOSUB 10/A. Gestiti a parte.
--
-- Backup completo dei 54 payable salvato prima dell'operazione (sessione Claude,
-- 2026-07-31). Reversibile: UPDATE ... SET is_placeholder=false per ripristinare.

update public.payables p
set is_placeholder = true,
    notes = coalesce(nullif(p.notes,'') || ' | ', '')
            || 'NASCOSTA 2026-07-31: documento reverse charge (TD16/17/18/19), non è un debito verso il fornitore. Vedi fix bridge 131. Reversibile: is_placeholder=false.'
from public.electronic_invoices ei
where ei.id = p.electronic_invoice_id
  and p.company_id = '00000000-0000-0000-0000-000000000001'
  and ei.tipo_documento in ('TD16','TD17','TD18','TD19')
  and p.bank_transaction_id is null
  and p.cash_movement_id is null
  and coalesce(p.is_placeholder, false) = false;
