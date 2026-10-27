import type { SpokenApi } from '../shared/ipc';

declare global {
  interface Window {
    readonly spoken: SpokenApi;
  }
}
export {};
