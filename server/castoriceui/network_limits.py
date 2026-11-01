"""One policy file shared by probe collection, mutations and the browser editor."""
import json
from pathlib import Path

NETWORK_LIMITS = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
MAX_NETWORK_TARGETS = NETWORK_LIMITS['maxTargets']
