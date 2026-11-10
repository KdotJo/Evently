#!/usr/bin/env python
"""Seed believable past events and researched venues through the public HTTP API.

Real (from `app.providers`): names, addresses, coordinates, place ids, ratings, review counts, websites,
phone numbers, opening-hour-independent listing facts, parking options, weather climatology.
Derived (deterministic, no LLM, labelled as estimates on the card): capacity, pricing, scores, pros/cons,
summaries, ranks and planner to-do notes. Drive times use the free heuristic provider, labelled as such.

Writes go through the HTTP API (the search indexer sees them via the normal event bus). Re-running is
idempotent: seeded events carry the marker `requirements.intake.demo_seed` and cards are matched by place id.
`--reset` deletes only marked events. Raw provider responses are cached in `.demo_seed_snapshot.json`
(gitignored: Google's terms restrict storing Places content), so re-seeding does not re-bill.

    task demo:seed BASE_URL=http://api.evently.localtest.me
    task demo:seed BASE_URL=http://api.evently.localtest.me -- --reset
    ACCESS_TOKEN=... task demo:seed ...   (seed for a signed-in account instead of the dev user)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import time as clock
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from app.agents.venues.cards import place_summary  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.providers.base import (  # noqa: E402
    GeoPoint,
    ParkingOption,
    PlaceCandidate,
    PlaceDetails,
    ProviderError,
    TravelEstimate,
    WeatherOutlook,
)
from app.providers.geo import TimezoneResolver  # noqa: E402
from app.providers.places import GooglePlacesProvider  # noqa: E402
from app.providers.traffic import HeuristicTrafficProvider  # noqa: E402
from app.providers.weather import OpenMeteoWeatherProvider  # noqa: E402
from app.schemas.venue import (  # noqa: E402
    CapacityAssessment,
    Fit,
    ParkingAssessment,
    ParkingSpot,
    PricingAssessment,
    Risk,
    Source,
    TrafficAssessment,
    VenueCardData,
    VenueCriteria,
    VenueScore,
    WeatherAssessment,
)

SNAPSHOT_PATH = BACKEND_DIR / ".demo_seed_snapshot.json"
MARKER_PREFIX = "evently-demo-seed:"
MARKER_KEY = "demo_seed"
DEFAULT_METROS = "bay-area,austin,chicago"
DEFAULT_GOOGLE_CAP = 80
SEARCH_RESULTS = 16  # a Text Search bills per request, not per result
PARKING_RADIUS_M = 800
RETRY_STATUSES = {502, 503, 504}
RETRY_WINDOW_S = 240.0
REQUEST_TIMEOUT_S = 30.0

# --------------------------------------------------------------------------- what gets seeded


@dataclass(frozen=True)
class Metro:
    key: str
    label: str  # "San Francisco, CA": search area and event location unless a plan overrides it
    origin: str  # where most attendees set off from, for drive times
    areas: dict[str, str] = field(default_factory=dict)  # plan slug -> search area within the metro


METROS: dict[str, Metro] = {
    "bay-area": Metro(
        key="bay-area",
        label="San Francisco, CA",
        origin="San Francisco Caltrain Station, San Francisco, CA",
        areas={"offsite": "Sonoma, CA", "team-dinner": "Palo Alto, CA", "launch": "Oakland, CA"},
    ),
    "austin": Metro(
        key="austin",
        label="Austin, TX",
        origin="Texas State Capitol, Austin, TX",
        areas={"offsite": "Dripping Springs, TX", "wedding": "Round Rock, TX"},
    ),
    "chicago": Metro(
        key="chicago",
        label="Chicago, IL",
        origin="Chicago Union Station, Chicago, IL",
        areas={"offsite": "Lake Geneva, WI", "wedding": "Oak Park, IL"},
    ),
}


@dataclass(frozen=True)
class EventPlan:
    slug: str
    metro_slot: int  # index into the chosen metros (wraps around), so any metro list works
    event_type: str
    frontend_type: str  # the web app's EVENT_TYPES label, so a reopened event shows the right workflow
    title: str  # "{area}" is replaced with the short search-area name
    query: str  # Places text query; the search area is folded in
    size: int  # venue cards on this event
    headcount: int
    event_date: date
    start: time
    end: time
    budget: str
    setting: str
    must_haves: tuple[str, ...]
    notes: str
    goal: str
    rank_top: int | None = None  # only the top N get a rank (the rest look unreviewed); None = rank all


PLANS: tuple[EventPlan, ...] = (
    EventPlan(
        slug="offsite",
        metro_slot=0,
        event_type="offsite",
        frontend_type="Business",
        title="Spring Leadership Offsite in {area}",
        query="corporate retreat and meeting venue",
        size=6,
        headcount=40,
        event_date=date(2026, 5, 14),
        start=time(9, 0),
        end=time(17, 0),
        budget="under $25k",
        setting="either",
        must_haves=("breakout rooms", "quiet setting", "group meals on site"),
        notes="Wanted somewhere calm enough for focused strategy sessions.",
        goal="Align the leadership team on next year's priorities",
    ),
    EventPlan(
        slug="gala",
        metro_slot=0,
        event_type="gala",
        frontend_type="Business",
        title="Autumn Benefit Gala in {area}",
        query="ballroom and historic venue for a gala dinner",
        size=6,
        headcount=300,
        event_date=date(2026, 9, 19),
        start=time(18, 0),
        end=time(23, 0),
        budget="$60k-$90k",
        setting="indoor",
        must_haves=("seated dinner for 300", "stage and AV", "coat check"),
        notes="Formal evening with a seated dinner and short program.",
        goal="Raise funds for the arts education program",
        rank_top=4,
    ),
    EventPlan(
        slug="team-dinner",
        metro_slot=0,
        event_type="team dinner",
        frontend_type="Business",
        title="Engineering Team Dinner in {area}",
        query="restaurant with a private dining room for a group dinner",
        size=5,
        headcount=18,
        event_date=date(2026, 10, 8),
        start=time(18, 30),
        end=time(21, 0),
        budget="under $4k",
        setting="indoor",
        must_haves=("private room", "vegetarian options"),
        notes="Small celebration after the Q3 release, somewhere easy to talk.",
        goal="Celebrate the Q3 release with the team",
    ),
    EventPlan(
        slug="launch",
        metro_slot=1,
        event_type="product launch",
        frontend_type="Business",
        title="Product Launch Party in {area}",
        query="event space with rooftop or terrace for a launch party",
        size=6,
        headcount=120,
        event_date=date(2026, 3, 11),
        start=time(17, 0),
        end=time(21, 0),
        budget="$15k-$30k",
        setting="either",
        must_haves=("space for demos", "bar service", "press area"),
        notes="Evening launch with demos and a short keynote.",
        goal="Launch the new product to press and customers",
        rank_top=4,
    ),
    EventPlan(
        slug="conference",
        metro_slot=1,
        event_type="conference",
        frontend_type="Conference",
        title="Founders Summit in {area}",
        query="conference center and convention space",
        size=5,
        headcount=450,
        event_date=date(2026, 2, 25),
        start=time(8, 0),
        end=time(18, 0),
        budget="under $75k",
        setting="indoor",
        must_haves=("main stage", "breakout rooms", "sponsor expo area"),
        notes="Single-day summit with a main stage and several tracks.",
        goal="Bring founders and investors together for a day of talks",
    ),
    EventPlan(
        slug="wedding",
        metro_slot=2,
        event_type="wedding",
        frontend_type="Wedding",
        title="Garden Wedding in {area}",
        query="wedding venue with garden ceremony space",
        size=6,
        headcount=140,
        event_date=date(2026, 6, 13),
        start=time(16, 0),
        end=time(22, 0),
        budget="$35k-$55k",
        setting="outdoor",
        must_haves=("ceremony and reception on site", "rain backup"),
        notes="Late-afternoon ceremony outdoors, reception right after.",
        goal="Host a ceremony and reception for family and friends",
    ),
)

# --- derivation tables (estimates based on what a venue *is*, not on anything the venue told us)


@dataclass(frozen=True)
class Profile:
    noun: str
    capacity: int
    price_factor: float
    themes: frozenset[str] = frozenset()


def _profile(noun: str, capacity: int, price_factor: float, *themes: str) -> Profile:
    return Profile(noun, capacity, price_factor, frozenset(themes))


# Word patterns in the venue's name win over its Google types: the name is more specific ("ballroom" vs "lodging").
NAME_PROFILES: tuple[tuple[str, Profile], ...] = (
    (r"convention cent(er|re)", _profile("convention center", 2500, 1.1, "modern")),
    (r"conference cent(er|re)", _profile("conference center", 700, 1.1, "modern")),
    (r"ballroom", _profile("ballroom", 420, 1.2, "grand")),
    (r"theat(er|re)", _profile("theater", 480, 1.05, "historic")),
    (r"winery|vineyards?", _profile("winery estate", 160, 1.15, "calm", "garden")),
    (r"brewery|brewing", _profile("brewery", 150, 0.85, "lively")),
    (r"estate|mansion|manor", _profile("estate", 220, 1.2, "grand", "garden", "historic")),
    (r"barn|ranch", _profile("ranch venue", 200, 0.95, "calm", "garden")),
    (r"resort|retreat", _profile("retreat resort", 300, 1.25, "calm")),
    (r"\binn\b|lodge", _profile("inn", 70, 1.0, "calm", "cozy")),
    (r"country club|golf", _profile("country club", 260, 1.1, "grand", "garden")),
    (r"gallery", _profile("art gallery", 130, 1.0, "modern")),
    (r"museum", _profile("museum", 320, 1.1, "historic")),
    (r"warehouse|loft|studio|foundry", _profile("loft-style event space", 200, 0.95, "modern")),
    (r"garden", _profile("garden venue", 180, 0.95, "garden", "calm")),
    (r"hotel", _profile("hotel", 300, 1.2, "grand")),
)
TYPE_PROFILES: dict[str, Profile] = {
    "convention_center": _profile("convention center", 2500, 1.1, "modern"),
    "banquet_hall": _profile("banquet hall", 350, 1.05, "grand"),
    "wedding_venue": _profile("wedding venue", 180, 1.1, "garden"),
    "event_venue": _profile("event space", 220, 1.0, "modern"),
    "resort_hotel": _profile("resort hotel", 350, 1.25, "calm", "grand"),
    "hotel": _profile("hotel", 300, 1.2, "grand"),
    "lodging": _profile("hotel", 250, 1.15, "grand"),
    "winery": _profile("winery", 160, 1.15, "calm", "garden"),
    "fine_dining_restaurant": _profile("fine-dining restaurant", 60, 1.3, "cozy", "grand"),
    "restaurant": _profile("restaurant", 70, 1.0, "cozy"),
    "wine_bar": _profile("wine bar", 60, 0.95, "cozy"),
    "bar": _profile("bar", 80, 0.9, "lively"),
    "night_club": _profile("nightclub", 250, 0.95, "lively"),
    "performing_arts_theater": _profile("performing arts theater", 480, 1.05, "historic"),
    "art_gallery": _profile("art gallery", 130, 1.0, "modern"),
    "museum": _profile("museum", 320, 1.1, "historic"),
    "historical_landmark": _profile("historic landmark", 200, 1.1, "historic"),
    "botanical_garden": _profile("botanical garden", 220, 0.9, "garden", "calm"),
    "garden": _profile("garden", 180, 0.9, "garden", "calm"),
    "park": _profile("park", 350, 0.7, "garden", "calm"),
    "coworking_space": _profile("coworking space", 70, 0.8, "modern"),
    "community_center": _profile("community center", 180, 0.6),
    "cultural_center": _profile("cultural center", 250, 0.85, "historic"),
}
DEFAULT_PROFILE = _profile("event venue", 150, 1.0)
# Not events venues, however the text query matched them.
EXCLUDED_TYPES = {
    "parking",
    "parking_garage",
    "parking_lot",
    "airport",
    "gas_station",
    "car_rental",
    "real_estate_agency",
}

PER_PERSON_USD = {
    "offsite": 350,
    "gala": 280,
    "team dinner": 140,
    "product launch": 140,
    "conference": 160,
    "wedding": 250,
}
PRICE_LEVEL_FACTOR = {"inexpensive": 0.75, "moderate": 1.0, "expensive": 1.25, "very expensive": 1.5, "free": 0.5}
EVENT_USES = {
    "offsite": "leadership offsites and retreats",
    "gala": "formal galas and fundraising dinners",
    "team dinner": "team dinners and small celebrations",
    "product launch": "product launches and press nights",
    "conference": "conferences and multi-track summits",
    "wedding": "wedding ceremonies and receptions",
}
# Theme vocabulary: which themes apply comes from the venue's name, types and Google's description; the exact
# word only varies the language, which is what semantic search matches on.
VOCABULARY = {
    "calm": ("calm", "quiet", "peaceful", "tranquil", "serene"),
    "cozy": ("cozy", "intimate", "warm", "relaxed"),
    "lively": ("lively", "energetic", "buzzy", "vibrant"),
    "grand": ("grand", "elegant", "formal", "stately"),
    "modern": ("modern", "contemporary", "industrial-chic", "design-forward"),
    "historic": ("historic", "landmark", "heritage", "storied"),
    "garden": ("garden", "courtyard", "lawn", "leafy outdoor area"),
    "roof": ("rooftop", "terrace", "roof deck", "upper-level patio"),
}
ROOF_EVIDENCE = re.compile(r"roof|terrace|skyline|\bsky\b", re.I)
GARDEN_EVIDENCE = re.compile(r"garden|courtyard|patio|lawn", re.I)
# Planner-style to-dos: things still to check, never claims about what happened or what a venue said.
PLANNER_NOTES = (
    "Ask about the AV package and load-in times.",
    "Backup if the top pick is unavailable.",
    "Need to confirm catering rules before shortlisting.",
    "Check parking validation before booking.",
    "Worth a site visit if the dates work.",
    "Confirm step-free access to every room we would use.",
    "Ask whether a deposit is refundable if the date moves.",
    "Check noise limits for the end of the evening.",
)

# --------------------------------------------------------------------------- deterministic helpers


def _hash(*parts: object) -> int:
    return int(hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:8], 16)


def _pick(options: Sequence[str], *parts: object) -> str:
    return options[_hash(*parts) % len(options)]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _round_people(value: float) -> int:
    step = 5 if value < 100 else 50 if value >= 1000 else 10
    return max(step, int(round(value / step)) * step)


def _usd(value: float) -> str:
    return f"${value / 1000:.0f}k" if value >= 10_000 else f"${value / 1000:.1f}k"


def _budget_limit(budget: str | None) -> float | None:
    """Upper bound in dollars from free text like "under $25k" or "$60k-$90k"; None when there is no figure."""
    amounts = re.findall(r"\$?(\d+(?:\.\d+)?)\s*(k|m)?", (budget or "").lower())
    values = [float(a) * {"k": 1_000, "m": 1_000_000, "": 1}[unit] for a, unit in amounts]
    return max(values) if values else None


def _join_sentences(*parts: str | None) -> str:
    return " ".join(p for p in parts if p)


def _locality(address: str | None, fallback: str) -> str:
    """ "Oakland, CA" from "1 Main St, Oakland, CA 94607, USA"."""
    if not address:
        return fallback
    parts = [p.strip() for p in address.split(",")]
    if len(parts) >= 3:
        return f"{parts[-3]}, {parts[-2].split()[0]}"
    return address


def _short_area(area: str) -> str:
    return area.split(",")[0].strip()


def _minutes(value: float | None) -> str:
    return "?" if value is None else f"{round(value)} min"


# --------------------------------------------------------------------------- snapshot + providers


class GoogleCapExceeded(RuntimeError):
    pass


class CountingGooglePlaces(GooglePlacesProvider):
    """The real provider, minus photo lookups (each is a separately billed call), with a hard call cap."""

    def __init__(self, api_key: str, cap: int) -> None:
        super().__init__(api_key)
        self.calls = 0
        self.cap = cap

    async def _request(self, method: str, url: str, *, api: str, **kwargs: Any) -> httpx.Response:
        if self.calls >= self.cap:
            raise GoogleCapExceeded(f"Google call cap of {self.cap} reached")
        self.calls += 1
        return await super()._request(method, url, api=api, **kwargs)

    async def _photo_urls(self, photos: list[dict[str, Any]]) -> list[str]:
        return []


class Snapshot:
    """Provider responses on disk, written after every miss so an aborted run keeps what was already paid for."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.entries: dict[str, Any] = {}
        if path.exists():
            self.entries = json.loads(path.read_text()).get("entries", {})

    def get(self, key: str) -> Any:
        return self.entries.get(key)

    def put(self, key: str, value: Any) -> None:
        self.entries[key] = value
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"entries": self.entries}, indent=1, sort_keys=True))
        tmp.replace(self.path)


