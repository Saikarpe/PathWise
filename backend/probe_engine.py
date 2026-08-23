"""Smoke check: warm the engine, exercise every DB-facing method, run chat turns."""
import asyncio
import logging
import time

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.security import hash_password
from app.ml.conversation import ConversationService
from app.ml.engine import Engine
from app.models.user import User

db_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
Base.metadata.create_all(db_engine)
SessionLocal = sessionmaker(bind=db_engine, autoflush=False)

eng = Engine()
t0 = time.perf_counter()
eng.warm()
print(f"\n=== warm: {time.perf_counter() - t0:.2f}s ===")
print("stats:", eng.stats())

db = SessionLocal()
user = User(
    email="probe@example.com",
    hashed_password=hash_password("probe1234"),
    full_name="Probe Learner",
    experience_level="Beginner",
    weekly_hours=10.0,
    timeline_weeks=20,
)
db.add(user)
db.commit()
db.refresh(user)

svc = ConversationService(eng)


async def main():
    turns = [
        "hi",
        "I want to become a machine learning engineer, I already know python basics",
        "why did you pick the first course?",
        "how am I doing?",
        "this is too easy, make it harder",
        "actually I only have 4 hours a week",
        "what providers do you use?",
        "I want to learn quantum teleportation with unicorns",
    ]
    for message in turns:
        t = time.perf_counter()
        turn = await svc.handle(db, user, message)
        ms = (time.perf_counter() - t) * 1000
        print(f"\n--- USER: {message}")
        print(f"    intent={turn.intent} conf={turn.intent_confidence:.2f} "
              f"src={turn.source} path={turn.path_id} {ms:.0f}ms")
        print(f"    {turn.reply[:600]}")
        if turn.suggestions:
            print(f"    suggestions: {turn.suggestions[:2]}")

    print("\n=== recommendations ===")
    for rec in eng.recommend(db, user, limit=3):
        print(f" #{rec['rank']} {rec['course']['title']} score={rec['score']:.3f}")
        print(f"    {rec['explanation']['headline']}")
        print(f"    drivers: {rec['explanation']['drivers']}")

    print("\n=== dashboard ===")
    snap = eng.dashboard(db, user)
    for key in ("has_path", "progress", "total_courses", "total_hours", "weeks_behind",
                "feedback_count"):
        print(f"  {key}: {snap.get(key)}")
    print(f"  phases: {[(p['name'], p['progress']) for p in snap['phases']]}")
    print(f"  milestones: {[(m['title'], m['achieved']) for m in snap['milestones']]}")
    print(f"  next_item: {(snap.get('next_item') or {}).get('title')}")
    print(f"  narrative: {snap['narrative']['headline']}")
    print(f"            {snap['narrative']['detail'][:300]}")

    print("\n=== feedback loop ===")
    path = eng.active_path(db, user)
    item = sorted(path.items, key=lambda i: i.order_index)[0]
    result = eng.record_feedback(
        db, user, event_type="dislike", course_id=item.course_id,
        factors=dict(item.factors or {}), path_id=path.id,
    )
    print("  deltas:", result["weight_deltas"])
    print("  explanation:", result["explanation"])
    print("  after:", result["weights_after"])
    print("  sum:", round(sum(result["weights_after"].values()), 4))


asyncio.run(main())
print("\nOK")
