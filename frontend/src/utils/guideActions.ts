/**
 * Guide actions: the places in the studio that guidance (the first-song card, the song
 * check-up, Help's fixes) can take the user to, and the tour that points them all out. `hooks/useGuideActions.ts` carries
 * them out; this file only names them, so the help chunk does not pull in the studio.
 */

export type GuideAction =
  | 'play'
  | 'timeline'
  | 'review-lines'
  | 'find-lyrics'
  | 'realign-all'
  | 'offset'
  | 'duet'
  | 'uncovered-vocals'
  | 'improve-stems'
  | 'mix'
  | 'export'
  | 'checkup'
  | 'help-fix'
  | 'tour';

/** What a button that performs the action says, unless the place it sits in words it. */
export const GUIDE_ACTION_LABELS: Record<GuideAction, string> = {
  play: 'Play the song',
  timeline: 'Open the timeline',
  'review-lines': 'Show the lines to review',
  'find-lyrics': 'Find or paste lyrics',
  'realign-all': 'Re-time every line',
  offset: 'Shift all the timing',
  duet: 'Assign singer parts',
  'uncovered-vocals': 'Go to the vocals without lyrics',
  'improve-stems': 'Re-make the stems',
  mix: 'Open the audio mix',
  export: 'Open export',
  checkup: 'Check this song',
  'help-fix': 'Fix a problem',
  tour: 'Show me around',
};

/** The Help dialog's tabs. */
export type HelpTab = 'shortcuts' | 'features' | 'guide' | 'fix';
