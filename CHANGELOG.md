# Changelog

## [2.15.0](https://github.com/moseph333/karaoke-studio/compare/v2.14.0...v2.15.0) (2026-11-27)


### Features

* **admin:** add the server settings page ([0f79695](https://github.com/moseph333/karaoke-studio/commit/0f796956c4939d569912591e9e72e308fe407ac5))
* **admin:** unlock server settings with an admin passphrase ([5282f5a](https://github.com/moseph333/karaoke-studio/commit/5282f5af813956b6154a6922598effc00af73e52))
* **server:** let saved settings override the environment ([3e89484](https://github.com/moseph333/karaoke-studio/commit/3e8948450b5670eff5a39ab498cd268320c44d6d))
* **show:** ask for a song the show could not find ([57e2bc2](https://github.com/moseph333/karaoke-studio/commit/57e2bc2a711216745e873575d1796c3b4fd22267))
* **show:** drag a singer to another place in the queue ([0d73b55](https://github.com/moseph333/karaoke-studio/commit/0d73b555acd1e6fa8b736469033d08b4f324a3a7))
* **show:** give a venue a passphrase that only runs the show ([ab772f2](https://github.com/moseph333/karaoke-studio/commit/ab772f24ddc6443225a0ad7777ac8ae2e592ea41))
* **show:** run a karaoke night from a queue ([0fa18cf](https://github.com/moseph333/karaoke-studio/commit/0fa18cf6457cfc350afb2312ed12b3054da8791a))
* **show:** show the stage's video on the host screen without sound ([e934d0b](https://github.com/moseph333/karaoke-studio/commit/e934d0ba5e65aedd85d8ec166a27c5d02596842d))
* **stage:** show the stage in a second window ([1ca030b](https://github.com/moseph333/karaoke-studio/commit/1ca030bb56170c9b4bb03aac829bcca1d73cbb35))
* **stems:** choose which quality presets a server offers ([096e231](https://github.com/moseph333/karaoke-studio/commit/096e231b776875d820233340325ed31fe3b1c6c1))


### Bug Fixes

* **intake:** start a failed song again with the lyrics pasted for it ([54ddb38](https://github.com/moseph333/karaoke-studio/commit/54ddb3861dc8b0b00dd63f9cb12f1bbdd27bfbc7))
* **intake:** stop text fields at the lengths the server accepts ([13c1652](https://github.com/moseph333/karaoke-studio/commit/13c16525ba7491fc2b0a761c6af982bcc1389ed0))
* **show:** clear the song search once a singer is queued ([13985ff](https://github.com/moseph333/karaoke-studio/commit/13985ff52e89ddb63d721266d99bd50573c3f17d))
* **stage:** delete an uploaded background the studio has replaced or removed ([fac45b7](https://github.com/moseph333/karaoke-studio/commit/fac45b76c3326d03e507d2a5145e5437f957b6d4))

## [2.14.0](https://github.com/moseph333/karaoke-studio/compare/v2.13.0...v2.14.0) (2026-11-25)


### Features

* **cloud:** make a looping background video from a song's lyrics on the gpu ([65ff0d0](https://github.com/moseph333/karaoke-studio/commit/65ff0d0c5ebd632c5ecec598e3ada5239d07ddb0))
* **export:** draw exported videos in the five new looks ([bc457b8](https://github.com/moseph333/karaoke-studio/commit/bc457b8c2a283b0a235fa6066a05d5e1f4baa845))
* **export:** say that the .ass download is laid out for the look's typeface ([c1f6fce](https://github.com/moseph333/karaoke-studio/commit/c1f6fce6e3b5946c87ab3d4956988739d3c5d3c8))
* **guide:** show a tour of the studio from the first-song card ([4a12266](https://github.com/moseph333/karaoke-studio/commit/4a12266c8b3561550ffb473b9351bb0ca0961481))
* **help:** list what you can do and point at each control ([da6b850](https://github.com/moseph333/karaoke-studio/commit/da6b8500aa9b0a1137920e6ad73a9e0556883d8e))
* **home:** show a short tour of the home screen ([ed89edd](https://github.com/moseph333/karaoke-studio/commit/ed89edd0a37bd2dadf38d45145d80afb17936359))
* **look:** choose best or fast when making a song loop ([c012402](https://github.com/moseph333/karaoke-studio/commit/c012402f5000d8a3b5a681c95f8991850fa134ef))
* **look:** make a song loop from the look panel and show it on the stage ([a3782aa](https://github.com/moseph333/karaoke-studio/commit/a3782aac4e4b943efd278d28ef68c95f7ecb574d))
* **loops:** make a song's loop as a background job on the cloud gpu ([4460564](https://github.com/moseph333/karaoke-studio/commit/44605642c36892e9414615a8b9085f64050d4911))
* **palette:** start the tour or find a feature by typing ([6d3c1e5](https://github.com/moseph333/karaoke-studio/commit/6d3c1e54e87f15013ae7f2f56d6d1ddd3a41d556))
* **render:** draw the song's loop behind the lyrics of an export ([4ac8eca](https://github.com/moseph333/karaoke-studio/commit/4ac8eca0397f3b0d080a6fed0d666476a75ddd4b))
* **stage:** serve the cover art the way a look treats it ([5ff8242](https://github.com/moseph333/karaoke-studio/commit/5ff8242e513a26709bfca16c1ed00b0ac990bbae))
* **stage:** show the video's frame on the stage, in five looks ([25e9491](https://github.com/moseph333/karaoke-studio/commit/25e949101707486e88b2faf6b5a60dc06f7c580d))


### Bug Fixes

* **cloud:** ask for a fixed camera, so a song loop repeats without a double image ([e074061](https://github.com/moseph333/karaoke-studio/commit/e074061fba8421e1883c85809433c0171f879d78))
* **cloud:** get a song loop through its last two steps on the cloud gpu ([4f2d409](https://github.com/moseph333/karaoke-studio/commit/4f2d40954c00e00c9a5755941777cb3361b2dbe5))
* **cloud:** keep the model libraries' progress bars out of a song loop's progress ([5605118](https://github.com/moseph333/karaoke-studio/commit/5605118ef69d8d8a39561eee5ed60de74ee2434a))
* **cloud:** make song loops only on gpus they are known to fit ([396094c](https://github.com/moseph333/karaoke-studio/commit/396094cd0428604fc102263f1f19c42c95b3aab2))
* **cloud:** take a song title that begins with a dash as the title ([506f39c](https://github.com/moseph333/karaoke-studio/commit/506f39c55052940f298a95a4dd101d33c2e73113))
* **export:** give a very long line more rows instead of running it off the frame ([44c1901](https://github.com/moseph333/karaoke-studio/commit/44c19010e3afa6303dee4ba5d0ac517615f5c83a))
* **export:** keep the end card up to the video's last frame ([7761a99](https://github.com/moseph333/karaoke-studio/commit/7761a99b9aa0646811ea0033601cad909d643c4a))
* **export:** show what starts with the song from the video's first frame ([24bf222](https://github.com/moseph333/karaoke-studio/commit/24bf22263525572d049ddc86c670cb295cbaabc0))
* **look:** show each look's sample as a strip of the frame that can be read ([a212706](https://github.com/moseph333/karaoke-studio/commit/a2127064405a4a35a45b2c9fce806cd79506c67b))
* **pwa:** leave font files out of the service worker's asset cache ([becab7c](https://github.com/moseph333/karaoke-studio/commit/becab7cf77622597b27c1f0bab99b73238130db9))
* **render:** draw a look's lyrics on frames in the video's own colour format ([12b6fef](https://github.com/moseph333/karaoke-studio/commit/12b6fef4bd643696941d3adb24c751f105d393e8))
* **render:** draw the visualizer's bars in the look's colour ([d303364](https://github.com/moseph333/karaoke-studio/commit/d303364698399b610991e4caddc650c21d76a984))
* **stage:** count the toolbar in the stage's height and fit a 9:16 frame on a phone ([b4131cb](https://github.com/moseph333/karaoke-studio/commit/b4131cb6b066b9da3ab25c971a839657ab849dd5))
* **stage:** keep the visualizer under the lyrics, in the band the video draws it in ([4971ca6](https://github.com/moseph333/karaoke-studio/commit/4971ca67d5f7206ca6005fa5a408ecf3d92fd83a))
* **stage:** light as much of a word as the video does ([8737df6](https://github.com/moseph333/karaoke-studio/commit/8737df636970a4c5e659a7e29479b4fe5396fb2b))

## [2.13.0](https://github.com/moseph333/karaoke-studio/compare/v2.12.0...v2.13.0) (2026-11-22)


### Features

* **album:** list an album's songs as numbered rows with one yellow action ([9ccd4f3](https://github.com/moseph333/karaoke-studio/commit/9ccd4f38fffd849c526f6fa286c7239d9a2b11db))
* **auth:** open the sign-in dialog on a marquee title instead of a lock tile ([af0e95b](https://github.com/moseph333/karaoke-studio/commit/af0e95b6cb4a8ef8f9b45baa8d39540a1bfd461a))
* **copy:** name controls for what they do, in plain words ([820318f](https://github.com/moseph333/karaoke-studio/commit/820318f4b429ac1ba5195c3b218d70a5fa98c27d))
* **dialogs:** give dialogs a bare title, text tabs and plain rows ([88438d6](https://github.com/moseph333/karaoke-studio/commit/88438d6345d3a4e39937fb179c4e9468cbcb2414))
* **dialogs:** take the remaining filled boxes out of the small dialogs and menus ([371311f](https://github.com/moseph333/karaoke-studio/commit/371311fca46dc5266b444c282ef83894c2c5348d))
* **export:** lay the export dialog out as sections under rules, in plain words ([cba858a](https://github.com/moseph333/karaoke-studio/commit/cba858a30a47674797eb1a753f367e7ed06ad9cd))
* **fonts:** set the interface in sofia sans ([0284ec3](https://github.com/moseph333/karaoke-studio/commit/0284ec31b30afd8acfd22d7dfe8bf82d672a16d3))
* **help:** say how to keep backing vocals or a duet partner in ([7f2fd3b](https://github.com/moseph333/karaoke-studio/commit/7f2fd3b6dc3b0adb6ca73f80aff1dd1e66dd123e))
* **home:** rebuild the home screen, song list and top bar as a marquee ([2be5a66](https://github.com/moseph333/karaoke-studio/commit/2be5a6623c06f67ce2aea1ba564a25f334176af8))
* **mix:** lay the inspector out as sections under a rule ([19d0be3](https://github.com/moseph333/karaoke-studio/commit/19d0be3a0aef7d2d7149bb7279e87355a2760731))
* **mix:** set a level for each vocal part and each singer's lines ([b397086](https://github.com/moseph333/karaoke-studio/commit/b39708620967bcf6376d3249d6b719c59cde2d19))
* **processing:** show progress as one large numeral and say what the song is doing ([93419c6](https://github.com/moseph333/karaoke-studio/commit/93419c6d1e5e2c5964e2cf3ae2eb115752d4a70a))
* **pwa:** redraw the app icon, shortcut icons and offline page ([5d96993](https://github.com/moseph333/karaoke-studio/commit/5d969933ed8481788144bb787bab5a710f5fad68))
* **pwa:** show the new look in the link preview and the install screenshots ([61048d8](https://github.com/moseph333/karaoke-studio/commit/61048d86a5c8d51e59e9fa7381f5e18e7af6ae5b))
* **separation:** let the worker pick its two stems by tag ([3e560d7](https://github.com/moseph333/karaoke-studio/commit/3e560d7a449d0d7096e822dea47f3215f4332034))
* **stage:** remove the live preview badge from the stage ([bd634b6](https://github.com/moseph333/karaoke-studio/commit/bd634b60c1edabcff50e16993db5540bc16c7588))
* **stems:** split a song's vocals into lead and backing parts ([36a5de8](https://github.com/moseph333/karaoke-studio/commit/36a5de88d20244a4636889f200211399b80476b6))
* **stems:** split the lead into a male and a female voice ([2e05c29](https://github.com/moseph333/karaoke-studio/commit/2e05c2945f1f53026328650c4a99ff5a7deb6a9b))
* **stems:** split the vocals of a finished song as a background job ([aaded5d](https://github.com/moseph333/karaoke-studio/commit/aaded5d180859d990f5492ab3cd4e81a5b2fdd8b))
* **studio:** call the phone's third tab "Mix & Look" ([bbc1895](https://github.com/moseph333/karaoke-studio/commit/bbc189575b167c3f95c97372ed3209d21fbdb68e))
* **studio:** keep backing vocals or a duet partner in the mix ([294ffc7](https://github.com/moseph333/karaoke-studio/commit/294ffc78f9d6b72903e434eb77ae1fe0cbe99ce6))
* **studio:** keep the male or the female voice of a duet in the mix ([7d21241](https://github.com/moseph333/karaoke-studio/commit/7d21241d6c24687e0fcf0eae6d8cbd6a27c7a3ad))
* **studio:** set the song header in marquee capitals and rule off the inspector ([d0091a8](https://github.com/moseph333/karaoke-studio/commit/d0091a8171f007ce38dc6716a92c0ded6ec5f12d))
* **studio:** split lead and backing vocals from the audio mix panel ([de46376](https://github.com/moseph333/karaoke-studio/commit/de463762b492b278806123a7977847c2dc2f2e61))
* **theme:** marquee colours, square corners and no shadows ([8cbf824](https://github.com/moseph333/karaoke-studio/commit/8cbf8241cde199f4150b09717864c7a0cc76848e))
* **theme:** retire the app themes and style the app from the stylesheet alone ([58608b4](https://github.com/moseph333/karaoke-studio/commit/58608b4c53abe78ea20ba2c9ac8e3990ddf67aee))
* **timeline:** light the word being sung and take the boxes out of the timeline's dialogs ([d8802c0](https://github.com/moseph333/karaoke-studio/commit/d8802c04f3b91b007a2ae41a3278b83a869347e4))
* **timeline:** list lyric lines as numbered rows and light the one being sung ([a787493](https://github.com/moseph333/karaoke-studio/commit/a7874932a8185e0d53bff5d232a526f0d00998cd))
* **timeline:** show tap sync as a lit band and the word editor as words over their times ([1e690d3](https://github.com/moseph333/karaoke-studio/commit/1e690d3a82ac7ed2a07f63d6dbf456b12d2efd61))
* **transport:** show the time in marquee numerals beside a square play block ([dc0017d](https://github.com/moseph333/karaoke-studio/commit/dc0017d4e9a16092f31e754e68f76900d68e8826))
* **ui:** draw checkboxes as squares and outline every field in the text colour ([612857c](https://github.com/moseph333/karaoke-studio/commit/612857c921c74392350218ab5e61581e6a46b184))
* **ui:** drop gradients, glow, blur, tints and rounded shapes from every screen ([c8a9ed2](https://github.com/moseph333/karaoke-studio/commit/c8a9ed2ada79fdeee015fae65927adc1abf9e63b))
* **ui:** set small labels in sentence case and nothing under 13px ([16e8ea0](https://github.com/moseph333/karaoke-studio/commit/16e8ea04aa67a84e5aa35700bd2901487949794a))
* **ui:** solid primary buttons and flat badges, without gradient variants ([5116929](https://github.com/moseph333/karaoke-studio/commit/5116929a1abfd4a14ca3e0cb6cb24a2cae281743))

## [2.12.0](https://github.com/moseph333/karaoke-studio/compare/v2.11.0...v2.12.0) (2026-11-19)


### Features

* **intake:** find the songs in a whole-album link or upload ([a65c790](https://github.com/moseph333/karaoke-studio/commit/a65c790d3005219f590986c12d5bb08769bb1f34))
* **studio:** pick the songs to make from a whole album ([e17ae48](https://github.com/moseph333/karaoke-studio/commit/e17ae4812db0e00f75023dcbd3745585cc2d5c4d))


### Bug Fixes

* **lyrics:** keep another artist's like-named song from replacing the song's own lyrics ([19b7463](https://github.com/moseph333/karaoke-studio/commit/19b746315d1e156729f40f43671d3ec9458026d0))
* **sync:** start a song's first lines where they are sung, not on the intro's stage talk ([15f579f](https://github.com/moseph333/karaoke-studio/commit/15f579fcb11e6fb5b173ddcab0a5914cc8b4c42c))

## [2.11.0](https://github.com/moseph333/karaoke-studio/compare/v2.10.1...v2.11.0) (2026-11-19)


### Features

* **help:** say what to do when the search misses a song ([4e96308](https://github.com/moseph333/karaoke-studio/commit/4e963085a9c76cfb4d998d7ddcf1974670a143dc))
* **links:** make karaoke from a deezer song link ([e374aa6](https://github.com/moseph333/karaoke-studio/commit/e374aa6112aa9080f2cf7d1fd4e5398807f0c2f1))
* **search:** find songs by name in the music catalogs, typos and all ([3a3d47f](https://github.com/moseph333/karaoke-studio/commit/3a3d47f13ef733eb79d070945fca326b6643e0c3))
* **search:** list songs under the search box as you type ([65912e6](https://github.com/moseph333/karaoke-studio/commit/65912e69c976981bcd72c8497120b7ad1d6d298c))


### Bug Fixes

* **help:** cover refused live streams, over-long recordings and failed uploads in "Fix a problem" ([b6b7cd3](https://github.com/moseph333/karaoke-studio/commit/b6b7cd3d3ffe25e529ba3282db0feee725359450))
* **help:** list the search problem beside the other intake problem ([d98cb20](https://github.com/moseph333/karaoke-studio/commit/d98cb206d002192fef325dd1054c8420552ce98f))
* **intake:** fit the search box's placeholder and shorten the phone hint ([9c8a426](https://github.com/moseph333/karaoke-studio/commit/9c8a426a499571afd9f481934eb1c6b98650a85a))
* **search:** keep another version from being marked as the library's song ([6a85044](https://github.com/moseph333/karaoke-studio/commit/6a850443b3d1180e59aaa5eeca8b9c28d52db0af))

## [2.10.1](https://github.com/moseph333/karaoke-studio/compare/v2.10.0...v2.10.1) (2026-11-18)


### Bug Fixes

* **chords:** spell a transposed b chord with sharps in the studio too ([5c873db](https://github.com/moseph333/karaoke-studio/commit/5c873db9e79d5bc95e1218b7b334d8c3490d2916))
* **chords:** spell a transposed b chord with sharps when no key says otherwise ([bf1efe2](https://github.com/moseph333/karaoke-studio/commit/bf1efe22144398b5417a134761e2cf09445652af))
* **chords:** treat chords the server replaces as saved ([253eac5](https://github.com/moseph333/karaoke-studio/commit/253eac5eef505081d97c662931205257e81997c6))
* **cloud:** fall back to a local run on any error of the modal client ([94480e9](https://github.com/moseph333/karaoke-studio/commit/94480e9ff7ad5ab88694d33cb59710b772d7af4b))
* **cloud:** name the cloud gpu's own time limit when it stops a separation ([0a828b1](https://github.com/moseph333/karaoke-studio/commit/0a828b11edbb1e318b729345a94a786fd9ef55fa))
* **dialog:** keep a dialog open when a drag ends on the backdrop ([42f9bf3](https://github.com/moseph333/karaoke-studio/commit/42f9bf3e7a3980babb5dd022099e4026c5fee96f))
* **download:** never reuse a song whose download stopped part-way ([094f89a](https://github.com/moseph333/karaoke-studio/commit/094f89a43e49c4f71e16c29356599b7f277d75b9))
* **download:** refuse live streams and recordings longer than MAX_SONG_MINUTES ([2c83407](https://github.com/moseph333/karaoke-studio/commit/2c834073ebdedfe99a9058029fbd867e7f753a9a))
* **duet:** let range line numbers be typed without clamping each key ([475b107](https://github.com/moseph333/karaoke-studio/commit/475b107692e276ce854f500f93bb8d78c1501383))
* **errors:** explain a refused live stream or over-long recording ([e10796f](https://github.com/moseph333/karaoke-studio/commit/e10796faf30a01c035722eb85ff5a112be40fef1))
* **errors:** explain an ffmpeg timeout as unreadable audio ([1e9c2db](https://github.com/moseph333/karaoke-studio/commit/1e9c2dba741daf99f6d6eb1770269c0398b1689f))
* **errors:** give a failed upload advice that fits a file ([7dd16c9](https://github.com/moseph333/karaoke-studio/commit/7dd16c97edb79f35458b702b9aaeca98f343fd39))
* **export:** keep the youtube description within 5,000 characters and free of angle brackets ([9cd379c](https://github.com/moseph333/karaoke-studio/commit/9cd379cda8085781d484b1d1c295761b47d4eb0c))
* **export:** only call a description chaptered when it lists chapters ([aa8e1e2](https://github.com/moseph333/karaoke-studio/commit/aa8e1e212e34d86fd4f044a2640d27d7ad22f897))
* **guidance:** open timeline tools on the timeline tab and say why one is unavailable ([5623468](https://github.com/moseph333/karaoke-studio/commit/5623468784f1986948fed13b4a395b3b82e6c5db))
* **input:** leave enter to the input method while it composes text ([5708f19](https://github.com/moseph333/karaoke-studio/commit/5708f1927d11e24bd48399e0434a7edc5d208c32))
* **intake:** keep a restarted song from being marked cancelled by its old run ([77fef75](https://github.com/moseph333/karaoke-studio/commit/77fef750a1feb0115044308b825d191ecb68940f))
* **intake:** make the first mix's preview before taking the store lock ([38dd2ea](https://github.com/moseph333/karaoke-studio/commit/38dd2eab727d8d7d1a16c50c01c0680a7efe55dc))
* **intake:** start a failed song again under its own owner and quality ([0441a69](https://github.com/moseph333/karaoke-studio/commit/0441a691e9a2c0ad5917241734a9c2b9a65f1ac5))
* **intake:** start one pipeline when the same song is submitted twice at once ([74132ec](https://github.com/moseph333/karaoke-studio/commit/74132ec2f5df565f72112d61543e4ecd68a821ab))
* **library:** recover from a song link that cannot be opened ([4ad5488](https://github.com/moseph333/karaoke-studio/commit/4ad54883f82c0263783eb82de432a4ba831e6305))
* **lyrics:** check netease's fuller lyrics against the song's length ([3e12c8e](https://github.com/moseph333/karaoke-studio/commit/3e12c8ed502fccb7341eab36c98bff00cf592f39))
* **lyrics:** drop a translation dumped after a song with no closing timestamp ([2295a89](https://github.com/moseph333/karaoke-studio/commit/2295a89a5768bc8c2b8e761df533277d9118bffe))
* **lyrics:** keep "with" in a song title when looking up lyrics ([ac9a56d](https://github.com/moseph333/karaoke-studio/commit/ac9a56ddb5efc15ef2ae33905e3f290e3d49295d))
* **lyrics:** keep an ad-lib after a japanese line out of its romaji ([429eb7d](https://github.com/moseph333/karaoke-studio/commit/429eb7d27a72efdb698e43d56c873548bed5e52a))
* **lyrics:** keep an lrclib hit when a later lrclib request fails ([93276ab](https://github.com/moseph333/karaoke-studio/commit/93276abed21fb94e8c01a506829912d8a4188e43))
* **lyrics:** keep the right words when a note or marker is cut from a line ([482b362](https://github.com/moseph333/karaoke-studio/commit/482b362aacee0fb6412799f52d99ff6a05efa3ed))
* **lyrics:** prefer this version's plain lyrics over timing for another version ([28600b6](https://github.com/moseph333/karaoke-studio/commit/28600b635e2924eaf35f03f43919614494559333))
* **lyrics:** save lyrics on a song whose length is unknown ([2947ff4](https://github.com/moseph333/karaoke-studio/commit/2947ff4b9872ba0739bd200c8c1d43b8aad63858))
* **lyrics:** start the replace-lyrics search fresh each time it opens ([ea2bda6](https://github.com/moseph333/karaoke-studio/commit/ea2bda6eecc73d59a3452a70eabff4485e4fea5f))
* **lyrics:** stop the cleanup deleting sung words that look like notes ([2496f38](https://github.com/moseph333/karaoke-studio/commit/2496f389cc1207a12f43e60ed64fada1a4fff812))
* **menu:** keep a row's menu open while the page scrolls by itself ([38ac44b](https://github.com/moseph333/karaoke-studio/commit/38ac44b7c6789af04b350daa103484f3d1327751))
* **metadata:** keep typed track details while the library refreshes ([7ea6c3b](https://github.com/moseph333/karaoke-studio/commit/7ea6c3be37fb4176731e4e90f38e13c24ce8d547))
* **palette:** open a song as the server has it now ([6a24a52](https://github.com/moseph333/karaoke-studio/commit/6a24a5241dfd98a8b265dba904f422f49a1fa4f1))
* **pwa:** keep the service worker away from api and media pages ([b2a8999](https://github.com/moseph333/karaoke-studio/commit/b2a8999ab4bdf7cdca37d9b3b17111335841d409))
* **render:** export from a folder with an apostrophe in its name ([434657e](https://github.com/moseph333/karaoke-studio/commit/434657e0202bde56fe4bc4c1983529c672c3bb4a))
* **render:** give a long song's pitch-shifted export mix time to finish ([58cd85a](https://github.com/moseph333/karaoke-studio/commit/58cd85a9cb5654a1b68760e75b62759c9e8bc7f8))
* **render:** read ffmpeg's output leniently in a local render ([c6a2822](https://github.com/moseph333/karaoke-studio/commit/c6a2822dbd1b952d8028ef0cec91170d17f04505))
* **render:** render an export requested right after a cancel ([4995c10](https://github.com/moseph333/karaoke-studio/commit/4995c1079b427e9d4e783dd6196fec769488dd30))
* **search:** ignore clicks on search results while a song is starting ([f9ec678](https://github.com/moseph333/karaoke-studio/commit/f9ec678610b0e0a957e8a05b801674031583eb1e))
* **server:** answer cors preflights when a passphrase is set ([8436c42](https://github.com/moseph333/karaoke-studio/commit/8436c42e7d9b264b02b2627b5e117d3244c10e1e))
* **server:** read APP_VERSION from .env and ask git for the version once per process ([31776a2](https://github.com/moseph333/karaoke-studio/commit/31776a22457fb5289f66d6a35b1b60d1ce9575bf))
* **shortcuts:** go to line 1 on "next lyric line" during the intro ([7df672d](https://github.com/moseph333/karaoke-studio/commit/7df672d1d0074f17316911f805c170089b2c42b3))
* **shortcuts:** keep undo from reaching the studio behind an open dialog ([a650c4b](https://github.com/moseph333/karaoke-studio/commit/a650c4b47eb713c0659911cac72a2efbbf31dc39))
* **stage:** show the player's real volume in the fullscreen controls ([ce3f93a](https://github.com/moseph333/karaoke-studio/commit/ce3f93afa18aac51141c2150e4f482dd864865ae))
* **studio:** close a song's dialogs when the song is left ([c973c9d](https://github.com/moseph333/karaoke-studio/commit/c973c9dcf83c1cb545aa4b977e4008888828d062))
* **studio:** load help or the palette again after its code failed to load once ([cc884e5](https://github.com/moseph333/karaoke-studio/commit/cc884e53bf655d58e79bb29f23864c2df8cb16e0))
* **studio:** start each song with a fresh lyric editor ([7b4a4ae](https://github.com/moseph333/karaoke-studio/commit/7b4a4ae2015f4837ec481b9a45ddb9e5eff42937))
* **subtitles:** draw a backslash in a lyric once and never as a line break ([61ac761](https://github.com/moseph333/karaoke-studio/commit/61ac7616c3581bee571d54f4169f10a9057fcb23))
* **sync:** share a short burst of voice between its words by weight ([a647561](https://github.com/moseph333/karaoke-studio/commit/a647561dda2707008247e00ab275d1e212fd0f4b))
* **sync:** time a romanized line by its romaji when re-timing it or adding a repeat ([99d19ae](https://github.com/moseph333/karaoke-studio/commit/99d19aeed9734376eb11cb634a0c7b4def727890))
* **timeline:** hand the active word to the next line when it starts ([d0796f9](https://github.com/moseph333/karaoke-studio/commit/d0796f91ade880d4b649b848bca92fa7a155d69e))
* **timeline:** keep a server re-timing when edits are discarded or saved later ([886c329](https://github.com/moseph333/karaoke-studio/commit/886c329be9a0cfca01ec43841ca5a78fadba8dbe))
* **timeline:** keep the expanded line open through undo and redo ([862c2d0](https://github.com/moseph333/karaoke-studio/commit/862c2d0753f2e8ea1b5a20dabfcbb7ab69cc0d6f))
* **timeline:** let the last word of a line end later ([4f21870](https://github.com/moseph333/karaoke-studio/commit/4f218708237b9a86cd481cc27933f61022f88237))
* **update:** keep a commit that failed ci held back when a later check reads no result ([a072bee](https://github.com/moseph333/karaoke-studio/commit/a072beea98dfb7ae628508bce810895c413a8d3c))
* **update:** retry an update whose build or restart failed ([0655b82](https://github.com/moseph333/karaoke-studio/commit/0655b8294b848ceb3cfcb6432ccc245d8cc57023))
* **upload:** accept a custom backing track for ids that start with a dash or underscore ([aec080a](https://github.com/moseph333/karaoke-studio/commit/aec080ad94441552aa7567a5cce1e0c9165a1e7d))
* **upload:** let a removed audio file be picked again ([7967bdf](https://github.com/moseph333/karaoke-studio/commit/7967bdfc654a65114862e8b54492317a4628d7e8))
* **upload:** limit the length of an uploaded song's title, artist, creator and lyrics ([4f8f061](https://github.com/moseph333/karaoke-studio/commit/4f8f061c2af9ac3ae144f3151a3f7cbcb2ad26d3))
* **upload:** refuse oversized instrumentals and backgrounds before sending ([5f17a19](https://github.com/moseph333/karaoke-studio/commit/5f17a196706aeffc444ea326c3a99c427e626a14))
* **visualizer:** repaint the resting bars when a paused stage is resized ([3904c9e](https://github.com/moseph333/karaoke-studio/commit/3904c9eafe5a540d068e16e3c65cb99d2e7b464e))
* **vocal-range:** spell the recommended key as the chord sheet does ([8931421](https://github.com/moseph333/karaoke-studio/commit/89314214071582b4ef440a157867c376e3812b9a))
* **waveform:** stop the scrubber from sticking to the mouse ([c8f371e](https://github.com/moseph333/karaoke-studio/commit/c8f371ea729d27dfe9d318a482f97efce993156a))

## [2.10.0](https://github.com/moseph333/karaoke-studio/compare/v2.9.0...v2.10.0) (2026-11-17)


### Features

* **help:** explain a streaming song that was not found on youtube ([0cbf9ac](https://github.com/moseph333/karaoke-studio/commit/0cbf9ac710e91eae17eb4094efbcec799d1168c9))
* **help:** explain failed downloads from the new song sites ([07503c2](https://github.com/moseph333/karaoke-studio/commit/07503c2d1010b39906a5323db1d25f679c4fdddd))
* **intake:** download songs from soundcloud, bandcamp, vimeo and internet archive links ([1688a45](https://github.com/moseph333/karaoke-studio/commit/1688a45f1604d47555febb88b57a748cbb472007))
* **intake:** find spotify, apple music and tidal songs on youtube ([96a5e19](https://github.com/moseph333/karaoke-studio/commit/96a5e19ebce193eeb9151148131225889e19abca))
* **intake:** paste and share soundcloud, bandcamp, vimeo and internet archive links ([b2a97c1](https://github.com/moseph333/karaoke-studio/commit/b2a97c11e14efbc5fb15a7a1146d4c52740ad9a0))
* **intake:** take spotify, apple music and tidal links and show the youtube match ([39c3d6e](https://github.com/moseph333/karaoke-studio/commit/39c3d6e0576e564c25e4ce04d44746f7f887e01f))
* **pwa:** add new song, upload and continue shortcuts to the app icon ([a26f8f5](https://github.com/moseph333/karaoke-studio/commit/a26f8f5f9fe65de689a485735a4d31d1e1a1284e))
* **pwa:** match the bar under android's gesture pill to the app theme ([cd5076c](https://github.com/moseph333/karaoke-studio/commit/cd5076c60e81691770e1b0ab4cad5f07affb5c72))
* **transport:** keep the screen on while a song plays ([6de2d84](https://github.com/moseph333/karaoke-studio/commit/6de2d846358cdf49a654037560fc393e4fb1835c))


### Bug Fixes

* **errors:** show a validator's own message without the field name and prefix ([8b6d602](https://github.com/moseph333/karaoke-studio/commit/8b6d602ce43b04e503801a1cb36ae0266b3ba507))
* **pwa:** keep the page end, toasts and boot shell clear of see-through bars ([a1c3230](https://github.com/moseph333/karaoke-studio/commit/a1c3230f7eb37b41e537544e85af539aae31cabb))

## [2.9.0](https://github.com/moseph333/karaoke-studio/compare/v2.8.0...v2.9.0) (2026-11-17)


### Features

* **export:** say what an export starts and that it can be left running ([76c158e](https://github.com/moseph333/karaoke-studio/commit/76c158eb801784d70bf96e61fbc8add25b3b74bc))
* **export:** walk through the YouTube upload after a render ([3cbcff4](https://github.com/moseph333/karaoke-studio/commit/3cbcff46b455161d22cb2084809457fa9c52ef69))
* **help:** add a "Fix a problem" tab and a first-song guide to Help ([0d1eae5](https://github.com/moseph333/karaoke-studio/commit/0d1eae5afb824d108c0b2cf2b39f00e4edf3efbc))
* **help:** cover a failed render and the YouTube upload in "Fix a problem" ([811fa0f](https://github.com/moseph333/karaoke-studio/commit/811fa0f2db550d5def6df809b64943c134f4c97a))
* **intake:** explain a failed song in plain words and offer to try again ([1abda64](https://github.com/moseph333/karaoke-studio/commit/1abda64357456edb52899808ee79e9b83fc3d1f1))
* **intake:** say what to expect of a song before it is finished ([e5e390f](https://github.com/moseph333/karaoke-studio/commit/e5e390fb4128f496a9906669595e4862a4e3a3ce))
* **palette:** let other screens run a registered command by its id ([d83d245](https://github.com/moseph333/karaoke-studio/commit/d83d2459f0577d4869a7a0f07d81b389318f1f90))
* **studio:** add a song check-up that links each problem to its fix ([eb09312](https://github.com/moseph333/karaoke-studio/commit/eb093127e6e594dae0b1c843137a484f5d435ce6))
* **studio:** show first-time users a getting-started card instead of a toast ([6ec7fee](https://github.com/moseph333/karaoke-studio/commit/6ec7feee28c5e1e4712cc8b3c4197b42af7ba6a9))
* **timeline:** lead a song without lyrics to the lyric search ([cb51682](https://github.com/moseph333/karaoke-studio/commit/cb516827c42491d3e4456fbb046f68ca4c255285))

## [2.8.0](https://github.com/moseph333/karaoke-studio/compare/v2.7.0...v2.8.0) (2026-11-16)


### Features

* **editor:** split and merge lyric lines in the timeline ([5229809](https://github.com/moseph333/karaoke-studio/commit/52298097c16ee3db6385e7c690fa01679de8ac2a))
* **logging:** tag log lines and responses with a request id ([b08dbb7](https://github.com/moseph333/karaoke-studio/commit/b08dbb7db1c88e5ebf3d006581094773a6dcb549))
* **lyrics:** drop translation notes and repeat markers from fetched lyrics ([3dbfaa8](https://github.com/moseph333/karaoke-studio/commit/3dbfaa89e815ec5e39e8f564efb85f5fa78bafd0))
* **lyrics:** prefer clean lyric versions over all-caps or annotated ones ([aa73f1e](https://github.com/moseph333/karaoke-studio/commit/aa73f1e870680ee83da255628e1c48411e56c319))
* **lyrics:** rank the other-versions list and mark the version in use ([1317e51](https://github.com/moseph333/karaoke-studio/commit/1317e51d8b781eb9a695c3c25811828a47e5be26))
* **lyrics:** show the romaji under japanese lines and align with it ([5256e1e](https://github.com/moseph333/karaoke-studio/commit/5256e1e36acb655296f54a19e1520a30b6c2ef33))
* **lyrics:** split overlong lyric lines at natural breaks ([2753c78](https://github.com/moseph333/karaoke-studio/commit/2753c780d7f041e8970fdb8330694012c1c17530))
* **lyrics:** time japanese lyrics one character at a time ([3ed38d0](https://github.com/moseph333/karaoke-studio/commit/3ed38d00ba7f92bc5d83b5537e05adbfd87881d7))
* **lyrics:** turn all-caps lyrics into sentence case ([055d788](https://github.com/moseph333/karaoke-studio/commit/055d788a65ef5f19dea0718077286044aae0f9db))
* **lyrics:** use neteases fuller transcription when lrclib writes repeats once ([8d6bae9](https://github.com/moseph333/karaoke-studio/commit/8d6bae965aa13f6b0b1f7bdf2cd32ecf74abfaf6))
* **render:** show instrumental and outro cards during long gaps in exports ([b840435](https://github.com/moseph333/karaoke-studio/commit/b84043503e3e1158d0143c43bbb4784a8b4b3632))
* **security:** answer only the configured host names when allowed_hosts is set ([f303feb](https://github.com/moseph333/karaoke-studio/commit/f303feb82a8e98eecb25501bdb851818dac6492d))
* **stage:** show parenthesised ad-libs as backing vocals on stage and in exports ([395e318](https://github.com/moseph333/karaoke-studio/commit/395e31882feb268ff75836153ca300d67f1e025c))
* **sync:** fill uncovered vocals with repeats of short lines ([b4a2d66](https://github.com/moseph333/karaoke-studio/commit/b4a2d668bb39a046de975607f293566bc011b9f6))
* **sync:** report vocals that no lyric line covers ([4dee82d](https://github.com/moseph333/karaoke-studio/commit/4dee82d484b1ebc0c15e786ec00346db3e8b8dcd))
* **voices:** assign singer parts by voice after alignment ([f49765d](https://github.com/moseph333/karaoke-studio/commit/f49765d5fa653e872e1a92a358fcf86e2dc16a2a))
* **voices:** let each song name its singer parts ([f1f22f2](https://github.com/moseph333/karaoke-studio/commit/f1f22f267892f1e89aa39446e6fcb889d3f55696))


### Bug Fixes

* **api:** stop echoing exception text in failed requests ([2c38096](https://github.com/moseph333/karaoke-studio/commit/2c38096556b7be0f7a9e2c899c5c0cc678be4448))
* **auth:** cap the login limit's bookkeeping per client ip ([1d6b854](https://github.com/moseph333/karaoke-studio/commit/1d6b854a9e529d03a3d107cc7921d25a4bf14165))
* **auth:** count parallel wrong passphrases at login before checking the next ([56885b5](https://github.com/moseph333/karaoke-studio/commit/56885b538f7c187e7dceec77bd2216aba2c9bb68))
* **auth:** keep routes that only start like /api/auth behind the passphrase ([f66d264](https://github.com/moseph333/karaoke-studio/commit/f66d26481d4fdd8858892bca17acf5bda97a31d0))
* **auth:** log sign-ins, sign-outs and refused credentials ([556e729](https://github.com/moseph333/karaoke-studio/commit/556e729a1841cfddb600a117eb4097e06dc46b4b))
* **auth:** sign session tokens with a server secret as well as the passphrase ([0b5cf0f](https://github.com/moseph333/karaoke-studio/commit/0b5cf0f7485f49473e3221837616278e8f7c47e3))
* **cloud:** log the error a cloud gpu or cpu job raised ([02f79ee](https://github.com/moseph333/karaoke-studio/commit/02f79eeba7f16f0e3278f00e418bdde812511eb9))
* **cors:** ignore a wildcard in allowed origins ([3eb3d72](https://github.com/moseph333/karaoke-studio/commit/3eb3d7282c7d992edd27ad2a0767b0fc6e2d4679))
* **docs:** load the api reference viewer only if it matches its pinned hash ([46206a7](https://github.com/moseph333/karaoke-studio/commit/46206a7937ed4126e12e3f149c64f4c54f28ead7))
* **download:** read only the one video when refreshing a cached song ([8fc88a1](https://github.com/moseph333/karaoke-studio/commit/8fc88a1219dc4a95129f04044202825b9ae0a108))
* **download:** stop a cancelled download instead of retrying it with other clients ([5a6bfe8](https://github.com/moseph333/karaoke-studio/commit/5a6bfe821cec35842993078fe5b30865abdfb8b2))
* **intake:** change a song only while holding the store lock ([9262dc7](https://github.com/moseph333/karaoke-studio/commit/9262dc7d38ec864bbf955e78f6070bd753a3277a))
* **jobs:** ignore a cancel that arrives after the job has finished ([7b1c9fd](https://github.com/moseph333/karaoke-studio/commit/7b1c9fd1b006330fe7fb977e224c0e9234f7dbfe))
* **jobs:** keep server paths and pages of ffmpeg output out of stored errors ([eb16922](https://github.com/moseph333/karaoke-studio/commit/eb169224090d7280adac12dda561e8a18bc934d8))
* **jobs:** log when each background job starts, ends or fails ([a7a01f4](https://github.com/moseph333/karaoke-studio/commit/a7a01f48ab77e90ba117219069c1a32ea7edc668))
* **jobs:** release the cancel event of a job whose song was deleted before it ran ([9fa0af9](https://github.com/moseph333/karaoke-studio/commit/9fa0af9901e2a1d36d9c9569010d3de36393d68e))
* **logging:** keep text from requests from forging log lines ([ae2dd39](https://github.com/moseph333/karaoke-studio/commit/ae2dd39779072ba96d8e416d065d899eedefbdab))
* **logging:** log a cancelled intake or render as a cancel, not an error ([3712d70](https://github.com/moseph333/karaoke-studio/commit/3712d700a33b637baa246c4e6c090a18c2ec8fa9))
* **lyrics:** answer 507 when an in-request re-alignment cannot be saved ([c81569e](https://github.com/moseph333/karaoke-studio/commit/c81569e174f82ffeb9d7cd1c92b6f6bff3aee80a))
* **lyrics:** keep ranking lyric candidates as fast as before ([2f2682b](https://github.com/moseph333/karaoke-studio/commit/2f2682bed037d9c94e05dd1d336377e29ce91d02))
* **lyrics:** match lrclib versions whose names carry mix, feat or album prefixes ([fb67809](https://github.com/moseph333/karaoke-studio/commit/fb678096ee293999d9f7cb5ff27e315c7c762d23))
* **lyrics:** never split a long line inside parentheses ([423043f](https://github.com/moseph333/karaoke-studio/commit/423043ff887527c0c9962de97aa2a71cc067cbbc))
* **lyrics:** split fan-upload titles into artist and song when the uploader is not the artist ([79633c3](https://github.com/moseph333/karaoke-studio/commit/79633c372d7f9051c8c0a88bc666459c4b356ecc))
* **media:** warn when a song's length cannot be read and a guess is used ([0766c0f](https://github.com/moseph333/karaoke-studio/commit/0766c0f30a45b27cf29324e09f235f71187113ef))
* **projects:** log which song was deleted ([598fafd](https://github.com/moseph333/karaoke-studio/commit/598fafd8ff5e08bfa9cf989484ef6f2882754926))
* **render:** install japanese fonts in the cloud render image ([9d189c3](https://github.com/moseph333/karaoke-studio/commit/9d189c31b9b31594bcaad68e74e3c0039edb409f))
* **render:** keep a render's style settings from injecting into the subtitle file ([f24ace1](https://github.com/moseph333/karaoke-studio/commit/f24ace1ad67a6658e3cf76a6fd55d197e7cc9942))
* **render:** keep overlong lines on screen in exports ([7fcf095](https://github.com/moseph333/karaoke-studio/commit/7fcf0951586efcb40d822ebfaac90ec35fb0b196))
* **search:** only ever search youtube, never fetch a url from the query ([79f704b](https://github.com/moseph333/karaoke-studio/commit/79f704b9215c15e4ef294638b5aa0d0f5ae2072b))
* **security:** sandbox api and media responses and turn off unused browser features ([c937859](https://github.com/moseph333/karaoke-studio/commit/c937859ea167f61b59a7d84382e6deffe1a29eb6))
* **server:** answer unhandled errors with json and log them with the request ([574a186](https://github.com/moseph333/karaoke-studio/commit/574a186644c64520200ce2fea188fda914ddb0b5))
* **server:** refuse oversized request bodies before reading them ([98f77e7](https://github.com/moseph333/karaoke-studio/commit/98f77e7656fe5c4678cf29b12184168e9b3ebe02))
* **store:** keep tracebacks when projects.json cannot be read or written ([98de7b9](https://github.com/moseph333/karaoke-studio/commit/98de7b9232c3f7bcd3852b4b20730c134d8204c3))
* **studio:** back off status polling when the server keeps failing and pause it while signed out ([9bc1795](https://github.com/moseph333/karaoke-studio/commit/9bc17950ebf46dd6ea4f5898f39330ae2e1f4f4e))
* **studio:** close the help dialog or palette when its chunk fails instead of unmounting the studio ([4232f14](https://github.com/moseph333/karaoke-studio/commit/4232f14766154e4f8241045699f29646f92a98aa))
* **studio:** reload once when opening a song after a deploy removed the studio's chunk ([7e00175](https://github.com/moseph333/karaoke-studio/commit/7e00175a499d14d1f8cb479b07660668d99f30bb))
* **update:** log who forced an update and which versions it moves between ([fa94f29](https://github.com/moseph333/karaoke-studio/commit/fa94f29cee785833de3889cd67e7e51d64697b80))
* **update:** log why the git commands behind the update check fail ([029082c](https://github.com/moseph333/karaoke-studio/commit/029082caa3808aff81e18f0ced2a942b105b06b9))
* **update:** refuse cross-site update requests sent with a visitor's cookie ([786b9b5](https://github.com/moseph333/karaoke-studio/commit/786b9b53cb675bdcb7a43c53ced2790d9f8ba611))
* **upload:** give an upload's transcode time to finish and clean up after it fails ([d9b9d04](https://github.com/moseph333/karaoke-studio/commit/d9b9d0461242837996fcb5fdfcb70a0f9d75aee2))

## [2.7.0](https://github.com/moseph333/karaoke-studio/compare/v2.6.0...v2.7.0) (2026-11-15)


### Features

* **intake:** look lyrics up during separation and warm the cloud gpu early ([#33](https://github.com/moseph333/karaoke-studio/issues/33)) ([aaf3a03](https://github.com/moseph333/karaoke-studio/commit/aaf3a03a53a10af47cd6dc94cf3102f69caa7a61))
* **intake:** open the studio while vocal range and chords are still detected ([#35](https://github.com/moseph333/karaoke-studio/issues/35)) ([a6e3989](https://github.com/moseph333/karaoke-studio/commit/a6e3989d3b4b7db30b908b9df1a19388eb7791e4))

## [2.6.0](https://github.com/moseph333/karaoke-studio/compare/v2.5.0...v2.6.0) (2026-11-15)


### Features

* **home:** show a live lyric preview and load the first screen faster ([#30](https://github.com/moseph333/karaoke-studio/issues/30)) ([1e1a4ad](https://github.com/moseph333/karaoke-studio/commit/1e1a4ad3dd6028299cca139bbd2ad0119ce7ebb9))
* **sync:** save the neural listening pass and compute it on the cloud gpu ([#29](https://github.com/moseph333/karaoke-studio/issues/29)) ([8484ccf](https://github.com/moseph333/karaoke-studio/commit/8484ccf7918f73454402362c87d201315cb5bcb8))
* **update:** wait for ci before deploying and cut releases with release-please ([#31](https://github.com/moseph333/karaoke-studio/issues/31)) ([c033bc7](https://github.com/moseph333/karaoke-studio/commit/c033bc756c077a1f34ee4924b0e2a2919aee84d0))
