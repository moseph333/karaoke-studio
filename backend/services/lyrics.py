"""Lyric fetching and parsing service integrating LRCLIB API and local LRC timestamp detection for custom and synced lyrics."""

import difflib
import logging
import math
import re
from typing import Any

import requests
import syncedlyrics

logger = logging.getLogger(__name__)

# Section labels that pasted lyrics often carry ("[Verse 1]", "(Chorus x2)", "Bridge:").
# Bracketed labels may name a performer ("[Verse 2: Artist]"); the less distinctive words
# (drop, break, solo...) only count when bracketed, so a sung "Drop" line survives.
_SECTION_WORDS = (
    r"verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|intro|outro|hook|refrain|interlude"
)
_BRACKET_ONLY_WORDS = (
    r"instrumental|breakdown|drop|break|solo|guitar solo|coda|vamp|tag|skit|spoken"
)
_SECTION_SUFFIX = r"(?:\s*\d+|\s+[ivx]+)?(?:\s*(?:[x\u00d7]\s*\d+|\d+\s*[x\u00d7]))?"
_SECTION_HEADING = re.compile(
    rf"^\s*(?:[\[\(\{{]\s*(?:{_SECTION_WORDS}|{_BRACKET_ONLY_WORDS}){_SECTION_SUFFIX}"
    rf"\s*(?:[:\-\u2013][^\]\)\}}]*)?[\]\)\}}]"
    rf"|(?:{_SECTION_WORDS}){_SECTION_SUFFIX}\s*:?)\s*$",
    re.IGNORECASE,
)


SYNCEDLYRICS_TIMEOUT_SEC = 6.0


def is_section_heading(line: str) -> bool:
    """True for a line that only labels a song section, such as "[Chorus]" or "Verse 2:"."""
    return bool(_SECTION_HEADING.match(line or ""))