class Providers:
    def __init__(self, snapshot: Snapshot, google_cap: int) -> None:
        self.snapshot = snapshot
        self.google_cap = google_cap
        self.google: CountingGooglePlaces | None = None
        self.weather_provider = OpenMeteoWeatherProvider()
        self.traffic = HeuristicTrafficProvider(timezones=TimezoneResolver(online=False))
        self.snapshot_hits = 0

    @property
    def google_calls(self) -> int:
        return self.google.calls if self.google else 0

    def _places(self) -> CountingGooglePlaces:
        if self.google is None:
            key = get_settings().maps_api_key
            if not key:
                raise ProviderError("No GOOGLE_MAPS_API_KEY in .env, and the snapshot does not cover this lookup.")
            self.google = CountingGooglePlaces(key, self.google_cap)
        return self.google

    def _hit(self, key: str) -> Any:
        value = self.snapshot.get(key)
        if value is not None:
            self.snapshot_hits += 1
        return value

    async def aclose(self) -> None:
        if self.google is not None:
            await self.google.aclose()

    async def geocode(self, address: str) -> GeoPoint | None:
        key = f"geocode|{address}"
        if (cached := self._hit(key)) is not None:
            return GeoPoint.model_validate(cached)
        point = await self._places().geocode(address)
        if point is not None:
            self.snapshot.put(key, point.model_dump(mode="json"))
        return point

    async def search(self, query: str, near: str) -> list[PlaceCandidate]:
        key = f"search|{query}|{near}|{SEARCH_RESULTS}"
        if (cached := self._hit(key)) is not None:
            return [PlaceCandidate.model_validate(c) for c in cached]
        found = await self._places().search_venues(query, near=near, max_results=SEARCH_RESULTS)
        self.snapshot.put(key, [c.model_dump(mode="json") for c in found])
        return found

    async def details(self, place_id: str) -> PlaceDetails | None:
        key = f"details|{place_id}"
        if (cached := self._hit(key)) is not None:
            return PlaceDetails.model_validate(cached)
        details = await self._places().get_details(place_id)
        if details is not None:
            self.snapshot.put(key, details.model_dump(mode="json"))
        return details

    async def parking(self, place_id: str, location: GeoPoint) -> list[ParkingOption]:
        key = f"parking|{place_id}|{PARKING_RADIUS_M}"
        if (cached := self._hit(key)) is not None:
            return [ParkingOption.model_validate(o) for o in cached]
        options = await self._places().find_parking(location, radius_m=PARKING_RADIUS_M)
        self.snapshot.put(key, [o.model_dump(mode="json") for o in options])
        return options

    async def weather(self, location: GeoPoint, day: date, start: time, end: time) -> WeatherOutlook | None:
        # Reanalysis data is a ~0.25-degree grid: venues in the same cell share one archive lookup.
        grid = GeoPoint(lat=round(location.lat * 4) / 4, lng=round(location.lng * 4) / 4)
        end_hour = min(23, end.hour + (1 if end.minute else 0))
        key = f"weather|{grid.lat},{grid.lng}|{day.isoformat()}|{start.hour}-{end_hour}"
        if (cached := self._hit(key)) is not None:
            return WeatherOutlook.model_validate(cached)
        for attempt in range(3):
            outlook = await self.weather_provider.get_outlook(grid, day, start_hour=start.hour, end_hour=end_hour)
            if outlook is not None:
                self.snapshot.put(key, outlook.model_dump(mode="json"))
                return outlook
            await asyncio.sleep(5 * (attempt + 1))
        return None


