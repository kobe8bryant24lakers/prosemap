'use client';

import { Plug, Settings2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';
import type { ModelProfiles } from '@/lib/model-profiles';

export type ModelSwitcherProps = {
  settings: ModelProfiles;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onManage: () => void;
};

export default function ModelSwitcher({ settings, disabled, onSelect, onManage }: ModelSwitcherProps) {
  useLocale();
  if (!settings.profiles.length) return <div className="model-switcher">
    <button type="button" className="model-connect" disabled={disabled} aria-label={t('管理模型')} title={t('管理模型')}
      onClick={event => { event.currentTarget.focus({ preventScroll: true }); onManage(); }}>
      <Plug size={14} aria-hidden="true" />{t('管理模型')}
    </button>
  </div>;
  return (
    <div className="model-switcher">
      <select aria-label={t('切换模型')} value={settings.activeId ?? ''} disabled={disabled || !settings.profiles.length} onChange={(event) => onSelect(event.target.value)}>
        {settings.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
      </select>
      <button type="button" className="icon-button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onManage(); }} disabled={disabled} title={t('管理模型')} aria-label={t('管理模型')}><Settings2 size={16} /></button>
    </div>
  );
}
