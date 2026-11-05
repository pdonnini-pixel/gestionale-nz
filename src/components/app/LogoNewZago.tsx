// Logo New Zago (scritta sottile e geometrica, stile dei negozi: bianco,
// nero e magenta #ff0066). Disegnato per l'app; il file e' anche in
// public/brand/newzago-logo.svg. Colore dal testo (currentColor).

export default function LogoNewZago({ className }: { className?: string }) {
  return (
    <svg viewBox="-3 -3 290 46" role="img" aria-label="New Zago" className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinejoin="miter" strokeLinecap="butt">
        <path d="M0 40V0l28 40V0" />
        <path d="M58 0H37v40h21M37 20h17" />
        <path d="M66 0l8 40 9-30 9 30 8-40" />
        <path d="M120 0h28l-28 40h28" />
        <path d="M156 40l14-40 14 40M161 26h18" />
        <path d="M228.4 8.5A20 20 0 1 0 231.7 23.5H215" />
        <circle cx={264} cy={20} r={20} />
      </g>
    </svg>
  )
}
