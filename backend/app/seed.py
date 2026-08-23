"""Demo data seeding.

Run as ``python -m app.seed`` (add ``--reset`` to wipe the database first).

Why fixed demo learners exist at all: an empty recommender demonstrates nothing.
Every interesting behaviour in this system — skill-gap analysis, prerequisite
insertion, pace tracking, feedback-driven re-ranking — only becomes visible on a
learner with history. So four are seeded, each chosen to exercise a different
part of the engine:

===================  =====================================================
``ml`` (Aarav)       Career switch with partial CS background: the gap
                     analyser has something to subtract, and the planner has
                     to bridge from what he knows to where he wants to be.
``security``         Beginner, no history, tight weekly hours: shows the
                     cold-start path and the timeline-constrained plan.
``robotics``         Cross-branch move (Mechanical -> Robotics): the semantic
                     layer has to bridge two branches, and the prerequisite
                     graph has to pull in Mechatronics foundations.
``civil``            Deep in-branch specialisation with several completions
                     and mid-path progress: the dashboard, pace tracker and
                     milestone achievement all have real data to render.
===================  =====================================================

Prior completions are declared as ``(track, tier)`` pairs and resolved against
the catalogue at seed time rather than as hard-coded course ids. The ids in this
dataset are stable, but a seed script that breaks when the CSV is regenerated is
a liability, and resolving by rung is no harder to read.
"""
from __future__ import annotations

import argparse
import sys
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import Base, SessionLocal, engine as db_engine, init_db
from app.core.security import hash_password
from app.ml.engine import Engine, get_engine
from app.models.activity import ChatMessage, Enrollment, FeedbackEvent
from app.models.learning_path import LearningPath
from app.models.user import SkillState, User, utcnow

#: Shared across every demo account. Public on purpose — printed in the README
#: and offered by ``/api/auth/demo-users`` so a reviewer never has to guess.
DEMO_PASSWORD = "demo1234"

