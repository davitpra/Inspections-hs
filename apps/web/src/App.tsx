import { healthResponseSchema, type HealthResponse } from '@hs/contracts';
import { isAnswered } from '@hs/forms';

/**
 * Etapa 0: solo verifica que el enlace del workspace funciona en el bundle.
 * TanStack Router/Query, la PWA y el outbox llegan en la etapa 3 (ADR-001, ADR-003).
 */
const health: HealthResponse = healthResponseSchema.parse({ status: 'ok', service: 'web' });

function App() {
  return (
    <main>
      <h1>hs-platform</h1>
      <p>
        {health.service}: {health.status}
      </p>
      <p>forms engine: {isAnswered('') ? 'unexpected' : 'ready'}</p>
    </main>
  );
}

export default App;
