"""Export the 12 October first-run test as an anonymous, compact replay.

Usage: python tools/export-first-run.py PATH_TO_MEASUREMENTS_CSV PATH_TO_EVENTS_JSON
"""

import csv
import json
import math
import sys
from pathlib import Path


def temperature(value):
    try:
        parsed = float(value)
        return round(parsed, 2) if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def convert(row):
    return {
        "t": round(int(row["uptime_ms"]) / 1000),
        "stage": int(row["stage"]),
        "temp": [temperature(row[f"Датчик {i} temperature_C"]) for i in range(1, 5)],
    }


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    source, event_source = map(Path, sys.argv[1:])
    with source.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    if not rows:
        raise SystemExit("No measurements")

    selected = []
    previous_stage = None
    last_time = -30000
    for index, row in enumerate(rows):
        stage = int(row["stage"])
        timestamp = int(row["uptime_ms"])
        transition = stage != previous_stage
        if transition and index:
            previous = convert(rows[index - 1])
            if selected[-1]["t"] != previous["t"]:
                selected.append(previous)
        if transition or timestamp - last_time >= 30000 or index == len(rows) - 1:
            selected.append(convert(row))
            last_time = timestamp
        previous_stage = stage

    raw_events = json.loads(event_source.read_text(encoding="utf-8-sig"))
    if isinstance(raw_events, dict):
        raw_events = raw_events["events"]
    events = [
        {"t": round(event["uptimeMs"] / 1000), "code": "STAGE_CHANGED", "stage": event["stage"]}
        for event in raw_events if event["code"] == "STAGE_CHANGED"
    ]
    output = {
        "title": "Первый перегон · горячий тест 12.10.2026",
        "source": "Обезличенная запись испытания; воспроизведение без подключения к устройству",
        "stages": {1: "Нагрев", 2: "Подготовить охлаждение", 3: "Отбор сырца", 4: "Завершение"},
        "sensors": ["Пар в колонне", "Пар в кубе", "Вода после дефлегматора", "Температура отбора"],
        "samples": selected,
        "events": events,
    }
    target = Path(__file__).resolve().parents[1] / "data" / "first-run.json"
    target.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(selected)} samples, {len(events)} events -> {target}")


if __name__ == "__main__":
    main()
