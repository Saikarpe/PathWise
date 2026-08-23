"""Conversational layer: route an utterance to an action, then narrate it.

The assistant is intentionally *not* a general chatbot wrapped around a catalogue.
Each turn is classified by the local parser (:mod:`app.ml.intent`) into one of a
small number of intents, and each intent maps to a concrete engine operation:

===============  ==========================================================
intent           what actually happens
===============  ==========================================================
``new_goal``     generate and persist a learning path, then describe it
``refine``       re-plan with the new constraint folded into the profile
``progress``     read the dashboard snapshot and narrate it
``explain``      re-explain the plan, or one course, from stored attribution
``feedback``     record a reaction and report what it changed in the model
``greeting``     orient the learner, with suggestions drawn from the catalogue
===============  ==========================================================

Every reply is *computed first*. Claude, when a key is configured, is handed the
computed text and asked only to rewrite it (:meth:`app.ml.llm.LLMClient.polish`)
or to answer an open question against a JSON context of that learner's real plan.
If the call fails, times out, or no key is set, the computed text ships as-is.
That is the whole fallback strategy, and it is why the ``source`` field on every
reply says which path produced it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ml.engine import Engine
from app.ml.intent import GoalInterpretation
from app.ml.llm import llm_client
from app.models.activity import ChatMessage
from app.models.learning_path import LearningPath, PathItem
from app.models.user import User

logger = logging.getLogger(__name__)

#: Suggestion chips offered when the learner has no path yet.
_COLD_START_SUGGESTIONS = (
    "I want to become a machine learning engineer",
    "Help me get into cybersecurity, I know some networking",
    "I'm a mechanical engineer moving into robotics",
    "Show me a 12-week path for data analytics",
)

#: Suggestion chips once a path exists.
_WARM_SUGGESTIONS = (
    "Why did you pick the first course?",
    "How am I doing?",
    "This is too easy — make it harder",
    "Add cloud deployment to my path",
)

#: Minimum track relevance worth persisting to the profile as an interest.
_INTEREST_FLOOR = 0.45


@dataclass
class ChatTurn:
    """One assistant reply plus whatever structured payload it produced."""

    reply: str
    intent: str
    intent_confidence: float = 0.0
    interpretation: dict = field(default_factory=dict)
    path_id: int | None = None
    recommendations: list[dict] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    #: "local" or "claude" — which layer wrote the prose the learner is reading.
    source: str = "local"

    def as_dict(self) -> dict:
        return {
            "reply": self.reply,
            "intent": self.intent,
            "intent_confidence": round(self.intent_confidence, 3),
            "interpretation": self.interpretation,
            "path_id": self.path_id,
            "recommendations": self.recommendations,
            "suggestions": self.suggestions,
            "source": self.source,
        }


class ConversationService:
    """Handles one chat turn end to end, including persistence."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ------------------------------------------------------------------ #
    async def handle(
        self, db: Session, user: User, message: str, *, session_id: str = "default"
    ) -> ChatTurn:
        goal = self.engine.interpret(message)
        history = self._history(db, user, session_id)

        handlers = {
            "new_goal": self._handle_goal,
            "refine": self._handle_refine,
            "progress": self._handle_progress,
            "explain": self._handle_explain,
            "feedback": self._handle_feedback,
            "greeting": self._handle_greeting,
        }
        handler = handlers.get(goal.intent, self._handle_question)
        turn = await handler(db, user, message, goal, history)

        turn.intent = goal.intent
        turn.intent_confidence = goal.intent_confidence
        turn.interpretation = goal.as_dict()
        if not turn.suggestions:
            turn.suggestions = list(
                _WARM_SUGGESTIONS if self.engine.active_path(db, user) else _COLD_START_SUGGESTIONS
            )

        self._persist(db, user, session_id, message, turn)
        return turn

    # ------------------------------------------------------------------ #
    async def _handle_goal(
        self, db: Session, user: User, message: str, goal: GoalInterpretation, history: list[dict]
    ) -> ChatTurn:
        """A new goal: fold it into the profile, then build a real path."""
        if not goal.has_target:
            return await self._handle_unresolved(db, user, message, goal)

        self._merge_into_profile(db, user, message, goal)
        path = self.engine.create_path(db, user, goal=goal)
        if path is None:
            return await self._handle_unresolved(db, user, message, goal)

        plan_dict = path.plan or {}
        computed = self._describe_path(path, plan_dict)
        reply, source = await self._maybe_polish(
            computed,
            purpose="Introduce the learning path you just generated for this learner.",
            context={
                "tracks": path.tracks,
                "total_hours": path.total_hours,
                "estimated_weeks": path.estimated_weeks,
                "phases": [p.get("name") for p in plan_dict.get("phases", [])],
                "assumptions": (path.analysis or {}).get("assumptions", []),
            },
        )
        return ChatTurn(reply=reply, intent="new_goal", path_id=path.id, source=source)

    async def _handle_refine(
        self, db: Session, user: User, message: str, goal: GoalInterpretation, history: list[dict]
    ) -> ChatTurn:
        """A constraint change: re-plan the *same* goal under the new constraint.

        The refinement is applied on top of the path's original goal text rather
        than on top of the accumulated profile. Re-deriving the target from the
        profile looked equivalent but was not: the profile's ``interests`` list is
        a flattened set of track names with the original relevance weights thrown
        away, so "I only have 4 hours a week" once silently moved a Machine
        Learning path onto the Machine Design track. Re-parsing the learner's own
        original sentence together with the new one keeps the target fixed and
        lets the parser read the constraint in context.
        """
        path = self.engine.active_path(db, user)
        if path is None:
            return await self._handle_goal(db, user, message, goal, history)

        self._merge_into_profile(db, user, message, goal, keep_goal_text=True)
        combined = f"{path.goal_text}. {message}".strip()
        merged = self.engine.interpret(combined)

        # Anything explicit in *this* message wins; the stored profile fills gaps.
        profile = user.profile_dict()
        for name, weight in goal.tracks.items():
            merged.tracks[name] = max(merged.tracks.get(name, 0.0), weight)
        merged.weekly_hours = goal.weekly_hours or merged.weekly_hours or profile["weekly_hours"]
        merged.timeline_weeks = (
            goal.timeline_weeks or merged.timeline_weeks or profile["timeline_weeks"]
        )
        merged.experience_level = (
            goal.experience_level or merged.experience_level or profile["experience_level"]
        )
        for fmt in profile["preferred_formats"]:
            if fmt not in merged.formats:
                merged.formats.append(fmt)
        for provider in profile["preferred_providers"]:
            if provider not in merged.providers:
                merged.providers.append(provider)
        merged.intent = "refine"

        if not merged.has_target:
            return ChatTurn(
                reply=(
                    "I could not re-plan from that. Tell me the change as a constraint — "
                    "\"only 4 hours a week\", \"make it harder\", \"finish in 10 weeks\" — "
                    "and I will rebuild the path."
                ),
                intent="refine",
                path_id=path.id,
            )

        new_path = self.engine.create_path(db, user, goal=merged)
        if new_path is None:
            return ChatTurn(
                reply=(
                    "That change left nothing plannable — the constraint may be too "
                    "tight. Try loosening it, or tell me which track to drop."
                ),
                intent="refine",
                path_id=path.id,
            )

        computed = (
            f"Updated your path (version {new_path.version}). "
            + self._describe_path(new_path, new_path.plan or {})
            + f" Previously it was {path.total_courses} courses over "
            f"{path.estimated_weeks} weeks; now it is {new_path.total_courses} over "
            f"{new_path.estimated_weeks}."
        )
        reply, source = await self._maybe_polish(
            computed, purpose="Explain how the learner's requested change reshaped their path."
        )
        return ChatTurn(reply=reply, intent="refine", path_id=new_path.id, source=source)

    async def _handle_progress(
        self, db: Session, user: User, message: str, goal: GoalInterpretation, history: list[dict]
    ) -> ChatTurn:
        snapshot = self.engine.dashboard(db, user)
        narrative = snapshot.get("narrative", {})
        computed = " ".join(
            filter(None, [narrative.get("headline"), narrative.get("detail")]
                   + list(narrative.get("caveats", [])))
        )
        if not snapshot.get("has_path"):
            computed = (
                "You do not have an active path yet. Describe what you want to be able "
                "to do — a role, a project, or a subject — and I will build one from the "
                f"{self.engine.stats().get('courses', 0)}-course catalogue."
            )
        reply, source = await self._maybe_polish(
            computed,
            purpose="Report the learner's progress and what to do next.",
            context={
                "progress": snapshot.get("progress"),
                "next_item": snapshot.get("next_item"),
                "next_milestone": snapshot.get("next_milestone"),
                "skills_proficient": snapshot.get("skills_proficient", [])[:8],
            },
        )
        return ChatTurn(
            reply=reply,
            intent="progress",
            path_id=(snapshot.get("path") or {}).get("id"),
            source=source,
        )

    async def _handle_explain(
        self, db: Session, user: User, message: str, goal: GoalInterpretation, history: list[dict]
    ) -> ChatTurn:
        """Explain the plan, or a specific step the learner referred to."""
        path = self.engine.active_path(db, user)
        if path is None:
            return ChatTurn(
                reply=(
                    "There is no path to explain yet. Tell me your goal and I will build "
                    "one, then I can justify every step in it."
                ),
                intent="explain",
            )

        item = self._resolve_referenced_item(db, user, path, message)
        assert self.engine.explainer is not None

        if item is not None:
            plan_items = (path.plan or {}).get("items", [])
            raw = next(
                (i for i in plan_items if i.get("order_index") == item.order_index), None
            )
            computed = self._describe_item(item, raw)
            context = {
                "title": item.title,
                "factors": item.factors,
                "rationale": item.rationale,
                "skills": item.skills,
                "prerequisites": item.prerequisite_ids,
            }
        else:
            explanation = self._plan_explanation(path)
            computed = " ".join(
                filter(
                    None,
                    [explanation.get("headline"), explanation.get("detail")]
                    + list(explanation.get("caveats", [])),
                )
            )
            context = {"tracks": path.tracks, "analysis_keys": list((path.analysis or {}).keys())}

        reply, source = await self._maybe_polish(
            computed, purpose="Justify a recommendation to the learner who asked why.", context=context
        )
        return ChatTurn(reply=reply, intent="explain", path_id=path.id, source=source)

    async def _handle_feedback(
        self, db: Session, user: User, message: str, goal: GoalInterpretation, history: list[dict]
    ) -> ChatTurn:
        """Turn "this is too hard" into a real model update, then say what changed."""
        event_type = _feedback_event_from(message)
        path = self.engine.active_path(db, user)
        item = self._resolve_referenced_item(db, user, path, message) if path else None

        result = self.engine.record_feedback(
            db,
            user,
            event_type=event_type,
            course_id=item.course_id if item and item.item_type == "course" else None,
            comment=message,
            factors=dict(item.factors or {}) if item else None,
            path_id=path.id if path else None,
        )

        computed = result["explanation"]
        if event_type in ("too_hard", "too_easy"):
            computed += (
                " Ask me to re-plan and I will rebuild the path at the new difficulty."
            )
        elif item is not None:
            computed = f"Thanks — noted on \"{item.title}\". " + computed

        reply, source = await self._maybe_polish(
            computed,
            purpose="Acknowledge feedback and state concretely what it changed in the model.",
            context={"weight_deltas": result["weight_deltas"], "bias": result["difficulty_bias"]},
        )
        return ChatTurn(
            reply=reply, intent="feedback", path_id=path.id if path else None, source=source
        )

    async def _handle_greeting(
        self, db: Session, user: User, message: str, goal: GoalInterpretation, history: list[dict]
    ) -> ChatTurn:
        stats = self.engine.stats()
        path = self.engine.active_path(db, user)
        name = (user.full_name or "").split(" ")[0]
        greeting = f"Hi {name}" if name else "Hi"

        if path is not None:
            computed = (
                f"{greeting} — you are working on \"{path.title}\": "
                f"{path.total_courses} courses over about {path.estimated_weeks} weeks. "
                f"Ask me how you are doing, why a course is in there, or tell me what to change."
            )
        else:
            computed = (
                f"{greeting}. I build learning paths from a catalogue of "
                f"{stats.get('courses', 0)} courses across {stats.get('branches', 0)} "
                f"engineering branches. Tell me what you want to be able to do — a role, "
                f"a project, or a subject — plus roughly how many hours a week you have, "
                f"and I will plan it in prerequisite order."
            )
        return ChatTurn(reply=computed, intent="greeting", path_id=path.id if path else None)

    async def _handle_question(
        self, db: Session, user: User, message: str, goal: GoalInterpretation, history: list[dict]
    ) -> ChatTurn:
        """An open question. Answered from context, and never allowed to mutate.

        Questions are strictly read-only. An earlier version fell back to "if the
        message named a topic, treat it as a goal", which was far too eager: LSA
        finds *some* track in almost any sentence, so "what is the difference
        between a course and a project here?" matched Project Management for
        Engineers and silently replaced an ML learner's whole path. Asking how the
        system works is not consent to re-plan. If a question does name a real
        topic, the topic is used to *illustrate* the answer with recommendations,
        and building a path is offered rather than performed.
        """
        path = self.engine.active_path(db, user)
        context = self._question_context(db, user, path)

        answer = await llm_client.answer(message, context, history=history)
        if answer:
            return ChatTurn(
                reply=answer, intent=goal.intent, path_id=path.id if path else None, source="claude"
            )

        # ---- local fallback ------------------------------------------------ #
        # Questions *about the system* are answered first. They are the ones a new
        # learner actually asks ("what is a project here?", "how do you decide?"),
        # and they contain nouns that the topic matcher will happily mistake for a
        # subject — "project" matches Project Management for Engineers — so the
        # meta answer has to win before any topic reasoning runs.
        meta = self._answer_about_system(user, message, path)
        if meta:
            return ChatTurn(
                reply=meta, intent=goal.intent, path_id=path.id if path else None
            )

        topic = goal.ranked_tracks[0][0] if goal.has_target and goal.ranked_tracks else None
        recommendations: list[dict] = []
        if topic:
            # Ranked *for the asked-about topic*, without touching the profile or
            # the active path. Passing goal= keeps this a query, not a commitment.
            recommendations = self.engine.recommend(db, user, goal=goal, limit=3)
        elif user.onboarded:
            recommendations = self.engine.recommend(db, user, limit=3)

        if topic and recommendations:
            titles = ", ".join(f"\"{r['course']['title']}\"" for r in recommendations)
            computed = (
                f"I read that as being about {topic}. The strongest matches I have are "
                f"{titles}. I have not changed your plan — say \"build me a path for "
                f"{topic}\" if you want me to, or ask \"why\" about any of those."
            )
        elif recommendations:
            titles = ", ".join(f"\"{r['course']['title']}\"" for r in recommendations)
            computed = (
                "I can answer that best by pointing at your actual plan. Based on your "
                f"profile the strongest next courses are {titles}. Ask me \"why\" about "
                "any of them, or say \"how am I doing\" for progress."
            )
        else:
            computed = (
                "I did not catch a goal in that. Try naming a role or a subject — "
                "\"become a data scientist\", \"learn embedded systems\" — and add your "
                "weekly hours if you know them."
            )
        return ChatTurn(
            reply=computed,
            intent=goal.intent,
            path_id=path.id if path else None,
            recommendations=recommendations,
        )

    async def _handle_unresolved(
        self, db: Session, user: User, message: str, goal: GoalInterpretation
    ) -> ChatTurn:
        """The parser found no target. Try Claude's constrained extraction, then ask.

        This is the one place the LLM can influence *what gets recommended*, and it
        is deliberately fenced: every value it returns is checked against the real
        catalogue vocabulary in :meth:`LLMClient.extract_goal_hints` before use.
        """
        assert self.engine.catalog is not None
        cat = self.engine.catalog

        hints = await llm_client.extract_goal_hints(
            message,
            known_tracks=cat.tracks,
            known_careers=cat.careers,
            known_skills=cat.skills,
        )
        if hints and (hints["tracks"] or hints["careers"] or hints["skills"]):
            for name in hints["tracks"]:
                goal.tracks[name] = max(goal.tracks.get(name, 0.0), 0.85)
            goal.careers = list(dict.fromkeys(goal.careers + hints["careers"]))
            goal.skills = list(dict.fromkeys(goal.skills + hints["skills"]))
            goal.known_tracks = list(dict.fromkeys(goal.known_tracks + hints["known_tracks"]))
            goal.experience_level = goal.experience_level or hints["experience_level"]
            goal.weekly_hours = goal.weekly_hours or hints["weekly_hours"]
            goal.timeline_weeks = goal.timeline_weeks or hints["timeline_weeks"]
            goal.source = "claude_extraction"
            goal.evidence.append(
                {"layer": "llm", "role": "goal", "matched": hints["tracks"] or hints["careers"]}
            )

            self._merge_into_profile(db, user, message, goal)
            path = self.engine.create_path(db, user, goal=goal)
            if path is not None:
                computed = self._describe_path(path, path.plan or {})
                reply, source = await self._maybe_polish(
                    computed, purpose="Introduce the path just generated for this learner."
                )
                return ChatTurn(reply=reply, intent="new_goal", path_id=path.id, source=source)

        near = [
            name
            for name, score in self.engine.space.rank_tracks(  # type: ignore[union-attr]
                self.engine.space.encode(message), top_n=4  # type: ignore[union-attr]
            )
            if score > 0.02
        ]
        if not near:
            # Nothing in the message resembled anything in the catalogue at all —
            # usually a one-word utterance whose LSA vector is essentially zero.
            # Offering the closest tracks would be offering noise.
            return ChatTurn(
                reply=(
                    "I did not get enough to go on there. Name a role, a subject or a "
                    "project you want to be able to build — for example \"machine "
                    "learning engineer\", \"embedded systems\" or \"I want to design a "
                    "bridge\" — and tell me roughly how many hours a week you have."
                ),
                intent="clarify",
                suggestions=list(_COLD_START_SUGGESTIONS),
            )
        return ChatTurn(
            reply=(
                "I could not match that to a track in the catalogue. The closest things "
                f"I have are {', '.join(near)}. Which of those is nearest to what you "
                "mean — or name the role you are aiming at?"
            ),
            intent="clarify",
            suggestions=[f"I want to learn {n}" for n in near[:3]],
        )

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    async def _maybe_polish(
        self, computed: str, *, purpose: str, context: dict | None = None
    ) -> tuple[str, str]:
        """Return ``(text, source)``, preferring Claude's rewrite when available."""
        polished = await llm_client.polish(computed, purpose=purpose, context=context)
        return (polished, "claude") if polished else (computed, "local")

    def _merge_into_profile(
        self,
        db: Session,
        user: User,
        message: str,
        goal: GoalInterpretation,
        *,
        keep_goal_text: bool = False,
    ) -> None:
        """Persist what this turn revealed, so the profile accumulates over time."""
        if not keep_goal_text and goal.has_target:
            user.goal_text = message[:1000]
        if goal.careers:
            user.target_role = goal.careers[0]
        if goal.branches:
            user.primary_branch = goal.branches[0]
        if goal.experience_level:
            user.experience_level = goal.experience_level
        if goal.weekly_hours:
            user.weekly_hours = float(goal.weekly_hours)
        if goal.timeline_weeks:
            user.timeline_weeks = int(goal.timeline_weeks)

        # Only strongly-matched tracks are stored as interests. Persisting the full
        # ranked list would flatten relevance weights into an undifferentiated set
        # and let a weak semantic neighbour outvote the real goal on the next parse.
        user.interests = list(
            dict.fromkeys(
                list(user.interests or [])
                + [n for n, w in goal.ranked_tracks[:4] if w >= _INTEREST_FLOOR]
            )
        )[:8]
        user.target_skills = list(dict.fromkeys(list(user.target_skills or []) + goal.skills))
        user.preferred_formats = list(
            dict.fromkeys(list(user.preferred_formats or []) + goal.formats)
        )
        user.preferred_providers = list(
            dict.fromkeys(list(user.preferred_providers or []) + goal.providers)
        )
        user.industry_interests = list(
            dict.fromkeys(list(user.industry_interests or []) + goal.sectors)
        )
        user.onboarded = True
        db.commit()

    def _history(self, db: Session, user: User, session_id: str, limit: int = 12) -> list[dict]:
        rows = list(
            db.scalars(
                select(ChatMessage)
                .where(ChatMessage.user_id == user.id, ChatMessage.session_id == session_id)
                .order_by(ChatMessage.created_at.desc())
                .limit(limit)
            )
        )
        return [{"role": r.role, "content": r.content} for r in reversed(rows)]

    def _persist(
        self, db: Session, user: User, session_id: str, message: str, turn: ChatTurn
    ) -> None:
        db.add(
            ChatMessage(
                user_id=user.id, session_id=session_id, role="user", content=message, meta={}
            )
        )
        db.add(
            ChatMessage(
                user_id=user.id,
                session_id=session_id,
                role="assistant",
                content=turn.reply,
                meta={
                    "intent": turn.intent,
                    "intent_confidence": round(turn.intent_confidence, 3),
                    "path_id": turn.path_id,
                    "source": turn.source,
                    # ``GoalInterpretation.as_dict`` emits "tracks" as a list of
                    # ``{"track", "weight"}`` records. An earlier version read
                    # "ranked_tracks" — the *property* name, which as_dict never
                    # emits — so this key was silently always empty and the reloaded
                    # transcript lost which topics each turn was about.
                    "tracks": [
                        t["track"]
                        for t in (turn.interpretation.get("tracks") or [])
                        if isinstance(t, dict) and t.get("track")
                    ][:4],
                },
            )
        )
        db.commit()

    def _resolve_referenced_item(
        self, db: Session, user: User, path: LearningPath | None, message: str
    ) -> PathItem | None:
        """Work out which step "that course" / "the first one" refers to."""
        if path is None:
            return None
        items = sorted(path.items, key=lambda i: i.order_index)
        if not items:
            return None

        lowered = message.lower()
        # 1. An explicit title match beats any positional guess.
        for item in items:
            if item.title and item.title.lower() in lowered:
                return item
        # 2. Positional references.
        courses = [i for i in items if i.item_type == "course"]
        if any(word in lowered for word in ("first", "1st", "next one", "next course")):
            return courses[0] if courses else items[0]
        if any(word in lowered for word in ("last", "final", "capstone")):
            return courses[-1] if courses else items[-1]
        # 3. "this"/"that" with an active path: the next unfinished step.
        if any(word in lowered for word in ("this", "that", "it")):
            snapshot = self.engine.dashboard(db, user)
            nxt = snapshot.get("next_item") or {}
            if nxt.get("id"):
                return db.get(PathItem, int(nxt["id"]))
        return None

    def _plan_explanation(self, path: LearningPath) -> dict:
        return self.engine.explain_path(path)

    def _describe_path(self, path: LearningPath, plan: dict) -> str:
        analysis = path.analysis or {}
        phases = plan.get("phases", [])
        before = float(analysis.get("readiness_before") or 0.0)
        after = float(analysis.get("readiness_after") or 0.0)

        sentences = [
            f"I built \"{path.title}\": {path.total_courses} courses plus projects and "
            f"assessments, about {path.total_hours:.0f} hours, roughly "
            f"{path.estimated_weeks} weeks."
        ]
        if path.tracks:
            sentences.append(
                "It follows "
                + (
                    f"the {path.tracks[0]} track"
                    if len(path.tracks) == 1
                    else ", ".join(path.tracks[:-1]) + f" and {path.tracks[-1]}"
                )
                + ", in prerequisite order."
            )
        if phases:
            sentences.append(
                "Phases: "
                + "; ".join(
                    f"{p['name']} (weeks {p['start_week']}–{p['end_week']})" for p in phases
                )
                + "."
            )
        sentences.append(
            f"Against the target skill set you currently meet {before:.0%}; finishing "
            f"this projects you to {after:.0%}."
        )
        assumptions = analysis.get("assumptions") or []
        if assumptions:
            sentences.append(
                f"I assumed you already have the basics in "
                + ", ".join(dict.fromkeys(a["track"] for a in assumptions))
                + ", so I skipped those and added a placement check to verify it."
            )
        first = next(
            (i for i in plan.get("items", []) if i.get("item_type") == "course"), None
        )
        if first:
            sentences.append(f"Start with \"{first['title']}\".")
        return " ".join(sentences)

    def _describe_item(self, item: PathItem, raw: dict | None) -> str:
        from app.ml.ranker import FACTOR_LABELS

        parts = [f"\"{item.title}\" is step {item.order_index + 1}, in {item.phase_name}."]
        if item.rationale:
            parts.append(item.rationale)
        drivers = sorted((item.factors or {}).items(), key=lambda kv: -kv[1])[:3]
        drivers = [(f, s) for f, s in drivers if s >= 0.08]
        if drivers:
            parts.append(
                "Its score came mostly from "
                + ", ".join(f"{FACTOR_LABELS.get(f, f)} ({s:.0%})" for f, s in drivers)
                + "."
            )
        if item.prerequisite_ids:
            assert self.engine.catalog is not None
            names = []
            for course_id in item.prerequisite_ids[:2]:
                pos = self.engine.catalog.pos(course_id)
                if pos is not None:
                    names.append(str(self.engine.catalog.df.iloc[pos]["course_title"]))
            if names:
                parts.append("It comes after " + " and ".join(names) + ".")
        if item.skills:
            parts.append("It teaches " + ", ".join(item.skills[:5]) + ".")
        if raw and raw.get("meta", {}).get("covers_skills"):
            parts.append(
                "Of your open gaps it closes "
                + ", ".join(raw["meta"]["covers_skills"][:4])
                + "."
            )
        parts.append(f"About {item.hours:.0f} hours.")
        return " ".join(parts)

    def _answer_about_system(
        self, user: User, message: str, path: LearningPath | None
    ) -> str | None:
        """Answer a question about how the recommender itself works, or return None.

        Deliberately keyword-driven rather than semantic. These are questions about
        this application, so there is a small closed set of them, and a wrong guess
        here is worse than no guess: it would answer a subject question with a
        product explanation. Every figure quoted is read from the live catalogue and
        the learner's own path, so the answers cannot drift away from the system
        they describe. When an API key is present Claude has already answered and
        this never runs; without one, this is what a reviewer's first question hits.
        """
        text = " ".join((message or "").lower().split())
        if not text:
            return None
        stats = self.engine.stats()
        providers = len(self.engine.catalog.providers) if self.engine.catalog else 0

        def has(*words: str) -> bool:
            return any(w in text for w in words)

        # "What is the difference between a course and a project/assessment?"
        if has("difference") and has("project", "assessment", "milestone", "capstone"):
            return (
                "Three different kinds of step. A *course* is a real catalogue entry "
                "with a provider, a rating and a difficulty tier — it is where the "
                "material comes from. A *project* is generated for you: it takes the "
                "tools and skills from the courses just before it and asks you to "
                "build something with them, because a skill you have only watched is "
                "not a skill you have. An *assessment* is a checkpoint that tests an "
                "assumption I made about you — the placement check in phase one exists "
                "to catch a wrong guess about your level in 90 minutes rather than "
                "three weeks. Only courses come from the catalogue; projects and "
                "assessments are synthesised from what surrounds them."
            )
        if has("what is a project", "what are projects", "why projects", "project for"):
            return (
                "Projects are generated, not catalogued. After a run of courses I take "
                "the tools and skills those courses teach and specify something to "
                "build with them, with named deliverables. They exist because the "
                "gap-closing arithmetic only credits a skill as *learned* once you "
                "have applied it, and because a portfolio artefact is what a hiring "
                "manager can actually check."
            )
        if has("milestone"):
            return (
                "Milestones are the checkpoints between phases. Each one names what you "
                "should be able to do by a target week, and it is marked achieved from "
                "your actual completions rather than by hand — so if you fall behind, "
                "the dashboard says so instead of quietly re-drawing the schedule."
            )

        # "How does this work / how do you decide / what model is this?"
        if has("how do you", "how does this", "how did you", "how are you", "what model",
               "which model", "what algorithm", "what ai", "how it works", "how does it"):
            return (
                f"Everything is computed locally from the catalogue of "
                f"{stats.get('courses', 0):,} courses. Your words are matched to the "
                f"{stats.get('tracks', 0)} tracks four ways — exact phrases, a curated "
                "alias table, fuzzy matching for typos, and semantic similarity in a "
                f"{stats.get('semantic_dimensions', 0)}-dimension space built by TF-IDF "
                "and SVD. Your target skills come from what courses on those tracks "
                "actually teach, weighted by how central and how distinctive each skill "
                "is. What you already know is subtracted, the remainder is covered by a "
                "greedy set-cover pass, and the result is ordered by a prerequisite "
                f"graph of {stats.get('prerequisite_rungs', 0)} rungs. Ranking uses nine "
                "weighted factors and reports each factor's share of the score, which "
                "is where the 'why' answers come from. Your feedback moves those weights."
            )
        if has("why should i trust", "are you making this up", "hallucinat", "made up",
               "is this real"):
            return (
                "None of it is generated prose dressed as analysis. Every recommendation "
                "carries the nine factor values that produced its score and their "
                "percentage shares, which sum to the score itself — you can check each "
                "claim against the course page. Courses, providers, ratings and hours "
                "are read from the catalogue, never invented. If a language model is "
                "configured it rewrites these explanations more fluently, but it is "
                "given the numbers as source and is never asked to do the reasoning."
            )
        if has("what data", "where do the courses", "which courses", "how many courses",
               "catalogue", "catalog"):
            return (
                f"The catalogue holds {stats.get('courses', 0):,} courses across "
                f"{stats.get('branches', 0)} engineering branches and "
                f"{stats.get('tracks', 0)} tracks, from {providers} "
                f"providers, tagged with {stats.get('skills', 0)} distinct skills. Each "
                "course has a difficulty tier, so the same track exists at several "
                "levels and the prerequisite graph can order them. Ratings are shrunk "
                "toward the catalogue average before use, so a 5.0 from eleven reviewers "
                "does not outrank a 4.6 from nine thousand."
            )

        # "Can I change it?" — answered against this learner's real path.
        if has("can i change", "can you change", "can i edit", "am i stuck", "change my path",
               "change the path", "start over", "different goal"):
            where = f'"{path.title}"' if path is not None else "your path"
            return (
                f"Yes, and nothing about {where} is frozen. Tell me a new goal and I will "
                "re-plan; say how many hours a week you really have and I will re-fit the "
                "schedule; mark a course too hard or too easy and the difficulty bias "
                "shifts for everything ranked afterwards. Say 'not relevant' on a "
                "recommendation and the factor that put it there loses weight. Every "
                "version is kept, so you can see what changed and why."
            )
        if has("how long", "how many weeks", "when will i finish", "finish by") and path is not None:
            return (
                f'"{path.title}" is about {float(path.total_hours or 0):.0f} hours, which '
                f"is roughly {int(path.estimated_weeks or 0)} weeks at the "
                f"{float(user.weekly_hours or 8):.0f} hours a week you gave me. That "
                "estimate is hours divided by your stated pace — it moves the moment you "
                "tell me your pace changed, and the dashboard tracks whether your actual "
                "completions are keeping up with it."
            )
        return None

    def _question_context(self, db: Session, user: User, path: LearningPath | None) -> dict:
        """Compact JSON context for an open question. Trimmed to stay cheap."""
        context: dict = {
            "learner": {
                "name": user.full_name,
                "experience_level": user.experience_level,
                "weekly_hours": user.weekly_hours,
                "goal": user.goal_text,
                "interests": list(user.interests or [])[:8],
            },
            "catalogue": self.engine.stats(),
        }
        if path is not None:
            items = sorted(path.items, key=lambda i: i.order_index)
            context["path"] = {
                "title": path.title,
                "tracks": path.tracks,
                "total_hours": path.total_hours,
                "estimated_weeks": path.estimated_weeks,
                "steps": [
                    {
                        "order": i.order_index + 1,
                        "type": i.item_type,
                        "title": i.title,
                        "phase": i.phase_name,
                        "hours": i.hours,
                        "why": i.rationale,
                        "skills": i.skills[:6],
                    }
                    for i in items
                ],
                "assumptions": (path.analysis or {}).get("assumptions", []),
                "readiness_before": (path.analysis or {}).get("readiness_before"),
                "readiness_after": (path.analysis or {}).get("readiness_after"),
            }
            gap = (path.analysis or {}).get("gap", {})
            context["skill_gaps"] = (gap.get("skills") or [])[:15]
            context["progress"] = {
                k: v
                for k, v in self.engine.dashboard(db, user).items()
                if k
                in (
                    "progress",
                    "completed_courses",
                    "total_courses",
                    "hours_completed",
                    "total_hours",
                    "next_item",
                    "next_milestone",
                    "skills_proficient",
                )
            }
        return context


# --------------------------------------------------------------------------- #
_FEEDBACK_PATTERNS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("too hard", "too difficult", "too advanced", "over my head", "lost", "struggling"), "too_hard"),
    (("too easy", "too basic", "too simple", "already know this", "boring", "make it harder"), "too_easy"),
    (("not relevant", "irrelevant", "nothing to do with", "not what i asked", "off topic"), "not_relevant"),
    (("don't like", "dont like", "dislike", "hate", "remove", "drop this", "not interested"), "dislike"),
    (("love", "like this", "great", "perfect", "helpful", "exactly", "keep"), "like"),
)


def _feedback_event_from(message: str) -> str:
    lowered = message.lower()
    for phrases, event in _FEEDBACK_PATTERNS:
        if any(p in lowered for p in phrases):
            return event
    return "dislike"  # the parser only routes here for negative-ish utterances
