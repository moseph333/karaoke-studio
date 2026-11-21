/**
 * Song Check-up Dialog
 *
 * Lists what looks off about the open song (missing lyrics, lines that may be out of time,
 * singing without lyrics, stems that fell back) with a button to the tool that fixes each,
 * and what is fine. The rows come from `utils/songCheckup.ts`.
 */

import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Lightbulb } from 'lucide-react';
import type { ProjectState } from '../../types';
import { useCapabilities } from '../../hooks/useCapabilities';
import { GUIDE_ACTION_LABELS, type GuideAction } from '../../utils/guideActions';
import { SEPARATION_PRESET_ORDER, presetInfo } from '../../utils/quality';
import { songCheckup, type CheckupLevel } from '../../utils/songCheckup';
import { cn } from '../../utils/cn';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Button } from '../ui/Button';

export interface SongCheckupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectState;
  /** Takes the user to the tool; the caller closes this dialog first. */
  onAction: (action: GuideAction) => void;
}

const LEVELS: Record<CheckupLevel, { Icon: typeof AlertTriangle; tone: string; spoken: string }> = {
  fix: { Icon: AlertTriangle, tone: 'text-theme-warning', spoken: 'To fix' },
  tip: { Icon: Lightbulb, tone: 'text-theme-text', spoken: 'Tip' },
  ok: { Icon: CheckCircle2, tone: 'text-theme-success', spoken: 'Fine' },
};

export const SongCheckupDialog: React.FC<SongCheckupDialogProps> = (props) =>
  props.isOpen ? <SongCheckupContent {...props} /> : null;

const SongCheckupContent: React.FC<SongCheckupDialogProps> = ({ onClose, project, onAction }) => {
  const capabilities = useCapabilities()?.separation;
  const preset = project.separation?.preset ?? 'fast';
  const betterStemsAvailable = useMemo(() => {
    if (!capabilities || preset === 'custom') return undefined;
    return SEPARATION_PRESET_ORDER.slice(SEPARATION_PRESET_ORDER.indexOf(preset) + 1).some(
      (better) => presetInfo(better, capabilities).available
    );
  }, [capabilities, preset]);
  const rows = useMemo(
    () => songCheckup(project, { betterStemsAvailable }),
    [project, betterStemsAvailable]
  );
  const toFix = rows.filter((row) => row.level === 'fix').length;

  return (
    <Dialog
      open
      onClose={onClose}
      titleId="song-checkup-title"
      descriptionId="song-checkup-desc"
      size="lg"
      showDragHandle
      dataModal="song-checkup"
      testId="song-checkup-dialog"
    >
      <DialogHeader
        title="Song check-up"
        titleId="song-checkup-title"
        description={
          toFix === 0
            ? 'Nothing to fix. This song is ready to sing.'
            : `${toFix} ${toFix === 1 ? 'thing' : 'things'} to look at. Each has a button to the tool that fixes it.`
        }
        descriptionId="song-checkup-desc"
        onClose={onClose}
        closeLabel="Close the song check-up"
      />
      <ul className="space-y-2.5" data-testid="song-checkup-rows">
        {rows.map((row) => {
          const { Icon, tone, spoken } = LEVELS[row.level];
          return (
            <li
              key={row.id}
              data-level={row.level}
              className="flex items-start gap-3 border-b border-theme-border-subtle py-3"
            >
              <span
                aria-hidden="true"
                className={cn('flex h-9 w-9 shrink-0 items-center justify-center', tone)}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-pretty font-theme-heading text-sm font-semibold text-theme-text">
                  <span className="sr-only">{spoken}: </span>
                  {row.title}
                </h3>
                <p className="text-pretty break-words text-xs leading-relaxed text-theme-text-muted">
                  {row.detail}
                </p>
                {row.action && (
                  <Button
                    size="sm"
                    variant={row.level === 'fix' ? 'primary' : 'secondary'}
                    className="mt-1.5"
                    onClick={() => onAction(row.action as GuideAction)}
                  >
                    {row.actionLabel ?? GUIDE_ACTION_LABELS[row.action]}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onAction('help-fix')} className="sm:mr-auto">
          Not listed? Fix a problem
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
