/**
 * Re-separate Dialog ("Improve stem separation")
 *
 * Re-makes the open song's vocal and backing stems at another quality in the background.
 * The song stays playable on its current stems until the new ones are ready.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Sparkles } from 'lucide-react';
import type { ProjectState, SeparationPreset, StudioCapabilities } from '../../types';
import type { ReseparateOptions } from '../../hooks/useQualityJobs';
import { useCapabilities } from '../../hooks/useCapabilities';
import { PRESET_NAMES, SEPARATION_PRESET_ORDER, presetInfo } from '../../utils/quality';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { SeparationQualityPicker } from './SeparationQualityPicker';

export interface ReseparateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectState;
  /** What the server can run; asked for when the dialog opens unless given. */
  capabilities?: StudioCapabilities['separation'] | null;
  /** Lyric edits not saved yet: re-timing would replace them. */
  hasUnsavedLyricEdits?: boolean;
  onSubmit: (options: ReseparateOptions) => Promise<void>;
}

/** The next better preset this server can run, or the current one when none is better. */
function suggestedPreset(
  current: SeparationPreset,
  capabilities?: StudioCapabilities['separation'] | null
): SeparationPreset {
  const better = SEPARATION_PRESET_ORDER.slice(SEPARATION_PRESET_ORDER.indexOf(current) + 1);
  return better.find((preset) => presetInfo(preset, capabilities).available) ?? current;
}

export const ReseparateDialog: React.FC<ReseparateDialogProps> = (props) =>
  props.isOpen ? <ReseparateDialogContent {...props} /> : null;

const ReseparateDialogContent: React.FC<ReseparateDialogProps> = ({
  onClose,
  project,
  capabilities: capabilitiesProp,
  hasUnsavedLyricEdits = false,
  onSubmit,
}) => {
  const fetched = useCapabilities(capabilitiesProp === undefined);
  const capabilities = capabilitiesProp ?? fetched?.separation ?? null;
  const preset = project.separation?.preset;
  const current: SeparationPreset =
    preset && preset !== 'custom' ? preset : (project.separation_quality ?? 'fast');
  const [quality, setQualityState] = useState<SeparationPreset>(() =>
    suggestedPreset(current, capabilities)
  );
  const touched = useRef(false);
  const setQuality = (next: SeparationPreset) => {
    touched.current = true;
    setQualityState(next);
  };
  // Until the user picks, follow the suggestion as the server's answer arrives
  useEffect(() => {
    if (!touched.current) setQualityState(suggestedPreset(current, capabilities));
  }, [current, capabilities]);
  const [realignLyrics, setRealignLyrics] = useState(false);
  const [redetectChords, setRedetectChords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLyrics = (project.lines?.length ?? 0) > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        quality,
        realignLyrics: realignLyrics && hasLyrics && !hasUnsavedLyricEdits,
        redetectChords,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start re-making the stems');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      titleId="reseparate-title"
      descriptionId="reseparate-desc"
      size="2xl"
      showDragHandle
      dataModal="reseparate"
      testId="reseparate-dialog"
    >
      <form onSubmit={handleSubmit}>
        <DialogHeader
          title="Improve stem separation"
          titleId="reseparate-title"
          description="Re-make this song's vocal and backing stems with another model. The song stays playable, and the new stems replace the current ones when they are ready."
          descriptionId="reseparate-desc"
          icon={<Sparkles className="h-5 w-5" />}
          onClose={onClose}
          closeDisabled={submitting}
        />
        <DialogBody>
          <SeparationQualityPicker
            name="reseparate-quality"
            legend="Quality"
            value={quality}
            onChange={setQuality}
            capabilities={capabilities}
            durationSeconds={project.duration}
            currentPreset={preset === 'custom' ? 'custom' : current}
          />
          <div className="space-y-1 rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle/60 px-3 py-1">
            <Checkbox
              checked={realignLyrics && hasLyrics && !hasUnsavedLyricEdits}
              onChange={setRealignLyrics}
              disabled={!hasLyrics || hasUnsavedLyricEdits}
              label="Re-time the lyrics against the new vocals"
              description={
                hasUnsavedLyricEdits
                  ? 'Save your lyric edits first; re-timing would replace them.'
                  : 'Cleaner vocals often give more accurate word timing. Lines timed by the lyrics file keep their timing; all others are re-timed, including lines you adjusted by hand.'
              }
              testId="reseparate-realign"
            />
            <Checkbox
              checked={redetectChords}
              onChange={setRedetectChords}
              label="Detect the chords again"
              description="Replaces the current chords, including any you edited."
              testId="reseparate-redetect"
            />
          </div>
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-theme-md border border-theme-danger/40 bg-theme-danger/10 p-3 text-sm text-theme-danger"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="gradient"
            loading={submitting}
            loadingLabel="Starting…"
            leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
          >
            Re-make stems with {PRESET_NAMES[quality]}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};
