#!/usr/bin/env python3
"""
Backfill for the speaker map (issue #106). Both steps are idempotent and neither ever confirms anything.

    python3 scripts/speaker_backfill.py labels        # set decisions.speaker_label from each quote's turn
    python3 scripts/speaker_backfill.py suggestions   # create suggested meeting_speakers rows (non-private meetings)
    python3 scripts/speaker_backfill.py all

Prints counts only, never transcript text. Run in the app dir with DATABASE_URL set.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import speaker_map  # noqa: E402


def main(argv):
    what = argv[1] if len(argv) > 1 else "all"
    if what not in ("labels", "suggestions", "all"):
        print(__doc__)
        return 2
    if what in ("labels", "all"):
        print("labels:", speaker_map.backfill_decision_labels())
    if what in ("suggestions", "all"):
        print("suggestions:", speaker_map.backfill_suggestions())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