# --------------------------------------------------------------------------- card assembly


def venue_profile(details: PlaceDetails) -> Profile:
    name = details.name.lower()
    for pattern, profile in NAME_PROFILES:
        if re.search(pattern, name):
            return profile
    for place_type in details.types:
        if place_type in TYPE_PROFILES:
            return TYPE_PROFILES[place_type]
    return DEFAULT_PROFILE


def choose_venues(candidates: list[PlaceCandidate], size: int) -> list[PlaceCandidate]:
    """Google order, but one venue per primary type first, so a shortlist is not six near-identical hotels."""
    usable = [
        c
        for c in candidates
        if c.location is not None
        and c.address
        and (c.rating is None or c.rating >= 3.5)
        and not EXCLUDED_TYPES.intersection(c.types)
    ]
    first_of_type: dict[str, PlaceCandidate] = {}
    for candidate in usable:
        first_of_type.setdefault(candidate.types[0] if candidate.types else "unknown", candidate)
    picked = list(first_of_type.values())[:size]
    ids = {c.place_id for c in picked}
    picked += [c for c in usable if c.place_id not in ids][: size - len(picked)]
    return picked


def assess_capacity(details: PlaceDetails, profile: Profile, plan: EventPlan) -> tuple[CapacityAssessment, int]:
    # +/-35% around the type's typical size, stable per venue: no two venues of a type are the same size.
    estimate = _round_people(profile.capacity * (0.65 + 0.7 * (_hash("cap", details.place_id) / 0xFFFFFFFF)))
    ratio = estimate / plan.headcount
    fit: Fit = "yes" if ratio >= 1.1 else "tight" if ratio >= 0.85 else "no"
    score = (90 if ratio <= 3 else 78 if ratio <= 6 else 65) if fit == "yes" else (55 if fit == "tight" else 22)
    assessment = CapacityAssessment(
        estimated_capacity=estimate,
        fits_headcount=fit,
        notes=(
            f"Rough estimate from what this venue is ({profile.noun}) and typical room sizes for that kind of "
            "place; not a figure the venue has confirmed, so check before relying on it."
        ),
        source="Planning estimate from venue type (no published capacity)",
    )
    return assessment, score


