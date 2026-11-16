import { describe, it, expect } from 'vitest';
import { statoInvio, destinatarioProposto, periodoInChiaro, type InvioPrimaNota } from './primaNotaInvii';

const invio = (p: Partial<InvioPrimaNota> & { document_id: string; inviato_il: string }): InvioPrimaNota => ({
  id: `${p.document_id}-${p.inviato_il}`,
  periodo_year: 2026,
  periodo_month: 10,
  destinatario: 'studio',
  note: null,
  ...p,
});

describe('statoInvio', () => {
  it('un file senza invii è «non mandato»', () => {
    const st = statoInvio('doc-1', []);
    expect(st.inviato).toBe(false);
    expect(st.ultimo).toBeNull();
    expect(st.quanti).toBe(0);
  });

  it('prende l\'invio più recente, non il primo inserito', () => {
    const st = statoInvio('doc-1', [
      invio({ document_id: 'doc-1', inviato_il: '2026-11-13', destinatario: 'studio' }),
      invio({ document_id: 'doc-1', inviato_il: '2026-11-20', destinatario: 'commercialista' }),
    ]);
    expect(st.inviato).toBe(true);
    expect(st.quanti).toBe(2);
    expect(st.ultimo?.inviato_il).toBe('2026-11-20');
    expect(st.ultimo?.destinatario).toBe('commercialista');
  });

  it('non confonde gli invii di un altro file dello stesso mese', () => {
    // Due export dello stesso periodo: quello rifatto il giorno dopo non eredita
    // l'invio del primo, altrimenti la pagina direbbe che lo studio ha una
    // versione che non ha mai ricevuto.
    const invii = [
      invio({ document_id: 'doc-primo', inviato_il: '2026-11-13' }),
    ];
    expect(statoInvio('doc-primo', invii).inviato).toBe(true);
    expect(statoInvio('doc-rifatto', invii).inviato).toBe(false);
  });
});

describe('destinatarioProposto', () => {
  it('senza storia non inventa nessun nome', () => {
    expect(destinatarioProposto([])).toBe('');
  });

  it('propone l\'ultimo destinatario usato', () => {
    expect(destinatarioProposto([
      invio({ document_id: 'a', inviato_il: '2026-09-12', destinatario: 'studio' }),
      invio({ document_id: 'b', inviato_il: '2026-10-14', destinatario: 'studio e banca' }),
    ])).toBe('studio e banca');
  });
});

describe('periodoInChiaro', () => {
  it('mese e anno', () => {
    expect(periodoInChiaro(2026, 10)).toBe('ottobre 2026');
    expect(periodoInChiaro(2026, 1)).toBe('gennaio 2026');
  });
  it('solo anno', () => {
    expect(periodoInChiaro(2026, null)).toBe('anno 2026');
  });
  it('senza periodo', () => {
    expect(periodoInChiaro(null, 10)).toBe('senza periodo');
  });
});
