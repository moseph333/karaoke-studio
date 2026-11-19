# Changelog

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