def assess_parking(details: PlaceDetails, nearby: list[ParkingOption]) -> ParkingAssessment:
    listed = [f for f in details.parking_features if not f.lower().startswith("no ")]
    on_site_kinds = [f for f in listed if re.search(r"lot|garage|valet", f, re.I)]
    on_site = True if on_site_kinds else False if details.parking_features else None
    score = 30.0 + (40 if on_site else 0) + (5 if any("valet" in f.lower() for f in listed) else 0)
    score += min(25, 6 * len(nearby))
    if nearby and (nearby[0].distance_m or 9999) <= 250:
        score += 8
    if listed:
        summary = f"Google lists {', '.join(f.lower() for f in listed)} at the venue."
    elif on_site is False:
        summary = "Google lists no parking at the venue itself."
    else:
        summary = "Google has no parking details for the venue itself."
    if nearby:
        closest = ", ".join(f"{o.name} ({o.distance_m} m{f', {o.kind}' if o.kind else ''})" for o in nearby[:3])
        summary += f" {len(nearby)} option(s) within {PARKING_RADIUS_M} m; closest: {closest}."
    else:
        summary += f" No lots or garages found within {PARKING_RADIUS_M} m."
    return ParkingAssessment(
        on_site=on_site,
        summary=summary,
        nearby=[ParkingSpot(name=o.name, distance_m=o.distance_m, address=o.address, kind=o.kind) for o in nearby],
        score=round(_clamp(score, 5, 100)),
    )


