-- ============================================================
-- FIX: Elimina outlet duplicati creati dal seed cost_centers
-- I tuoi outlet originali hanno codici come BRB, FRC, PLM...
-- Il seed ha creato duplicati con codici barberino, franciacorta, palmanova...
-- Questo elimina SOLO quelli con i codici lunghi (dal seed)
-- ============================================================

-- Prima vediamo cosa c'è
-- SELECT id, name, code, created_at FROM outlets ORDER BY code;

-- Elimina i duplicati (quelli creati dal seed con codici da cost_centers)
DELETE FROM outlet_attachments
WHERE outlet_id IN (
  SELECT id FROM outlets
  WHERE code IN ('sede_magazzino', 'valdichiana', 'barberino', 'palmanova', 'franciacorta', 'brugnato', 'valmontone', 'torino')
);

DELETE FROM outlets
WHERE code IN ('sede_magazzino', 'valdichiana', 'barberino', 'palmanova', 'franciacorta', 'brugnato', 'valmontone', 'torino');

-- Verifica: dovrebbero restare solo i tuoi outlet originali
SELECT id, name, code, is_active FROM outlets ORDER BY name;
