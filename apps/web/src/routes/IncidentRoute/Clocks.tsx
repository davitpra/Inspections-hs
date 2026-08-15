import type { RegulatoryClockDto } from '@hs/contracts';

import { OBLIGATION_LABELS, clockOrigin, clockStatus } from '../../presentation/incidents';

/**
 * Los relojes regulatorios.
 *
 * **Se muestran, no se cumplen.** Cada uno dice qué hay que hacer, para cuándo, desde
 * cuándo cuenta y de qué artículo sale. El sistema no envía nada al MLITSD ni al WSIB:
 * presentar es un acto de una persona, y por eso la pantalla lo dice con todas las
 * letras en vez de dejarlo implícito.
 *
 * **Un reloj vencido se muestra vencido.** Esconderlo sería peor: quien tiene que
 * responder ante el organismo necesita saberlo hoy.
 */
export function Clocks({
  clocks,
}: {
  clocks: readonly RegulatoryClockDto[];
}): React.JSX.Element {
  if (clocks.length === 0) {
    return <p>This classification does not trigger a Ministry or WSIB obligation.</p>;
  }

  return (
    <section>
      <h2>Regulatory clocks</h2>

      <ul className="list">
        {clocks.map((clock) => (
          <li key={clock.obligation} className="list__row">
            <span>
              {OBLIGATION_LABELS[clock.obligation as keyof typeof OBLIGATION_LABELS] ??
                clock.obligation}
            </span>
            <p>
              {clockStatus(clock)} — {clockOrigin(clock)}
              {clock.overdue ? <span className="badge badge--overdue">Past due</span> : null}
            </p>
            <p>{clock.citation}</p>
          </li>
        ))}
      </ul>

      <p className="notice">
        These deadlines are calculated and shown. The platform does not file anything with
        the Ministry or the WSIB — a person does that, in the regulator&apos;s own portal.
      </p>
    </section>
  );
}
