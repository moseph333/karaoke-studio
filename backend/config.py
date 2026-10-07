import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("KARAOKE_DATA_DIR", BASE_DIR / "workspace_data"))
DOWNLOADS_DIR = DATA_DIR / "downloads"
STEMS_DIR = DATA_DIR / "stems"
OUTPUT_DIR = DATA_DIR / "output"
ASSETS_DIR = DATA_DIR / "assets"
BACKGROUNDS_DIR = DATA_DIR / "backgrounds"

for d in [DATA_DIR, DOWNLOADS_DIR, STEMS_DIR, OUTPUT_DIR, ASSETS_DIR, BACKGROUNDS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# Access Control
APP_PASSWORD = os.getenv("APP_PASSWORD", "").strip()


# Default Video Configuration
DEFAULT_VIDEO_CONFIG = {
    "width": 1920,
    "height": 1080,
    "fps": 60,
    "font_name": "Montserrat",
    "font_size": 52,
    "primary_color": "&H0000FFFF",      # Vibrant yellow fill when sung
    "secondary_color": "&H00FFFFFF",    # Crisp white unsung
    "outline_color": "&H00000000",      # Pure black outline
    "shadow_color": "&H80000000",       # Soft shadow
    "outline_width": 3,
    "shadow_width": 2,
    "lead_in_countdown_dots": 3,
}

# YouTube API configuration
YOUTUBE_CLIENT_SECRETS_FILE = BASE_DIR / "client_secret.json"
