# Changelog

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
