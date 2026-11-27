-- NZ_ONLY 477 — Palmanova 22/11/2025: netto allineato al registro corrispettivi
-- Solo New Zago (xfvfxsvqpnpvibgeqpqp). Patrizio, 27/11/2026: caricati i registri corrispettivi 2025
-- di tutti i negozi («recorrispettivinewzagoezago2025.zip»), da confrontare con daily_revenue.
-- Esito del confronto: 1.427 giornate New Zago e 27 mesi Zago identici al centesimo, tranne questa.
-- Il registro di Palmanova ha il 22/11/2025 in due righe: 1.051,80 + 1.396,21 = 2.448,01 di imponibile,
-- 231,40 + 307,17 = 538,57 di imposta, «Totale di giornata» 2.986,58. L'import storico del 09/09/2026
-- aveva scritto 2.448,02 (lordo / 1,22 arrotondato). Il riepilogo di novembre (37.962,05) conferma 2.448,01.
-- Valore prima: gross 2986.58, net 2448.02. Tocca solo quella riga e solo se ha ancora il valore vecchio.
-- Rollback: NZ_ONLY_20261127_477_..._ROLLBACK.sql
UPDATE public.daily_revenue d
SET net_revenue = 2448.01
FROM public.outlets o
WHERE o.id = d.outlet_id AND o.code = 'PLM' AND d.date = '2025-11-22'
  AND d.gross_revenue = 2986.58 AND d.net_revenue = 2448.02;
