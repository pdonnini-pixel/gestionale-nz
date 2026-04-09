-- ============================================================
-- FIX: Adatta tabella employees esistente al nuovo schema
-- Esegui QUESTO nel SQL Editor, poi ri-esegui supabase_DEFINITIVO.sql
-- ============================================================

-- 1) Aggiungi colonne mancanti alla tabella employees esistente
DO $$
BEGIN
  -- nome (copia da first_name)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='nome') THEN
    ALTER TABLE employees ADD COLUMN nome TEXT;
    UPDATE employees SET nome = first_name WHERE nome IS NULL;
  END IF;

  -- cognome (copia da last_name)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='cognome') THEN
    ALTER TABLE employees ADD COLUMN cognome TEXT;
    UPDATE employees SET cognome = last_name WHERE cognome IS NULL;
  END IF;

  -- codice_fiscale (copia da fiscal_code)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='codice_fiscale') THEN
    ALTER TABLE employees ADD COLUMN codice_fiscale TEXT;
    UPDATE employees SET codice_fiscale = fiscal_code WHERE codice_fiscale IS NULL;
  END IF;

  -- matricola
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='matricola') THEN
    ALTER TABLE employees ADD COLUMN matricola TEXT;
  END IF;

  -- data_assunzione (copia da hire_date)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='data_assunzione') THEN
    ALTER TABLE employees ADD COLUMN data_assunzione DATE;
    UPDATE employees SET data_assunzione = hire_date WHERE data_assunzione IS NULL;
  END IF;

  -- data_cessazione (copia da termination_date)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='data_cessazione') THEN
    ALTER TABLE employees ADD COLUMN data_cessazione DATE;
    UPDATE employees SET data_cessazione = termination_date WHERE data_cessazione IS NULL;
  END IF;

  -- contratto_tipo (copia da contract_type castet a text)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='contratto_tipo') THEN
    ALTER TABLE employees ADD COLUMN contratto_tipo TEXT;
    UPDATE employees SET contratto_tipo = contract_type::text WHERE contratto_tipo IS NULL;
  END IF;

  -- livello (copia da level)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='livello') THEN
    ALTER TABLE employees ADD COLUMN livello TEXT;
    UPDATE employees SET livello = level WHERE livello IS NULL;
  END IF;

  -- ore_settimanali (copia da weekly_hours)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='ore_settimanali') THEN
    ALTER TABLE employees ADD COLUMN ore_settimanali NUMERIC(5,1) DEFAULT 40;
    UPDATE employees SET ore_settimanali = weekly_hours WHERE ore_settimanali IS NULL OR ore_settimanali = 40;
  END IF;

  -- note (singolare - copia da notes plurale)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='note') THEN
    ALTER TABLE employees ADD COLUMN note TEXT;
    UPDATE employees SET note = notes WHERE note IS NULL;
  END IF;

END $$;

-- 2) Assicurati che nome/cognome non siano NULL (necessario per le viste)
UPDATE employees SET nome = first_name WHERE nome IS NULL AND first_name IS NOT NULL;
UPDATE employees SET cognome = last_name WHERE cognome IS NULL AND last_name IS NOT NULL;

-- Se nome è ancora NULL, metti un default
UPDATE employees SET nome = 'N/D' WHERE nome IS NULL;
UPDATE employees SET cognome = 'N/D' WHERE cognome IS NULL;

-- 3) Drop viste che usano employees (per evitare conflitti)
DROP VIEW IF EXISTS v_employee_costs_by_outlet CASCADE;

-- 4) Verifica
SELECT
  id, nome, cognome, codice_fiscale, data_assunzione, contratto_tipo, livello, is_active
FROM employees
LIMIT 5;

SELECT 'Fix employees completato! ' || count(*) || ' dipendenti aggiornati.' AS risultato FROM employees;
