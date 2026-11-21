/**
 * Fix a problem: what a user is likely to say is wrong with a song, why it happens and the
 * steps that fix it. Help's "Fix a problem" tab lists these, with a button for each action
 * while a song is open. The README's "When results are off" table says the same in short;
 * keep the two in step by hand.
 */

import type { GuideAction } from './guideActions';

export interface Problem {
  id: string;
  /** The symptom, as the user would put it. */
  symptom: string;
  /** Why it happens, when that helps choose a fix. */
  why?: string;
  steps: string[];
  /** Places in the studio the steps lead to. */
  actions: GuideAction[];
}

export const PROBLEMS: Problem[] = [
  {
    id: 'no-lyrics',
    symptom: 'There are no lyrics',
    why: 'No lyrics listing matched the song’s title and artist. It happens with rare songs and with titles that carry extras such as “Official Video”.',
    steps: [
      'Press Re-import in the timeline.',
      'Search again with a simpler title or the original artist, or paste the lyrics yourself as plain text or an .lrc file.',
      'Pasted words are timed to the singing for you.',
    ],
    actions: ['find-lyrics'],
  },
  {
    id: 'wrong-lyrics',
    symptom: 'The lyrics are for another song, or another version of it',
    why: 'Lyrics are looked up by title and artist, so a live take, a remix or a cover can pick up the studio version’s words.',
    steps: [
      'If the song’s title or artist is wrong, fix it first with the pencil next to the title.',
      'Press Re-import, open “Re-query LRCLIB” and search. Each listing says whether it is word-timed and flags sloppy transcriptions.',
      'Preview a listing, then apply the one that matches what is sung.',
    ],
    actions: ['find-lyrics'],
  },
  {
    id: 'all-off',
    symptom: 'The words light up early or late through the whole song',
    steps: [
      'Press Offset in the timeline and shift every line earlier or later. Start with 0.1 to 0.5 seconds.',
      'If the gap changes as the song goes on, re-time every line instead. Lines you timed by hand are kept.',
    ],
    actions: ['offset', 'realign-all'],
  },
  {
    id: 'part-off',
    symptom: 'One part is out of time',
    steps: [
      'Press “Needs review” above the timeline to see only the lines the studio is unsure about.',
      'Open a line’s menu (⋯) and choose “Re-align this line”.',
      'Or nudge the line with its arrows, or expand it to move single words.',
      'For a long stretch, use Tap sync: play the song and tap as each line starts.',
    ],
    actions: ['review-lines'],
  },
  {
    id: 'missing-parts',
    symptom: 'Some sung parts have no words',
    why: 'Lyrics often write a repeated chorus once. The studio adds the repeats it can hear and lists the rest above the timeline as “Vocals without lyrics”.',
    steps: [
      'Press a time in that notice to hear the part.',
      'Add a line there (a line’s ⋯ menu, Insert below) and type the words.',
      'Choose “Re-align this line” to time them.',
    ],
    actions: ['uncovered-vocals'],
  },
  {
    id: 'singer-audible',
    symptom: 'I can still hear the singer',
    why: 'Either the guide vocal is turned up, or the separation left some of the voice in the backing track. Fast quality leaves the most.',
    steps: [
      'In Audio mix, set Guide vocal to Off.',
      'Still there? Press Improve next to Stems and pick Balanced or Best. The song stays playable while the stems are re-made.',
    ],
    actions: ['mix', 'improve-stems'],
  },
  {
    id: 'keep-backing',
    symptom: 'I want the backing vocals left in',
    why: 'The harmonies leave with the lead singer because they are one stem, until the vocals are split into lead and backing.',
    steps: [
      'In Audio mix, press Split next to Backing vocals. The song stays playable while it runs.',
      'Raise the Backing vocals level and leave Guide vocal at Off.',
    ],
    actions: ['mix'],
  },
  {
    id: 'thin-backing',
    symptom: 'The backing track sounds thin or watery',
    why: 'Separation takes a little of the music away with the voice, most on dense mixes and at Fast quality.',
    steps: [
      'Re-make the stems at a better quality.',
      'If you have the real instrumental, use Replace next to Instrumental in Audio mix.',
    ],
    actions: ['improve-stems', 'mix'],
  },
  {
    id: 'fell-back',
    symptom: 'I asked for Best quality and got Fast',
    why: 'When the better model cannot run (the cloud GPU is busy or unreachable, the model is not installed, there is too little memory) the studio falls back so you still get a song.',
    steps: [
      'Open the song check-up: it says which quality was used and why.',
      'Re-make the stems later, when the better model can run.',
    ],
    actions: ['checkup', 'improve-stems'],
  },
  {
    id: 'duet',
    symptom: 'It is a duet, but every line has the same colour',
    why: 'A song is split between two singers only when their voices are clearly different.',
    steps: [
      'Press Duet parts in the timeline.',
      'Try By Voice first. If it finds one voice, use Alternating, or set lines one by one with the singer chip on each line.',
      'Name the singers with the pencil next to the song title.',
    ],
    actions: ['duet'],
  },
  {
    id: 'keep-partner',
    symptom: 'I want my duet partner’s voice left in',
    why: 'The studio can keep one singer and remove the other when it knows who sings what: from the singer of each lyric line, or from a split of a male and a female voice.',
    steps: [
      'Give each line its singer with Duet parts in the timeline.',
      'In Audio mix, choose By singer under Lead by singer, turn your own part down and your partner’s up.',
      'If a man and a woman sing at the same time, choose Male / female there instead and press Split.',
    ],
    actions: ['duet', 'mix'],
  },
  {
    id: 'key',
    symptom: 'The song is too high or too low for me',
    steps: [
      'In Audio mix, shift the key up or down. The tempo stays the same.',
      '“Suggest a key for my voice” picks a key from the song’s vocal range.',
    ],
    actions: ['mix'],
  },
  {
    id: 'search-misses',
    symptom: 'The search does not list my song, or lists another version',
    why: 'The songs come from two music catalogs, which do not carry every recording, and one song often has several versions: the album cut, a single edit, live takes, remixes and covers.',
    steps: [
      'Add the artist to the title, or type a line of the lyrics. Small typos are fine.',
      'Tell versions apart by the album, the year, the length and the badge (Live, Remix, Edit), and tap the artwork to hear 30 seconds.',
      'The list starts with the five best matches; Show more songs lists the rest.',
      'Search YouTube uploads, under the songs, lists videos of a recording the catalogs do not have.',
      'Or paste a link to the song, or add your own audio under Local Audio File.',
    ],
    actions: [],
  },
  {
    id: 'processing-failed',
    symptom: 'Processing failed, or seems stuck',
    why: 'Most failures are the download: the song is private, age-restricted, blocked where the server is, or was removed, the site wants a sign-in (most Vimeo videos do), or a song picked from the search (or a Spotify, Apple Music, TIDAL or Deezer link) has no matching upload on YouTube. A server restart also stops a song.',
    steps: [
      'Open the failed song from the library and press Try again.',
      'If it fails the same way, search for the song again and pick one of the YouTube uploads listed under the songs, paste another copy of it (YouTube, SoundCloud, Bandcamp, Vimeo or Internet Archive), or download the audio yourself and add it under Local Audio File.',
      'A live stream or a recording longer than the server allows (an hour unless it was changed) is refused: paste a video of the song alone, not a concert. A whole album is fine: the studio lists its songs and you pick the ones to make.',
      'A song picked from a whole album is cut out of the album again by Try again.',
      'A song made from an uploaded file has no Try again: upload the file again from New Song.',
      'A server’s first Balanced or Best song downloads its model once, which can take several minutes with little progress.',
      'You can leave the page: the song keeps processing and waits in the library.',
    ],
    actions: [],
  },
  {
    id: 'render-failed',
    symptom: 'The video render failed, or takes very long',
    why: 'A render draws the lyric sweep for every frame, so most songs take a few minutes. A cloud render that fails or finds no free machine is rendered on your server instead.',
    steps: [
      'Open Export and press Try Again.',
      'You can close the Export dialog while it renders: the header shows the progress.',
      'A failed or cancelled render keeps the previous video.',
    ],
    actions: ['export'],
  },
  {
    id: 'youtube-upload',
    symptom: 'I don’t know how to get the video onto YouTube',
    why: 'The studio makes the video and writes its title, description and tags; the upload itself happens on YouTube.',
    steps: [
      'Open Export and render the video, then download it.',
      'Follow “Upload to YouTube” under the finished video: it gives you the title, the description (with chapters and lyrics) and the tags to paste, in order.',
      'Publish as Unlisted first, watch it through, then make it Public.',
      'YouTube may put a copyright claim on a song it recognises. Upload only songs you have the right to share.',
    ],
    actions: ['export'],
  },
  {
    id: 'job-failed',
    symptom: 'Re-timing the lyrics or re-making the stems failed',
    why: 'Only one job runs on a song at a time, and a server restart stops the one that is running. The song keeps its previous timing and stems, so nothing is lost.',
    steps: [
      'Open the song check-up for the reason.',
      'Wait for any running job to finish, then start it again.',
    ],
    actions: ['checkup'],
  },
];

/** The first-song steps, as Help's usage guide spells them out. */
export const FIRST_SONG_STEPS: { title: string; text: string }[] = [
  {
    title: 'Play and sing',
    text: 'Press Space or the play button. The words light up as they are sung.',
  },
  {
    title: 'Check lyrics',
    text: 'The check-up button next to the song title counts what looks off and takes you to each fix.',
  },
  {
    title: 'Set your key',
    text: 'In Audio mix, shift the key to your range and turn the guide vocal up or down.',
  },
  {
    title: 'Make a video',
    text: 'Export renders a 1080p karaoke video, or gives you subtitle files and the stems.',
  },
];
