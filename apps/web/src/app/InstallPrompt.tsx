import { useEffect, useState } from "react";

import { useAppSession } from "./session-context";

/**
 * El paso de onboarding de ADR-010: instalar en la pantalla de inicio.
 *
 * No es cosmético. La PWA instalada arranca sin la barra del navegador, sobrevive mejor
 * a que Android recicle memoria, y —lo que importa acá— es la forma en que un inspector
 * abre la aplicación en una planta sin señal: desde un ícono, no escribiendo una URL
 * que necesitaría resolver DNS.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt(): React.JSX.Element | null {
  const { ready } = useAppSession();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event): void => {
      // El navegador ofrece su propio banner y lo hace cuando quiere. Se intercepta para
      // que la invitación aparezca en el onboarding, que es donde el inspector todavía
      // tiene red y paciencia.
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };

    const onInstalled = (): void => {
      setInstalled(true);
      setInstallEvent(null);
    };

    globalThis.addEventListener("beforeinstallprompt", onPrompt);
    globalThis.addEventListener("appinstalled", onInstalled);

    return () => {
      globalThis.removeEventListener("beforeinstallprompt", onPrompt);
      globalThis.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!ready || !installEvent || installed) return null;

  return (
    <section className="onboarding">
      <p>
        <button
          type="button"
          onClick={() => {
            void installEvent.prompt();
            setInstallEvent(null);
          }}
        >
          Add to home screen
        </button>{" "}
        Install the app before going out on a walkthrough.
      </p>
    </section>
  );
}