#: Consumed by ``/api/auth/demo-login``. ``email`` is the only field that endpoint
#: reads; the rest drives seeding.
DEMO_USERS: list[dict] = [
    {
        "key": "ml",
        "email": "aarav@demo.dev",
        "password": DEMO_PASSWORD,
        "full_name": "Aarav Sharma",
        "headline": "CS undergrad switching into machine learning",
        "goal_text": (
            "I'm a final-year CS student and I want to become a machine learning "
            "engineer. I've done data structures and Python, and I can put in about "
            "10 hours a week."
        ),
        "experience_level": "Intermediate",
        "primary_branch": "Computer Science Engineering",
        "target_role": "ml engineer",
        "interests": ["Machine Learning", "Data Structures & Algorithms"],
        "preferred_formats": ["Blended (Video + Project)", "Interactive Lab"],
        "preferred_providers": ["Coursera", "NPTEL"],
        "industry_interests": ["Information Technology"],
        "weekly_hours": 10.0,
        "timeline_weeks": 24,
        # Real background: he genuinely knows the CS foundations.
        "prior": [
            ("Data Structures & Algorithms", 0),
            ("Data Structures & Algorithms", 1),
            ("Database Systems", 0),
        ],
        "self_assessed": {"python programming": 0.7, "sql": 0.5},
        # Progress into the generated path, so the dashboard is populated.
        "advance": 2,
        "reactions": [("like", 0), ("too_easy", 1)],
        "chat": [
            "I want to become a machine learning engineer",
            "Why did you pick the first course?",
        ],
    },
    {
        "key": "security",
        "email": "meera@demo.dev",
        "password": DEMO_PASSWORD,
        "full_name": "Meera Iyer",
        "headline": "Beginner moving into cybersecurity, 5 hours a week",
        "goal_text": (
            "Help me get into cybersecurity. I understand basic networking but "
            "nothing else, and I only have about 5 hours a week."
        ),
        "experience_level": "Beginner",
        "primary_branch": "Computer Science Engineering",
        "target_role": "security analyst",
        "interests": ["Cybersecurity", "Computer Networks"],
        "preferred_formats": ["Video Course"],
        "preferred_providers": [],
        "industry_interests": ["Information Technology"],
        "weekly_hours": 5.0,
        "timeline_weeks": 16,
        "prior": [("Computer Networks", 0)],
        "self_assessed": {"computer networks": 0.4},
        "advance": 0,
        "reactions": [],
        "chat": ["Help me get into cybersecurity, I know some networking"],
    },
    {
        "key": "robotics",
        "email": "rohan@demo.dev",
        "password": DEMO_PASSWORD,
        "full_name": "Rohan Verma",
        "headline": "Mechanical engineer moving into robotics",
        "goal_text": (
            "I'm a mechanical engineer with four years in manufacturing and I want "
            "to move into robotics and automation. 8 hours a week."
        ),
        "experience_level": "Advanced",
        "primary_branch": "Mechanical Engineering",
        "target_role": "robotics engineer",
        "interests": ["Robotics and Automation", "Mechatronics"],
        "preferred_formats": ["Interactive Lab", "Instructor-led Live"],
        "preferred_providers": ["Udacity"],
        "industry_interests": ["Manufacturing"],
        "weekly_hours": 8.0,
        "timeline_weeks": None,
        "prior": [
            ("Manufacturing Processes", 0),
            ("Manufacturing Processes", 1),
            ("Machine Design", 0),
            ("CAD and CAM", 0),
            ("Mechanics of Materials", 0),
        ],
        "self_assessed": {"cad modeling": 0.8, "manufacturing processes": 0.75},
        "advance": 1,
        "reactions": [("too_hard", 2)],
        "chat": [
            "I'm a mechanical engineer moving into robotics",
            "How am I doing?",
        ],
    },
    {
        "key": "civil",
        "email": "priya@demo.dev",
        "password": DEMO_PASSWORD,
        "full_name": "Priya Nair",
        "headline": "Civil engineer specialising in earthquake-resistant design",
        "goal_text": (
            "I work in structural design and I want to specialise in earthquake "
            "engineering and disaster-resilient design over the next 6 months."
        ),
        "experience_level": "Advanced",
        "primary_branch": "Civil Engineering",
        "target_role": "structural engineer",
        "interests": ["Earthquake Engineering", "Structural Analysis"],
        "preferred_formats": ["Instructor-led Live", "Blended (Video + Project)"],
        "preferred_providers": ["NPTEL", "edX"],
        "industry_interests": ["Construction"],
        "weekly_hours": 12.0,
        "timeline_weeks": 26,
        "prior": [
            ("Structural Analysis", 0),
            ("Structural Analysis", 1),
            ("Reinforced Concrete Design", 0),
            ("Construction Materials", 0),
            ("Foundation Engineering", 0),
            ("Steel Structure Design", 0),
        ],
        "self_assessed": {"structural analysis": 0.85, "reinforced concrete design": 0.7},
        "advance": 3,
        "reactions": [("like", 0), ("like", 1), ("not_relevant", 3)],
        "chat": [
            "I want to specialise in earthquake engineering",
            "How am I doing?",
            "Why did you pick the first course?",
        ],
    },
]


# --------------------------------------------------------------------------- #
# Seeding
# --------------------------------------------------------------------------- #
def seed(*, reset: bool = False, quiet: bool = False) -> dict:
    """Create (or refresh) the demo learners and everything hanging off them.

    Idempotent: an existing demo learner is torn down and rebuilt rather than
    duplicated, so re-running after a code change regenerates paths against the
    current planner instead of leaving stale ones behind.
    """
    def say(message: str) -> None:
        if not quiet:
            print(message)

    if reset:
        say("Dropping all tables ...")
        Base.metadata.drop_all(bind=db_engine)
    init_db()

    say("Warming the ML engine ...")
    ml: Engine = get_engine()
    ml.warm()
    say(f"  {ml.stats()['courses']} courses, warm in {ml.stats()['warmup_seconds']}s")

    summary: list[dict] = []
    with SessionLocal() as db:
        for spec in DEMO_USERS:
            record = _seed_one(db, ml, spec, say)
            summary.append(record)

    say("")
    say(f"Seeded {len(summary)} demo learners (password: {DEMO_PASSWORD})")
    for record in summary:
        say(
            f"  {record['email']:<18} {record['path_title'] or '(no path)':<34} "
            f"{record['courses']} steps / {record['completed']} done"
        )
    return {"password": DEMO_PASSWORD, "users": summary}


