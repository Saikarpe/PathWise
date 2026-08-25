# PathWise AI — Personalised Learning Path Recommender

An AI-powered assistant that turns a plain-English goal ("I want to become a machine
learning engineer, I know Python") into a prerequisite-ordered learning roadmap:
courses, projects and assessments, explained, milestone-tracked, and adapted as the
learner gives feedback and makes progress.

Built for the **AI-Powered Personalised Learning Path Recommender** hackathon problem
statement. Every one of the six required capabilities is implemented and wired
end-to-end against a real catalogue of **2,400 engineering courses** across 12
branches and 235 tracks.

## Try it now

| | |
|---|---|
| **Live app** | **https://path-wise-two.vercel.app** |
| **API** | https://pathfinder-api-sq45.onrender.com ([`/docs`](https://pathfinder-api-sq45.onrender.com/docs) · [`/api/health`](https://pathfinder-api-sq45.onrender.com/api/health)) |

Sign in with **“Try a demo account”** — four seeded learners, password `demo1234`,
each exercising a different part of the engine. Or register and describe your own goal.

> **First request may take 1–3 minutes.** The API is on a free tier that sleeps after
> ~15 minutes idle; the first call wakes it. The UI shows a “waking up the server”
> notice while this happens. Subsequent requests are fast (see benchmarks below).

| Problem statement requirement | Where it lives |
|---|---|
| Conversational interface | [`routes/chat.tsx`](frontend/src/routes/chat.tsx), [`app/api/chat.py`](backend/app/api/chat.py), [`app/ml/conversation.py`](backend/app/ml/conversation.py) |
| Learner profiling engine | [`routes/profile.tsx`](frontend/src/routes/profile.tsx), [`routes/onboarding.tsx`](frontend/src/routes/onboarding.tsx), [`app/api/profile.py`](backend/app/api/profile.py) |
| Recommendation engine | [`app/ml/ranker.py`](backend/app/ml/ranker.py), [`app/api/recommendations.py`](backend/app/api/recommendations.py) |
| Path generator (prerequisites + milestones) | [`app/ml/planner.py`](backend/app/ml/planner.py), [`app/ml/graph.py`](backend/app/ml/graph.py), [`app/api/paths.py`](backend/app/api/paths.py) |
| AI assistant that explains recommendations | [`app/ml/explainer.py`](backend/app/ml/explainer.py), the "Why this?" panels in the UI |
| Progress / skill dashboard | [`routes/dashboard.tsx`](frontend/src/routes/dashboard.tsx), [`app/api/dashboard.py`](backend/app/api/dashboard.py) |

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

#### What is *learned* vs *engineered*

Stated plainly, because the distinction matters when judging the AI/ML work:

| Component | Nature |
|---|---|
| Semantic space (TF-IDF + Truncated SVD) | **Unsupervised ML** — fitted on the corpus. The only `scikit-learn` model in the system. |
| Per-learner ranking weights | **Online learning** — a signed, magnitude-scaled credit-assignment rule updated from real feedback. Adaptive, but a hand-derived update rule rather than gradient descent on a loss. |
| Intent parser | **Hybrid** — 3 deterministic layers (lexical, alias ontology, fuzzy) with the LSA space as the semantic fallback. |
| Skill-gap / competency model | **Engineered** — saturating tier-scaled arithmetic over the skill matrix. |
| Path planner | **Classical algorithms** — topological sort over a prerequisite DAG, plus phase segmentation. |
| Explanations | **Derived** — assembled from the ranker's own factor contributions, not generated prose. |

The deliberate choice throughout was **explainability over model complexity**: every
number a learner sees can be traced to the arithmetic that produced it, which is what
makes the "why was this recommended?" feature honest rather than decorative. A deeper
model (neural re-ranker, collaborative filtering) would need interaction data this
system doesn't have — see the evaluation caveats in §4.

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
└── frontend/                    React 19 + TanStack Start/Router + TanStack Query + Tailwind v4 + shadcn/ui
    └── src/
        ├── routes/               file-based routes: index, login, register, onboarding, dashboard,
        │                         roadmap, recommendations, chat, explore, courses.$courseId, profile
        ├── components/           AppShell (nav shell), CourseCard, pf.tsx (shared primitives: Stat, Meter, Chip, Section…)
        ├── lib/api.ts            fetch wrapper — bearer token, VITE_API_BASE_URL, FastAPI error shape
        └── lib/auth.tsx          auth context + useRequireAuth guard
```

> The UI was designed in [Lovable](https://lovable.dev) against this exact backend's
> API contract, then hand-integrated: every route was checked field-by-field against
> the real FastAPI response shapes (see git history for the list of fixes — mostly
> field-name mismatches like `skills` vs `skills_taught`, and nested vs flat fields
> like `analysis.readiness_after` and `course.title` vs a bare course id).

---

## 3. Setup & run (local)

Requires **Python 3.11+** and **Node 18+**. For the full walkthrough —
prerequisites, exact commands, what auto-seeds on first boot, and a
troubleshooting table — see [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md).
Quick version below.

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    |    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

python -m app.ml.build_cache   # optional: pre-fit ML artifacts (7s once, ~0.1s per boot after)

uvicorn app.main:app --reload --port 8000
```

The API is now at `http://127.0.0.1:8000` (interactive docs at `/docs`).

Demo accounts seed themselves on first startup, so no separate seed step is needed.
(`python -m app.seed --reset` still exists to rebuild them from scratch.)

**On startup cost.** The TF-IDF/SVD space, prerequisite graph and competency model
are pure functions of the course CSV, so they're cached to disk and reloaded rather
than refitted — **7.0s → 0.11s** per boot, measured. The cache is keyed on the CSV's
content hash plus the hyperparameters and library versions, so it invalidates itself
when any of those change, and *any* failure (missing, stale, corrupt) silently falls
back to rebuilding — it's an optimisation, never a dependency. Run
`python -m app.ml.build_cache` in your **build** step when deploying: hosts without a
persistent disk discard anything written at runtime, so building it into the image is
what makes cold starts fast.

Optional `.env` in `backend/` (all settings have sane defaults — nothing here is
required to run the app):

```
ANTHROPIC_API_KEY=          # optional — leave blank to run fully local
SECRET_KEY=change-me-in-production
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### Frontend

```bash
cd frontend
npm install     # bun install also works if you have bun — bun.lock is included
npm run dev
```

Open `http://localhost:3000`. Unlike the old Vite SPA, this frontend calls the
backend directly — no dev proxy — via `VITE_API_BASE_URL` (defaults to
`http://127.0.0.1:8000`, set in `frontend/.env` if the backend runs elsewhere), so
the backend must be running and its `CORS_ORIGINS` must include the frontend's
origin (already the case with the defaults above).

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

### Deploying

The live instance runs the backend on Render and the frontend on Vercel.

**Backend** (root directory `learning-path-recommender/backend`):

| Setting | Value |
|---|---|
| Build command | `pip install -r requirements.txt && python -m app.ml.build_cache` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Env | `SECRET_KEY` (any long random string), `CORS_ORIGINS` (the frontend's exact origin) |

Python version is pinned by `backend/.python-version` (3.11) — the default on some
hosts is 3.14, which has no prebuilt SciPy wheel and fails the build trying to
compile from source without a Fortran toolchain.

**Frontend** (root directory `learning-path-recommender/frontend`):

```bash
npm run build   # TanStack Start; nitro preset is pinned to Vercel in vite.config.ts
```
Set `VITE_API_BASE_URL` to the deployed backend URL. Vite bakes env vars in at
*build* time, so changing it requires a redeploy, not just a restart.

> `CORS_ORIGINS` is an exact-origin allowlist. A frontend deployed to a new URL
> won't be able to reach the API until that origin is added.

---

## 4. Verifying it works

### Test suite

34 tests, no mocks — they run against the real ML engine and a real (in-memory)
database, so they exercise the same code paths as production:

```bash
cd backend && pytest
```

They assert the *invariants the product claims* rather than pinning today's exact
output (a test that froze one specific recommendation would break on any tuning
change without indicating a real regression). The ones that matter most:

- prerequisites always precede their dependents in a generated path
- a completed course is never recommended again
- every score decomposes into factor contributions summing to 1.0
- fewer weekly hours must produce a longer timeline
- feedback measurably moves the learner model, and weights stay normalised
- **one learner cannot read another's path** — the boundary where a bug is a data leak

### Recommender evaluation

```bash
cd backend && python -m app.ml.evaluate          # add --json report.json to save
```

Sweeps 20 goals across every branch and reports structural and behavioural metrics.
Current results:

| Metric | Value | |
|---|---|---|
| `prerequisite_ordering_valid` | **1.00** | 92/92 in-plan prerequisite edges correctly ordered |
| `goal_plannable_rate` | **1.00** | 20/20 sweep goals resolved to a plannable target |
| `intent_resolution_top3` | **1.00** | 60/60 catalogue tracks recovered from a natural phrasing |
| `recommendation_relevance` | **1.00** | 186/186 were in-track or closed an open skill gap |
| `recommendation_track_precision` | 0.55 | strictly in-track (descriptive — see below) |
| `mean_readiness_gain` | **+0.88** | projected skill-gap closure per plan |
| `catalogue_coverage` | 0.09 | 223/2400 distinct courses surfaced across 20 goals |
| `latency_recommend_p95` | 123 ms | median 98 ms |
| `latency_plan_p95` | 72 ms | median 40 ms |

Two honest caveats, stated because they change how the numbers should be read:

1. **There is no held-out interaction data**, because there is no population of real
   learners. That rules out precision@k against observed clicks, NDCG against
   relevance judgements, and collaborative-filtering error — inventing that data
   would make the numbers meaningless. So these are structural invariants,
   behavioural properties, and accuracy against labels *derived from the
   catalogue's own taxonomy*.
2. **`recommendation_track_precision` is deliberately not optimised.** For an
   "ML engineer" goal, the off-track results are NLP, Computer Vision, Cloud and
   DevOps — genuinely relevant, just outside the two literally-resolved tracks.
   Driving this to 1.0 would mean never recommending an adjacent or gap-filling
   course, making the recommender worse. It is reported for transparency;
   `recommendation_relevance` is the metric with a target.

### Scratch harnesses

Kept for interactive inspection — they print full payloads rather than asserting:

```bash
cd backend
PYTHONPATH=. python probe_engine.py   # multi-turn chat + feedback loop, printed
PYTHONPATH=. python probe_api.py      # every REST endpoint, with response shapes
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
- The deployed backend is on a free tier with **no persistent disk**: the SQLite
  database is discarded when the instance recycles, so accounts registered on the
  live demo are not durable. Demo learners re-seed themselves automatically on
  boot, which is why they always work. A real deployment wants a managed Postgres.
- **Cold starts on the live demo take 1–3 minutes** (free-tier spin-up). The ML
  cache removed the refit cost from that, but not the host's own wake time.
