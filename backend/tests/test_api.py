"""HTTP-level tests: auth, contracts, and the ownership boundary.

Runs against a real TestClient with an isolated on-disk-free database, so
these exercise routing, dependency injection, serialisation and auth exactly
as deployed — the layers a pure-engine test cannot reach.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app


@pytest.fixture(scope="module")
def client():
    """A client whose DB is swapped for an isolated in-memory one.

    The dependency override has to be installed *before* the TestClient
    context manager runs the app's lifespan, or startup (which seeds demo
    accounts) would touch the real database file.
    """
    # StaticPool is required, not incidental: every new connection to
    # `sqlite:///:memory:` gets its *own* empty database, and TestClient runs
    # the app on a different thread than the one that created the tables — so
    # without a single shared connection the app sees "no such table: users".
    db_engine = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(db_engine)
    TestingSession = sessionmaker(bind=db_engine, autoflush=False)

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    """Register a fresh learner and return their bearer header."""
    import uuid

    email = f"user-{uuid.uuid4().hex[:10]}@example.com"
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "testpass123", "full_name": "Test User"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# --------------------------------------------------------------------- #
# Meta
# --------------------------------------------------------------------- #
def test_health_reports_a_warm_engine(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["engine"]["ready"] is True
    assert body["engine"]["courses"] > 0


# --------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------- #
def test_register_returns_a_usable_token(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": "fresh@example.com", "password": "testpass123", "full_name": "Fresh"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "fresh@example.com"
    assert body["user"]["onboarded"] is False

    me = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200


def test_register_rejects_a_duplicate_email(client: TestClient) -> None:
    payload = {"email": "dupe@example.com", "password": "testpass123", "full_name": "Dupe"}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_register_rejects_a_short_password(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register", json={"email": "short@example.com", "password": "abc"}
    )
    assert response.status_code == 422


def test_login_rejects_a_wrong_password(client: TestClient) -> None:
    client.post(
        "/api/auth/register",
        json={"email": "pw@example.com", "password": "testpass123", "full_name": "PW"},
    )
    response = client.post(
        "/api/auth/login", json={"email": "pw@example.com", "password": "wrongpassword"}
    )
    assert response.status_code == 401


def test_protected_route_requires_a_token(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/dashboard").status_code == 401


# --------------------------------------------------------------------- #
# Core flow
# --------------------------------------------------------------------- #
def test_interpret_exposes_its_evidence(client: TestClient) -> None:
    response = client.post(
        "/api/profile/interpret",
        json={"text": "I want to become a machine learning engineer"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["plannable"] is True
    assert body["resolved_tracks"]
    assert body["evidence"]


def test_generate_preview_does_not_persist_a_path(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """Preview is the whole point of preview — it must not create state."""
    preview = client.post(
        "/api/paths/generate",
        headers=auth_headers,
        json={"goal_text": "I want to become a machine learning engineer", "preview": True},
    )
    assert preview.status_code == 200
    assert preview.json()["preview"] is True

    active = client.get("/api/paths/active", headers=auth_headers)
    assert active.json()["has_path"] is False, "a preview must not have created a path"


def test_full_path_lifecycle(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/api/paths/generate",
        headers=auth_headers,
        json={"goal_text": "I want to become a machine learning engineer"},
    )
    assert created.status_code == 201
    path_id = created.json()["id"]

    active = client.get("/api/paths/active", headers=auth_headers).json()
    assert active["has_path"] is True and active["id"] == path_id

    graph = client.get(f"/api/paths/{path_id}/graph", headers=auth_headers).json()
    assert graph["nodes"] and graph["edges"]

    dashboard = client.get("/api/dashboard", headers=auth_headers).json()
    assert dashboard["has_path"] is True
    assert dashboard["total_courses"] > 0


def test_progress_updates_and_reports_adaptation(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    created = client.post(
        "/api/paths/generate",
        headers=auth_headers,
        json={"goal_text": "I want to get into cybersecurity"},
    ).json()
    course_id = next(i["course_id"] for i in created["items"] if i["course_id"])

    response = client.post(
        f"/api/paths/{created['id']}/progress",
        headers=auth_headers,
        json={"course_id": course_id, "status": "completed"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["narrative"], "completing a step should tell the learner what they gained"
    assert body["dashboard"]["hours_completed"] > 0


def test_unresolvable_goal_is_rejected_not_guessed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/paths/generate",
        headers=auth_headers,
        json={"goal_text": "zxcvbnm qwertyuiop asdfghjkl"},
    )
    assert response.status_code == 422


def test_chat_turn_returns_intent_and_provenance(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/chat",
        headers=auth_headers,
        json={"message": "I want to become a machine learning engineer"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reply"]
    assert body["intent"] == "new_goal"
    assert body["source"] in {"local", "claude"}


# --------------------------------------------------------------------- #
# Ownership boundary
# --------------------------------------------------------------------- #
def test_a_learner_cannot_read_another_learners_path(client: TestClient) -> None:
    """The one boundary where a bug would be a data leak, not an inconvenience."""
    import uuid

    def register() -> dict[str, str]:
        email = f"owner-{uuid.uuid4().hex[:10]}@example.com"
        token = client.post(
            "/api/auth/register",
            json={"email": email, "password": "testpass123", "full_name": "Owner"},
        ).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    alice, bob = register(), register()
    alice_path = client.post(
        "/api/paths/generate",
        headers=alice,
        json={"goal_text": "I want to become a machine learning engineer"},
    ).json()["id"]

    assert client.get(f"/api/paths/{alice_path}", headers=bob).status_code == 404


# --------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------- #
def test_catalog_search_respects_its_filters(client: TestClient) -> None:
    body = client.post(
        "/api/catalog/search",
        json={"q": "machine learning", "difficulty": "Beginner", "limit": 5},
    ).json()
    assert body["results"]
    assert all(r["difficulty"] == "Beginner" for r in body["results"])


def test_unknown_course_is_a_404(client: TestClient) -> None:
    assert client.get("/api/catalog/courses/NOPE-9999").status_code == 404
