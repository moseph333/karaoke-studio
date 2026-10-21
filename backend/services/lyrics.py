"""Lyric fetching and parsing service integrating LRCLIB API and local LRC timestamp detection for custom and synced lyrics."""

import difflib
import logging
import math
import re
from typing import Any

import requests
import syncedlyrics

logger = logging.getLogger(__name__)


class LyricsNormalizer:
    """Normalizes noisy track titles and artist names to canonical search queries."""

    # 1. Bracketed media noise patterns: (Official Music Video), [HD], {Audio}, etc.
    BRACKETED_NOISE_RE = re.compile(
        r"[\(\[\{][^)\]\}]*?\b(?:"
        r"official\s+(?:music\s+)?video|official\s+audio|official\s+lyric\s+video|official\s+visualizer|official\s+stream|"
        r"music\s+video|lyric\s+video|lyrics?|visualizer|audio|"
        r"hd|4k|8k|1080p|hq|remaster(?:ed)?|extended(?:\s+mix)?|original\s+mix|"
        r"live(?:\s+(?:at|from)[^)\]}]*)?|clip\s+officiel|video\s+oficial|mv|"
        r"deluxe|bonus\s+track"
        r")\b[^)\]\}]*?[\)\]\}]",
        flags=re.IGNORECASE,
    )

    # 2. Unbracketed trailing delimiter noise: " | Official Video", " // Audio", " - Lyric Video"
    DELIMITER_NOISE_RE = re.compile(
        r"\s*(?:\||//|-|\u2013|\u2014|:)\s*(?:"
        r"official\s+(?:music\s+)?video|official\s+audio|official\s+lyric\s+video|official\s+visualizer|"
        r"music\s+video|lyric\s+video|lyrics?|visualizer|audio|hd|4k|8k|1080p|hq|mv|clip\s+officiel|video\s+oficial"
        r")\b.*$",
        flags=re.IGNORECASE,
    )

    # 3. Featured artist clauses:
    # Bracketed: (feat. Guest), [ft. Guest], (with Guest)
    FEAT_BRACKET_RE = re.compile(
        r"[\(\[\{]\s*(?:ft\.?|feat\.?|featuring|with)\s+([^()\[\]{}]+)[\)\]\}]",
        flags=re.IGNORECASE,
    )
    # Unbracketed: ft. Guest, feat. Guest, featuring Guest, with Guest
    # Avoid matching normal song titles ending in pronouns with 'with' (e.g. 'Stay With Me', 'With You')
    FEAT_UNBRACKETED_RE = re.compile(
        r"(?:\s+(?:ft\.?|feat\.?|featuring)\s+([^()\[\]{}]+)$|"
        r"\s+with\s+(?!(?:me|you|us|myself|him|her|them)\b)([^()\[\]{}]+)$)",
        flags=re.IGNORECASE,
    )

    # 4. Artist channel suffixes: "- Topic", "VEVO", "Official Channel"
    TOPIC_SUFFIX_RE = re.compile(r"\s*-\s*topic\b.*$", flags=re.IGNORECASE)
    VEVO_SUFFIX_RE = re.compile(r"(?<=[a-zA-Z0-9])\s*vevo\b.*$", flags=re.IGNORECASE)
    OFFICIAL_CHANNEL_RE = re.compile(
        r"\s*(?:-\s*)?official(?:\s+channel|\s+music\s+video|\s+page)?$", flags=re.IGNORECASE
    )

    @classmethod
    def extract_featured(cls, text: str) -> str | None:
        if not text:
            return None
        m_bracket = cls.FEAT_BRACKET_RE.search(text)
        if m_bracket:
            return m_bracket.group(1).strip()
        m_unbracket = cls.FEAT_UNBRACKETED_RE.search(text)
        if m_unbracket:
            return (m_unbracket.group(1) or m_unbracket.group(2) or "").strip()
        return None

    @classmethod
    def clean_title(cls, title: str) -> str:
        if not title or not isinstance(title, str):
            return ""
        t = title.strip()
        # 1. Strip bracketed media noise
        t = cls.BRACKETED_NOISE_RE.sub("", t)
        # 2. Strip delimiter noise
        t = cls.DELIMITER_NOISE_RE.sub("", t)
        # 3. Strip bracketed featured artist clauses
        t = cls.FEAT_BRACKET_RE.sub("", t)
        # 4. Strip unbracketed featured artist clauses
        t = cls.FEAT_UNBRACKETED_RE.sub("", t)
        # 5. Remove any leftover empty brackets
        t = re.sub(r"[\(\[\{]\s*[\)\]\}]", "", t)
        # 6. Clean trailing delimiters
        t = re.sub(r"\s*(?:\||//|-|\u2013|\u2014|:)\s*$", "", t)
        # 7. Clean quotes and extra whitespace
        t = re.sub(r"^[\"']|[\"']$", "", t)
        t = re.sub(r"\s+", " ", t).strip()
        return t

    @classmethod
    def clean_artist(cls, artist: str) -> str:
        if not artist or not isinstance(artist, str):
            return "Unknown Artist"
        a = artist.strip()
        a = cls.TOPIC_SUFFIX_RE.sub("", a)
        a = cls.VEVO_SUFFIX_RE.sub("", a)
        a = cls.OFFICIAL_CHANNEL_RE.sub("", a)
        # Remove featured artist tags in artist string
        a = cls.FEAT_BRACKET_RE.sub("", a)
        a = cls.FEAT_UNBRACKETED_RE.sub("", a)
        # Strip generic brackets
        a = re.sub(r"[\(\[\{].*?[\)\]\}]", "", a)
        a = re.sub(r"\s*(?:\||//|-|\u2013|\u2014|:)\s*$", "", a)
        a = re.sub(r"\s+", " ", a).strip()
        return a or "Unknown Artist"

    @classmethod
    def extract_canonical(cls, track_title: str, artist_name: str) -> tuple[str, str, str | None]:
        title = (track_title or "").strip()
        artist = (artist_name or "").strip()

        if " - " in title:
            parts = title.split(" - ", 1)
            clean_part0 = cls.clean_artist(parts[0])
            clean_existing_a = cls.clean_artist(artist)
            if (
                not artist
                or artist in ("Unknown Artist", "Unknown")
                or clean_existing_a == "Unknown Artist"
                or clean_part0.lower() == clean_existing_a.lower()
            ):
                artist = parts[0].strip()
                title = parts[1].strip()

        featured = cls.extract_featured(track_title or "") or (
            cls.extract_featured(artist_name or "") if artist_name else None
        )

        clean_t = cls.clean_title(title)
        clean_a = cls.clean_artist(artist)
        return (clean_t, clean_a, featured)

    @classmethod
    def normalize_track_metadata(cls, title: str, artist: str) -> tuple[str, str]:
        clean_t, clean_a, _ = cls.extract_canonical(title, artist)
        return (clean_t, clean_a)


