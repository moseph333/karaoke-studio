/**
 * The stage window's cards: what the room sees when no song is on. Without a show it is the
 * app's name; a show names the night and who is coming up, and calls the next singer.
 */

import React from 'react';
import type { StageBilling } from '../../utils/stageLink';

const card = 'flex h-full flex-col items-center justify-center gap-6 px-10 text-center';
const label = 'text-xl font-semibold text-theme-text-muted sm:text-2xl';

const songOf = (billing: StageBilling) =>
  billing.artist ? `${billing.title} · ${billing.artist}` : billing.title;

/** Who is coming up after the singer the card is about. */
const ComingUp: React.FC<{ heading: string; next: StageBilling[] }> = ({ heading, next }) =>
  next.length === 0 ? null : (
    <div data-testid="stage-coming-up" className="mt-4 flex max-w-4xl flex-col items-center gap-2">
      <p className={label}>{heading}</p>
      <ol className="flex flex-col gap-1">
        {next.map((billing, index) => (
          <li key={index} className="text-2xl text-theme-text sm:text-3xl">
            <span className="font-semibold">{billing.singer}</span>
            <span className="text-theme-text-muted"> · {billing.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );

export const StudioIdleCard: React.FC = () => (
  <div className={card} data-testid="stage-idle">
    <h1 className="ks-display text-[64px] font-black text-theme-text sm:text-[128px]">
      Karaoke Studio
    </h1>
    <p className="max-w-xl text-lg text-theme-text-muted">
      Open a song in the studio and its stage shows here.
    </p>
  </div>
);

export const ShowIdleCard: React.FC<{ title: string; next: StageBilling[] }> = ({
  title,
  next,
}) => (
  <div className={card} data-testid="stage-show-idle">
    <h1 className="ks-display text-balance text-[64px] font-black text-theme-text sm:text-[128px]">
      {title}
    </h1>
    {next.length === 0 ? (
      <p className={label}>Tell the host what you want to sing.</p>
    ) : (
      <ComingUp heading="Coming up" next={next} />
    )}
  </div>
);

export const UpNextCard: React.FC<{ title: string; now: StageBilling; next: StageBilling[] }> = ({
  title,
  now,
  next,
}) => (
  <div className={card} data-testid="stage-up-next">
    <p className={label}>{title} · Up next</p>
    <h1 className="ks-display text-balance text-[72px] font-black text-theme-text sm:text-[144px]">
      {now.singer}
    </h1>
    <p className="max-w-5xl text-balance text-3xl text-theme-text sm:text-5xl">{songOf(now)}</p>
    <ComingUp heading="Then" next={next} />
  </div>
);
