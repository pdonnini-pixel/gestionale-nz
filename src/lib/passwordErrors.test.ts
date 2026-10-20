import { describe, it, expect } from 'vitest'
import { messaggioErrorePassword } from './passwordErrors'

describe('messaggioErrorePassword', () => {
  it('password uguale alla precedente', () => {
    expect(messaggioErrorePassword({ code: 'same_password', message: 'New password should be different from the old password.', status: 422 }))
      .toBe('La nuova password deve essere diversa da quella attuale.')
    expect(messaggioErrorePassword({ message: 'New password should be different from the old password.' }))
      .toBe('La nuova password deve essere diversa da quella attuale.')
  })

  it('password debole', () => {
    expect(messaggioErrorePassword({ code: 'weak_password', message: 'Password should contain at least one character of each: abc, ABC, 123', status: 422 }))
      .toMatch(/^Password troppo debole/)
  })

  it('sessione di recupero scaduta', () => {
    expect(messaggioErrorePassword({ code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist', status: 403 }))
      .toMatch(/^Il link è scaduto/)
  })

  it('troppi tentativi', () => {
    expect(messaggioErrorePassword({ message: 'Request rate limit reached', status: 429 }))
      .toBe('Troppi tentativi ravvicinati. Aspetta un minuto e riprova.')
  })

  it('errore sconosciuto: resta il testo originale', () => {
    expect(messaggioErrorePassword({ message: 'Qualcosa di imprevisto' })).toBe('Qualcosa di imprevisto')
  })
})
