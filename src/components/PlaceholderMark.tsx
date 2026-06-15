import React from 'react';
import Tooltip from './Tooltip';

/**
 * PlaceholderMark — marcatore visivo per i valori SEGNAPOSTO (non ancora granito).
 *
 * Un valore è "segnaposto" quando deriva (anche solo in parte) da righe
 * `budget_entries` con `is_placeholder = true`: tipicamente un clone del 2025
 * non ancora confermato/granito in Budget & Controllo.
 *
 * Convenzione colori INVARIATA: il numero resta nero/rosso secondo le regole
 * (positivo nero, negativo rosso col meno). Questo marcatore NON colora la cifra:
 * aggiunge solo un pallino arancio accanto al valore. Stesso token arancio del
 * "bordo-fonte" di Personale (#ea580c = orange-600).
 *
 * NB: in Personale l'arancio indica "fonte = Budget & Controllo"; qui indica
 * "segnaposto non granito". Stesso colore, significato esplicitato in tooltip/legenda.
 */

export const PLACEHOLDER_COLOR = '#ea580c'; // orange-600 — stesso token "bordo-fonte" Personale

export const PLACEHOLDER_TIP =
  'Valore segnaposto: clonato dal 2025, non ancora confermato. Da compilare in Budget & Controllo.';

/** Pallino arancio inline accanto a un valore segnaposto. Reso solo se `show`. */
export function PlaceholderDot({
  show = true,
  tip = PLACEHOLDER_TIP,
  className = '',
}: {
  show?: boolean;
  tip?: string;
  className?: string;
}) {
  if (!show) return null;
  return (
    <Tooltip content={tip}>
      <span
        className={`inline-block w-2 h-2 rounded-full align-middle ml-1 shrink-0 cursor-help ${className}`}
        style={{ background: PLACEHOLDER_COLOR }}
        aria-label="segnaposto"
      />
    </Tooltip>
  );
}

/** Legenda standard da mostrare nelle viste che usano il marcatore. */
export function PlaceholderLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs text-slate-500 ${className}`}>
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: PLACEHOLDER_COLOR }}
      />
      <span>
        <span className="font-medium text-slate-700">Arancio = segnaposto</span> (clone 2025,
        ancora da granire in Budget &amp; Controllo)
      </span>
    </div>
  );
}
