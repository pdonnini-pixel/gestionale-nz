import type { ReactNode } from 'react';

/**
 * Riquadro per un periodo senza dati (16/11/2026).
 *
 * Se esistono dati in un altro periodo (`ultimo`), dice che quello a video non e'
 * ancora caricato e porta all'ultimo con un pulsante: niente invito a importare,
 * che farebbe ricaricare file gia' presenti creando doppioni. Solo se non c'e'
 * nessun dato in nessun periodo mostra `senzaNiente` (l'invito a caricare).
 * Per trovare `ultimo` vedi src/lib/periodoVuoto.ts.
 */
export default function PeriodoVuoto({
  messaggio, ultimo, onVai, senzaNiente, compatto = false, className = '',
}: {
  /** Prima frase, es. «I cedolini di novembre 2026 non sono ancora caricati.» */
  messaggio: ReactNode;
  /** Etichetta dell'ultimo periodo con dati, null se non ce n'e' nessuno. */
  ultimo: string | null;
  onVai?: () => void;
  /** Cosa dire quando non c'e' nessun dato in nessun periodo (di solito l'invito a caricare). */
  senzaNiente: ReactNode;
  /** Riga di testo invece del riquadro (per KPI e grafici). */
  compatto?: boolean;
  className?: string;
}) {
  if (!ultimo) {
    return compatto
      ? <p className={`text-xs text-slate-500 ${className}`}>{senzaNiente}</p>
      : <div className={`bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 ${className}`}>{senzaNiente}</div>;
  }
  const testo = <>{messaggio} L'ultimo periodo caricato è <strong className="text-slate-700">{ultimo}</strong>.</>;
  if (compatto) {
    return (
      <p className={`text-xs text-slate-500 ${className}`}>
        {testo}
        {onVai && <>{' '}<button type="button" onClick={onVai} className="underline font-semibold text-slate-700 hover:text-slate-900">Vai a {ultimo}</button></>}
      </p>
    );
  }
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500 ${className}`}>
      <div>{testo}</div>
      {onVai && (
        <button
          type="button"
          onClick={onVai}
          className="mt-3 inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          Vai a {ultimo}
        </button>
      )}
    </div>
  );
}
