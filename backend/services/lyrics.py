import re
import logging
from typing import Dict, Any, List, Optional
import requests
import syncedlyrics

logger = logging.getLogger(__name__)

class LyricsService:
    def __init__(self):
        self.lrclib_url = "https://lrclib.net/api"

    def fetch_lyrics(self, track_title: str, artist_name: str, duration: Optional[float] = None) -> Dict[str, Any]:
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
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
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
                    "lines": parsed_lines
                }
        except FuturesTimeout:
            logger.warning(f"syncedlyrics search timed out after 6 seconds for {query}")
        except Exception as e:
            logger.warning(f"syncedlyrics search failed: {e}")


        return {
            "source": "none",
            "synced": False,
            "plain_lyrics": "",
            "lrc": "",
            "lines": []
        }

    def _fetch_from_lrclib(self, track_name: str, artist_name: str, duration: Optional[float]) -> Optional[Dict[str, Any]]:
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
                    "lines": lines
                }
            
            # If exact match fails, try search endpoint
            search_resp = requests.get(f"{self.lrclib_url}/search", params={"q": f"{track_name} {artist_name}"}, timeout=5)
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
                        "lines": lines
                    }
        except Exception as e:
            logger.warning(f"LRCLIB fetch error: {e}")
        return None

    @staticmethod
    def parse_lrc(lrc_text: str) -> List[Dict[str, Any]]:
        """Parses LRC format into a list of line dicts."""
        lines = []
        pattern = re.compile(r"\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)")
        line_id = 0

        raw_lines = lrc_text.strip().split("\n")
        parsed_entries = []

        for raw_line in raw_lines:
            match = pattern.match(raw_line.strip())
            if match:
                minutes, seconds, frac, text = match.groups()
                # If frac is 2 digits, it's centiseconds (0.xx), if 3, it's ms (0.xxx)
                divisor = 1000 if len(frac) == 3 else 100
                timestamp = int(minutes) * 60 + int(seconds) + int(frac) / divisor
                clean_text = text.strip()
                if clean_text:
                    parsed_entries.append((timestamp, clean_text))

        for idx, (start_time, text) in enumerate(parsed_entries):
            # Estimate end time based on the start of next line or +4 seconds
            if idx + 1 < len(parsed_entries):
                end_time = parsed_entries[idx + 1][0]
                if end_time - start_time > 8.0:
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
                    word_objs.append({
                        "word": w,
                        "start_time": round(w_start, 3),
                        "end_time": round(w_end, 3)
                    })

            lines.append({
                "id": line_id,
                "text": text,
                "start_time": round(start_time, 3),
                "end_time": round(end_time, 3),
                "words": word_objs
            })
            line_id += 1

        return lines

    @staticmethod
    def parse_plain_text(text: str) -> List[Dict[str, Any]]:
        """Parses plain multiline text into unaligned line items."""
        lines = []
        raw_lines = [l.strip() for l in text.split("\n") if l.strip()]
        for idx, line in enumerate(raw_lines):
            words = line.split()
            lines.append({
                "id": idx,
                "text": line,
                "start_time": 0.0,
                "end_time": 0.0,
                "words": [{"word": w, "start_time": 0.0, "end_time": 0.0} for w in words]
            })
        return lines