def assess_weather(outlook: WeatherOutlook | None, plan: EventPlan, themes: set[str]) -> tuple[WeatherAssessment, int]:
    if outlook is None:
        return WeatherAssessment(summary="No weather data was available for this date.", risk="unknown"), 60
    wet = outlook.precipitation_probability or 0.0
    outdoors = plan.setting == "outdoor" or (plan.setting == "either" and bool(themes & {"roof", "garden"}))
    risk: Risk
    if outdoors:
        risk = "high" if wet >= 0.4 else "medium" if wet >= 0.2 else "low"
    else:
        risk = "medium" if wet >= 0.5 else "low"
    notes = None
    if outdoors and risk != "low":
        notes = "Outdoor parts of the event need a covered backup at this time of year."
    assessment = WeatherAssessment(
        summary=outlook.window_summary or outlook.summary,
        temp_high_c=outlook.temp_high_c,
        temp_low_c=outlook.temp_low_c,
        precipitation_probability=outlook.precipitation_probability,
        wind_kph=outlook.wind_kph,
        basis=outlook.basis,
        risk=risk,
        notes=notes,
    )
    return assessment, round(_clamp(95 - wet * 110 - (10 if risk == "high" else 0), 25, 95))


def assess_traffic(estimate: TravelEstimate | None, origin_label: str) -> tuple[TrafficAssessment, int]:
    if estimate is None or estimate.event_time_minutes is None:
        return TrafficAssessment(summary="Drive time could not be estimated.", origin=origin_label), 60
    score = round(_clamp(100 - estimate.event_time_minutes * 0.9 - (8 if estimate.rush_hour_overlap else 0), 20, 97))
    return (
        TrafficAssessment(
            summary=(
                f"About {_minutes(estimate.event_time_minutes)} from {origin_label} arriving for the event start "
                f"({_minutes(estimate.typical_minutes)} typical) (heuristic estimate)"
            ),
            origin=origin_label,
            typical_minutes=estimate.typical_minutes,
            event_time_minutes=estimate.event_time_minutes,
            delay_ratio=estimate.delay_ratio,
            rush_hour_overlap=estimate.rush_hour_overlap,
            score=score,
        ),
        score,
    )


def assess_pricing(details: PlaceDetails, profile: Profile, plan: EventPlan) -> tuple[PricingAssessment, int]:
    per_head = PER_PERSON_USD[plan.event_type] * profile.price_factor
    per_head *= PRICE_LEVEL_FACTOR.get(details.price_level or "", 1.0)
    midpoint = per_head * plan.headcount
    low, high = midpoint * 0.8, midpoint * 1.25
    limit = _budget_limit(plan.budget)
    within: Fit = "unknown"
    if limit is not None:
        within = "yes" if midpoint <= limit else "tight" if midpoint <= limit * 1.15 else "no"
    score = {"yes": 85, "tight": 60, "no": 30, "unknown": 65}[within] + round(((details.rating or 4.0) - 4.0) * 10)
    assessment = PricingAssessment(
        estimate=f"{_usd(low)}-{_usd(high)} (planning estimate)",
        summary=(
            f"Planning estimate of about ${round(per_head)} per person from the venue type, Google price level and "
            f"headcount; no quote was requested, so confirm pricing with the venue."
        ),
        within_budget=within,
    )
    return assessment, round(_clamp(score, 10, 98))


def rating_score(details: PlaceDetails) -> float:
    if details.rating is None:
        return 60.0
    return _clamp((details.rating - 3.0) / 1.9 * 100, 30, 98)


def venue_themes(details: PlaceDetails, profile: Profile) -> set[str]:
    themes = set(profile.themes)
    text = f"{details.name} {details.editorial_summary or ''}"
    if ROOF_EVIDENCE.search(text):
        themes.add("roof")
    if GARDEN_EVIDENCE.search(text):
        themes.add("garden")
    if {"park", "botanical_garden", "garden"} & set(details.types):
        themes.add("garden")
    if details.price_level in ("expensive", "very expensive"):
        themes.add("grand")
    return themes


def _word(theme: str, details: PlaceDetails, salt: str = "") -> str:
    return _pick(VOCABULARY[theme], theme, salt, details.place_id)