def _seed_one(db: Session, ml: Engine, spec: dict, say) -> dict:
    """Build one demo learner from scratch: profile, history, path, activity."""
    email = spec["email"].lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        _purge(db, existing)
        user = existing
    else:
        user = User(email=email)
        db.add(user)

    user.full_name = spec["full_name"]
    user.hashed_password = hash_password(spec["password"])
    user.experience_level = spec["experience_level"]
    user.primary_branch = spec["primary_branch"]
    user.target_role = spec["target_role"]
    user.goal_text = spec["goal_text"]
    user.interests = list(spec["interests"])
    user.preferred_formats = list(spec["preferred_formats"])
    user.preferred_providers = list(spec["preferred_providers"])
    user.industry_interests = list(spec["industry_interests"])
    user.weekly_hours = spec["weekly_hours"]
    user.timeline_weeks = spec["timeline_weeks"]
    user.target_skills = []
    user.onboarded = True
    user.is_demo = True
    db.commit()
    db.refresh(user)

    # ---- prior history -------------------------------------------------- #
    prior_ids = _resolve_prior(ml, spec["prior"])
    # Backdated so the pace tracker has a plausible history to measure against.
    stamp = utcnow() - timedelta(weeks=len(prior_ids) + 2)
    for offset, course_id in enumerate(prior_ids):
        pos = ml.catalog.pos(course_id)  # type: ignore[union-attr]
        completed_at = stamp + timedelta(weeks=offset)
        db.add(
            Enrollment(
                user_id=user.id,
                course_id=course_id,
                status="completed",
                progress_pct=100.0,
                hours_logged=float(ml.catalog.hours[pos]),  # type: ignore[union-attr,index]
                learner_rating=4.0,
                started_at=completed_at - timedelta(weeks=1),
                completed_at=completed_at,
            )
        )
    for skill, level in spec["self_assessed"].items():
        db.add(SkillState(user_id=user.id, skill=skill, proficiency=level, source="self"))
    db.commit()

    # ---- generated path ------------------------------------------------- #
    goal = ml.interpret(spec["goal_text"])
    path = ml.create_path(db, user, goal=goal)
    if path is None:
        say(f"  ! {email}: no path could be built")
        return {
            "email": email,
            "name": spec["full_name"],
            "key": spec["key"],
            "headline": spec["headline"],
            "path_title": None,
            "courses": 0,
            "completed": 0,
        }

    # Backdate creation so "weeks elapsed" is non-zero and the pace indicator has
    # something to say. A path created this second is trivially on schedule.
    path.created_at = utcnow() - timedelta(weeks=max(spec["advance"], 1))
    db.commit()

    # ---- progress through the path -------------------------------------- #
    course_items = [
        item
        for item in sorted(path.items, key=lambda i: i.order_index)
        if item.item_type == "course" and item.course_id
    ]
    advance = min(spec["advance"], max(len(course_items) - 1, 0))
    for index, item in enumerate(course_items):
        if index < advance:
            ml.record_feedback(
                db, user, event_type="completed", course_id=item.course_id, path_id=path.id
            )
            enrollment = _enrollment(db, user, item.course_id, path.id)
            enrollment.status = "completed"
            enrollment.progress_pct = 100.0
            enrollment.hours_logged = float(item.hours or 0.0)
            enrollment.completed_at = utcnow() - timedelta(weeks=advance - index)
        elif index == advance and advance:
            enrollment = _enrollment(db, user, item.course_id, path.id)
            enrollment.status = "in_progress"
            enrollment.progress_pct = 40.0
            enrollment.hours_logged = round(float(item.hours or 0.0) * 0.4, 1)
    db.commit()

    # ---- explicit reactions --------------------------------------------- #
    for event_type, index in spec["reactions"]:
        if index < len(course_items):
            ml.record_feedback(
                db,
                user,
                event_type=event_type,
                course_id=course_items[index].course_id,
                path_id=path.id,
                factors=course_items[index].factors or None,
            )
    db.commit()

    # ---- seeded conversation -------------------------------------------- #
    # Written directly rather than run through ConversationService: replaying the
    # turns would re-plan the path and undo the progress just seeded above. The
    # transcript exists so the chat panel opens with context, not to be re-derived.
    for offset, message in enumerate(spec["chat"]):
        db.add(
            ChatMessage(
                user_id=user.id,
                role="user",
                content=message,
                created_at=utcnow() - timedelta(minutes=len(spec["chat"]) * 4 - offset * 4),
            )
        )
    db.commit()

    completed = db.scalar(
        select(Enrollment)
        .where(Enrollment.user_id == user.id, Enrollment.status == "completed")
        .order_by(Enrollment.id)
    )
    completed_count = len(
        [
            e
            for e in db.scalars(select(Enrollment).where(Enrollment.user_id == user.id))
            if e.status == "completed"
        ]
    )
    say(f"  {email}: {path.title} ({len(course_items)} courses, {completed_count} completed)")
    return {
        "email": email,
        "name": spec["full_name"],
        "key": spec["key"],
        "headline": spec["headline"],
        "path_title": path.title,
        "courses": len(course_items),
        "completed": completed_count,
        "first_completed": completed.course_id if completed else None,
    }


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _purge(db: Session, user: User) -> None:
    """Delete everything belonging to a demo learner, keeping the row and id.

    Paths cascade to their items and milestones; enrolments, feedback, chat and
    skill states are cleared explicitly. Reusing the user row keeps any bookmarked
    ids valid across a re-seed.
    """
    for path in db.scalars(select(LearningPath).where(LearningPath.user_id == user.id)):
        db.delete(path)
    for table in (Enrollment, FeedbackEvent, ChatMessage, SkillState):
        db.execute(delete(table).where(table.user_id == user.id))
    db.commit()


