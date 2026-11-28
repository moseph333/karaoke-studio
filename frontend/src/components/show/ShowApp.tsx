/**
 * The root of a show (`/?show=1`): the host screen behind its own sign-in. It stands in for
 * `App`, which would open the library and the studio.
 *
 * The sign-in takes the studio passphrase or, on a server that has one, the show passphrase
 * a venue's host is given (`useShowAuth`). That one only runs a show, so the screen then has
 * no way back to the songs.
 *
 * A sign-in that ends while the screen is open does not close it: the song on stage keeps
 * playing, a line across the top says what happened, and the host signs in again from there
 * when there is a moment. The address is kept as the host screen's, so a reload made while
 * signed out comes back here and not to the studio's sign-in.
 *
 * Opened with a studio sign-in that would end during the night, it asks for the passphrase
 * first, once: before anybody sings is the moment it costs nothing. (A show sign-in renews
 * itself and is never asked for this way.)
 *
 * One tab runs the show (`useShowHostLock`): a second one, once signed in, says the show is
 * open elsewhere and mounts no host screen, so it writes no queue and sends the stage window
 * nothing until it is told to take the show over.
 */

import React, { useEffect, useState } from 'react';
import { useShowAuth } from '../../hooks/useShowAuth';
import { useShowHostLock } from '../../hooks/useShowHostLock';
import { SHOW_PARAM, isShowUrl } from '../../utils/stageLink';
import { Button } from '../ui';
import { ShowOneHost } from './ShowOneHost';
import { ShowScreen } from './ShowScreen';
import { ShowSignIn } from './ShowSignIn';

export const ShowApp: React.FC = () => {
  const auth = useShowAuth();
  const [asking, setAsking] = useState(false);
  const [carriedOn, setCarriedOn] = useState(false);
  const ended = auth.access === 'ended';
  const early = auth.access === 'open' && auth.endsIn !== null && !carriedOn;
  // Only a tab that is past the sign-in asks for the show: one sitting at the sign-in
  // must not keep it from a tab that could run it
  const host = useShowHostLock(auth.access === 'open' || ended);

  // A show sign-in opens the host screen at the app's own address; without its token that
  // address is the studio's again
  useEffect(() => {
    if (isShowUrl(window.location.search)) return;
    const url = new URL(window.location.href);
    url.searchParams.set(SHOW_PARAM, '1');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  useEffect(() => {
    if (!ended) setAsking(false);
  }, [ended]);

  if (auth.access === 'checking') return null;
  if (auth.access === 'locked') {
    return <ShowSignIn hasShowPassphrase={auth.hasShowPassphrase} onSignIn={auth.signIn} />;
  }
  if (host.turn === 'waiting') return null;
  if (host.turn === 'elsewhere') return <ShowOneHost onTakeOver={host.takeOver} />;
  return (
    <>
      {ended && (
        <div
          role="alert"
          data-testid="show-signed-out"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b-2 border-theme-border bg-theme-bg px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] font-theme-body text-theme-text sm:px-8"
        >
          <p className="min-w-0 flex-1 text-base text-theme-warning">
            The sign-in has ended. What is playing carries on; sign in again to start the next song.
          </p>
          <Button variant="primary" className="min-h-[44px]" onClick={() => setAsking(true)}>
            Sign in again
          </Button>
        </div>
      )}
      <ShowScreen canLeave={auth.studio} session={auth.session} />
      {ended && asking && (
        <ShowSignIn
          hasShowPassphrase={auth.hasShowPassphrase}
          onSignIn={auth.signIn}
          onClose={() => setAsking(false)}
        />
      )}
      {early && (
        <ShowSignIn
          hasShowPassphrase={auth.hasShowPassphrase}
          onSignIn={auth.signIn}
          onClose={() => setCarriedOn(true)}
          endsIn={auth.endsIn}
        />
      )}
    </>
  );
};
