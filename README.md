# PathFinder AI — Personalised Learning Path Recommender

An AI-powered assistant that turns a plain-English goal ("I want to become a machine
learning engineer, I know Python") into a prerequisite-ordered learning roadmap:
courses, projects and assessments, explained, milestone-tracked, and adapted as the
learner gives feedback and makes progress.

Built for the **AI-Powered Personalised Learning Path Recommender** hackathon problem
statement. Every one of the six required capabilities is implemented and wired
end-to-end against a real catalogue of **2,400 engineering courses** across 12
branches and 235 tracks.

| Problem statement requirement | Where it lives |
|---|---|
| Conversational interface | [`/chat`](frontend/src/pages/Chat.jsx) UI, [`app/api/chat.py`](backend/app/api/chat.py), [`app/ml/conversation.py`](backend/app/ml/conversation.py) |
| Learner profiling engine | [`/profile`](frontend/src/pages/Profile.jsx), [`Onboarding`](frontend/src/pages/Onboarding.jsx), [`app/api/profile.py`](backend/app/api/profile.py) |
| Recommendation engine | [`app/ml/ranker.py`](backend/app/ml/ranker.py), [`app/api/recommendations.py`](backend/app/api/recommendations.py) |
| Path generator (prerequisites + milestones) | [`app/ml/planner.py`](backend/app/ml/planner.py), [`app/ml/graph.py`](backend/app/ml/graph.py), [`app/api/paths.py`](backend/app/api/paths.py) |
| AI assistant that explains recommendations | [`app/ml/explainer.py`](backend/app/ml/explainer.py), the `Why` drawer in the UI |
| Progress / skill dashboard | [`/dashboard`](frontend/src/pages/Dashboard.jsx), [`app/api/dashboard.py`](backend/app/api/dashboard.py) |

---

## 1. How it works

Everything that *decides* something — intent classification, goal parsing, ranking,
gap analysis, path planning — runs **locally**, with no external API calls. An
`ANTHROPIC_API_KEY` is optional and only changes how replies are *worded*; it never
changes what the engine decides. That claim is visible at runtime: the footer of
every authenticated page reports whether the LLM layer is on, and every chat reply
is tagged `local` or `claude`.

```
learner text
     │
     ▼
four-layer intent parser  (lexical → alias ontology → fuzzy → LSA semantic)
     │  resolves free text to tracks / skills / careers / constraints,
     │  with an evidence trail shown back to the learner before anything is built
     ▼
skill-gap analysis  (proficiency_from_history: completions + self-ratings,
     │                saturating so the 5th course on a skill adds less than the 1st)
     ▼
multi-factor ranker  (9 weighted factors: goal fit, skill-gain, level fit, quality,
     │                 prerequisite readiness, effort fit, format/provider/affinity —
     │                 weights adapt per-learner from thumbs up/down feedback)
     ▼
prerequisite-aware path planner  (topological order over the tier graph, phases,
     │                             milestones, generated projects & assessments)
     ▼
explainer  (headline + detail + drivers, local templates by default,
                                          Claude for prose polish if a key is set)
```

### AI / ML techniques

- **Semantic search / goal parsing** — TF-IDF over course text, reduced with
  Truncated SVD (LSA) to a 256-dimensional space (`app/ml/vectorizer.py`); goal
  text and catalogue entries are compared in that space, which is what lets
  "learn to make robots move" surface kinematics courses that share no literal
  words with the query.
- **Four-layer intent/goal parser** (`app/ml/intent.py`) — lexical n-grams → a
  curated alias ontology → fuzzy string matching → LSA semantic fallback, each
  match kept with its evidence (`matched phrase → layer → conclusion`) so a
  misread is correctable before a 40-hour roadmap is built on it.
- **Skill-gap / competency model** (`app/ml/skills.py`) — proficiency per skill is
  inferred from completed courses (tier-scaled, multiplicatively saturating
  toward 1.0) merged with self-declared ratings.
- **Multi-factor learned ranker** (`app/ml/ranker.py`) — 9 explicit factors summing
  to 1.0, so every recommendation's score is fully decomposable; per-learner
  weights update online from explicit feedback (`recommendations/feedback`) and
  implicit signals (completions, skips).
- **Prerequisite graph planner** (`app/ml/graph.py`, `app/ml/planner.py`) — a
  `networkx` DAG over track tiers drives topological ordering, prerequisite
  waivers/insertions based on declared experience, phase segmentation, and
  auto-generated capstone projects and placement assessments.
- **Explanation layer** (`app/ml/explainer.py`) — every recommendation, path and
  progress update carries a headline, a detail paragraph, ranked drivers and
  caveats, built from the same numbers the ranker/planner used (not a
  post-hoc rationalisation).
- **Optional LLM layer** (`app/ml/llm.py`) — Claude, used only to rephrase
  already-decided output; disabled entirely with no `ANTHROPIC_API_KEY`, and the
  app is fully functional either way.

---

## 2. Project structure

```
learning-path-recommender/
├── backend/                     FastAPI + SQLAlchemy + scikit-learn
│   ├── app/
│   │   ├── api/                 routers: auth, profile, chat, recommendations, paths, dashboard, catalog
│   │   ├── ml/                  the engine: catalog, vectorizer, intent, skills, ranker, graph, planner, explainer, conversation, llm
│   │   ├── models/               SQLAlchemy models (User, LearningPath, Enrollment, ChatMessage, FeedbackEvent, SkillState…)
│   │   ├── schemas/              Pydantic request/response contracts
│   │   ├── core/                 config, DB session, JWT auth, deps
│   │   ├── seed.py               seeds 4 demo learners with realistic history
│   │   └── main.py               app factory, CORS, lifespan warmup
│   ├── data/engineering_courses_dataset.csv   the course catalogue (2,400 rows)
│   ├── probe_engine.py           scratch harness: exercises the ML engine directly
│   ├── probe_api.py              scratch harness: exercises every HTTP endpoint
│   └── requirements.txt
└── frontend/                    React 18 + Vite + Tailwind
    └── src/
        ├── pages/                Landing, Login, Register, Onboarding, Dashboard,
        │                         Roadmap, Recommendations, Chat, Explore, CourseDetail, Profile
        ├── components/           CourseCard, RoadmapGraph, SkillMeter, WhyDrawer, Milestones…
        ├── api/                  axios client + one function per endpoint
        ├── store/auth.jsx        auth context
        └── hooks/useApi.js       fetch/action hooks
```

---

## 3. Setup & run (local)

Requires **Python 3.11+** and **Node 18+**.

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    |    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# create tables and seed 4 demo learners (idempotent; add --reset to wipe first)
python -m app.seed

uvicorn app.main:app --reload --port 8000
```

The API is now at `http://127.0.0.1:8000` (interactive docs at `/docs`). First
startup takes a few seconds — the TF-IDF/SVD semantic space and the prerequisite
graph are built once, in memory, from the CSV.

Optional `.env` in `backend/` (all settings have sane defaults — nothing here is
required to run the app):

```
ANTHROPIC_API_KEY=          # optional — leave blank to run fully local
SECRET_KEY=change-me-in-production
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to
`http://127.0.0.1:8000`, so both must be running.

### Try it without registering

Click **"Or enter as a demo learner"** on the login page, or:

```
POST /api/auth/demo-login?email=aarav@demo.dev
```

All four seeded accounts share the password `demo1234`:

| Email | Scenario it demonstrates |
|---|---|
| `aarav@demo.dev` | CS undergrad → ML engineer; partial background, gap analysis has real work to do |
| `meera@demo.dev` | Beginner, no history, tight weekly hours — cold-start path |
| `rohan@demo.dev` | Mechanical → Robotics; cross-branch semantic bridging |
| `priya@demo.dev` | Deep in-branch specialisation, mid-path progress — dashboard has real data |

### Production build

```bash
cd frontend && npm run build     # outputs frontend/dist
```
Serve `frontend/dist` from any static host and point `CORS_ORIGINS` /
`VITE_API_TARGET` at the deployed backend.

---

## 4. Verifying it works

There's no mocked data path — both scratch harnesses run against the real engine
and a real (in-memory / seeded) database:

```bash
cd backend
PYTHONPATH=. python probe_engine.py   # warms the engine, runs a multi-turn chat, prints the feedback loop
PYTHONPATH=. python probe_api.py      # exercises every REST endpoint end-to-end, asserts expected status codes
```

---

## 5. Notable design choices

- **Local-first, LLM-optional.** The ranking, planning and gap analysis are
  deterministic and explainable without any API key — a reviewer can audit the
  arithmetic behind every recommendation from the `Why` drawer.
- **Replacement semantics on profile lists.** `completed_course_ids` and
  `self_assessed_skills` are full replacements on `PUT /api/profile`, not
  patches — the frontend always reads the current list before editing it (see
  `Profile.jsx`), so a retracted completion or rating is actually retractable.
- **Preview before commit.** `POST /api/paths/generate` with `preview: true`
  computes a full plan without writing it, which is what the onboarding wizard's
  final step shows before the learner commits.
- **Single source of truth per view.** The dashboard is one backend call
  (`engine.dashboard`) that assembles progress × skills × milestones × pacing
  together, specifically so they cannot disagree with each other.

## 6. Known limitations

- Single catalogue (engineering courses only, though the data covers 12
  branches broadly).
- Adaptive ranking weights are per-learner and reset only on explicit feedback —
  there is no cross-learner collaborative-filtering signal.
- No production auth hardening (rate limiting, refresh tokens) — `SECRET_KEY`
  and JWT expiry are dev defaults; rotate `SECRET_KEY` before any real
  deployment.