def compose_summary(
    details: PlaceDetails,
    profile: Profile,
    themes: set[str],
    capacity: CapacityAssessment,
    plan: EventPlan,
    area: str,
    overall: int,
) -> str:
    """Natural-language description that only claims what the listing or venue type supports."""
    place_id = details.place_id
    adjective_theme = next((t for t in ("calm", "cozy", "lively", "grand", "modern", "historic") if t in themes), None)
    adjective = _word(adjective_theme, details, "lead") if adjective_theme else "well-reviewed"
    locality = _locality(details.address, area)
    use = EVENT_USES[plan.event_type]
    opening = _pick(
        (
            f"{details.name} is a {adjective} {profile.noun} in {locality}, considered for {use}.",
            f"A {adjective} {profile.noun} in {locality}, {details.name} was evaluated for {use}.",
        ),
        "open",
        place_id,
    )
    sentences: list[str | None] = [opening]
    if "calm" in themes and adjective_theme != "calm":
        sentences.append(f"The setting should feel {_word('calm', details, 'body')}, suited to focused sessions.")
    if "roof" in themes:
        roof = _word("roof", details)
        sentences.append(f"Its listing points to a {roof}, useful for receptions and breaks.")
    if "garden" in themes and "roof" not in themes:
        sentences.append(f"Expect a {_word('garden', details)} for arrivals and photos.")
    if details.editorial_summary:
        sentences.append(f"Google describes it as: {details.editorial_summary.rstrip('.')}.")
    cap = capacity.estimated_capacity
    fit = {"yes": "fits", "tight": "is a tight fit for", "no": "looks too small for", "unknown": "was not compared to"}
    sentences.append(
        f"Planning estimate is about {cap} people, which {fit[capacity.fits_headcount]} the {plan.headcount}-person "
        f"{plan.event_type}."
    )
    if details.rating is not None:
        reviews = f" across {details.review_count:,} Google reviews" if details.review_count else " on Google"
        sentences.append(f"Rated {details.rating:g}/5{reviews}.")
    closer = (
        "A strong option."
        if overall >= 75
        else "A workable backup."
        if overall >= 55
        else "A long shot for this group."
    )
    sentences.append(closer)
    return _join_sentences(*sentences)


@dataclass
class SeedCard:
    place_id: str
    title: str
    data: VenueCardData
    overall: int


async def build_card(
    candidate: PlaceCandidate,
    plan: EventPlan,
    area: str,
    criteria: VenueCriteria,
    origin: GeoPoint,
    providers: Providers,
) -> SeedCard | None:
    details = await providers.details(candidate.place_id)
    if details is None:
        print(f"  ! no listing for {candidate.name}; skipped")
        return None
    assert details.location is not None
    profile = venue_profile(details)
    themes = venue_themes(details, profile)
    nearby = await providers.parking(details.place_id, details.location)
    outlook = await providers.weather(details.location, plan.event_date, plan.start, plan.end)
    estimate = await providers.traffic.estimate_travel(
        origin, details.location, arrive_by=datetime.combine(plan.event_date, plan.start)
    )

    capacity, capacity_score = assess_capacity(details, profile, plan)
    parking = assess_parking(details, nearby)
    weather, weather_score = assess_weather(outlook, plan, themes)
    traffic, traffic_score = assess_traffic(estimate, criteria.attendee_origin or "the metro centre")
    pricing, value_score = assess_pricing(details, profile, plan)
    assert parking.score is not None
    overall = round(
        0.30 * capacity_score
        + 0.15 * parking.score
        + 0.10 * weather_score
        + 0.15 * traffic_score
        + 0.15 * value_score
        + 0.15 * rating_score(details)
    )

    pros: list[str] = []
    cons: list[str] = []
    if details.rating is not None and details.rating >= 4.4 and details.review_count:
        pros.append(f"Highly rated: {details.rating:g}/5 across {details.review_count:,} Google reviews")
    if details.rating is not None and details.rating < 4.0:
        cons.append(f"Mixed reviews: {details.rating:g}/5 on Google")
    if capacity.fits_headcount == "yes":
        pros.append(f"Planning estimate of ~{capacity.estimated_capacity} fits the group of {plan.headcount}")
    elif capacity.fits_headcount == "tight":
        cons.append(f"Planning estimate of ~{capacity.estimated_capacity} is tight for {plan.headcount} guests")
    else:
        cons.append(f"Planning estimate of ~{capacity.estimated_capacity} looks too small for {plan.headcount} guests")
    if parking.on_site:
        pros.append("On-site parking listed by Google")
    elif not parking.nearby:
        cons.append(f"No parking listed on site and none found within {PARKING_RADIUS_M} m")
    if len(parking.nearby) >= 2:
        pros.append(f"{len(parking.nearby)} parking options within {PARKING_RADIUS_M} m")
    if traffic.rush_hour_overlap:
        cons.append("Arrival overlaps the weekday rush hour")
    elif traffic.event_time_minutes is not None and traffic.event_time_minutes <= 25:
        pros.append(f"Short drive: about {_minutes(traffic.event_time_minutes)} from {traffic.origin}")
    if weather.risk in ("medium", "high"):
        cons.append(f"Weather risk is {weather.risk} for the event hours (typical conditions for the date)")
    if pricing.within_budget == "no":
        cons.append("Planning estimate looks over budget")
    elif pricing.within_budget == "yes":
        pros.append("Planning estimate is within budget")

    sources = [
        Source(title=f"{details.name} listing (google)", url=details.maps_url or details.website),
        Source(title="Capacity and pricing: planning estimates from venue type, not confirmed by the venue"),
    ]
    if outlook is not None:
        sources.append(Source(title=f"Weather {outlook.basis} for {plan.event_date.isoformat()} (open_meteo)"))
    if estimate is not None:
        sources.append(Source(title=f"Drive-time {estimate.basis.replace('_', ' ')} ({providers.traffic.name})"))

    notes = None
    if _hash("note?", details.place_id, plan.slug) % 100 < 45:
        notes = _pick(PLANNER_NOTES, "note", details.place_id, plan.slug)

    data = VenueCardData(
        place=place_summary(details),
        criteria=criteria,
        capacity=capacity,
        parking=parking,
        weather=weather,
        traffic=traffic,
        pricing=pricing,
        pros=pros,
        cons=cons,
        score=VenueScore(
            overall=overall,
            capacity=capacity_score,
            parking=parking.score,
            weather=weather_score,
            traffic=traffic_score,
            value=value_score,
        ),
        summary=compose_summary(details, profile, themes, capacity, plan, area, overall),
        sources=sources,
        user_notes=notes,
    )
    return SeedCard(place_id=details.place_id, title=details.name, data=data, overall=overall)


