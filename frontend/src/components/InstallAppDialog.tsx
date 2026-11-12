/**
 * Install App Dialog
 *
 * iOS has no install prompt a page can open, so this sheet walks through Safari's
 * Share → Add to Home Screen → Add. It also offers to hide the header's install button for
 * good (the command palette and help keep the entry).
 */

import React from 'react';
import { PlusSquare, Share, Smartphone, SquareCheck } from 'lucide-react';
import { Dialog, DialogFooter, DialogHeader } from './ui/Dialog';
import { Button } from './ui/Button';

export interface InstallAppDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Hides the header button; omitted once it is already hidden. */
  onHideButton?: () => void;
}

const STEPS: { icon: React.ReactNode; text: React.ReactNode }[] = [
  {
    icon: <Share className="h-5 w-5" />,
    text: (
      <>
        Tap <strong className="text-theme-text">Share</strong> in the browser toolbar (on iPhone
        it&apos;s at the bottom; on iPad, at the top).
      </>
    ),
  },
  {
    icon: <PlusSquare className="h-5 w-5" />,
    text: (
      <>
        Scroll down and choose <strong className="text-theme-text">Add to Home Screen</strong>.
      </>
    ),
  },
  {
    icon: <SquareCheck className="h-5 w-5" />,
    text: (
      <>
        Make sure <strong className="text-theme-text">Open as Web App</strong> is on if it&apos;s
        shown, then tap <strong className="text-theme-text">Add</strong>.
      </>
    ),
  },
];

export const InstallAppDialog: React.FC<InstallAppDialogProps> = ({
  isOpen,
  onClose,
  onHideButton,
}) => (
  <Dialog
    open={isOpen}
    onClose={onClose}
    titleId="install-app-title"
    descriptionId="install-app-desc"
    size="md"
    showDragHandle
    testId="install-app-dialog"
  >
    <DialogHeader
      title="Install Karaoke Studio"
      titleId="install-app-title"
      description="Add it to your Home Screen to open it full screen, like an app."
      descriptionId="install-app-desc"
      icon={<Smartphone className="h-5 w-5" />}
      onClose={onClose}
      closeLabel="Close install instructions"
    />
    <ol className="space-y-3">
      {STEPS.map((step, index) => (
        <li key={index} className="flex items-start gap-3 text-sm text-theme-text-muted">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-theme-md bg-theme-accent/15 text-theme-highlight"
          >
            {step.icon}
          </span>
          <span className="pt-2">
            <span className="sr-only">Step {index + 1}: </span>
            {step.text}
          </span>
        </li>
      ))}
    </ol>
    <p className="mt-4 text-xs text-theme-text-muted">
      The installed app keeps its own sign-in, so you may need to enter the studio passphrase once
      more.
    </p>
    <DialogFooter>
      {onHideButton && (
        <Button
          variant="ghost"
          onClick={() => {
            onHideButton();
            onClose();
          }}
        >
          Don&apos;t show the install button
        </Button>
      )}
      <Button variant="primary" onClick={onClose}>
        Got it
      </Button>
    </DialogFooter>
  </Dialog>
);
