import { isDesktopRuntime } from './ai-client';
import type { ModelProfiles } from './model-profiles';

export type ModelConfigStorage = 'system' | 'memory';

export async function saveModelProfiles(settings: ModelProfiles): Promise<ModelConfigStorage> {
  if (!(await isDesktopRuntime())) return 'memory';
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('save_model_profiles', { settings });
  return 'system';
}

export async function loadModelProfiles(): Promise<ModelProfiles | null> {
  if (!(await isDesktopRuntime())) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ModelProfiles | null>('load_model_profiles');
}

export async function selectModelProfile(id: string): Promise<void> {
  if (!(await isDesktopRuntime())) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('select_model_profile', { id });
}