@dataclass
class SeedEvent:
    plan: EventPlan
    marker: str
    name: str
    description: str
    requirements: dict[str, Any]
    cards: list[SeedCard]


async def build_event(plan: EventPlan, metro: Metro, providers: Providers) -> SeedEvent:
    area = metro.areas.get(plan.slug, metro.label)
    criteria = VenueCriteria(
        location=area,
        headcount=plan.headcount,
        event_date=plan.event_date,
        start_time=plan.start,
        end_time=plan.end,
        event_type=plan.event_type,
        setting=plan.setting,  # type: ignore[arg-type]
        budget=plan.budget,
        attendee_origin=metro.origin,
        must_haves=list(plan.must_haves),
        notes=plan.notes,
    )
    origin = await providers.geocode(metro.origin)
    if origin is None:
        raise ProviderError(f"Could not geocode the attendee origin {metro.origin!r}.")
    candidates = await providers.search(plan.query, area)
    picked = choose_venues(candidates, plan.size)
    if not picked:
        raise ProviderError(f"Google returned no usable venues for {plan.query!r} near {area!r}.")
    cards = [c for candidate in picked if (c := await build_card(candidate, plan, area, criteria, origin, providers))]
    cards.sort(key=lambda c: c.overall, reverse=True)
    ranked = len(cards) if plan.rank_top is None else min(plan.rank_top, len(cards))
    for position, card in enumerate(cards, 1):
        card.data.rank = position if position <= ranked else None

    marker = f"{MARKER_PREFIX}{plan.slug}@{metro.key}"
    title = plan.title.format(area=_short_area(area))
    requirements = {
        **criteria.model_dump(mode="json", exclude_none=True),
        "intake": {
            "type": plan.frontend_type,
            "goal": plan.goal,
            "date": plan.event_date.isoformat(),
            "headcount": f"{plan.headcount} people",
            "city": area,
            "budget": plan.budget,
            "format": "In person",
            MARKER_KEY: marker,
        },
    }
    return SeedEvent(
        plan=plan,
        marker=marker,
        name=title,
        description=f"{plan.goal}. Demo data: past event seeded for demos, venues researched from real listings.",
        requirements=requirements,
        cards=cards,
    )


# --------------------------------------------------------------------------- HTTP


class TransientError(Exception):
    """The API is rolling out or unreachable; it may have processed the request."""


class ApiError(RuntimeError):
    pass


class Api:
    def __init__(self, base_url: str, token: str | None) -> None:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._http = httpx.AsyncClient(
            base_url=f"{base_url.rstrip('/')}/api/v1", headers=headers, timeout=REQUEST_TIMEOUT_S
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._http.request(method, path, **kwargs)
        except httpx.TransportError as exc:
            raise TransientError(f"{method} {path}: {type(exc).__name__}") from exc
        if response.status_code in RETRY_STATUSES:
            raise TransientError(f"{method} {path}: HTTP {response.status_code}")
        return response

    async def _retrying(self, attempt: Callable[[], Awaitable[httpx.Response]]) -> httpx.Response:
        deadline = clock.monotonic() + RETRY_WINDOW_S
        delay = 2.0
        while True:
            try:
                return await attempt()
            except TransientError as exc:
                if clock.monotonic() >= deadline:
                    raise ApiError(f"API still unavailable after {RETRY_WINDOW_S:.0f}s: {exc}") from exc
                print(f"  ... {exc}; retrying in {delay:.0f}s")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 15.0)

    @staticmethod
    def _checked(response: httpx.Response, method: str, path: str) -> Any:
        if response.status_code >= 400:
            raise ApiError(f"{method} {path} -> HTTP {response.status_code}: {response.text[:300]}")
        return response.json() if response.content else None

    async def get(self, path: str, **params: Any) -> Any:
        response = await self._retrying(lambda: self._send("GET", path, params=params or None))
        return self._checked(response, "GET", path)

    async def patch(self, path: str, body: dict[str, Any]) -> Any:
        response = await self._retrying(lambda: self._send("PATCH", path, json=body))
        return self._checked(response, "PATCH", path)

    async def delete(self, path: str) -> None:
        """A 404 on a retried delete means the lost first attempt did the work, so it counts as success."""
        response = await self._retrying(lambda: self._send("DELETE", path))
        if response.status_code != 404:
            self._checked(response, "DELETE", path)

    async def create(
        self, path: str, body: dict[str, Any], find_existing: Callable[[], Awaitable[dict[str, Any] | None]]
    ) -> dict[str, Any]:
        """POST once per attempt; after a lost response, look for the row before posting again (no duplicates)."""
        first = True

        async def attempt() -> httpx.Response:
            nonlocal first
            if not first and (existing := await find_existing()) is not None:
                return httpx.Response(200, json=existing)
            first = False
            return await self._send("POST", path, json=body)

        response = await self._retrying(attempt)
        return self._checked(response, "POST", path)


def event_marker(event: dict[str, Any]) -> str | None:
    intake = (event.get("requirements") or {}).get("intake")
    value = intake.get(MARKER_KEY) if isinstance(intake, dict) else None
    return value if isinstance(value, str) and value.startswith(MARKER_PREFIX) else None


async def seeded_events(api: Api) -> dict[str, dict[str, Any]]:
    return {marker: event for event in await api.get("/events") if (marker := event_marker(event))}


async def event_cards(api: Api, event_id: str) -> list[dict[str, Any]]:
    return (await api.get(f"/events/{event_id}/board"))["cards"]


def card_place_id(card: dict[str, Any]) -> str | None:
    return ((card.get("data") or {}).get("place") or {}).get("place_id")


