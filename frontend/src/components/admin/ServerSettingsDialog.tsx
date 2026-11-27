/**
 * Server Settings
 *
 * The owner's page: which options this server offers everyone (song loops and their video
 * models, the stem qualities, the cloud, limits, the song search) and their defaults. It
 * opens locked; the admin passphrase (the server's ADMIN_PASSWORD) unlocks it for this
 * browser. Changes are saved together and apply at once, without a restart.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useServerSettings } from '../../hooks/useServerSettings';
import { useToast } from '../../hooks/useToast';
import type { ServerSettingValue } from '../../types';
import {
  SETTING_GROUPS,
  SettingDraft,
  changeCount,
  withChange,
  withReset,
} from '../../utils/serverSettings';
import { Button } from '../ui/Button';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import { Spinner } from '../ui/Spinner';
import { SettingRow } from './SettingRow';

export interface ServerSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ServerSettingsDialog: React.FC<ServerSettingsDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();
  const { phase, state, error, busy, unlock, save, reload } = useServerSettings(isOpen);
  const [draft, setDraft] = useState<SettingDraft>({});
  const [passphrase, setPassphrase] = useState('');
  const passphraseRef = useRef<HTMLInputElement>(null);
  const changes = changeCount(draft);

  // A page opened again starts from what the server has, not from an old draft
  useEffect(() => {
    if (!isOpen) {
      setDraft({});
      setPassphrase('');
    }
  }, [isOpen]);

  // The passphrase field appears after the server has answered, so the dialog's own first
  // focus (taken when it opened) cannot be it
  useEffect(() => {
    if (isOpen && phase === 'locked') passphraseRef.current?.focus();
  }, [isOpen, phase]);

  const handleUnlock = (event: React.FormEvent) => {
    event.preventDefault();
    if (!passphrase.trim() || busy) return;
    void unlock(passphrase).then(() => setPassphrase(''));
  };

  const handleSave = async () => {
    if (!changes || busy) return;
    if (await save(draft)) {
      setDraft({});
      toast.success('Server settings saved');
    }
  };

  const handleChange = (id: string, value: ServerSettingValue) => {
    if (state) setDraft((current) => withChange(state, current, id, value));
  };
  const handleReset = (id: string) => {
    if (state) setDraft((current) => withReset(state, current, id));
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="server-settings-title"
      descriptionId="server-settings-desc"
      size="3xl"
      dataModal="server-settings"
      showDragHandle
      testId="server-settings-dialog"
    >
      <DialogHeader
        title="Server settings"
        titleId="server-settings-title"
        description="What this server offers everyone who uses it. Changes apply at once."
        descriptionId="server-settings-desc"
        onClose={onClose}
        closeLabel="Close server settings"
      />

      {phase === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-sm text-theme-text-muted">
          <Spinner /> Asking the server…
        </p>
      )}

      {phase === 'off' && (
        <p className="text-sm text-theme-text-muted">
          This server has no admin passphrase, so its settings cannot be changed here. Set{' '}
          <code className="font-mono text-theme-text">ADMIN_PASSWORD</code> on the server to turn
          this page on.
        </p>
      )}

      {phase === 'failed' && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-theme-danger">
            {error}
          </p>
          <Button variant="secondary" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      )}

      {phase === 'locked' && (
        <form onSubmit={handleUnlock} className="max-w-sm space-y-4">
          <p className="text-sm text-theme-text-muted">
            Only this server&apos;s owner can change its settings.
          </p>
          <Field label="Admin passphrase" htmlFor="server-settings-passphrase" error={error}>
            <Input
              id="server-settings-passphrase"
              ref={passphraseRef}
              type="password"
              autoComplete="current-password"
              value={passphrase}
              disabled={busy}
              aria-invalid={Boolean(error)}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            loadingLabel="Unlocking"
            disabled={!passphrase.trim()}
          >
            Unlock
          </Button>
        </form>
      )}

      {phase === 'ready' && state && (
        <>
          <div className="space-y-6">
            {SETTING_GROUPS.map((group) => (
              <section key={group.id} aria-labelledby={`server-settings-${group.id}`}>
                <h3
                  id={`server-settings-${group.id}`}
                  className="ks-display border-b-2 border-theme-border pb-1 text-[24px] text-theme-text"
                >
                  {group.title}
                </h3>
                <ul className="divide-y divide-theme-border-subtle">
                  {group.settings
                    .filter((setting) => state.settings[setting.id])
                    .map((setting) => (
                      <SettingRow
                        key={setting.id}
                        setting={setting}
                        state={state}
                        draft={draft}
                        disabled={busy}
                        onChange={handleChange}
                        onReset={handleReset}
                      />
                    ))}
                </ul>
              </section>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-4 text-sm text-theme-danger">
              {error}
            </p>
          )}
        </>
      )}

      <DialogFooter>
        {phase === 'ready' && changes > 0 && (
          <p className="self-center text-sm text-theme-text-muted tabular-nums sm:mr-auto">
            {changes === 1 ? '1 change not saved yet' : `${changes} changes not saved yet`}
          </p>
        )}
        <Button variant="secondary" fullWidth="mobile" onClick={onClose}>
          Close
        </Button>
        {phase === 'ready' && (
          <Button
            variant="primary"
            fullWidth="mobile"
            loading={busy}
            loadingLabel="Saving"
            disabled={changes === 0}
            onClick={() => void handleSave()}
          >
            Save changes
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
};

export default ServerSettingsDialog;
