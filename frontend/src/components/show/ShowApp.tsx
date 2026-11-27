/**
 * The root of a show (`/?show=1`): the sign-in the app uses, then the host screen. It stands
 * in for `App`, which would open the library and the studio.
 */

import React from 'react';
import { AuthModal } from '../AuthModal';
import { useStudioAuth } from '../../hooks/useStudioAuth';
import { ShowScreen } from './ShowScreen';

export const ShowApp: React.FC = () => {
  const auth = useStudioAuth();
  return (
    <>
      {/* Signing in mounts the screen afresh, so what a signed-out request missed is asked again */}
      {!auth.isAuthLocked && <ShowScreen key={auth.authToken} />}
      <AuthModal
        isOpen={auth.showAuthModal}
        onSuccess={auth.handleAuthSuccess}
        requirePassword={auth.authRequired}
      />
    </>
  );
};
