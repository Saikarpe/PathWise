"""Exercise every API endpoint against the seeded database.

Scratch harness, not a test suite — it prints what each endpoint returns so the
shapes can be eyeballed. Run from ``backend/``:

    PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe probe_api.py
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.main import app

#: The throwaway account this probe registers. Removed before each run so the
#: registration path is genuinely exercised rather than 409-ing on its own leftovers.
PROBE_EMAIL = "probe@example.com"

FAILURES: list[str] = []


def reset_probe_account() -> None:
    from sqlalchemy import select

    from app.core.database import SessionLocal
    from app.models.user import User

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == PROBE_EMAIL))
        if user is not None:
            db.delete(user)
            db.commit()
            print(f"(removed leftover {PROBE_EMAIL})")


def show(label: str, response, keys: list[str] | None = None, expect: int = 200) -> dict:
    ok = response.status_code == expect
    if not ok:
        FAILURES.append(f"{label}: {response.status_code} != {expect}")
    mark = "ok " if ok else "FAIL"
    print(f"[{mark}] {label:<52} {response.status_code}  {response.headers.get('X-Process-Time-Ms', '?')}ms")
    if not ok:
        print("       ", response.text[:400])
        return {}
    if response.status_code == 204 or not response.content:
        return {}
    body = response.json()
    # Bare arrays are wrapped *before* the key loop, not after, so a probe can ask
    # for "_list" and actually see it.
    if not isinstance(body, dict):
        body = {"_list": body, "_count": len(body) if isinstance(body, list) else None}
    if keys:
        for key in keys:
            rendered = json.dumps(body.get(key), default=str)
            print(f"        {key}: {rendered[:220]}")
    return body


def main() -> int:
    reset_probe_account()
    with TestClient(app) as client:
        print("=" * 100)
        print("META")
        print("=" * 100)
        show("GET /", client.get("/"))
        show("GET /api/health", client.get("/api/health"), ["status", "engine"])

        print()
        print("=" * 100)
        print("AUTH")
        print("=" * 100)
        show("GET /api/auth/demo-users", client.get("/api/auth/demo-users"), ["seeded", "accounts"])
        show("GET /api/auth/me (no token)", client.get("/api/auth/me"), expect=401)

        registered = show(
            "POST /api/auth/register",
            client.post(
                "/api/auth/register",
                json={"email": PROBE_EMAIL, "password": "probe1234", "full_name": "Probe"},
            ),
            ["token_type", "expires_in"],
            expect=201,
        )
        show(
            "POST /api/auth/register (duplicate)",
            client.post(
                "/api/auth/register",
                json={"email": PROBE_EMAIL, "password": "probe1234", "full_name": "Probe"},
            ),
            expect=409,
        )
        show(
            "POST /api/auth/login (wrong password)",
            client.post("/api/auth/login", json={"email": PROBE_EMAIL, "password": "nope"}),
            expect=401,
        )
        fresh = {"Authorization": f"Bearer {registered['access_token']}"}

        demo = show(
            "POST /api/auth/demo-login (aarav)",
            client.post("/api/auth/demo-login", params={"email": "aarav@demo.dev"}),
            ["user"],
        )
        auth = {"Authorization": f"Bearer {demo['access_token']}"}
        show(
            "POST /api/auth/demo-login (not a demo account)",
            client.post("/api/auth/demo-login", params={"email": "nobody@example.com"}),
            expect=404,
        )
        show("GET /api/auth/me", client.get("/api/auth/me", headers=auth), ["email", "goal_text"])

        print()
        print("=" * 100)
        print("CATALOG  (unauthenticated where possible)")
        print("=" * 100)
        show("GET /api/catalog/stats", client.get("/api/catalog/stats"), ["courses", "prerequisite_rungs"])
        tax = show("GET /api/catalog/taxonomy", client.get("/api/catalog/taxonomy"), ["difficulty_levels", "providers"])
        print(f"        branches: {len(tax.get('branches', []))}, skills: {len(tax.get('skills', []))}")
        show(
            "POST /api/catalog/search (semantic + filter)",
            client.post(
                "/api/catalog/search",
                json={"q": "neural networks for images", "branch": "computer science engineering", "limit": 3},
            ),
            ["count", "total_matching"],
        )
        found = show(
            "POST /api/catalog/search (loose branch spelling)",
            client.post("/api/catalog/search", json={"branch": "mechanical", "limit": 2}),
            ["count", "total_matching"],
        )
        show(
            "POST /api/catalog/search (impossible filter combo)",
            client.post(
                "/api/catalog/search",
                json={"branch": "Civil Engineering", "track": "Machine Learning", "limit": 5},
            ),
            ["count"],
        )
        sample_id = found["results"][0]["course_id"] if found.get("results") else "CSE-0001"
        show(
            f"GET /api/catalog/courses/{sample_id} (anon)",
            client.get(f"/api/catalog/courses/{sample_id}"),
            ["rung", "prerequisite_chain", "status"],
        )
        show(
            f"GET /api/catalog/courses/{sample_id} (auth)",
            client.get(f"/api/catalog/courses/{sample_id}", headers=auth),
            ["status"],
        )
        show("GET /api/catalog/courses/NOPE-9999", client.get("/api/catalog/courses/NOPE-9999"), expect=404)
        skill = (tax.get("skills") or ["python programming"])[0]
        show(
            f"GET /api/catalog/skills/{skill}",
            client.get(f"/api/catalog/skills/{skill}"),
            ["course_count", "prevalence", "central_to_tracks"],
        )
        show("GET /api/catalog/skills/nonsense", client.get("/api/catalog/skills/nonsense"), expect=404)

        print()
        print("=" * 100)
        print("PROFILE")
        print("=" * 100)
        show("GET /api/profile", client.get("/api/profile", headers=auth), ["experience_level", "interests"])
        show(
            "PUT /api/profile",
            client.put(
                "/api/profile",
                headers=auth,
                json={"weekly_hours": 12, "preferred_formats": ["Interactive Lab"]},
            ),
            ["weekly_hours", "preferred_formats"],
        )
        show(
            "POST /api/profile/interpret",
            client.post(
                "/api/profile/interpret",
                headers=auth,
                json={"text": "I want to be a computer vision engineer, 6 hours a week for 3 months"},
            ),
            ["resolved_tracks", "plannable", "weekly_hours", "timeline_weeks"],
        )
        show(
            "POST /api/profile/interpret (gibberish)",
            client.post("/api/profile/interpret", headers=auth, json={"text": "zzzz qqqq"}),
            ["plannable"],
        )
        show("GET /api/profile/skills", client.get("/api/profile/skills", headers=auth), ["skills"])
        vocab = show("GET /api/profile/vocabulary", client.get("/api/profile/vocabulary", headers=auth))
        print(f"        keys: {sorted(vocab)}")

        print()
        print("=" * 100)
        print("PATHS")
        print("=" * 100)
        active = show(
            "GET /api/paths/active",
            client.get("/api/paths/active", headers=auth),
            ["has_path", "title", "total_hours", "estimated_weeks"],
        )
        path_id = active.get("id")
        print(f"        items: {len(active.get('items') or [])}, milestones: {len(active.get('milestones') or [])}")
        explanation = active.get("explanation") or {}
        print(f"        explanation keys: {sorted(explanation)}")
        show("GET /api/paths", client.get("/api/paths", headers=auth), ["_list"])
        show(f"GET /api/paths/{path_id}", client.get(f"/api/paths/{path_id}", headers=auth), ["title"])
        graph = show(
            f"GET /api/paths/{path_id}/graph",
            client.get(f"/api/paths/{path_id}/graph", headers=auth),
            ["nodes", "edges"],
        )
        print(f"        {len(graph.get('nodes', []))} nodes, {len(graph.get('edges', []))} edges")
        first_item = (active.get("items") or [{}])[0]
        show(
            f"GET /api/paths/{path_id}/items/{first_item.get('id')}/explain",
            client.get(f"/api/paths/{path_id}/items/{first_item.get('id')}/explain", headers=auth),
            ["explanation"],
        )
        show(
            "GET /api/paths/999999 (not mine)",
            client.get("/api/paths/999999", headers=auth),
            expect=404,
        )
        show(
            "GET /api/paths/active (fresh account, no path)",
            client.get("/api/paths/active", headers=fresh),
            ["has_path"],
        )
        show(
            "POST /api/paths/generate (preview, fresh account)",
            client.post(
                "/api/paths/generate",
                headers=fresh,
                json={"goal_text": "I want to learn embedded systems", "preview": True},
            ),
            ["preview", "interpretation"],
            expect=200,
        )
        show(
            "POST /api/paths/generate (unresolvable goal)",
            client.post("/api/paths/generate", headers=fresh, json={"goal_text": "qqqq zzzz"}),
            expect=422,
        )
        created = show(
            "POST /api/paths/generate (commit)",
            client.post(
                "/api/paths/generate",
                headers=fresh,
                json={"goal_text": "I want to learn embedded systems, 6 hours a week"},
            ),
            ["title", "total_hours"],
            expect=201,
        )
        new_id = created.get("id")
        target = next(
            (i for i in created.get("items", []) if i.get("item_type") == "course"), {}
        )
        show(
            f"POST /api/paths/{new_id}/progress (completed)",
            client.post(
                f"/api/paths/{new_id}/progress",
                headers=fresh,
                json={"course_id": target.get("course_id"), "status": "completed", "rating": 5},
            ),
            ["status", "adaptation"],
        )
        show(
            f"POST /api/paths/{new_id}/progress (unknown course)",
            client.post(
                f"/api/paths/{new_id}/progress",
                headers=fresh,
                json={"course_id": "NOPE-0000", "status": "completed"},
            ),
            expect=404,
        )
        show(
            f"POST /api/paths/{new_id}/archive",
            client.post(f"/api/paths/{new_id}/archive", headers=fresh),
            ["status"],
        )
        show(
            f"POST /api/paths/{new_id}/activate",
            client.post(f"/api/paths/{new_id}/activate", headers=fresh),
            ["status"],
        )

        print()
        print("=" * 100)
        print("RECOMMENDATIONS")
        print("=" * 100)
        recs = show(
            "POST /api/recommendations (from profile)",
            client.post("/api/recommendations", headers=auth, json={"limit": 5}),
            ["count", "goal"],
        )
        for r in recs.get("results", [])[:3]:
            alts = len(r.get("alternatives", []))
            print(
                f"        #{r['rank']} {r['course']['title'][:44]:<44} "
                f"score={r['score']:.3f} alts={alts}  {r['explanation']['headline'][:60]}"
            )
        # Nothing already finished may be recommended, and neither may a sibling
        # variant of a finished course — same track, same tier, different provider
        # is the same material.
        activity = client.get("/api/dashboard/activity", headers=auth).json()
        done = {
            e["course_id"] for e in activity.get("enrollments", []) if e.get("status") == "completed"
        }
        offered = {r["course"]["course_id"] for r in recs.get("results", [])} | {
            a["course_id"] for r in recs.get("results", []) for a in r.get("alternatives", [])
        }
        repeats = done & offered
        print(f"        completed={len(done)} offered={len(offered)} repeats={sorted(repeats)}")
        if repeats:
            FAILURES.append(f"recommendations repeated completed courses: {sorted(repeats)}")
        titles = [r["course"]["title"] for r in recs.get("results", [])]
        if len(titles) != len(set(titles)):
            FAILURES.append(f"recommendations contain duplicate titles: {titles}")
        show(
            "POST /api/recommendations (explicit goal)",
            client.post(
                "/api/recommendations",
                headers=auth,
                json={"goal_text": "reinforcement learning", "limit": 3},
            ),
            ["count"],
        )
        show(
            "POST /api/recommendations (unresolvable goal)",
            client.post("/api/recommendations", headers=auth, json={"goal_text": "qqqq zzzz"}),
            expect=422,
        )
        top = recs["results"][0]
        show(
            f"GET /api/recommendations/similar/{top['course']['course_id']}",
            client.get(f"/api/recommendations/similar/{top['course']['course_id']}"),
            ["similar"],
        )
        show(
            "POST /api/recommendations/feedback (dislike)",
            client.post(
                "/api/recommendations/feedback",
                headers=auth,
                json={
                    "event_type": "dislike",
                    "course_id": top["course"]["course_id"],
                    "factors": top.get("contributions") or top.get("factors"),
                    "comment": "not what I meant",
                },
            ),
            ["explanation", "weight_deltas"],
        )
        show(
            "POST /api/recommendations/feedback (bad event type)",
            client.post(
                "/api/recommendations/feedback",
                headers=auth,
                json={"event_type": "shrug", "course_id": top["course"]["course_id"]},
            ),
            expect=422,
        )
        model = show(
            "GET /api/recommendations/model",
            client.get("/api/recommendations/model", headers=auth),
            ["difficulty_bias", "update_count", "personalised"],
        )
        moved = [w for w in model.get("weights", []) if abs(w["delta"]) > 1e-6]
        print(f"        moved factors: {[(w['factor'], w['delta']) for w in moved][:6]}")

        print()
        print("=" * 100)
        print("DASHBOARD")
        print("=" * 100)
        dash = show(
            "GET /api/dashboard",
            client.get("/api/dashboard", headers=auth),
            ["progress", "weeks_elapsed", "weeks_behind", "readiness_after"],
        )
        print(f"        keys: {sorted(dash)}")
        show("GET /api/dashboard/next", client.get("/api/dashboard/next", headers=auth), ["next_item"])
        show(
            "GET /api/dashboard/activity",
            client.get("/api/dashboard/activity", headers=auth),
            ["counts", "hours_logged"],
        )
        show(
            "GET /api/dashboard (fresh account)",
            client.get("/api/dashboard", headers=fresh),
            ["progress", "has_path"],
        )

        print()
        print("=" * 100)
        print("CHAT")
        print("=" * 100)
        # ``mutating`` records whether the message is *allowed* to change the
        # learner's plan. Questions and progress checks are not: a question once
        # matched a track via LSA and silently re-planned an ML learner's path onto
        # Project Management, so read-only-ness is asserted rather than assumed.
        conversation = [
            ("hi", False),
            ("I want to move into MLOps and deployment", True),
            ("why did you pick the first course?", False),
            ("actually I only have 4 hours a week", True),
            ("how am I doing?", False),
            ("what is the difference between a course and a project here?", False),
        ]
        for message, mutating in conversation:
            before = client.get("/api/paths/active", headers=auth).json()
            before_goal = client.get("/api/auth/me", headers=auth).json().get("goal_text")
            turn = show(
                f"POST /api/chat  {message!r}",
                client.post("/api/chat", headers=auth, json={"message": message}),
                ["intent", "intent_confidence", "source", "path_id"],
            )
            print(f"        reply: {(turn.get('reply') or '')[:200]}")
            if mutating:
                continue
            after = client.get("/api/paths/active", headers=auth).json()
            after_goal = client.get("/api/auth/me", headers=auth).json().get("goal_text")
            if before.get("id") != after.get("id"):
                FAILURES.append(
                    f"chat {message!r} (read-only) replaced the active path: "
                    f"{before.get('id')} -> {after.get('id')} ({after.get('title')!r})"
                )
                print(f"        !! path changed to {after.get('title')!r}")
            if before_goal != after_goal:
                FAILURES.append(f"chat {message!r} (read-only) rewrote goal_text")
                print(f"        !! goal_text rewritten to {str(after_goal)[:120]!r}")
        show("GET /api/chat/history", client.get("/api/chat/history", headers=auth), ["_list"])
        show(
            "DELETE /api/chat/history",
            client.delete("/api/chat/history", headers=auth),
            expect=204,
        )

    print()
    print("=" * 100)
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES")
        for failure in FAILURES:
            print("  -", failure)
        return 1
    print("all endpoints returned their expected status")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
