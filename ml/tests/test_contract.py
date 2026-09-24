"""
Guards on the boundaries this service shares with the rest of the project.

These fail when two things that must agree stop agreeing — the kind of drift that produces no
error anywhere, just quietly wrong numbers.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent


def test_risk_bands_match_the_frontend():
    # Two languages cannot share a constant, so read the TypeScript and compare.
    from app.domain import RISK_BANDS

    source = (PROJECT / "web" / "src" / "domain" / "thresholds.ts").read_text(encoding="utf-8")
    body = source[source.index("export function riskLevelForScore") :]
    found = re.findall(r"score >= (\d+)\) return '(\w+)'", body)[:3]
    assert [(int(n), level) for n, level in found] == list(RISK_BANDS)


def test_feature_contract_has_no_season_and_twelve_features():
    from app.domain import FEATURE_ORDER

    assert len(FEATURE_ORDER) == 12
    assert "season" not in FEATURE_ORDER


def test_inference_code_cannot_reach_the_label_formula():
    # If anything under app/ imported the formula, "prediction" could be the formula itself.
    offenders = []
    for path in (ROOT / "app").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            if any(n.startswith("training") for n in names):
                offenders.append(path.name)
    assert offenders == []


def test_inference_code_contains_no_demo_scores():
    # The frozen demo's route scores are the regression reference, not an output. If any of
    # them appeared as a literal in inference code, that would be the first sign of faking it.
    for path in (ROOT / "app").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for literal in ("87", "64", "32"):
            assert not re.search(rf"(?<![\w.]){literal}(?![\w.])", text), f"{literal} in {path.name}"


def test_dataset_is_deterministic():
    from training.generate_route_dataset import generate

    a, b = generate(rows=500), generate(rows=500)
    assert a.equals(b)
