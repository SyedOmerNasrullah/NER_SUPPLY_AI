"""
The generative formula behind the synthetic delivery-risk dataset.

This file is the *data-generating process*, not the model. The dataset generator and the tests
import it; `app/` must never import it (tests/test_contract.py enforces that). If inference could
reach this formula, the cheapest way to "predict" would be to evaluate it — fake ML with extra
steps.

Two labels come out of one physical story:

  delayMinutes   how much later than plan the vehicle arrives. Built from the journey itself:
                 the time it will take at the speed it is actually making, under the weather and
                 route risk it faces, minus the time the schedule assumed — plus the stoppages a
                 high-risk corridor imposes (slides cleared, single-lane working, convoy holds),
                 which grow faster than linearly with route risk and bite hardest at night.

  failed         whether that delay burns through the slack the cargo's priority allows. CRITICAL
                 medicine has 90 minutes; LOW-priority stores have six hours. The draw is
                 Bernoulli on a logistic of (delay - slack), so the boundary is a probability
                 rather than a step and a classifier has something real to learn.

Everything is closed form and seeded. Nothing here is taken from the demo fixtures, and none of
the demo's expected numbers appear anywhere in it.
"""

from __future__ import annotations

import numpy as np

#: The speed the schedule was written against, km/h. Planned time = distance / this.
NOMINAL_SPEED_KMH = 45.0

#: Minutes of slack each cargo priority carries before a late arrival counts as a failure,
#: indexed by CARGO_PRIORITY_CODE (LOW = 0 ... CRITICAL = 3).
PRIORITY_SLACK_MIN = (360.0, 240.0, 150.0, 90.0)

#: Logistic width on (delay - slack), in minutes. Wider means a softer boundary.
FAILURE_SCALE_MIN = 45.0


def _effective_speed(current_speed, route_risk, weather):
    """The speed actually achievable: what the vehicle is making, degraded by risk and weather."""
    factor = 1.0 - 0.25 * (route_risk / 100.0) - 0.10 * weather
    return np.maximum(5.0, current_speed) * np.clip(factor, 0.35, 1.0)


def _stoppage_minutes(route_risk, weather, hour):
    """Time a risky corridor takes back standing still."""
    risk = route_risk / 100.0
    base = 180.0 * risk**2 * (0.6 + 0.4 * (weather / 3.0))
    night = np.where((hour >= 22) | (hour <= 5), 1.25, 1.0)
    return base * night


def delay_minutes(distance_km, current_speed, route_risk, weather, hour, day_of_week):
    """Expected minutes behind schedule, before observation noise. Never negative."""
    travel_h = distance_km / _effective_speed(current_speed, route_risk, weather)
    planned_h = distance_km / NOMINAL_SPEED_KMH
    behind = np.maximum(0.0, travel_h - planned_h) * 60.0
    # Weekends run lighter, so a little of the delay comes back.
    weekend = np.where(day_of_week >= 5, 0.92, 1.0)
    return (behind + _stoppage_minutes(route_risk, weather, hour)) * weekend


def failure_probability(delay, cargo_priority):
    """P(the delivery misses its required window), given the delay and the cargo's slack."""
    slack = np.asarray(PRIORITY_SLACK_MIN, dtype=float)[np.asarray(cargo_priority, dtype=int)]
    return 1.0 / (1.0 + np.exp(-(delay - slack) / FAILURE_SCALE_MIN))
