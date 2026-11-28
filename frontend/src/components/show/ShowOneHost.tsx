/**
 * What a second host tab shows: the show is being run from another tab of this browser
 * (`hooks/useShowHostLock`). It has nothing of the show on it, so nothing here can change the
 * queue; "Run the show here" takes the show over, and the other tab then shows this.
 */

import React from 'react';
import { Button } from '../ui';

export interface ShowOneHostProps {
  onTakeOver: () => void;
}

export const ShowOneHost: React.FC<ShowOneHostProps> = ({ onTakeOver }) => (
  <main
    data-testid="show-elsewhere"
    className="flex min-h-screen flex-col items-start justify-center gap-5 bg-theme-bg px-4 py-10 font-theme-body text-theme-text sm:px-8"
  >
    <h1 className="ks-display text-balance text-[44px] font-black leading-[0.9] sm:text-[72px]">
      The show is open in another tab
    </h1>
    <p className="max-w-xl text-lg text-theme-text-muted">
      One tab runs the show at a time, so the queue and the stage window have one host. Go back to
      that tab, or run the show from this one: the queue comes with it, and a song that is playing
      can be resumed.
    </p>
    <Button variant="primary" size="lg" className="min-h-[44px]" onClick={onTakeOver}>
      Run the show here
    </Button>
  </main>
);
