'use client';

import { t, setLocale } from '@/lib/i18n';
import { useLocale } from '@/lib/use-locale';

import { Check, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { emptyModelConfig, normalizeModelProfiles, removeModelProfile, type ModelProfile, type ModelProfiles } from '@/lib/model-profiles';
import { ANTHROPIC_BASE_URL, OPENAI_BASE_URL, type ProviderKind } from '@/lib/editor';

type SettingsModalProps = {
  settings: ModelProfiles;
  onSave: (settings: ModelProfiles) => void | Promise<void>;
  onClose: () => void;
};

const providerCopy: Record<ProviderKind, { name: string; detail: string; model: string }> = {
  openai: { name: 'OpenAI-compatible', get detail() { return t("OpenAI、OpenRouter 及兼容 Chat Completions 的服务"); }, get model() { return t("例如：gpt-4.1-mini"); } },
  anthropic: { name: 'Anthropic Claude', get detail() { return t("Anthropic Messages API 与 Claude 系列模型"); }, get model() { return t("例如：claude-sonnet-4-5"); } },
};

function isValidEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value.trim());
    return (
      (endpoint.protocol === 'https:' || endpoint.protocol === 'http:')
      && endpoint.hostname.length > 0
      && endpoint.username.length === 0
      && endpoint.password.length === 0
      && endpoint.search.length === 0
      && endpoint.hash.length === 0
      && endpoint.port !== '0'
    );
  } catch {
    return false;
  }
}

