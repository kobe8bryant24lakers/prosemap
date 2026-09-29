import type { ModelConfig } from './editor';

export type ModelProfile = ModelConfig & { id: string; name: string };
export type ModelProfiles = { profiles: ModelProfile[]; activeId: string | null };
export const emptyModelConfig: ModelConfig = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' };
export const emptyModelProfiles: ModelProfiles = { profiles: [], activeId: null };

export function activeModelProfile(settings: ModelProfiles): ModelProfile | undefined {
  return settings.profiles.find((profile) => profile.id === settings.activeId);
}

export function removeModelProfile(settings: ModelProfiles, id: string): ModelProfiles {
  const profiles = settings.profiles.filter((profile) => profile.id !== id);
  return { profiles, activeId: settings.activeId === id ? profiles[0]?.id ?? null : settings.activeId };
}

export function normalizeModelProfiles(settings: ModelProfiles): ModelProfiles {
  return { ...settings, profiles: settings.profiles.map((profile) => ({
    ...profile,
    name: profile.name.trim() || profile.model.trim(),
    model: profile.model.trim(),
    apiKey: profile.apiKey.trim(),
    baseUrl: profile.baseUrl.trim().replace(/\/+$/, ''),
  })) };
}
