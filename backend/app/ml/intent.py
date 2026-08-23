"""Natural-language goal understanding, running entirely locally.

Learners do not type catalogue vocabulary. They say "I want to work on
self-driving cars", not "Autonomous Vehicle Technology". Four layers turn free
text into a structured goal, in increasing order of looseness:

1. **Lexical** — n-gram windows matched against the closed vocabularies
   (235 tracks, 65 careers, 76 skills, 36 sectors, 12 branches, 8 providers,
   5 formats). Multi-word track names are highly distinctive, so an exact hit is
   a near-certain signal.
2. **Alias ontology** — a curated phrase table mapping how people actually speak
   onto canonical targets ("ml" -> Machine Learning, "self-driving" ->
   Autonomous Vehicle Technology + Computer Vision). Every alias target is
   validated against the catalogue at startup, so the table can never point at a
   track that does not exist.
3. **Fuzzy** — ``difflib`` ratio over n-grams catches typos and inflections
   ("cybersecurty", "roboticss").
4. **Semantic** — LSA similarity against track centroids, which needs no keyword
   overlap and covers phrasings the first three layers miss.

Per-target scores are combined by taking the maximum, so a strong exact match is
never diluted by a weak semantic one.

Goal versus background
----------------------
"Get me into cybersecurity, I already know networking" states one *goal* and one
piece of *background*. Treating both as goals sends the roadmap up the wrong
ladder. The text is therefore split into clauses and each classified, so
background matches feed the learner's existing skill state instead of the target
profile — which is exactly what the profiling engine needs anyway.

This module is the fallback path when no LLM key is configured, and also the
*validator* for LLM output, so a language model can never invent a track or skill
outside the catalogue.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

from app.ml.catalog import DIFFICULTY_ORDER, Catalog
from app.ml.vectorizer import SemanticSpace

# --------------------------------------------------------------------------- #
# Alias ontology: spoken phrase -> canonical catalogue targets
# --------------------------------------------------------------------------- #
#: ``phrase -> [(kind, canonical_name, weight)]`` where kind is one of
#: "track" | "career" | "skill" | "branch" | "sector" | "provider" | "format".
#: Targets are validated against the catalogue in :meth:`IntentParser.__init__`;
#: anything unresolvable is dropped and reported rather than failing silently.
ALIASES: dict[str, list[tuple[str, str, float]]] = {
    # --- computing ---
    "ml": [("track", "Machine Learning", 1.0), ("career", "ml engineer", 0.9)],
    "machine learning": [("track", "Machine Learning", 1.0), ("career", "ml engineer", 0.9)],
    "ai": [("track", "Artificial Intelligence", 1.0)],
    "artificial intelligence": [("track", "Artificial Intelligence", 1.0)],
    "deep learning": [("track", "Machine Learning", 0.95), ("track", "Computer Vision", 0.6)],
    "neural network": [("track", "Machine Learning", 0.9)],
    "nlp": [("track", "Natural Language Processing", 1.0)],
    "language model": [("track", "Natural Language Processing", 0.9)],
    "chatbot": [("track", "Natural Language Processing", 0.85)],
    "computer vision": [("track", "Computer Vision", 1.0)],
    "image processing": [("track", "Computer Vision", 0.9), ("track", "Signal Processing", 0.5)],
    "data science": [
        ("track", "Big Data Analytics", 0.9),
        ("track", "Machine Learning", 0.8),
        ("career", "data scientist", 1.0),
    ],
    "data scientist": [
        ("track", "Big Data Analytics", 0.9),
        ("track", "Machine Learning", 0.85),
        ("career", "data scientist", 1.0),
    ],
    "data analyst": [("track", "Big Data Analytics", 0.95), ("career", "data scientist", 0.7)],
    "data analytics": [("track", "Big Data Analytics", 1.0)],
    "big data": [("track", "Big Data Analytics", 1.0)],
    "web dev": [("track", "Web Development", 1.0)],
    "web development": [("track", "Web Development", 1.0)],
    "web developer": [("track", "Web Development", 1.0)],
    "full stack": [("track", "Web Development", 1.0), ("career", "backend developer", 0.7)],
    "frontend": [("track", "Web Development", 0.9)],
    "front end": [("track", "Web Development", 0.9)],
    "backend": [("track", "Web Development", 0.8), ("career", "backend developer", 1.0)],
    "back end": [("track", "Web Development", 0.8), ("career", "backend developer", 1.0)],
    "app development": [("track", "Mobile App Development", 1.0)],
    "mobile app": [("track", "Mobile App Development", 1.0)],
    "android": [("track", "Mobile App Development", 0.9)],
    "ios": [("track", "Mobile App Development", 0.9)],
    "devops": [("track", "DevOps Engineering", 1.0), ("career", "devops engineer", 1.0)],
    "ci/cd": [("track", "DevOps Engineering", 0.9)],
    "kubernetes": [("track", "DevOps Engineering", 0.85), ("skill", "kubernetes", 1.0)],
    "docker": [("track", "DevOps Engineering", 0.8), ("skill", "docker", 1.0)],
    # MLOps sits between two tracks rather than inside either. Learners who say it
    # want the model work *and* the shipping work, so both are targeted and the
    # planner's prerequisite ordering decides which comes first.
    "mlops": [
        ("track", "Machine Learning", 0.9),
        ("track", "DevOps Engineering", 0.9),
        ("track", "Cloud Computing", 0.6),
        ("career", "ml engineer", 0.9),
    ],
    "ml ops": [
        ("track", "Machine Learning", 0.9),
        ("track", "DevOps Engineering", 0.9),
        ("career", "ml engineer", 0.9),
    ],
    "model deployment": [
        ("track", "Machine Learning", 0.85),
        ("track", "DevOps Engineering", 0.85),
        ("track", "Cloud Computing", 0.6),
    ],
    "model serving": [("track", "Machine Learning", 0.8), ("track", "DevOps Engineering", 0.8)],
    "production ml": [("track", "Machine Learning", 0.9), ("track", "DevOps Engineering", 0.8)],
    "deploying models": [("track", "Machine Learning", 0.85), ("track", "DevOps Engineering", 0.85)],
    # Deliberately weaker: "deployment" alone is ordinary English, so it should
    # nudge toward DevOps without outvoting anything stated more precisely.
    "deployment": [("track", "DevOps Engineering", 0.7), ("track", "Cloud Computing", 0.5)],
    "cloud": [("track", "Cloud Computing", 1.0), ("career", "cloud engineer", 0.9)],
    "aws": [("track", "Cloud Computing", 0.9)],
    "azure": [("track", "Cloud Computing", 0.9)],
    "cyber": [("track", "Cybersecurity", 1.0), ("career", "security analyst", 0.9)],
    "cybersecurity": [("track", "Cybersecurity", 1.0), ("career", "security analyst", 0.9)],
    "infosec": [("track", "Cybersecurity", 1.0)],
    "hacking": [("track", "Cybersecurity", 0.85)],
    "penetration testing": [("track", "Cybersecurity", 0.9)],
    "ethical hacking": [("track", "Cybersecurity", 0.95)],
    "blockchain": [("track", "Blockchain Development", 1.0)],
    "web3": [("track", "Blockchain Development", 0.9)],
    "smart contract": [("track", "Blockchain Development", 0.9)],
    "quantum": [("track", "Quantum Computing", 1.0)],
    "networking": [("track", "Computer Networks", 1.0)],
    "computer network": [("track", "Computer Networks", 1.0)],
    "operating system": [("track", "Operating Systems", 1.0)],
    "dsa": [("track", "Data Structures & Algorithms", 1.0)],
    "data structures": [("track", "Data Structures & Algorithms", 1.0)],
    "algorithms": [("track", "Data Structures & Algorithms", 0.95), ("skill", "algorithms", 1.0)],
    "competitive programming": [("track", "Data Structures & Algorithms", 0.9)],
    "coding interview": [("track", "Data Structures & Algorithms", 0.9)],
    "database": [("track", "Database Systems", 1.0)],
    "sql": [("track", "Database Systems", 0.85), ("skill", "sql", 1.0)],
    "software engineer": [("track", "Software Engineering", 1.0), ("career", "software engineer", 1.0)],
    "software developer": [("track", "Software Engineering", 1.0), ("career", "software engineer", 1.0)],
    "programmer": [("track", "Software Engineering", 0.8)],
    "system design": [("track", "Software Engineering", 0.9), ("skill", "system design", 1.0)],
    "iot": [("track", "Internet of Things", 1.0), ("career", "iot developer", 1.0)],
    "internet of things": [("track", "Internet of Things", 1.0)],
    "vlsi": [("track", "VLSI Design", 1.0), ("career", "vlsi design engineer", 1.0)],
    "chip design": [("track", "VLSI Design", 0.9), ("track", "Semiconductor Devices", 0.7)],
    "semiconductor": [("track", "Semiconductor Devices", 1.0)],
    "fpga": [("track", "FPGA Design", 1.0)],
    "embedded": [("track", "Embedded Systems", 1.0), ("career", "embedded systems engineer", 1.0)],
    "microcontroller": [("track", "Microprocessors and Microcontrollers", 1.0)],
    "arduino": [("track", "Microprocessors and Microcontrollers", 0.85)],
    "raspberry pi": [("track", "Internet of Things", 0.75)],
    # --- robotics / vehicles ---
    "robotics": [
        ("track", "Robotics Programming", 1.0),
        ("track", "Robotics and Automation", 0.9),
        ("career", "robotics engineer", 1.0),
    ],
    "robot": [("track", "Robotics Programming", 0.9), ("track", "Industrial Robotics", 0.7)],
    "self-driving": [("track", "Autonomous Vehicle Technology", 1.0), ("track", "Computer Vision", 0.75)],
    "self driving": [("track", "Autonomous Vehicle Technology", 1.0), ("track", "Computer Vision", 0.75)],
    "autonomous": [("track", "Autonomous Vehicle Technology", 1.0)],
    "driverless": [("track", "Autonomous Vehicle Technology", 1.0)],
    "adas": [("track", "Autonomous Vehicle Technology", 0.95)],
    "perception": [("track", "Computer Vision", 0.8)],
    "lidar": [("track", "Autonomous Vehicle Technology", 0.85)],
    "drone": [("track", "Unmanned Aerial Vehicles", 1.0)],
    "uav": [("track", "Unmanned Aerial Vehicles", 1.0)],
    "ev": [("track", "Electric Vehicle Technology", 1.0)],
    "electric vehicle": [("track", "Electric Vehicle Technology", 1.0)],
    "electric car": [("track", "Electric Vehicle Technology", 1.0)],
    "battery": [("track", "Battery Management Systems", 1.0), ("track", "Energy Storage Systems", 0.8)],
    "mechatronics": [("track", "Mechatronics", 1.0)],
    "plc": [("track", "PLC Programming", 1.0)],
    "automation": [("track", "Industrial Automation", 1.0)],
    "industry 4.0": [("track", "Industry 4.0", 1.0)],
    # --- aerospace ---
    "aerospace": [("branch", "Aerospace Engineering", 1.0)],
    "rocket": [("track", "Rocket Propulsion", 1.0), ("track", "Propulsion Systems", 0.8)],
    "spacecraft": [("track", "Spacecraft Design", 1.0)],
    "satellite": [("track", "Satellite Systems", 1.0), ("track", "Satellite Communication", 0.85)],
    "space mission": [("track", "Space Mission Design", 1.0)],
    "aerodynamics": [("track", "Aerodynamics", 1.0)],
    "avionics": [("track", "Avionics Systems", 1.0)],
    "aircraft": [("track", "Aircraft Design", 1.0)],
    "orbital mechanics": [("track", "Orbital Mechanics", 1.0)],
    "propulsion": [("track", "Propulsion Systems", 1.0)],
    # --- mechanical / manufacturing ---
    "cad": [("track", "CAD and CAM", 1.0)],
    "solidworks": [("track", "CAD and CAM", 0.7)],
    "3d printing": [("track", "Additive Manufacturing", 1.0)],
    "additive manufacturing": [("track", "Additive Manufacturing", 1.0)],
    "cnc": [("track", "Manufacturing Processes", 0.9)],
    "fea": [("track", "Finite Element Analysis", 1.0)],
    "cfd": [("track", "Computational Fluid Dynamics", 1.0)],
    "fluid dynamics": [("track", "Computational Fluid Dynamics", 0.95), ("track", "Fluid Mechanics", 0.9)],
    "thermodynamics": [("track", "Thermodynamics", 1.0)],
    "heat transfer": [("track", "Heat Transfer", 1.0)],
    "hvac": [("track", "HVAC Systems", 1.0)],
    "vibration": [("track", "Vibration Analysis", 1.0)],
    "turbomachinery": [("track", "Turbomachinery", 1.0)],
    "six sigma": [("track", "Six Sigma", 1.0), ("track", "Six Sigma Quality Control", 0.9)],
    "lean manufacturing": [("track", "Lean Manufacturing", 1.0)],
    "supply chain": [("track", "Supply Chain Management", 1.0)],
    "operations research": [("track", "Operations Research", 1.0)],
    "project management": [("track", "Project Management for Engineers", 1.0)],
    # --- civil ---
    "civil": [("branch", "Civil Engineering", 1.0)],
    "structural": [("track", "Structural Analysis", 1.0), ("career", "structural engineer", 1.0)],
    "bridge": [("track", "Bridge Engineering", 1.0)],
    "concrete": [("track", "Reinforced Concrete Design", 1.0)],
    "earthquake": [("track", "Earthquake Engineering", 1.0)],
    "seismic": [("track", "Earthquake Engineering", 0.95)],
    "geotechnical": [("track", "Geotechnical Engineering", 1.0)],
    "surveying": [("track", "Surveying", 1.0)],
    "bim": [("track", "Building Information Modeling", 1.0)],
    "construction": [("track", "Construction Management", 1.0)],
    "highway": [("track", "Highway Engineering", 1.0)],
    "urban planning": [("track", "Urban Planning", 1.0)],
    "green building": [("track", "Green Building Design", 1.0)],
    # --- electrical / power ---
    "power system": [("track", "Power Systems", 1.0)],
    "smart grid": [("track", "Smart Grid Technology", 1.0)],
    "microgrid": [("track", "Microgrid Design", 1.0)],
    "renewable": [("track", "Renewable Energy Systems", 1.0)],
    "solar": [("track", "Renewable Energy Systems", 0.9)],
    "wind energy": [("track", "Renewable Energy Systems", 0.9)],
    "power electronics": [("track", "Power Electronics", 1.0)],
    "electrical machine": [("track", "Electrical Machines", 1.0)],
    "high voltage": [("track", "High Voltage Engineering", 1.0)],
    "control system": [("track", "Control Systems", 1.0)],
    # --- electronics / comms ---
    "5g": [("track", "5G Technology", 1.0)],
    "antenna": [("track", "Antenna Design", 1.0)],
    "rf": [("track", "RF Circuit Design", 1.0)],
    "radar": [("track", "Radar Systems", 1.0)],
    "dsp": [("track", "Digital Signal Processing", 1.0)],
    "signal processing": [("track", "Signal Processing", 1.0), ("track", "Digital Signal Processing", 0.9)],
    "wireless": [("track", "Wireless Communication", 1.0)],
    "optical fiber": [("track", "Optical Communication", 1.0)],
    # --- chemical / petroleum / environment ---
    "chemical": [("branch", "Chemical Engineering", 1.0)],
    "process control": [("track", "Process Control", 1.0)],
    "reactor": [("track", "Reaction Engineering", 1.0)],
    "refinery": [("track", "Refinery Engineering", 1.0)],
    "petrochemical": [("track", "Petrochemical Engineering", 1.0)],
    "polymer": [("track", "Polymer Engineering", 1.0)],
    "drilling": [("track", "Drilling Engineering", 1.0)],
    "reservoir": [("track", "Reservoir Engineering", 1.0)],
    "oil and gas": [("branch", "Petroleum Engineering", 1.0)],
    "petroleum": [("branch", "Petroleum Engineering", 1.0)],
    "well logging": [("track", "Well Logging", 1.0)],
    "pipeline": [("track", "Pipeline Engineering", 1.0)],
    "offshore": [("track", "Offshore Engineering", 1.0)],
    "environmental": [("branch", "Environmental Engineering", 1.0)],
    "sustainability": [("track", "Sustainable Development", 1.0)],
    "carbon capture": [("track", "Carbon Capture and Storage", 1.0)],
    "water treatment": [("track", "Water Treatment Engineering", 1.0)],
    "wastewater": [("track", "Wastewater Engineering", 1.0)],
    "air pollution": [("track", "Air Pollution Control", 1.0)],
    "waste management": [("track", "Solid Waste Management", 1.0)],
    "climate": [("track", "Climate Change Engineering", 1.0)],
    "gis": [("track", "GIS for Environmental Analysis", 1.0)],
    # --- biomedical ---
    "biomedical": [("branch", "Biomedical Engineering", 1.0)],
    "medical device": [("track", "Medical Device Design", 1.0)],
    "medical imaging": [("track", "Medical Imaging", 1.0)],
    "prosthetics": [("track", "Prosthetics Design", 1.0)],
    "biomechanics": [("track", "Biomechanics", 1.0)],
    "tissue engineering": [("track", "Tissue Engineering", 1.0)],
    "bioinformatics": [("track", "Bioinformatics for Engineers", 1.0)],
    "biosensor": [("track", "Biosensors", 1.0)],
    "healthcare analytics": [("track", "Healthcare Data Analytics", 1.0)],
    "neural engineering": [("track", "Neural Engineering", 1.0)],
    # --- delivery-format preferences ---
    "video course": [("format", "Video Course", 1.0)],
    "video lecture": [("format", "Video Course", 1.0)],
    "watch videos": [("format", "Video Course", 1.0)],
    "self-paced": [("format", "Self-paced Reading", 1.0)],
    "self paced": [("format", "Self-paced Reading", 1.0)],
    "reading": [("format", "Self-paced Reading", 0.9)],
    "textbook": [("format", "Self-paced Reading", 0.9)],
    "live class": [("format", "Instructor-led Live", 1.0)],
    "live session": [("format", "Instructor-led Live", 1.0)],
    "instructor-led": [("format", "Instructor-led Live", 1.0)],
    "instructor led": [("format", "Instructor-led Live", 1.0)],
    "with a mentor": [("format", "Instructor-led Live", 0.9)],
    "hands-on": [("format", "Interactive Lab", 1.0)],
    "hands on": [("format", "Interactive Lab", 1.0)],
    "lab": [("format", "Interactive Lab", 0.9)],
    "practical": [("format", "Interactive Lab", 0.85)],
    "project-based": [("format", "Blended (Video + Project)", 1.0)],
    "project based": [("format", "Blended (Video + Project)", 1.0)],
    "blended": [("format", "Blended (Video + Project)", 1.0)],
}

#: Phrases signalling the learner's current level. Longest match wins, so
#: "know the basics" (Intermediate) beats a stray "beginner" elsewhere.
LEVEL_PATTERNS: dict[str, tuple[str, ...]] = {
    "Beginner": (
        "complete beginner", "absolute beginner", "beginner", "new to", "never done",
        "no experience", "no prior experience", "from scratch", "zero experience",
        "starting out", "just started", "fresher", "no background", "total newbie", "newbie",
    ),
    "Intermediate": (
        "intermediate", "some experience", "familiar with", "working knowledge",
        "know the basics", "know basics", "done a few projects", "comfortable with",
        "a bit of experience",
    ),
    "Advanced": (
        "advanced", "very experienced", "highly experienced", "experienced", "senior",
        "expert", "deep dive", "professional", "proficient", "specialise", "specialize",
        "cutting edge", "state of the art",
    ),
}

#: Ordered intent rules. Earlier entries win ties, so the more specific
#: conversational acts are listed before the broad "new_goal" catch-all.
_INTENT_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "feedback",
        ("too easy", "too hard", "too basic", "too advanced", "not relevant", "don't like",
         "dont like", "boring", "not interested", "too slow", "too fast", "irrelevant",
         "already know this", "this is great", "love this", "too long", "too short"),
    ),
    (
        "progress",
        ("my progress", "how am i doing", "how far", "what's next", "whats next", "next step",
         "what should i do next", "am i on track", "how much is left", "how much left",
         "completed so far", "my dashboard", "my milestone", "my stats"),
    ),
    (
        "explain",
        ("why did you", "why this", "why that", "why is", "why are", "explain why",
         "reason for", "justify", "how did you pick", "how did you choose", "why recommend",
         "what makes this", "why should i"),
    ),
    (
        "refine",
        ("instead", "rather than", "swap", "replace", "change it to", "i prefer", "shorter",
         "make it", "fewer", "more advanced", "less advanced", "different provider",
         "something else", "another option", "can you adjust", "tweak"),
    ),
    (
        "new_goal",
        ("i want", "i'd like", "i would like", "i need", "help me", "my goal", "aiming",
         "become a", "become an", "transition", "switch to", "get into", "learn", "master",
         "build a career", "career in", "prepare for", "roadmap", "path for", "teach me",
         "i wish", "i hope to", "plan to", "looking to", "interested in"),
    ),
    (
        "greeting",
        ("hello", "hi there", "hey", "good morning", "good evening", "namaste", "thanks",
         "thank you", "who are you", "what can you do", "how do you work"),
    ),
)

#: Bare greetings, matched on the whole utterance. Substring matching cannot be
#: used for these: "hi" occurs inside "this", "which" and "architecture", and
#: "yo" inside "your". Anchoring the whole (short) utterance is unambiguous.
_GREETING_EXACT = re.compile(
    r"^\s*(?:hi|hii+|hey+|yo|hiya|sup|hello|helo|howdy|greetings|namaste|"
    r"good\s+(?:morning|afternoon|evening|day)|"
    r"(?:hi|hey|hello)\s+(?:there|claude|bot))"
    r"[\s!.,?]*(?:everyone|all|again)?[\s!.,?]*$",
    re.IGNORECASE,
)

#: Phrases that only make sense as an adjustment to an *existing* plan. Unlike
#: the ``refine`` rules above these carry no target, so they are consulted after
#: parsing, when it is known that no track was found (see :meth:`IntentParser.parse`).
_BARE_REFINEMENT_MARKERS: tuple[str, ...] = (
    "actually", "instead", "on second thought", "can you make", "make it", "i only have",
    "i have only", "let's do", "lets do", "update", "adjust", "change", "reduce",
    "increase", "add ", "drop ", "remove ", "skip ", "cut ", "extend", "shorten",
)

#: Clause boundaries. Bare "and" is deliberately *not* a boundary because many
#: track names contain it ("CAD and CAM", "Robotics and Automation"); only "and"
#: followed by goal language splits.
_CLAUSE_SPLIT = re.compile(
    r"[,;!?]"
    r"|(?<=[a-zA-Z])\.\s"
    r"|\bbut\b|\bhowever\b|\balthough\b|\bthough\b"
    r"|\band (?:i )?(?:want|need|would like|wish|hope|plan|aim|am looking|would love)\b"
    r"|\bnow i\b|\bso i\b|\bwhile i\b",
    re.IGNORECASE,
)

#: A clause containing any of these states existing knowledge, not a goal.
#: Written with natural punctuation and normalised through :func:`_norm` in
#: :meth:`IntentParser.__init__` before use — clause text has already been through
#: ``_norm``, which turns apostrophes into spaces, so a literal "i've done" here
#: could never match "i ve done" there. Six markers were silently dead for that
#: reason, which is how "I've done data structures" was read as a *goal* and put a
#: learner back at the start of a ladder they had already climbed.
BACKGROUND_MARKERS: tuple[str, ...] = (
    "already know", "already familiar", "already did", "already done", "already completed",
    "already have", "i know", "i've done", "i have done", "i've completed", "i have completed",
    "i've taken", "i have taken", "i took", "i studied", "i have studied", "i've studied",
    "familiar with", "experience with", "experience in", "background in", "worked with",
    "worked on", "comfortable with", "good at", "proficient in", "did my", "graduated in",
    "my degree", "completed", "finished", "i learnt", "i learned", "used to work",
    # Stating competence without the word "know" or "done".
    "i understand", "i can already", "i've used", "i have used", "i've built", "i have built",
    "i've worked", "i have worked", "my background", "basic knowledge of", "some experience",
    "i'm comfortable", "i am comfortable", "solid in", "strong in", "confident in",
    "years in", "years of", "my day job", "professionally",
)

#: "3 years of experience" is a *level* signal, not a timeline. Stripped before
#: timeline parsing so it cannot be misread as a 156-week deadline.
_EXPERIENCE_YEARS = re.compile(
    r"(\d+)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp\b|work|working)"
)


@dataclass
class GoalInterpretation:
    """Structured reading of one learner utterance."""

    raw_text: str
    intent: str = "new_goal"
    intent_confidence: float = 0.0
    #: Goal targets. track -> relevance weight in [0, 1].
    tracks: dict[str, float] = field(default_factory=dict)
    careers: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    branches: list[str] = field(default_factory=list)
    sectors: list[str] = field(default_factory=list)
    #: Stated background, feeding the learner's current skill state.
    known_tracks: list[str] = field(default_factory=list)
    known_skills: list[str] = field(default_factory=list)
    #: Delivery preferences, collected from every clause.
    providers: list[str] = field(default_factory=list)
    formats: list[str] = field(default_factory=list)
    experience_level: str | None = None
    weekly_hours: float | None = None
    timeline_weeks: int | None = None
    years_experience: int | None = None
    #: Audit trail: which phrase produced which target, via which layer.
    evidence: list[dict] = field(default_factory=list)
    #: "local" or "llm"
    source: str = "local"

    @property
    def ranked_tracks(self) -> list[tuple[str, float]]:
        return sorted(self.tracks.items(), key=lambda kv: (-kv[1], kv[0]))

    @property
    def has_target(self) -> bool:
        return bool(self.tracks or self.careers or self.skills or self.branches)

    def as_dict(self) -> dict:
        return {
            "intent": self.intent,
            "intent_confidence": round(self.intent_confidence, 3),
            "tracks": [{"track": t, "weight": round(w, 3)} for t, w in self.ranked_tracks[:8]],
            "careers": self.careers,
            "skills": self.skills,
            "branches": self.branches,
            "sectors": self.sectors,
            "known_tracks": self.known_tracks,
            "known_skills": self.known_skills,
            "providers": self.providers,
            "formats": self.formats,
            "experience_level": self.experience_level,
            "weekly_hours": self.weekly_hours,
            "timeline_weeks": self.timeline_weeks,
            "years_experience": self.years_experience,
            "evidence": self.evidence[:14],
            "source": self.source,
        }


class IntentParser:
    """Turns learner text into a :class:`GoalInterpretation`."""

    #: Intents where the learner is not naming a topic, so the loose semantic
    #: layer would only add noise.
    NO_SEMANTIC_INTENTS = frozenset({"greeting", "progress", "explain", "feedback"})

    def __init__(self, cat: Catalog, space: SemanticSpace) -> None:
        self.cat = cat
        self.space = space

        # ---- normalised vocabulary: normalised name -> (kind, canonical) ----
        self._vocab: dict[str, tuple[str, str]] = {}
        for kind, names in (
            ("sector", cat.sectors),  # lowest priority first; later kinds overwrite
            ("skill", cat.skills),
            ("career", cat.careers),
            ("branch", cat.branches),
            ("provider", cat.providers),
            ("format", cat.formats),
            ("track", cat.tracks),
        ):
            for name in names:
                self._vocab[_norm(name)] = (kind, name)

        # ---- validate the alias table against the real catalogue ----
        valid: dict[str, set[str]] = {
            "track": set(cat.tracks),
            "career": set(cat.careers),
            "skill": set(cat.skills),
            "branch": set(cat.branches),
            "sector": set(cat.sectors),
            "provider": set(cat.providers),
            "format": set(cat.formats),
        }
        self.aliases: dict[str, list[tuple[str, str, float]]] = {}
        self.dropped_aliases: list[tuple[str, str, str]] = []
        for phrase, targets in ALIASES.items():
            kept = []
            for kind, canonical, weight in targets:
                if canonical in valid.get(kind, ()):
                    kept.append((kind, canonical, weight))
                else:
                    self.dropped_aliases.append((phrase, kind, canonical))
            if kept:
                self.aliases[phrase] = kept

        # Precompiled plural-tolerant boundary patterns, longest phrase first so
        # "electric vehicle" is tried before "ev".
        self._alias_patterns: list[tuple[re.Pattern[str], str]] = [
            (re.compile(rf"(?<![a-z0-9]){re.escape(p)}(?:es|s)?(?![a-z0-9])"), p)
            for p in sorted(self.aliases, key=len, reverse=True)
        ]

        #: Vocabulary keys long enough to fuzzy-match without false positives.
        self._fuzzy_keys = [k for k in self._vocab if len(k) >= 6]

        #: Background markers put through the same normaliser as clause text, so
        #: the two can never diverge on punctuation. De-duplicated because "i've
        #: done" and "i have done" collapse to distinct strings but several other
        #: pairs do not.
        self._background_markers = tuple(dict.fromkeys(_norm(m) for m in BACKGROUND_MARKERS))

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def parse(self, text: str) -> GoalInterpretation:
        raw = (text or "").strip()
        interp = GoalInterpretation(raw_text=raw)
        if not raw:
            interp.intent = "greeting"
            return interp

        full = _norm(raw)
        interp.intent, interp.intent_confidence = self._classify_intent(full)

        # ---- clause split: goals versus stated background ----
        goal_clauses: list[str] = []
        for clause in _CLAUSE_SPLIT.split(raw):
            clause_norm = _norm(clause or "")
            if not clause_norm:
                continue
            background = any(m in clause_norm for m in self._background_markers)
            self._match_lexical(clause_norm, interp, background=background)
            self._match_aliases(clause_norm, interp, background=background)
            if not background:
                goal_clauses.append(clause_norm)

        goal_text = " ".join(goal_clauses) or full
        self._match_fuzzy(goal_text, interp)
        self._match_semantic(goal_text, interp)

        # ---- numeric and level signals, read from the whole utterance ----
        years = _EXPERIENCE_YEARS.search(full)
        if years:
            interp.years_experience = int(years.group(1))
        interp.experience_level = self._detect_level(full, interp.years_experience)
        interp.weekly_hours = self._detect_weekly_hours(full)
        interp.timeline_weeks = self._detect_timeline(_EXPERIENCE_YEARS.sub(" ", full))

        # A named career implies its branch, which narrows the candidate pool.
        for career in interp.careers:
            positions = self.cat.career_index.get(career, [])
            if not positions:
                continue
            branch = self.cat.df.iloc[positions[0]]["branch"]
            if branch not in interp.branches:
                interp.branches.append(branch)

        self._reclassify(interp, full)
        return interp

    # ------------------------------------------------------------------ #
    @staticmethod
    def _reclassify(interp: GoalInterpretation, lowered: str) -> None:
        """Correct the phrase-rule guess using what parsing actually found.

        Two cases the keyword rules cannot decide on their own:

        * *"actually I only have 4 hours a week"* carries a real constraint but no
          target. Read as a new goal it produces nothing; read as a refinement it
          re-plans the existing path, which is what the learner meant.
        * *"machine learning"* — a bare topic with no verb — matches no rule and
          falls through to the weak ``new_goal`` default. Once a track has been
          resolved from it, that default is right and deserves real confidence.
        """
        if interp.intent not in ("new_goal", "question") or interp.intent_confidence > 0.5:
            return

        has_constraint = any(
            v is not None
            for v in (interp.weekly_hours, interp.timeline_weeks, interp.experience_level)
        ) or bool(interp.providers or interp.formats)

        if not interp.has_target and has_constraint:
            interp.intent, interp.intent_confidence = "refine", 0.65
            return
        if not interp.has_target and any(m in lowered for m in _BARE_REFINEMENT_MARKERS):
            interp.intent, interp.intent_confidence = "refine", 0.55
            return
        if interp.has_target and interp.intent == "new_goal":
            # Confidence follows the strength of the strongest resolved target.
            best = max([w for _, w in interp.ranked_tracks] or [0.6])
            interp.intent_confidence = round(min(0.5 + 0.5 * best, 0.95), 3)

    # ------------------------------------------------------------------ #
    # Layer 1: lexical
    # ------------------------------------------------------------------ #
    def _match_lexical(self, clause: str, interp: GoalInterpretation, *, background: bool) -> None:
        tokens = clause.split()
        for size in (5, 4, 3, 2, 1):
            for i in range(len(tokens) - size + 1):
                phrase = " ".join(tokens[i : i + size])
                hit = self._vocab.get(phrase)
                if hit is None:
                    continue
                kind, canonical = hit
                # Single very short tokens are too ambiguous to trust lexically.
                if size == 1 and len(phrase) <= 3 and kind not in {"skill", "provider"}:
                    continue
                self._add(interp, kind, canonical, 1.0, phrase, "lexical", background)

    # ------------------------------------------------------------------ #
    # Layer 2: alias ontology
    # ------------------------------------------------------------------ #
    def _match_aliases(self, clause: str, interp: GoalInterpretation, *, background: bool) -> None:
        for pattern, phrase in self._alias_patterns:
            if pattern.search(clause):
                for kind, canonical, weight in self.aliases[phrase]:
                    self._add(interp, kind, canonical, weight, phrase, "alias", background)

    # ------------------------------------------------------------------ #
    # Layer 3: fuzzy
    # ------------------------------------------------------------------ #
    def _match_fuzzy(self, goal_text: str, interp: GoalInterpretation) -> None:
        """Typo tolerance. Stricter once solid targets already exist."""
        cutoff = 0.90 if interp.tracks else 0.86
        tokens = goal_text.split()
        for size in (3, 2, 1):
            for i in range(len(tokens) - size + 1):
                phrase = " ".join(tokens[i : i + size])
                if len(phrase) < 6 or phrase in self._vocab:
                    continue
                for match in difflib.get_close_matches(phrase, self._fuzzy_keys, n=1, cutoff=cutoff):
                    kind, canonical = self._vocab[match]
                    ratio = difflib.SequenceMatcher(None, phrase, match).ratio()
                    self._add(interp, kind, canonical, 0.85 * ratio, phrase, "fuzzy", False)

    # ------------------------------------------------------------------ #
    # Layer 4: semantic
    # ------------------------------------------------------------------ #
    def _match_semantic(self, goal_text: str, interp: GoalInterpretation) -> None:
        if interp.intent in self.NO_SEMANTIC_INTENTS:
            return
        vector = self.space.encode(goal_text)
        if not vector.any():
            return
        for track, score in self.space.rank_tracks(vector, top_n=5):
            if score < 0.22:
                continue
            # Discounted so an exact lexical or alias hit always dominates.
            self._add(interp, "track", track, 0.8 * score, goal_text[:60], "semantic", False)

    # ------------------------------------------------------------------ #
    def _add(
        self,
        interp: GoalInterpretation,
        kind: str,
        canonical: str,
        weight: float,
        phrase: str,
        layer: str,
        background: bool,
    ) -> None:
        if background:
            # Preferences still apply; targets become known state instead.
            bucket = {
                "track": interp.known_tracks,
                "skill": interp.known_skills,
                "provider": interp.providers,
                "format": interp.formats,
            }.get(kind)
            if bucket is None or canonical in bucket:
                return
            bucket.append(canonical)
        elif kind == "track":
            if weight <= interp.tracks.get(canonical, 0.0):
                return
            interp.tracks[canonical] = weight
        else:
            bucket = {
                "career": interp.careers,
                "skill": interp.skills,
                "branch": interp.branches,
                "sector": interp.sectors,
                "provider": interp.providers,
                "format": interp.formats,
            }.get(kind)
            if bucket is None or canonical in bucket:
                return
            bucket.append(canonical)

        interp.evidence.append(
            {
                "kind": kind,
                "value": canonical,
                "matched": phrase,
                "layer": layer,
                "role": "background" if background else "goal",
                "weight": round(weight, 3),
            }
        )

    # ------------------------------------------------------------------ #
    @staticmethod
    def _classify_intent(lowered: str) -> tuple[str, float]:
        if _GREETING_EXACT.match(lowered):
            return "greeting", 0.95

        best_intent, best_score = "", 0.0
        for intent, phrases in _INTENT_RULES:
            hits = sum(1 for p in phrases if p in lowered)
            if not hits:
                continue
            score = min(0.55 + 0.15 * hits, 1.0)
            if score > best_score:  # strict >, so earlier (more specific) rules win ties
                best_intent, best_score = intent, score

        if not best_intent:
            first = lowered.split()[0] if lowered.split() else ""
            if first in {
                "what", "which", "how", "when", "where", "is", "are", "can", "should",
                "do", "does", "who", "will", "could", "would",
            }:
                return "question", 0.6
            return "new_goal", 0.35

        # A long utterance that merely opens with a greeting is still a goal.
        if best_intent == "greeting" and len(lowered.split()) > 8:
            return "new_goal", 0.4
        return best_intent, best_score

    # ------------------------------------------------------------------ #
    @staticmethod
    def _detect_level(lowered: str, years: int | None) -> str | None:
        """Longest matching phrase wins; explicit years override vague wording."""
        best_level, best_len = None, 0
        for level in DIFFICULTY_ORDER:
            for phrase in LEVEL_PATTERNS.get(level, ()):
                if phrase in lowered and len(phrase) > best_len:
                    best_level, best_len = level, len(phrase)
        if best_level:
            return best_level
        if years is not None:
            return "Advanced" if years >= 3 else "Intermediate" if years >= 1 else "Beginner"
        return None

    @staticmethod
    def _detect_weekly_hours(lowered: str) -> float | None:
        patterns = (
            r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:per|a|an|each|every|/)\s*week",
            r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*weekly",
            r"(?:about|around|roughly|maybe)?\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s+a\s+week",
        )
        for pattern in patterns:
            match = re.search(pattern, lowered)
            if match:
                hours = float(match.group(1))
                if 0 < hours <= 80:
                    return hours
        if re.search(r"\bfull[- ]?time\b", lowered):
            return 35.0
        if re.search(r"\bpart[- ]?time\b", lowered):
            return 12.0
        if re.search(r"\b(?:weekends?|weekend only)\b", lowered):
            return 8.0
        return None

    @staticmethod
    def _detect_timeline(lowered: str) -> int | None:
        match = re.search(r"(\d+)\s*(week|month|year)s?", lowered)
        if not match:
            return None
        amount, unit = int(match.group(1)), match.group(2)
        weeks = {"week": 1, "month": 4, "year": 52}[unit] * amount
        return weeks if 1 <= weeks <= 260 else None


def _norm(text: str) -> str:
    """Lowercase, punctuation to spaces, whitespace collapsed."""
    lowered = (text or "").lower()
    lowered = re.sub(r"[^\w\s&/#+.-]", " ", lowered)
    return " ".join(lowered.split())