class LyricsNormalizer:
    """Normalizes noisy track titles and artist names to canonical search queries."""

    # 1. Bracketed media & soundtrack noise patterns: (Official Music Video), [HD], [OST], (From "..."), etc.
    BRACKETED_NOISE_RE = re.compile(
        r"[\(\[\{][^)\]\}]*?\b(?:"
        r"official\s+(?:music\s+)?video|official\s+audio|official\s+lyric\s+video|official\s+visualizer|official\s+stream|"
        r"music\s+video|lyric\s+video|lyrics?|visualizer|audio|"
        r"hd|4k|8k|1080p|hq|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|extended(?:\s+mix)?|original\s+mix|"
        r"live(?:\s+(?:at|from)[^)\]}]*)?|clip\s+officiel|video\s+oficial|mv|"
        r"deluxe(?:\s+edition)?|bonus\s+track|"
        r"soundtrack|ost|original\s+(?:motion\s+picture\s+)?soundtrack|motion\s+picture\s+soundtrack|"
        r"from\s+[\"'\x27\x22].*?[\"'\x27\x22]|from\s+[^)\]\}]+?(?:\s+(?:soundtrack|album|movie|film|series|score|ost))\b|"
        r"from\s+(?:the\s+)?(?:motion\s+picture|movie|film|netflix|series)\b|"
        r"radio\s+edit|single\s+version|album\s+version|acoustic(?:\s+version)?"
        r")[^)\]\}]*?[\)\]\}]",
        flags=re.IGNORECASE,
    )

    # 2. Unbracketed trailing delimiter noise: " | Official Video", " - 2011 Remaster", " - Live", etc.
    DELIMITER_NOISE_RE = re.compile(
        r"\s*(?:\||//|-|\u2013|\u2014|:)\s*(?:"
        r"official\s+(?:music\s+)?video|official\s+audio|official\s+lyric\s+video|official\s+visualizer|"
        r"music\s+video|lyric\s+video|lyrics?|visualizer|audio|hd|4k|8k|1080p|hq|mv|clip\s+officiel|video\s+oficial|"
        r"(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|live(?:\s+(?:at|from)[^|\-\/]*)?|"
        r"radio\s+edit|single\s+version|album\s+version|acoustic(?:\s+version)?|"
        r"deluxe(?:\s+edition)?|extended(?:\s+mix)?|original\s+mix|bonus\s+track|"
        r"ost|soundtrack|original\s+(?:motion\s+picture\s+)?soundtrack|motion\s+picture\s+soundtrack|"
        r"from\s+[\"'\x27\x22].*?[\"'\x27\x22]|from\s+(?:the\s+)?[^|\-\/]+(?:\s+(?:soundtrack|album|movie|film|series|score|ost))\b|"
        r"from\s+(?:the\s+)?(?:motion\s+picture|movie|film|netflix|series|album)\b"
        r").*$",
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

    # 5. Unicode smart quotes translation table
    SMART_QUOTES = str.maketrans(
        {
            "\u201c": '"',  # Left double quotation mark
            "\u201d": '"',  # Right double quotation mark
            "\u2018": "'",  # Left single quotation mark
            "\u2019": "'",  # Right single quotation mark
            "\u00ab": '"',  # Left-pointing double angle quotation mark
            "\u00bb": '"',  # Right-pointing double angle quotation mark
        }
    )

    @classmethod
    def _strip_unbalanced_brackets(cls, s: str) -> str:
        """Strip orphaned/unbalanced closing or opening brackets from edges of a string."""
        s = s.strip()
        bracket_pairs = (("(", ")"), ("[", "]"), ("{", "}"))
        changed = True
        while changed and s:
            changed = False
            for open_b, close_b in bracket_pairs:
                # Check trailing unbalanced closing or opening brackets
                if (s.endswith(close_b) and s.count(close_b) > s.count(open_b)) or (
                    s.endswith(open_b) and s.count(open_b) > s.count(close_b)
                ):
                    s = s[:-1].strip()
                    changed = True
                # Check leading unbalanced closing or opening brackets
                elif (s.startswith(close_b) and s.count(close_b) > s.count(open_b)) or (
                    s.startswith(open_b) and s.count(open_b) > s.count(close_b)
                ):
                    s = s[1:].strip()
                    changed = True
        return s

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
    def extract_primary_artist(cls, artist_name: str) -> str:
        """Extract primary artist from collaboration strings containing &, feat., ft., x, ,, etc."""
        if not artist_name or not isinstance(artist_name, str):
            return "Unknown Artist"
        a = cls.clean_artist(artist_name)
        if a == "Unknown Artist":
            return "Unknown Artist"
        # First strip trailing feat./ft./featuring/with clause
        feat_pat = r"(?i)\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$"
        a = re.sub(feat_pat, "", a).strip()
        # Split on collaboration conjunctions: &, and, vs., /, comma, or spaced x
        parts = re.split(r"(?i)\s+(?:&|and|vs\.?|\/)\s+|\s*,\s*|\s+[xX]\s+", a)
        if parts and parts[0].strip():
            primary = parts[0].strip()
            primary = re.sub(r"\s*(?:\||//|-|\u2013|\u2014|:)\s*$", "", primary).strip()
            return primary or "Unknown Artist"
        return a or "Unknown Artist"

    @classmethod
    def extract_base_title(cls, track_name: str) -> str:
        """Extract core/base title by stripping subtitle clauses and version suffixes."""
        if not track_name or not isinstance(track_name, str):
            return ""
        clean = cls.clean_title(track_name)
        if not clean:
            return ""
        # Strip any remaining bracketed or parenthetical clauses
        t = re.sub(r"[\(\[\{].*?[\)\]\}]", "", clean).strip()
        # Split on subtitle delimiters: " - ", en-dash, em-dash, colon
        parts = re.split(r"\s*(?: - | \u2013 | \u2014 | : )\s*", t)
        if parts and parts[0].strip():
            base = parts[0].strip()
            base = re.sub(r"^[\"']+|[\"']+$", "", base).strip()
            base = re.sub(r"\s+", " ", base).strip()
            if len(base) >= 2:
                return base
        return clean

    @classmethod
    def clean_title(cls, title: str) -> str:
        if not title or not isinstance(title, str):
            return ""
        t = title.strip().translate(cls.SMART_QUOTES)

        # Iteratively apply stripping until string stabilizes (max 5 iterations)
        for _ in range(5):
            old_t = t
            # 1. Strip bracketed media & soundtrack noise
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
            # 7. Clean residual unbalanced/orphaned brackets at boundaries
            t = cls._strip_unbalanced_brackets(t)
            # 8. Clean trailing delimiters again if bracket stripping exposed one
            t = re.sub(r"\s*(?:\||//|-|\u2013|\u2014|:)\s*$", "", t)
            # 9. Clean quotes and extra whitespace
            t = re.sub(r"^[\"']+|[\"']+$", "", t)
            t = re.sub(r"\s+", " ", t).strip()

            if t == old_t:
                break

        return t

    @classmethod
    def clean_artist(cls, artist: str) -> str:
        if not artist or not isinstance(artist, str):
            return "Unknown Artist"
        a = artist.strip().translate(cls.SMART_QUOTES)
        a = cls.TOPIC_SUFFIX_RE.sub("", a)
        a = cls.VEVO_SUFFIX_RE.sub("", a)
        a = cls.OFFICIAL_CHANNEL_RE.sub("", a)
        # Remove featured artist tags in artist string
        a = cls.FEAT_BRACKET_RE.sub("", a)
        a = cls.FEAT_UNBRACKETED_RE.sub("", a)
        # Strip generic brackets
        a = re.sub(r"[\(\[\{].*?[\)\]\}]", "", a)
        a = cls._strip_unbalanced_brackets(a)
        a = re.sub(r"\s*(?:\||//|-|\u2013|\u2014|:)\s*$", "", a)
        a = re.sub(r"^[\"']+|[\"']+$", "", a)
        a = re.sub(r"\s+", " ", a).strip()
        return a or "Unknown Artist"

    @classmethod
    def extract_canonical(cls, track_title: str, artist_name: str) -> tuple[str, str]:
        title = (track_title or "").strip()
        artist = (artist_name or "").strip()

        # Check for delimiters: " - ", en-dash, em-dash
        split_delim = None
        for d in (" - ", " \u2013 ", " \u2014 "):
            if d in title:
                split_delim = d
                break

        if split_delim:
            parts = title.split(split_delim, 1)
            clean_part0 = cls.clean_artist(parts[0])
            clean_part1 = cls.clean_artist(parts[1])
            clean_existing_a = cls.clean_artist(artist)

            # Case 1: Title is "Title - Artist" and artist matches parts[1]
            if (
                clean_existing_a != "Unknown Artist"
                and clean_part1.lower() == clean_existing_a.lower()
            ):
                title = parts[0].strip()
                artist = parts[1].strip()
            # Case 2: Title is "Artist - Title" (parts[0] matches artist or artist is unknown/generic)
            elif (
                not artist
                or artist in ("Unknown Artist", "Unknown", "Various Artists")
                or clean_existing_a in ("Unknown Artist", "Unknown", "Various Artists")
                or clean_part0.lower() == clean_existing_a.lower()
            ):
                artist = parts[0].strip()
                title = parts[1].strip()

        clean_t = cls.clean_title(title)
        clean_a = cls.clean_artist(artist)
        return (clean_t, clean_a)

    @classmethod
    def normalize_track_metadata(cls, title: str, artist: str) -> tuple[str, str]:
        return cls.extract_canonical(title, artist)


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
        from concurrent.futures import ThreadPoolExecutor
        from concurrent.futures import TimeoutError as FuturesTimeout

        query = f"{clean_artist} - {clean_title}"
        # Not a `with` block: leaving one waits for the search to finish, which defeated the
        # timeout. A late result is simply dropped.
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="syncedlyrics")
        try:
            future = executor.submit(syncedlyrics.search, query)
            lrc_content = future.result(timeout=SYNCEDLYRICS_TIMEOUT_SEC)

            if isinstance(lrc_content, str) and lrc_content.strip():
                if self.is_lrc(lrc_content):
                    parsed_lines = self.parse_lrc(lrc_content)
                    if parsed_lines:
                        return {
                            "source": "syncedlyrics",
                            "synced": True,
                            "plain_lyrics": "\n".join(line["text"] for line in parsed_lines),
                            "lrc": lrc_content,
                            "lines": parsed_lines,
                        }
                else:
                    # Some providers only have untimed lyrics: align them like pasted text
                    plain_lines = self.parse_plain_text(lrc_content)
                    if plain_lines:
                        return {
                            "source": "syncedlyrics",
                            "synced": False,
                            "plain_lyrics": lrc_content.strip(),
                            "lrc": "",
                            "lines": plain_lines,
                        }
        except FuturesTimeout:
            logger.warning(
                f"syncedlyrics search timed out after {SYNCEDLYRICS_TIMEOUT_SEC:g} seconds for {query}"
            )
        except Exception as e:
            logger.warning(f"syncedlyrics search failed: {e}")
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

        return {"source": "none", "synced": False, "plain_lyrics": "", "lrc": "", "lines": []}

    @classmethod
    def calculate_similarity(cls, str1: str, str2: str) -> float:
        """
        Calculate string similarity combining SequenceMatcher ratio, token-set intersection,
        and token-sort ratio for resilience against extra words and token reordering.
        """
        if not str1 and not str2:
            return 1.0
        if not str1 or not str2:
            return 0.0

        s1 = str(str1).lower().strip()
        s2 = str(str2).lower().strip()
        if s1 == s2:
            return 1.0

        seq_ratio = difflib.SequenceMatcher(None, s1, s2).ratio()

        # Token-level similarity
        t1 = set(re.findall(r"\w+", s1))
        t2 = set(re.findall(r"\w+", s2))

        if not t1 or not t2:
            return seq_ratio

        common = t1 & t2
        coverage1 = len(common) / len(t1)
        coverage2 = len(common) / len(t2)
        jaccard = len(common) / len(t1 | t2)

        sorted_s1 = " ".join(sorted(t1))
        sorted_s2 = " ".join(sorted(t2))
        sort_ratio = difflib.SequenceMatcher(None, sorted_s1, sorted_s2).ratio()

        subset_bonus = (
            0.9 * max(coverage1, coverage2) if (t1.issubset(t2) or t2.issubset(t1)) else 0.0
        )
        best_token_sim = max(jaccard, sort_ratio, subset_bonus)
        combined = (0.4 * seq_ratio) + (0.6 * best_token_sim)
        return max(seq_ratio, combined)

    @classmethod
    def score_candidate(
        cls,
        cand: dict[str, Any],
        target_title: str,
        target_artist: str,
        target_duration: float | None = None,
    ) -> float:
        """
        Score a single candidate using multi-objective metrics:
          - Synced lyrics preference (+100.0 bonus / -10.0 penalty)
          - Line count completeness (+1.0 per line up to +20.0; penalty -140.0 if < 6 lines when duration > 60s or duration is None)
          - Truncated snippet penalty (-130.0 if latest timestamp < 0.5 * duration)
          - Synced bonus gating: revoke +100.0 bonus if candidate is a stub, truncated snippet, or unrelated song (< 35/70 similarity or title < 0.40)
          - Unrelated metadata mismatch penalty (-60.0)
          - Duration proximity & escalated mismatch penalty for differences > 30s
          - Token-set / fuzzy string similarity with swapped artist/title tolerance
        """
        synced_lrc = (cand.get("syncedLyrics") or "").strip()
        plain_lrc = (cand.get("plainLyrics") or "").strip()
        if not synced_lrc and not plain_lrc:
            return -1000.0

        is_synced = bool(synced_lrc and cls.is_lrc(synced_lrc))

        # Parse line count
        if is_synced:
            parsed_lines = cls.parse_lrc(synced_lrc)
            line_count = len(parsed_lines)
        else:
            line_count = len([line for line in plain_lrc.splitlines() if line.strip()])

        # Safe duration extraction
        valid_target_dur: float | None = None
        if target_duration is not None:
            try:
                t_dur = float(target_duration)
                if math.isfinite(t_dur) and t_dur > 0:
                    valid_target_dur = t_dur
            except (ValueError, TypeError):
                pass

        cand_dur: float | None = None
        try:
            c_dur = float(cand.get("duration", 0) or 0)
            if math.isfinite(c_dur) and c_dur > 0:
                cand_dur = c_dur
        except (ValueError, TypeError):
            pass

        # Effective duration: fallback to cand_dur when target_duration is None
        effective_duration = valid_target_dur if valid_target_dur is not None else cand_dur

        # 1. Title & Artist Similarity (Token-set, SequenceMatcher, and Swapped check)
        c_title = str(cand.get("trackName") or cand.get("name") or cand.get("title") or "")
        c_artist = str(cand.get("artistName") or cand.get("artist") or "")

        title_sim = cls.calculate_similarity(target_title, c_title)
        artist_sim = cls.calculate_similarity(target_artist, c_artist)

        swapped_title_sim = cls.calculate_similarity(target_title, c_artist)
        swapped_artist_sim = cls.calculate_similarity(target_artist, c_title)

        direct_sim = (40.0 * title_sim) + (30.0 * artist_sim)
        swapped_sim = (40.0 * swapped_title_sim) + (30.0 * swapped_artist_sim)
        meta_sim = max(direct_sim, max(0.0, swapped_sim - 5.0))

        best_title_sim = max(title_sim, swapped_title_sim)

        # Unrelated check: title similarity < 0.40 or combined similarity < 35.0 (out of 70.0)
        is_unrelated = bool(best_title_sim < 0.40 or meta_sim < 35.0)

        # Completeness / Stub check:
        # If target duration > 60s, or cand duration > 60s, or target_duration is None
        is_long_or_unknown = bool(
            valid_target_dur is None
            or (effective_duration is not None and effective_duration > 60.0)
        )
        is_stub = bool(is_long_or_unknown and line_count < 6)

        # Truncated snippet check (for synced lyrics):
        is_truncated = False
        if is_synced and effective_duration and effective_duration > 60.0:
            ts_matches = re.findall(r"\[(\d{1,4}):(\d{2})(?:\.(\d{1,3}))?\]", synced_lrc)
            if ts_matches:
                max_ts = 0.0
                for m in ts_matches:
                    mins = int(m[0])
                    secs = int(m[1])
                    frac = float(f"0.{m[2]}") if m[2] else 0.0
                    ts = mins * 60 + secs + frac
                    if ts > max_ts:
                        max_ts = ts
                if max_ts < 0.5 * effective_duration:
                    is_truncated = True

        score = 0.0

        # 2. Synced Lyrics Preference & Gating:
        # Gate the +100.0 bonus on not being a stub, not being a truncated snippet, and not being unrelated
        if is_synced:
            if not is_stub and not is_truncated and not is_unrelated:
                score += 100.0
        else:
            score -= 10.0

        # 3. Line count completeness scoring
        if is_stub:
            score -= 140.0
        else:
            score += min(20.0, float(line_count) * 1.0)

        # 4. Truncated snippet penalty
        if is_truncated and not is_stub:
            score -= 130.0

        # 5. Unrelated song mismatch penalty
        if is_unrelated:
            score -= 60.0

        # 6. Duration Proximity & Escalated Mismatch Penalty (>30s)
        if valid_target_dur is not None and cand_dur is not None:
            diff = abs(cand_dur - valid_target_dur)
            if diff <= 3.0:
                score += 50.0 - (diff * 2.0)
            elif diff <= 8.0:
                score += 35.0 - ((diff - 3.0) * 2.0)
            elif diff <= 20.0:
                score += 15.0 - ((diff - 8.0) * 1.0)
            elif diff <= 30.0:
                score -= 10.0 + ((diff - 20.0) * 1.5)
            else:
                score -= min(120.0, 25.0 + ((diff - 30.0) * 2.5))

        # 7. Add metadata similarity
        score += meta_sim

        return score

    @classmethod
    def rank_candidates_with_score(
        cls,
        candidates: list[dict[str, Any]],
        target_title: str,
        target_artist: str,
        target_duration: float | None = None,
    ) -> tuple[dict[str, Any] | None, float]:
        if not candidates or not isinstance(candidates, list):
            return None, -float("inf")

        scored: list[tuple[float, dict[str, Any]]] = []
        for cand in candidates:
            if not isinstance(cand, dict):
                continue
            synced_lrc = (cand.get("syncedLyrics") or "").strip()
            plain_lrc = (cand.get("plainLyrics") or "").strip()
            if not synced_lrc and not plain_lrc:
                continue

            score = cls.score_candidate(cand, target_title, target_artist, target_duration)
            scored.append((score, cand))

        if not scored:
            return None, -float("inf")

        # Stable sort preserving original candidate order for ties
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1], scored[0][0]

    @classmethod
    def rank_candidates(
        cls,
        candidates: list[dict[str, Any]],
        target_title: str,
        target_artist: str,
        target_duration: float | None = None,
    ) -> dict[str, Any] | None:
        """
        Rank search candidates from LRCLIB using a multi-objective scoring formula.
        Returns the top-ranked candidate dict or None.
        """
        best_cand, _ = cls.rank_candidates_with_score(
            candidates, target_title, target_artist, target_duration
        )
        return best_cand

    @classmethod
    def generate_query_ladder(
        cls, track_name: str, artist_name: str, duration: float | None = None
    ) -> list[dict[str, Any]]:
        """
        Generate multi-stage LRCLIB query fallback ladder:
          Stage 1: Exact /api/get with duration (if duration > 0)
          Stage 2: Exact /api/get without duration
          Stage 3: Search q = f"{clean_title} {clean_artist}"
          Stage 4: Search q = f"{clean_title} {primary_artist}" (if different)
          Stage 5: Search q = f"{base_title} {primary_artist}" (if different)
          Stage 6: Search swapped q = f"{clean_artist} {clean_title}"
          Stage 7: Search q = f"{base_title}" (title-only)
        """
        clean_title, clean_artist = LyricsNormalizer.normalize_track_metadata(
            track_name, artist_name
        )
        primary_artist = LyricsNormalizer.extract_primary_artist(clean_artist)
        base_title = LyricsNormalizer.extract_base_title(clean_title)

        ladder: list[dict[str, Any]] = []

        is_valid_duration = (
            duration is not None
            and isinstance(duration, (int, float))
            and math.isfinite(duration)
            and duration > 0
        )
        safe_duration = int(duration) if is_valid_duration else None

        # Stage 1: Exact /api/get with duration (only if valid, finite, > 0)
        if safe_duration is not None:
            ladder.append(
                {
                    "stage": 1,
                    "type": "get",
                    "endpoint": "/get",
                    "track_name": clean_title,
                    "artist_name": clean_artist,
                    "duration": safe_duration,
                    "params": {
                        "track_name": clean_title,
                        "artist_name": clean_artist,
                        "duration": safe_duration,
                    },
                    "description": "Exact GET with duration",
                }
            )

        # Stage 2: Exact /api/get without duration
        ladder.append(
            {
                "stage": 2,
                "type": "get",
                "endpoint": "/get",
                "track_name": clean_title,
                "artist_name": clean_artist,
                "params": {
                    "track_name": clean_title,
                    "artist_name": clean_artist,
                },
                "description": "Exact GET without duration",
            }
        )

        # Stage 3: Search q = f"{clean_title} {clean_artist}"
        q3 = f"{clean_title} {clean_artist}".strip()
        ladder.append(
            {
                "stage": 3,
                "type": "search",
                "endpoint": "/search",
                "q": q3,
                "params": {"q": q3},
                "description": "Search clean title and clean artist",
            }
        )

        # Stage 4: Search q = f"{clean_title} {primary_artist}" (if different)
        q4 = f"{clean_title} {primary_artist}".strip()
        if (
            primary_artist
            and primary_artist.lower() != clean_artist.lower()
            and q4.lower() != q3.lower()
        ):
            ladder.append(
                {
                    "stage": 4,
                    "type": "search",
                    "endpoint": "/search",
                    "q": q4,
                    "params": {"q": q4},
                    "description": "Search clean title and primary artist",
                }
            )

        # Stage 5: Search q = f"{base_title} {primary_artist}" (if different)
        q5 = f"{base_title} {primary_artist}".strip()
        if base_title and q5.lower() not in (q3.lower(), q4.lower()):
            ladder.append(
                {
                    "stage": 5,
                    "type": "search",
                    "endpoint": "/search",
                    "q": q5,
                    "params": {"q": q5},
                    "description": "Search base title and primary artist",
                }
            )

        # Stage 6: Search swapped q = f"{clean_artist} {clean_title}"
        q6 = f"{clean_artist} {clean_title}".strip()
        if clean_artist and clean_artist != "Unknown Artist" and q6.lower() != q3.lower():
            ladder.append(
                {
                    "stage": 6,
                    "type": "search",
                    "endpoint": "/search",
                    "q": q6,
                    "params": {"q": q6},
                    "description": "Search swapped artist and title",
                }
            )

        # Stage 7: Search q = f"{base_title}" (title-only)
        q7 = base_title.strip()
        seen_queries = {q3.lower(), q4.lower(), q5.lower(), q6.lower()}
        if q7 and q7.lower() not in seen_queries:
            ladder.append(
                {
                    "stage": 7,
                    "type": "search",
                    "endpoint": "/search",
                    "q": q7,
                    "params": {"q": q7},
                    "description": "Search base title only",
                }
            )

        return ladder

    @staticmethod
    def normalize_candidate(item: dict[str, Any]) -> dict[str, Any]:
        """An LRCLIB search result with the studio's snake_case keys (LRCLIB answers in
        camelCase) and safe types: missing or null fields become empty values."""
        return {
            "id": item.get("id"),
            "track_name": item.get("trackName") or item.get("name") or item.get("track_name") or "",
            "artist_name": item.get("artistName") or item.get("artist_name") or "",
            "album_name": item.get("albumName") or item.get("album_name") or "",
            "duration": float(item.get("duration", 0.0) or 0.0),
            "instrumental": bool(item.get("instrumental", False)),
            "plain_lyrics": item.get("plainLyrics") or item.get("plain_lyrics") or "",
            "synced_lyrics": item.get("syncedLyrics") or item.get("synced_lyrics") or "",
        }

    def search_lyrics(
        self, track_name: str, artist_name: str | None = None
    ) -> list[dict[str, Any]]:
        """LRCLIB's candidates for a title and artist, for the studio's lyric picker: a
        structured search, then a free-text one when that finds nothing. A network error
        gives no candidates."""
        title = (track_name or "").strip()
        artist = (artist_name or "").strip()
        params = {
            name: value for name, value in (("track_name", title), ("artist_name", artist)) if value
        }
        results = self._search_lrclib(params)
        if not results and (title or artist):
            results = self._search_lrclib({"q": f"{title} {artist}".strip()})
        return [self.normalize_candidate(item) for item in results if isinstance(item, dict)]

    def _search_lrclib(self, params: dict[str, str]) -> list[Any]:
        try:
            resp = requests.get(f"{self.lrclib_url}/search", params=params, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.warning(f"LRCLIB search failed ({params}): {e}")
        return []

    def _fetch_from_lrclib(
        self, track_name: str, artist_name: str, duration: float | None
    ) -> dict[str, Any] | None:
        try:
            safe_duration = (
                float(duration)
                if (
                    duration is not None
                    and isinstance(duration, (int, float))
                    and math.isfinite(duration)
                    and duration > 0
                )
                else None
            )
            ladder = self.generate_query_ladder(track_name, artist_name, safe_duration)
            clean_title, clean_artist = LyricsNormalizer.normalize_track_metadata(
                track_name, artist_name
            )

            exact_plain = ""
            exact_synced_cand: dict[str, Any] | None = None
            best_candidate_overall: dict[str, Any] | None = None
            best_score_overall: float = -float("inf")

            for step in ladder:
                stype = step["type"]
                endpoint = step["endpoint"]
                params = step["params"]

                if stype == "get":
                    resp = requests.get(f"{self.lrclib_url}{endpoint}", params=params, timeout=5)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list) and data:
                            data = data[0]
                        if not isinstance(data, dict):
                            continue
                        data.setdefault("trackName", clean_title)
                        data.setdefault("artistName", clean_artist)
                        if safe_duration is not None:
                            data.setdefault("duration", safe_duration)
                        synced = bool(data.get("syncedLyrics"))
                        lrc = data.get("syncedLyrics") or ""
                        plain = data.get("plainLyrics") or ""
                        if plain and not exact_plain:
                            exact_plain = plain

                        if synced and self.is_lrc(lrc):
                            if exact_synced_cand is None:
                                exact_synced_cand = data
                            score = self.score_candidate(
                                data, clean_title, clean_artist, safe_duration
                            )
                            if score > 0:
                                lines = self.parse_lrc(lrc)
                                return {
                                    "source": "lrclib",
                                    "synced": True,
                                    "plain_lyrics": plain,
                                    "lrc": lrc,
                                    "lines": lines,
                                }
                    # If 404 or plain-only or invalid synced, proceed to next stage

                elif stype == "search":
                    resp = requests.get(f"{self.lrclib_url}{endpoint}", params=params, timeout=5)
                    if resp.status_code == 200:
                        results = resp.json()
                        if results and isinstance(results, list):
                            best_cand, cand_score = self.rank_candidates_with_score(
                                results,
                                target_title=clean_title,
                                target_artist=clean_artist,
                                target_duration=safe_duration,
                            )
                            if best_cand and cand_score > best_score_overall:
                                best_score_overall = cand_score
                                best_candidate_overall = best_cand

                                # If we found a high quality synced candidate in search:
                                has_synced = bool(best_cand.get("syncedLyrics")) and self.is_lrc(
                                    best_cand["syncedLyrics"]
                                )
                                if has_synced and cand_score >= 50.0:
                                    lrc = best_cand["syncedLyrics"]
                                    plain = best_cand.get("plainLyrics") or ""
                                    return {
                                        "source": "lrclib_search",
                                        "synced": True,
                                        "plain_lyrics": plain,
                                        "lrc": lrc,
                                        "lines": self.parse_lrc(lrc),
                                    }

            # If all stages completed and we found a search candidate
            if best_candidate_overall:
                has_synced = bool(best_candidate_overall.get("syncedLyrics")) and self.is_lrc(
                    best_candidate_overall["syncedLyrics"]
                )
                lrc = best_candidate_overall.get("syncedLyrics") or ""
                plain = best_candidate_overall.get("plainLyrics") or ""
                lines = self.parse_lrc(lrc) if has_synced else self.parse_plain_text(plain)
                return {
                    "source": "lrclib_search",
                    "synced": has_synced,
                    "plain_lyrics": plain,
                    "lrc": lrc,
                    "lines": lines,
                }

            # Fallback to exact match synced lyrics if search found no candidate
            if exact_synced_cand:
                lrc = exact_synced_cand.get("syncedLyrics") or ""
                plain = exact_synced_cand.get("plainLyrics") or ""
                lines = self.parse_lrc(lrc)
                return {
                    "source": "lrclib",
                    "synced": True,
                    "plain_lyrics": plain,
                    "lrc": lrc,
                    "lines": lines,
                }

            # Fallback to exact match plain lyrics if search found no candidate
            if exact_plain:
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

        # [offset:+/-ms] header. LRC convention: a positive offset makes the lyrics appear
        # sooner, so it is subtracted from every timestamp.
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
                adj_timestamp = round(max(0.0, timestamp - offset_sec), 3)
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
                    ts = round(max(0.0, raw_ts - offset_sec), 3)
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
        """Parses plain multiline text into unaligned line items, skipping section labels
        such as "[Chorus]" that are not sung."""
        lines = []
        raw_lines = [
            line.strip()
            for line in text.split("\n")
            if line.strip() and not is_section_heading(line)
        ]
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


def extract_canonical(track_name: str, artist_name: str) -> tuple[str, str]:
    """Extract canonical track title and artist name."""
    return LyricsNormalizer.extract_canonical(track_name, artist_name)


def extract_primary_artist(artist_name: str) -> str:
    """Extract primary artist name from collaborative or multi-artist strings."""
    return LyricsNormalizer.extract_primary_artist(artist_name)


def extract_base_title(track_name: str) -> str:
    """Extract base track title by stripping subtitle clauses and version tags."""
    return LyricsNormalizer.extract_base_title(track_name)


def generate_query_ladder(
    track_name: str, artist_name: str, duration: float | None = None
) -> list[dict[str, Any]]:
    """Generate multi-stage LRCLIB query fallback ladder."""
    return LyricsService.generate_query_ladder(track_name, artist_name, duration)