async def ensure_event(api: Api, seed: SeedEvent, existing: dict[str, Any] | None) -> tuple[dict[str, Any], bool]:
    if existing is not None:
        return existing, False

    async def find() -> dict[str, Any] | None:
        return (await seeded_events(api)).get(seed.marker)

    body = {"name": seed.name, "description": seed.description, "requirements": seed.requirements}
    return await api.create("/events", body, find), True


async def ensure_cards(api: Api, event_id: str, seed: SeedEvent) -> tuple[int, int]:
    """Create the cards this event is missing, best first, so the server's grid placement follows rank."""
    have = {card_place_id(c) for c in await event_cards(api, event_id)}

    def finder(place_id: str) -> Callable[[], Awaitable[dict[str, Any] | None]]:
        async def find() -> dict[str, Any] | None:
            return next((c for c in await event_cards(api, event_id) if card_place_id(c) == place_id), None)

        return find

    created = skipped = 0
    for card in seed.cards:
        if card.place_id in have:
            skipped += 1
            continue
        data = card.data.model_dump(mode="json", exclude_none=True)
        body = {"kind": "venue", "title": card.title, "data": data}
        await api.create(f"/events/{event_id}/cards", body, finder(card.place_id))
        created += 1
    return created, skipped


# --------------------------------------------------------------------------- main


async def reset(api: Api) -> None:
    seeded = await seeded_events(api)
    print(f"Deleting {len(seeded)} seeded event(s); untagged events are never touched.")
    for marker, event in seeded.items():
        await api.delete(f"/events/{event['id']}")
        print(f"  deleted {event['name']} ({marker})")


async def report_index(api: Api, expected_venues: int) -> None:
    """Wait for the indexer to catch up, then show what search can see."""
    status: dict[str, Any] = {}
    for _ in range(30):
        status = await api.get("/search/status")
        docs = (status.get("indices") or {}).get("venues", {}).get("docs", 0)
        if docs >= expected_venues:
            break
        await asyncio.sleep(2)
    indexer = status.get("indexer") or {}
    docs = (status.get("indices") or {}).get("venues", {}).get("docs")
    print(
        f"Search: configured={status.get('configured')} semantic={status.get('semantic')} venue docs={docs} "
        f"(expected at least {expected_venues}) failed_items={indexer.get('failed_items')}"
    )


def resolve_metros(spec: str) -> list[Metro]:
    """Comma-separated keys from `METROS`, or free-form cities ("Seattle, WA" needs quotes in the shell)."""
    metros: list[Metro] = []
    for raw in (part.strip() for part in spec.split(";" if ";" in spec else ",")):
        if raw:
            metros.append(
                METROS.get(raw) or Metro(key=re.sub(r"\W+", "-", raw.lower()), label=raw, origin=f"{raw} city center")
            )
    if not metros:
        raise SystemExit("--metros named no metros")
    return metros


async def login(base_url: str, email: str, password: str) -> str:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as http:
        response = await http.post(
            f"{base_url.rstrip('/')}/api/v1/auth/login", json={"email": email, "password": password}
        )
    if response.status_code != 200:
        raise SystemExit(f"Login for {email} failed: HTTP {response.status_code}")
    return response.json()["access_token"]


async def seed(args: argparse.Namespace, api: Api) -> None:
    metros = resolve_metros(args.metros)
    providers = Providers(Snapshot(args.snapshot), args.max_google_calls)
    try:
        builds = [await build_event(plan, metros[plan.metro_slot % len(metros)], providers) for plan in PLANS]
    finally:
        await providers.aclose()
    print(
        f"Provider data ready: {providers.google_calls} Google call(s) this run, "
        f"{providers.snapshot_hits} snapshot hit(s) ({args.snapshot.name})."
    )

    existing = await seeded_events(api)
    created_events = created_cards = skipped_cards = 0
    for seed_event in builds:
        event, was_new = await ensure_event(api, seed_event, existing.get(seed_event.marker))
        created_events += was_new
        created, skipped = await ensure_cards(api, event["id"], seed_event)
        created_cards += created
        skipped_cards += skipped
        if event.get("status") != "archived":
            await api.patch(f"/events/{event['id']}", {"status": "archived"})
        print(f"  {event['name']}: {created} new venue card(s), {skipped} already there")

    total_cards = created_cards + skipped_cards
    print(
        f"Done: {len(builds)} events ({created_events} new), {total_cards} venue cards ({created_cards} new). "
        f"Google calls this run: {providers.google_calls}."
    )
    await report_index(api, total_cards)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed demo events and venue cards through the Evently API.")
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost:8000"))
    parser.add_argument("--reset", action="store_true", help="Delete only events tagged by this seeder, then exit.")
    parser.add_argument(
        "--metros",
        default=DEFAULT_METROS,
        help=f"Comma-separated metros (default {DEFAULT_METROS}); use ; for free-form cities.",
    )
    parser.add_argument("--max-google-calls", type=int, default=DEFAULT_GOOGLE_CAP)
    parser.add_argument("--snapshot", type=Path, default=SNAPSHOT_PATH)
    parser.add_argument(
        "--login-email",
        default=os.environ.get("SEED_EMAIL"),
        help="Seed for this account (password from SEED_PASSWORD). ACCESS_TOKEN also works. Default: the dev user.",
    )
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    os.chdir(BACKEND_DIR)  # Settings reads .env relative to the working directory
    token = os.environ.get("ACCESS_TOKEN") or None
    if not token and args.login_email:
        password = os.environ.get("SEED_PASSWORD")
        if not password:
            raise SystemExit("--login-email needs the password in SEED_PASSWORD (never on the command line).")
        token = await login(args.base_url, args.login_email, password)
    api = Api(args.base_url, token)
    try:
        me = await api.get("/auth/me")
        print(f"Acting as {me.get('email')} ({me.get('id')}) on {args.base_url}")
        if args.reset:
            await reset(api)
        else:
            await seed(args, api)
    except (GoogleCapExceeded, ProviderError, ApiError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        await api.aclose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
