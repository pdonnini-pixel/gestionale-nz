// Messaggi di errore di Supabase Auth sul cambio password, tradotti per chi
// usa il gestionale. Si guarda prima il codice (stabile), poi il testo inglese
// per le versioni che non lo mandano. Un errore non riconosciuto resta com'è,
// così non si nasconde niente.

interface AuthErrorLike {
  code?: string
  message: string
  status?: number
}

export function messaggioErrorePassword(error: AuthErrorLike): string {
  const code = error.code ?? ''
  const msg = error.message.toLowerCase()

  if (code === 'same_password' || msg.includes('should be different')) {
    return 'La nuova password deve essere diversa da quella attuale.'
  }
  if (code === 'weak_password' || msg.includes('password should') || msg.includes('weak')) {
    return 'Password troppo debole: scegline una più lunga, con lettere maiuscole, minuscole e numeri.'
  }
  if (
    code === 'session_not_found' || code === 'session_expired' || code === 'reauthentication_needed' ||
    msg.includes('session') || msg.includes('jwt') || error.status === 401 || error.status === 403
  ) {
    return 'Il link è scaduto. Richiedi un nuovo link da «Password dimenticata?» nella schermata di accesso.'
  }
  if (code === 'over_request_rate_limit' || msg.includes('rate limit') || error.status === 429) {
    return 'Troppi tentativi ravvicinati. Aspetta un minuto e riprova.'
  }
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'Connessione non riuscita. Controlla la rete e riprova.'
  }
  return error.message
}
