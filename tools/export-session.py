"""Export a small, public, anonymous replay from a private measurements CSV.

Usage: python tools/export-session.py PATH_TO_MEASUREMENTS_CSV PATH_TO_EVENTS_JSON
"""

import csv
import json
import math
import sys
from pathlib import Path


STAGES = {1: "Нагрев", 2: "Работа на себя", 3: "Головы", 4: "Тело", 5: "Завершение"}
SENSORS = ("Пар в колонне", "Пар в кубе", "Вода после дефл", "Отбор")
EVENTS = {
    "STAGE_CHANGED", "SELF_REFLUX_STARTED", "SELF_REFLUX_COMPLETED",
    "SCALE_TARGET_REACHED", "TEMPERATURE_WARNING", "ALARM_ACTIVATED",
    "ALARM_ACKNOWLEDGED", "ALARM_CLEARED", "RECOVERY_STARTED",
    "RECOVERY_COMPLETED", "VALVE_MANUAL_CLOSED", "VALVE_MANUAL_OPENED",
}


def number(value):
    try:
        result = float(value)
        return round(result, 2) if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    source, event_source = map(Path, sys.argv[1:])
    with source.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    if not rows:
        raise SystemExit("No measurements")

    # One point every ~30 seconds, plus both sides of each stage transition.
    selected = []
    previous_stage = None
    last_time = -30000
    for index, row in enumerate(rows):
        stage = int(row["stage"])
        timestamp = int(row["uptime_ms"])
        transition = stage != previous_stage
        if transition and index and selected[-1]["t"] != round(int(rows[index - 1]["uptime_ms"]) / 1000):
            selected.append(convert(rows[index - 1]))
        if transition or timestamp - last_time >= 30000 or index == len(rows) - 1:
            selected.append(convert(row))
            last_time = timestamp
        previous_stage = stage

    raw_events = json.loads(event_source.read_text(encoding="utf-8-sig"))["events"]
    events = [
        {"t": round(event["uptimeMs"] / 1000), "code": event["code"]}
        for event in raw_events if event["code"] in EVENTS
    ]
    output = {
        "title": "Отбор по жидкости · стендовый тест 30.10.2026",
        "source": "Обезличенная запись одного стендового сеанса; не подключена к устройству",
        "stages": STAGES,
        "sensors": ["Пар в колонне", "Пар в кубе", "Вода после дефлегматора", "Температура отбора"],
        "samples": selected,
        "events": events,
    }
    target = Path(__file__).resolve().parents[1] / "data" / "session.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(selected)} samples, {len(events)} events -> {target}")


def convert(row):
    temperatures = [number(row[f"{name} temperature_C"]) for name in SENSORS]
    return {
        "t": round(int(row["uptime_ms"]) / 1000),
        "stage": int(row["stage"]),
        "temp": temperatures,
        "mass": number(row["scale_mass_g"]),
        "volume": number(row["scale_volume_ml"]),
    }


if __name__ == "__main__":
    main()