def _resolve_prior(ml: Engine, prior: list[tuple[str, int]]) -> list[str]:
    """Turn ``(track, tier)`` pairs into the best-rated course id at each rung."""
    cat = ml.catalog
    assert cat is not None
    out: list[str] = []
    for track, tier in prior:
        positions = cat.track_positions(track, tier=tier)
        if not positions:
            raise ValueError(
                f"Demo spec references track {track!r} tier {tier}, which is not in "
                "the catalogue. Fix the spec rather than seeding a learner whose "
                "stated background is silently empty."
            )
        best = max(positions, key=lambda p: cat.quality[p])
        course_id = cat.course_ids[best]
        if course_id not in out:
            out.append(course_id)
    return out


def _enrollment(db: Session, user: User, course_id: str, path_id: int) -> Enrollment:
    enrollment = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == course_id
        )
    )
    if enrollment is None:
        enrollment = Enrollment(user_id=user.id, course_id=course_id, path_id=path_id)
        db.add(enrollment)
        db.flush()
    enrollment.path_id = path_id
    return enrollment


def public_demo_users() -> list[dict]:
    """Safe-to-expose descriptions of the demo accounts, for the login screen."""
    return [
        {
            "email": spec["email"],
            "name": spec["full_name"],
            "headline": spec["headline"],
            "password": DEMO_PASSWORD,
        }
        for spec in DEMO_USERS
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed demo learners and learning paths.")
    parser.add_argument(
        "--reset", action="store_true", help="drop all tables before seeding"
    )
    parser.add_argument("--quiet", action="store_true", help="suppress progress output")
    args = parser.parse_args()
    seed(reset=args.reset, quiet=args.quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
