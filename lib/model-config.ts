import type { ModelConfig } from './editor';
import { isDesktopRuntime } from './ai-client';

export type ModelConfigStorage = 'system' | 'memory';

export async function saveModelConfig(config: ModelConfig): Promise<ModelConfigStorage> {
  if (!(await isDesktopRuntime())) return 'memory';
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('save_model_config', { config });
  return 'system';
}

export async function loadModelConfig(): Promise<ModelConfig | null> {
  if (!(await isDesktopRuntime())) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ModelConfig | null>('load_model_config');
}
