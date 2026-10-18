import logging
import re
from typing import Any

import requests
import syncedlyrics

logger = logging.getLogger(__name__)


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
        clean_title = re.sub(r"[\(\[\{].*?[\)\]\}]", "", track_title).strip()
        clean_artist = re.sub(r"[\(\[\{].*?[\)\]\}]", "", artist_name).strip()

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

            resp = requests.get(f"{self.lrclib_url}/get", params=params, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                synced = bool(data.get("syncedLyrics"))
                lrc = data.get("syncedLyrics") or ""
                plain = data.get("plainLyrics") or ""

                lines = self.parse_lrc(lrc) if synced else self.parse_plain_text(plain)
                return {
                    "source": "lrclib",
                    "synced": synced,
                    "plain_lyrics": plain,
                    "lrc": lrc,
                    "lines": lines,
                }

            # If exact match fails, try search endpoint
            search_resp = requests.get(
                f"{self.lrclib_url}/search", params={"q": f"{track_name} {artist_name}"}, timeout=5
            )
            if search_resp.status_code == 200:
                results = search_resp.json()
                if results and len(results) > 0:
                    top = results[0]
                    synced = bool(top.get("syncedLyrics"))
                    lrc = top.get("syncedLyrics") or ""
                    plain = top.get("plainLyrics") or ""
                    lines = self.parse_lrc(lrc) if synced else self.parse_plain_text(plain)
                    return {
                        "source": "lrclib_search",
                        "synced": synced,
                        "plain_lyrics": plain,
                        "lrc": lrc,
                        "lines": lines,
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
        return bool(re.search(r"\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]", text))

    @staticmethod
    def parse_lrc(lrc_text: str) -> list[dict[str, Any]]:
        """Parses LRC format into a list of line dicts with all raw tags stripped."""
        if not lrc_text or not isinstance(lrc_text, str):
            return []

        tag_pattern = re.compile(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]")
        raw_lines = lrc_text.strip().split("\n")
        parsed_entries: list[tuple[float, str]] = []

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

            clean_text = tag_pattern.sub("", line_str)
            clean_text = re.sub(r"<\d{1,2}:\d{2}(?:\.\d{1,3})?>", "", clean_text)
            clean_text = re.sub(r"\s+", " ", clean_text).strip()
            if not clean_text:
                continue

            for m in leading_tags:
                minutes, seconds, frac = m.groups()
                divisor = (10 ** len(frac)) if frac else 1
                frac_val = (int(frac) / divisor) if frac else 0.0
                timestamp = int(minutes) * 60 + int(seconds) + frac_val
                parsed_entries.append((round(timestamp, 3), clean_text))

        # Sort entries chronologically to handle multi-timestamp or out-of-order lines
        parsed_entries.sort(key=lambda x: x[0])

        lines = []
        for idx, (start_time, text) in enumerate(parsed_entries):
            # Estimate end time based on the start of next line or +4 seconds
            if idx + 1 < len(parsed_entries):
                end_time = parsed_entries[idx + 1][0]
                if end_time <= start_time:
                    end_time = start_time + 0.5
                elif end_time - start_time > 8.0:
                    end_time = start_time + 4.5
            else:
                end_time = start_time + 4.0

            # Split line into initial word tokens evenly spaced across line duration
            words = text.split()
            word_objs = []
            if words:
                word_dur = (end_time - start_time) / len(words)
                for w_idx, w in enumerate(words):
                    w_start = start_time + (w_idx * word_dur)
                    w_end = w_start + word_dur
                    word_objs.append(
                        {"word": w, "start_time": round(w_start, 3), "end_time": round(w_end, 3)}
                    )

            lines.append(
                {
                    "id": idx,
                    "text": text,
                    "start_time": round(start_time, 3),
                    "end_time": round(end_time, 3),
                    "words": word_objs,
                }
            )

        return lines

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
