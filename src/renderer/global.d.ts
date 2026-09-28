import type { CompanionApi } from '../main/types';

declare global {
  interface Window {
    companion: CompanionApi;
  }
}

export {};
