/**
 * Install-as-app state for the UI: whether the studio can be installed here, how (the
 * browser's own sheet or the iOS share menu), and an `install()` that does the right thing,
 * opening the iOS steps dialog through `onShowIosSteps`.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  getInstallSnapshot,
  installPlatform,
  InstallPlatform,
  promptInstall,
  readInstallButtonHidden,
  subscribeInstall,
  writeInstallButtonHidden,
} from '../utils/installPrompt';

export interface UseInstallPromptReturn {
  platform: InstallPlatform;
  isInstalled: boolean;
  /** Installing is possible from this browser right now. */
  canInstall: boolean;
  /** The header shows its install button (installable and not hidden by the user). */
  showHeaderButton: boolean;
  install: () => void;
  hideHeaderButton: () => void;
}

export function useInstallPrompt(onShowIosSteps: () => void): UseInstallPromptReturn {
  const state = useSyncExternalStore(subscribeInstall, getInstallSnapshot, getInstallSnapshot);
  const [buttonHidden, setButtonHidden] = useState(readInstallButtonHidden);
  const platform = installPlatform(state);
  const canInstall = !state.isInstalled && platform !== 'other';

  const install = useCallback(() => {
    if (getInstallSnapshot().canPrompt) {
      void promptInstall();
    } else {
      onShowIosSteps();
    }
  }, [onShowIosSteps]);

  const hideHeaderButton = useCallback(() => {
    writeInstallButtonHidden(true);
    setButtonHidden(true);
  }, []);

  return {
    platform,
    isInstalled: state.isInstalled,
    canInstall,
    showHeaderButton: canInstall && !buttonHidden,
    install,
    hideHeaderButton,
  };
}
