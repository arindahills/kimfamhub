"""Unit tests for project_timeline.build_timeline — run: python3 test_project_timeline.py"""
from datetime import datetime, timezone
from project_timeline import build_timeline


def dt(y, m, d):
    return datetime(y, m, d, tzinfo=timezone.utc)


def _db(*items):
    """items: (id, 'DD Mon YYYY', text, images, videos, created_at) newest-first."""
    return [{"id": i, "date": d, "text": t, "images": im, "videos": vi, "created_at": ca}
            for (i, d, t, im, vi, ca) in items]


def test_newest_first_and_hardcoded_media_preserved():
    db = _db((25, "28 Aug 2026", "cow recovered well KIM/07/26-11", [], [], dt(2026, 8, 28)),
             (19, "20 Aug 2026", "cow leg wound noted KIM/07/26-11", [], [], dt(2026, 8, 20)))
    hc = {"date": "15 Aug 2026", "author": "Family", "text": "Tuhimbises cow purchased",
          "images": ["pic.jpg"], "videos": []}
    tl = build_timeline(db, hc)
    assert [u["id"] for u in tl] == [25, 19, None]              # newest-first, hardcoded last
    assert tl[0]["superseded"] is False                        # newest never superseded
    assert tl[1]["superseded"] is True                         # text-only, same ref, older
    assert tl[2]["superseded"] is False and tl[2]["images"] == ["pic.jpg"]


def test_MAJOR1_hardcoded_survives_the_cap():
    """6 newer DB updates must NOT evict the media-rich hardcoded row."""
    db = _db(*[(i, "0%d Sep 2026" % (i + 1), "u%d" % i, [], [], dt(2026, 9, i + 10))
               for i in range(6)])
    hc = {"date": "01 Jan 2026", "author": "A", "text": "septic tank photos",
          "images": ["a.jpg", "b.jpg"], "videos": ["v.mp4"]}
    tl = build_timeline(db, hc, limit=6)
    assert len(tl) == 6
    pinned = [u for u in tl if u["text"] == "septic tank photos"]
    assert pinned and pinned[0]["images"] == ["a.jpg", "b.jpg"]  # pin present despite 6 newer


def test_MAJOR2_media_report_not_superseded_by_ref_mention():
    """A newer one-line 'ref done' note must NOT hide an older media-rich report."""
    db = _db((30, "05 Sep 2026", "KIM/07/26-3 done", [], [], dt(2026, 9, 5)),
             (28, "03 Sep 2026", "ploughing progress KIM/07/26-3", ["p1.jpg", "p2.jpg"], ["v.mp4"], dt(2026, 9, 3)))
    tl = build_timeline(db, None)
    older = next(u for u in tl if u["id"] == 28)
    assert older["superseded"] is False                        # has media → never hidden


def test_text_only_superseded_but_distinct_ref_kept():
    db = _db((3, "03 Sep 2026", "settled KIM/01/26-1", [], [], dt(2026, 9, 3)),
             (2, "02 Sep 2026", "note KIM/01/26-1", [], [], dt(2026, 9, 2)),
             (1, "01 Sep 2026", "other KIM/09/26-9", [], [], dt(2026, 9, 1)))
    tl = build_timeline(db, None)
    flags = {u["id"]: u["superseded"] for u in tl}
    assert flags == {3: False, 2: True, 1: False}              # only the same-ref text-only older


def test_identical_text_dedup_keeps_more_media():
    db = _db((9, "01 Sep 2026", "same text", [], [], dt(2026, 9, 1)))
    hc = {"date": "01 Sep 2026", "author": "A", "text": "same text", "images": ["x.jpg"], "videos": []}
    tl = build_timeline(db, hc)
    assert len(tl) == 1 and tl[0]["images"] == ["x.jpg"]        # no dupe, media upgraded


def test_hardcoded_newer_sorts_top_and_no_ref_never_superseded():
    db = _db((1, "01 Jan 2026", "old note", [], [], dt(2026, 1, 1)))
    hc = {"date": "01 Sep 2026", "author": "A", "text": "brand new", "images": [], "videos": []}
    tl = build_timeline(db, hc)
    assert [u["id"] for u in tl] == [None, 1]
    assert all(u["superseded"] is False for u in tl)           # no action refs anywhere


def test_no_mutation_of_input():
    row = {"id": 1, "date": "01 Sep 2026", "text": "x", "images": [], "videos": [], "created_at": dt(2026, 9, 1)}
    db = [row]
    build_timeline(db, None)
    assert "superseded" not in row and "_pinned" not in row    # caller dict untouched


def test_empty():
    assert build_timeline([], None) == []
    assert build_timeline(None, None) == []


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print("  ok", fn.__name__)
    print("\nAll %d tests passed." % len(fns))
