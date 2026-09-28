export type ProviderMode = 'xkiro' | 'custom';

export interface AppSettings {
  provider: ProviderMode;
  endpoint: string;
  model: string;
  intervalSeconds: number;
  displayId: string;
  shortcut: string;
  proactive: boolean;
  launchAtLogin: boolean;
}

export interface DisplayOption {
  id: string;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

export interface CompanionStatus {
  monitoring: boolean;
  permission: 'unknown' | 'granted' | 'denied' | 'not-determined' | 'unsupported';
  lastSnapshotAt?: number;
  message?: string;
}

export interface ChatRequest {
  question: string;
  imageDataUrl?: string;
}

export interface ChatResponse {
  text: string;
}

export interface CompanionApi {
  isPreview: boolean;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  saveApiKey(key: string): Promise<void>;
  hasApiKey(): Promise<boolean>;
  listDisplays(): Promise<DisplayOption[]>;
  captureSnapshot(displayId: string): Promise<string>;
  ask(request: ChatRequest): Promise<ChatResponse>;
  getStatus(): Promise<CompanionStatus>;
  setMonitoring(enabled: boolean): Promise<CompanionStatus>;
  openSystemSettings(): Promise<void>;
  onStatus(callback: (status: CompanionStatus) => void): () => void;
  onHotkey(callback: () => void): () => void;
  onTip(callback: (text: string) => void): () => void;
  setOverlayMode(mode: 'compact' | 'chat' | 'settings' | 'thought'): void;
  armOverlayMove(): void;
  moveOverlayBy(dx: number, dy: number): void;
  finishOverlayMove(): void;
  onMoveMode(callback: (enabled: boolean) => void): () => void;
  quit(): void;
}
