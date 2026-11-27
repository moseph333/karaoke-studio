/**
 * The root of a show (`/?show=1`): the host screen behind its own sign-in. It stands in for
 * `App`, which would open the library and the studio.
 *
 * The sign-in takes the studio passphrase or, on a server that has one, the show passphrase
 * a venue's host is given (`useShowAuth`). That one only runs a show, so the screen then has
 * no way back to the songs.
 */

import React from 'react';
import { useShowAuth } from '../../hooks/useShowAuth';
import { ShowScreen } from './ShowScreen';
import { ShowSignIn } from './ShowSignIn';

export const ShowApp: React.FC = () => {
  const auth = useShowAuth();
  if (auth.access === 'checking') return null;
  if (auth.access === 'locked') {
    return <ShowSignIn hasShowPassphrase={auth.hasShowPassphrase} onSignIn={auth.signIn} />;
  }
  return <ShowScreen canLeave={auth.studio} />;
};