class LyricsService:
    def __init__(self):
        self.lrclib_url = "https://lrclib.net/api"

    def fetch_lyrics(
        self, track_title: str, artist_name: str, duration: float | None = None
    ) -> dict[str, Any]:
        """
        Fetch synced or plain lyrics from LRCLIB, syncedlyrics, or NetEase.
        Returns structured dict with raw text, synced lines, and source metadata.
        """
        clean_title, clean_artist = LyricsNormalizer.normalize_track_metadata(
            track_title, artist_name
        )

        # 1. Try LRCLIB API first
        lrclib_res = self._fetch_from_lrclib(clean_title, clean_artist, duration)
        if lrclib_res:
            return lrclib_res

        # 2. Try syncedlyrics library with strict timeout
        try:
            from concurrent.futures import ThreadPoolExecutor
            from concurrent.futures import TimeoutError as FuturesTimeout

            query = f"{clean_artist} - {clean_title}"
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(syncedlyrics.search, query)
                lrc_content = future.result(timeout=6.0)

            if lrc_content:
                parsed_lines = self.parse_lrc(lrc_content)
                plain = "\n".join(line["text"] for line in parsed_lines)
                return {
                    "source": "syncedlyrics",
                    "synced": True,
                    "plain_lyrics": plain,
                    "lrc": lrc_content,
                    "lines": parsed_lines,
                }
        except FuturesTimeout:
            logger.warning(f"syncedlyrics search timed out after 6 seconds for {query}")
        except Exception as e:
            logger.warning(f"syncedlyrics search failed: {e}")

        return {"source": "none", "synced": False, "plain_lyrics": "", "lrc": "", "lines": []}

    @staticmethod
    def rank_candidates(
        candidates: list[dict[str, Any]],
        target_title: str,
        target_artist: str,
        target_duration: float | None = None,
    ) -> dict[str, Any] | None:
        """
        Rank search candidates from LRCLIB using a multi-objective scoring formula:
          - Synced lyrics bonus (+100.0) / unsynced penalty (-10.0)
          - Duration proximity bonus (<=3s: +44..+50) and mismatch penalty (>20s)
          - Title and artist string similarity using SequenceMatcher (up to +70.0)
        """
        if not candidates or not isinstance(candidates, list):
            return None

        scored: list[tuple[float, dict[str, Any]]] = []
        for cand in candidates:
            if not isinstance(cand, dict):
                continue
            synced_lrc = (cand.get("syncedLyrics") or "").strip()
            plain_lrc = (cand.get("plainLyrics") or "").strip()
            if not synced_lrc and not plain_lrc:
                continue

            score = 0.0
            # 1. Synced Lyrics Preference (+100.0 bonus)
            if synced_lrc and LyricsService.is_lrc(synced_lrc):
                score += 100.0
            else:
                score -= 10.0

            # 2. Duration Proximity
            if target_duration and target_duration > 0:
                try:
                    c_dur = float(cand.get("duration", 0) or 0)
                    if c_dur > 0:
                        diff = abs(c_dur - target_duration)
                        if diff <= 3.0:
                            score += 50.0 - (diff * 2.0)
                        elif diff <= 8.0:
                            score += 35.0 - ((diff - 3.0) * 2.0)
                        elif diff <= 20.0:
                            score += 15.0 - ((diff - 8.0) * 1.0)
                        else:
                            score -= min(60.0, 10.0 + (diff - 20.0) * 1.5)
                except (ValueError, TypeError):
                    pass

            # 3. Title & Artist Similarity
            c_title = str(cand.get("trackName") or cand.get("name") or cand.get("title") or "")
            c_artist = str(cand.get("artistName") or cand.get("artist") or "")
            t_sim = difflib.SequenceMatcher(
                None, (target_title or "").lower(), c_title.lower()
            ).ratio()
            a_sim = difflib.SequenceMatcher(
                None, (target_artist or "").lower(), c_artist.lower()
            ).ratio()
            score += (40.0 * t_sim) + (30.0 * a_sim)

            scored.append((score, cand))

        if not scored:
            return None

        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]

    def _fetch_from_lrclib(
        self, track_name: str, artist_name: str, duration: float | None
    ) -> dict[str, Any] | None:
        try:
            params = {
                "track_name": track_name,
                "artist_name": artist_name,
            }
            if duration:
                params["duration"] = int(duration)

            exact_plain = ""
            resp = requests.get(f"{self.lrclib_url}/get", params=params, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                synced = bool(data.get("syncedLyrics"))
                lrc = data.get("syncedLyrics") or ""
                exact_plain = data.get("plainLyrics") or ""

                if synced:
                    lines = self.parse_lrc(lrc)
                    return {
                        "source": "lrclib",
                        "synced": True,
                        "plain_lyrics": exact_plain,
                        "lrc": lrc,
                        "lines": lines,
                    }

            # If exact match fails or only had plain lyrics, try search endpoint
            search_query = f"{track_name} {artist_name}".strip()
            if search_query:
                search_resp = requests.get(
                    f"{self.lrclib_url}/search", params={"q": search_query}, timeout=5
                )
                if search_resp.status_code == 200:
                    results = search_resp.json()
                    if results and isinstance(results, list):
                        best_cand = self.rank_candidates(
                            results,
                            target_title=track_name,
                            target_artist=artist_name,
                            target_duration=duration,
                        )
                        if best_cand:
                            synced = bool(best_cand.get("syncedLyrics"))
                            lrc = best_cand.get("syncedLyrics") or ""
                            plain = best_cand.get("plainLyrics") or ""
                            lines = self.parse_lrc(lrc) if synced else self.parse_plain_text(plain)
                            return {
                                "source": "lrclib_search",
                                "synced": synced,
                                "plain_lyrics": plain,
                                "lrc": lrc,
                                "lines": lines,
                            }

            # Fallback to exact match plain lyrics if search found no candidate
            if resp.status_code == 200 and exact_plain:
                return {
                    "source": "lrclib",
                    "synced": False,
                    "plain_lyrics": exact_plain,
                    "lrc": "",
                    "lines": self.parse_plain_text(exact_plain),
                }

        except Exception as e:
            logger.warning(f"LRCLIB fetch error: {e}")
        return None

    @staticmethod
    def is_lrc(text: str) -> bool:
        """
        Checks whether the given lyrics text contains LRC-formatted line timestamps
        such as [mm:ss.xx] or [mm:ss.xxx]. Safely ignores metadata headers ([ti:...])
        and section headers ([Verse 1], [Chorus]).
        """
        if not text or not isinstance(text, str):
            return False
        return bool(re.search(r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]", text))

    @staticmethod
    def parse_lrc(lrc_text: str) -> list[dict[str, Any]]:
        """Parses LRC format into a list of line dicts with all raw tags stripped."""
        if not lrc_text or not isinstance(lrc_text, str):
            return []

        tag_pattern = re.compile(r"\[(\d{1,4}):(\d{2})(?:\.(\d{1,3}))?\]")
        word_tag_pattern = re.compile(r"<(\d{1,4}):(\d{2})(?:\.(\d{1,3}))?>")
        offset_pattern = re.compile(r"^\[offset:\s*([+-]?\d+)\s*\]", re.IGNORECASE | re.MULTILINE)

        # Extract [offset:+/-ms] header if present
        offset_sec = 0.0
        offset_match = offset_pattern.search(lrc_text)
        if offset_match:
            try:
                offset_sec = int(offset_match.group(1)) / 1000.0
            except (ValueError, TypeError):
                offset_sec = 0.0

        raw_lines = lrc_text.strip().split("\n")
        parsed_entries: list[tuple[float, str, str]] = []

        for raw_line in raw_lines:
            line_str = raw_line.strip()
            if not line_str:
                continue

            # Find all leading timestamp tags (handles repeated timestamps like [00:04.20][00:15.50])
            pos = 0
            leading_tags = []
            while pos < len(line_str):
                while pos < len(line_str) and line_str[pos].isspace():
                    pos += 1
                m = tag_pattern.match(line_str, pos)
                if m:
                    leading_tags.append(m)
                    pos = m.end()
                else:
                    break

            # If no leading tags, check if there are any timestamp tags anywhere in the line as fallback
            if not leading_tags:
                fallback_matches = list(tag_pattern.finditer(line_str))
                if not fallback_matches:
                    continue
                leading_tags = [fallback_matches[0]]
                body_start = fallback_matches[0].end()
            else:
                body_start = pos

            body = line_str[body_start:]

            clean_text = re.sub(r"\[.*?\]|<.*?>", "", line_str)
            clean_text = re.sub(r"\s+", " ", clean_text).strip()
            if not clean_text:
                continue

            for m in leading_tags:
                minutes, seconds, frac = m.groups()
                divisor = (10 ** len(frac)) if frac else 1
                frac_val = (int(frac) / divisor) if frac else 0.0
                timestamp = int(minutes) * 60 + int(seconds) + frac_val
                adj_timestamp = round(max(0.0, timestamp + offset_sec), 3)
                parsed_entries.append((adj_timestamp, clean_text, body))

        # Sort entries chronologically to handle multi-timestamp or out-of-order lines
        parsed_entries.sort(key=lambda x: x[0])

        lines = []
        for idx, (start_time, text, body) in enumerate(parsed_entries):
            # Estimate end time based on the start of next line or +4 seconds
            if idx + 1 < len(parsed_entries):
                end_time = parsed_entries[idx + 1][0]
                if end_time <= start_time:
                    end_time = start_time + 0.5
                elif end_time - start_time > 8.0:
                    end_time = start_time + 4.5
            else:
                end_time = start_time + 4.0

            # Parse word timings
            word_tag_matches = list(word_tag_pattern.finditer(body))
            has_word_sync = False
            word_objs = []

            if word_tag_matches:
                # Enhanced LRC with <mm:ss.xx> tags
                tags: list[tuple[float, int, int]] = []
                for tm in word_tag_matches:
                    mins, secs, frac = tm.groups()
                    divisor = (10 ** len(frac)) if frac else 1
                    frac_val = (int(frac) / divisor) if frac else 0.0
                    raw_ts = int(mins) * 60 + int(secs) + frac_val
                    ts = round(max(0.0, raw_ts + offset_sec), 3)
                    tags.append((ts, tm.start(), tm.end()))

                # Text before the first tag
                pre_text = body[: tags[0][1]]
                clean_pre = re.sub(r"\[.*?\]|<.*?>", "", pre_text).strip()
                pre_words = [re.sub(r"\[.*?\]|<.*?>", "", w).strip() for w in clean_pre.split()]
                pre_words = [w for w in pre_words if w]
                if pre_words:
                    pre_end = tags[0][0]
                    if pre_end <= start_time:
                        pre_end = round(start_time + 0.1 * len(pre_words), 3)
                    pre_dur = (pre_end - start_time) / len(pre_words)
                    for k, w in enumerate(pre_words):
                        w_s = round(start_time + k * pre_dur, 3)
                        w_e = round(w_s + pre_dur, 3)
                        word_objs.append(
                            {"word": w, "start_time": w_s, "end_time": max(w_s + 0.05, w_e)}
                        )

                # Words between tag i and tag i+1 (or end)
                for i in range(len(tags)):
                    w_start = tags[i][0]
                    next_start = tags[i + 1][1] if i + 1 < len(tags) else len(body)
                    seg_text = body[tags[i][2] : next_start]
                    clean_seg = re.sub(r"\[.*?\]|<.*?>", "", seg_text).strip()
                    seg_words = [re.sub(r"\[.*?\]|<.*?>", "", w).strip() for w in clean_seg.split()]
                    seg_words = [w for w in seg_words if w]
                    if not seg_words:
                        continue

                    w_end = tags[i + 1][0] if i + 1 < len(tags) else end_time

                    if w_end <= w_start:
                        w_end = round(w_start + 0.2 * len(seg_words), 3)

                    dur = (w_end - w_start) / len(seg_words)
                    for k, w in enumerate(seg_words):
                        sw_s = round(w_start + k * dur, 3)
                        sw_e = round(sw_s + dur, 3)
                        word_objs.append(
                            {"word": w, "start_time": sw_s, "end_time": max(sw_s + 0.05, sw_e)}
                        )

                if word_objs:
                    has_word_sync = True
                    # Ensure strict monotonicity
                    cur_t = start_time
                    for w in word_objs:
                        if w["start_time"] < cur_t:
                            w["start_time"] = cur_t
                        if w["end_time"] <= w["start_time"]:
                            w["end_time"] = round(w["start_time"] + 0.05, 3)
                        cur_t = w["start_time"]
                    end_time = max(end_time, word_objs[-1]["end_time"])

            if not has_word_sync:
                words = [re.sub(r"\[.*?\]|<.*?>", "", w).strip() for w in text.split()]
                words = [w for w in words if w]
                if words:
                    word_dur = (end_time - start_time) / len(words)
                    for w_idx, w in enumerate(words):
                        w_start = start_time + (w_idx * word_dur)
                        w_end = w_start + word_dur
                        word_objs.append(
                            {
                                "word": w,
                                "start_time": round(w_start, 3),
                                "end_time": round(w_end, 3),
                            }
                        )

            lines.append(
                {
                    "id": idx,
                    "text": text,
                    "start_time": round(start_time, 3),
                    "end_time": round(end_time, 3),
                    "words": word_objs,
                    "has_word_sync": has_word_sync,
                }
            )

        return lines

    @staticmethod
    def format_lrc_timestamp(seconds: float) -> str:
        """Format seconds into standard LRC timestamp format [mm:ss.xx].

        Handles negative, NaN, Inf, and rollover boundary conditions safely.
        """
        try:
            val = float(seconds)
            if not math.isfinite(val) or val < 0.0:
                val = 0.0
        except (ValueError, TypeError):
            val = 0.0

        total_centis = round(val * 100)
        centis = total_centis % 100
        total_secs = total_centis // 100
        secs = total_secs % 60
        minutes = total_secs // 60
        return f"[{minutes:02d}:{secs:02d}.{centis:02d}]"

    @staticmethod
    def generate_lrc(
        lines: list[dict[str, Any]],
        title: str = "",
        artist: str = "",
    ) -> str:
        """Generate standard UTF-8 LRC text from a list of project lyric lines.

        Includes metadata header tags [ti:...] and [ar:...] if provided,
        sorts lines chronologically by start_time, strips raw timestamp tags,
        and formats timestamps as [mm:ss.xx].
        """
        tag_pattern = re.compile(r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]")
        bracket_pattern = re.compile(r"<\d{1,4}:\d{2}(?:\.\d{1,3})?>")

        lrc_lines: list[str] = []

        clean_title = (title or "").strip()
        clean_artist = (artist or "").strip()
        if clean_title:
            lrc_lines.append(f"[ti:{clean_title}]")
        if clean_artist:
            lrc_lines.append(f"[ar:{clean_artist}]")

        if not lines or not isinstance(lines, list):
            return "\n".join(lrc_lines) + ("\n" if lrc_lines else "")

        def _sort_key(item: dict[str, Any]) -> tuple[float, int]:
            st = item.get("start_time", 0.0) if isinstance(item, dict) else 0.0
            try:
                val = float(st)
                if not math.isfinite(val) or val < 0.0:
                    val = 0.0
            except (ValueError, TypeError):
                val = 0.0
            lid = item.get("id", 0) if isinstance(item, dict) else 0
            try:
                id_val = int(lid)
            except (ValueError, TypeError):
                id_val = 0
            return (val, id_val)

        sorted_lines = sorted(lines, key=_sort_key)

        for item in sorted_lines:
            if not isinstance(item, dict):
                continue
            raw_text = str(item.get("text") or "")
            clean_text = tag_pattern.sub("", raw_text)
            clean_text = bracket_pattern.sub("", clean_text)
            clean_text = re.sub(r"\s+", " ", clean_text).strip()
            if not clean_text:
                continue

            st = item.get("start_time", 0.0)
            timestamp_tag = LyricsService.format_lrc_timestamp(st)
            lrc_lines.append(f"{timestamp_tag}{clean_text}")

        if not lrc_lines:
            return ""

        return "\n".join(lrc_lines) + "\n"

    def process_custom_lyrics(self, custom_lyrics: str) -> dict[str, Any]:
        """
        Processes custom lyrics: auto-detects LRC timestamps vs plain un-timed text.
        Returns structured dict with source, synced, lines, and plain_lyrics.
        """
        clean = custom_lyrics.strip() if custom_lyrics else ""
        if not clean:
            return {"source": "none", "synced": False, "lines": [], "plain_lyrics": "", "lrc": ""}

        if self.is_lrc(clean):
            parsed = self.parse_lrc(clean)
            if parsed:
                plain = "\n".join(line["text"] for line in parsed)
                return {
                    "source": "custom",
                    "synced": True,
                    "lines": parsed,
                    "plain_lyrics": plain,
                    "lrc": clean,
                }

        # Plain text fallback
        return {
            "source": "custom",
            "synced": False,
            "lines": self.parse_plain_text(clean),
            "plain_lyrics": clean,
            "lrc": "",
        }

    @staticmethod
    def parse_plain_text(text: str) -> list[dict[str, Any]]:
        """Parses plain multiline text into unaligned line items."""
        lines = []
        raw_lines = [line.strip() for line in text.split("\n") if line.strip()]
        for idx, line in enumerate(raw_lines):
            words = line.split()
            lines.append(
                {
                    "id": idx,
                    "text": line,
                    "start_time": 0.0,
                    "end_time": 0.0,
                    "words": [{"word": w, "start_time": 0.0, "end_time": 0.0} for w in words],
                }
            )
        return lines
