/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Optionaler Standard-Endpunkt des KI-Proxys. */
  readonly VITE_AI_PROXY_URL?: string;
}