export default function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const locale = useLocale();
  const [collection, setCollection] = useState<ModelProfiles>(() => {
    if (settings.profiles.length) return settings;
    const profile = { ...emptyModelConfig, id: crypto.randomUUID(), name: '' };
    return { profiles: [profile], activeId: profile.id };
  });
  const [editingId, setEditingId] = useState(() => settings.activeId);
  const draft = collection.profiles.find((profile) => profile.id === editingId) ?? collection.profiles[0];
  function setDraft(update: ModelProfile | ((current: ModelProfile) => ModelProfile)) {
    if (!draft) return;
    setCollection((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === draft.id ? typeof update === 'function' ? update(profile) : update : profile) }));
  }
  function addProfile() {
    const profile = { ...emptyModelConfig, id: crypto.randomUUID(), name: '' };
    setCollection((current) => ({ profiles: [...current.profiles, profile], activeId: current.activeId ?? profile.id }));
    setEditingId(profile.id);
    setShowKey(false);
  }
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onClose, saving]);

  function chooseProvider(provider: ProviderKind) {
    if (draft?.provider === provider) return;
    setDraft((current) => ({
      ...current,
      provider,
      model: '',
      apiKey: '',
      baseUrl: provider === 'openai' ? OPENAI_BASE_URL : ANTHROPIC_BASE_URL,
    }));
  }

  const valid = collection.profiles.every((profile) => profile.model.trim().length > 0 && profile.apiKey.trim().length > 0 && isValidEndpoint(profile.baseUrl));

  async function save() {
    setSaving(true);
    try {
      await onSave(normalizeModelProfiles(collection));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-header">
          <div className="settings-icon"><KeyRound size={20} /></div>
          <div><h2 id="settings-title">{t("模型连接")}</h2><p>{t("选择服务并填写你自己的访问凭据。")}</p></div>
          <button type="button" className="icon-button modal-close" onClick={onClose} disabled={saving} aria-label={t("关闭模型配置")}><X size={18} /></button>
        </header>

        <fieldset className="settings-body" disabled={saving}>
          <div className="language-settings field-group">
            <label htmlFor="interface-language">{t('界面语言')}</label>
            <select id="interface-language" value={locale} onChange={(event) => setLocale(event.target.value === 'zh-CN' ? 'zh-CN' : 'en')}>
              <option value="en" lang="en">English</option>
              <option value="zh-CN" lang="zh-CN">简体中文</option>
            </select>
            <small>{t('语言切换立即生效，并自动保存在本机。')}</small>
          </div>
          <div className="profile-manager">
            <div className="profile-manager-heading"><strong>{t('已保存的模型')}</strong><button type="button" className="secondary-button" onClick={addProfile} disabled={collection.profiles.length >= 20}>{t('添加模型')}</button></div>
            <div className="profile-list">
              {collection.profiles.map((profile) => <button type="button" aria-pressed={profile.id === draft?.id} className={profile.id === draft?.id ? 'selected' : ''} key={profile.id} onClick={() => { setEditingId(profile.id); setShowKey(false); }}>
                <span>{profile.name || profile.model || t('新模型')}</span>{profile.id === collection.activeId && <small>{t('当前使用')}</small>}
              </button>)}
            </div>
          </div>
          {draft ? <>
          <div className="profile-actions">
            <button type="button" className="secondary-button" disabled={draft.id === collection.activeId} onClick={() => setCollection({ ...collection, activeId: draft.id })}>{t('设为当前模型')}</button>
            <button type="button" className="secondary-button" onClick={() => { const next = removeModelProfile(collection, draft.id); setCollection(next); setEditingId(next.activeId); setShowKey(false); }}>{t('移除模型')}</button>
          </div>
          <div className="field-group">
            <label htmlFor="profile-name">{t('配置名称')}</label>
            <input id="profile-name" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t('例如：日常写作、代码助手')} />
          </div>
          <div className="field-group">
            <label>{t("服务类型")}</label>
            <div className="provider-grid">
              {(Object.keys(providerCopy) as ProviderKind[]).map((provider) => (
                <button key={provider} type="button" className={`provider-option ${draft.provider === provider ? 'selected' : ''}`} onClick={() => chooseProvider(provider)}>
                  <span className="provider-radio">{draft.provider === provider ? <Check size={11} /> : null}</span>
                  <span><strong>{providerCopy[provider].name}</strong><small>{providerCopy[provider].detail}</small></span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-fields">
            <div className="field-group">
              <label htmlFor="base-url">{t("API 地址")}</label>
              <input
                id="base-url"
                type="url"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                placeholder="https://api.example.com:8443/v1"
                aria-describedby="base-url-help"
                spellCheck={false}
              />
              <small id="base-url-help">{t("HTTPS 域名会严格校验证书；HTTPS IP 会跳过证书校验，仅用于可信网络。端口不参与证书校验。本机或私网也可使用 HTTP（如 http://127.0.0.1:11434/v1）。")}</small>
            </div>
            <div className="field-group">
              <label htmlFor="model-name">{t("模型名称")}</label>
              <input id="model-name" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder={providerCopy[draft.provider].model} spellCheck={false} />
            </div>
            <div className="field-group">
              <label htmlFor="api-key">{t("API 密钥")}</label>
              <div className="secret-input">
                <LockKeyhole size={15} />
                <input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  placeholder={draft.provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
                  autoComplete="new-password"
                  data-lpignore="true"
                  spellCheck={false}
                />
                <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? t("隐藏密钥") : t("显示密钥")}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </div>
          </div>

          </> : <p>{t('尚未配置模型，点击添加模型开始。')}</p>}
          {!valid && <p className="profile-validation" role="status">{t('请补全每个模型的名称、API 地址和密钥，或移除未完成的配置。')}</p>}
          <div className="security-card">
            <ShieldCheck size={18} />
            <div><strong>{t("配置将安全保存在本机")}</strong><p>{t("桌面端使用系统安全凭据库加密保存，重启后仍可使用；不会写入源码或服务端日志。浏览器预览环境不持久化密钥。")}</p></div>
          </div>
        </fieldset>

        <footer className="settings-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t("取消")}</button>
          <button type="button" className="confirm-button" onClick={() => void save()} disabled={!valid || saving}>
            <Check size={15} /> {saving ? t("安全保存中…") : t("安全保存")}
          </button>
        </footer>
      </section>
    </div>
  );
}
