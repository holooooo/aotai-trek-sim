"""Real HTTP acceptance test for the local Wrangler Pages analytics API.

The managed with_server.py/Wrangler process owns the server and D1 binding.
This script only writes UUID-prefixed fixtures to the URL under test; never
point it at production. Default URL is the isolated local Pages port.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

URL = os.environ.get("AOTAI_HTTP_URL", "http://127.0.0.1:53744").rstrip("/")
_PARSED_URL = urlparse(URL)
if _PARSED_URL.scheme != "http" or _PARSED_URL.hostname not in {"127.0.0.1", "localhost", "::1"}:
    raise SystemExit(f"Refusing non-loopback analytics target: {URL}")
ORIGIN = f"{_PARSED_URL.scheme}://{_PARSED_URL.netloc}"
QUESTION_ID = "event:headlamp_contact:defer|fix|warm"
OPTION_IDS = ["defer", "fix", "warm"]


def request(path: str, method: str = "GET", body: dict | None = None, origin: str | None = ORIGIN):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if origin is not None:
        headers["Origin"] = origin
    req = Request(f"{URL}{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw)
    except HTTPError as error:
        raw = error.read().decode("utf-8")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return error.code, parsed
    except URLError as error:
        raise AssertionError(f"HTTP server unavailable at {URL}: {error}") from error


def assert_error(response, status: int, code: str) -> None:
    actual_status, body = response
    assert actual_status == status and body.get("error") == code, response


def main() -> None:
    prefix = "qa9_" + uuid.uuid4().hex
    visitor = prefix + "_visitor"
    run_one = prefix + "_run_a"
    run_two = prefix + "_run_b"
    event_id = prefix + "_event"
    telemetry_run = prefix + "_telemetry"
    query = "?" + urlencode({"questionId": QUESTION_ID, "optionIds": ",".join(OPTION_IDS)})

    status, baseline = request("/api/choices" + query)
    assert status == 200, (status, baseline)
    assert set(baseline) == {"questionId", "total", "counts"}, baseline
    assert baseline["questionId"] == QUESTION_ID
    assert set(baseline["counts"]) == set(OPTION_IDS)
    assert baseline["total"] == sum(baseline["counts"].values()), baseline
    base_total = baseline["total"]
    base_counts = dict(baseline["counts"])

    payload = {
        "visitorId": visitor,
        "runId": run_one,
        "questionId": QUESTION_ID,
        "optionId": "fix",
        "optionIds": OPTION_IDS,
    }
    status, first = request("/api/choices", "POST", payload)
    assert status == 200 and first["recorded"] is True, (status, first)
    assert first["total"] == base_total + 1, first
    assert first["counts"]["fix"] == base_counts["fix"] + 1, first

    status, retry = request("/api/choices", "POST", payload)
    assert status == 200 and retry["recorded"] is False, (status, retry)
    assert retry["total"] == base_total + 1 and retry["previousOptionId"] == "fix", retry

    changed = {**payload, "optionId": "warm"}
    status, changed_result = request("/api/choices", "POST", changed)
    assert status == 200 and changed_result["recorded"] is False, (status, changed_result)
    assert changed_result["total"] == base_total + 1, changed_result
    assert changed_result["previousOptionId"] == "fix", changed_result

    other_run = {**payload, "runId": run_two, "optionId": "warm"}
    status, second = request("/api/choices", "POST", other_run)
    assert status == 200 and second["recorded"] is True, (status, second)
    assert second["total"] == base_total + 2, second
    assert second["counts"]["warm"] == base_counts["warm"] + 1, second

    status, final_read = request("/api/choices" + query)
    assert status == 200 and final_read["total"] == base_total + 2, final_read
    assert set(final_read) == {"questionId", "total", "counts"}, final_read

    assert_error(
        request("/api/choices", "POST", {**payload, "unexpected": "nope"}),
        400,
        "unknown_fields",
    )
    assert_error(
        request("/api/choices", "POST", {**payload, "optionId": "not-an-option"}),
        400,
        "invalid_option",
    )
    assert_error(
        request("/api/choices", "POST", payload, origin="https://cross-origin.invalid"),
        403,
        "same_origin_required",
    )
    assert_error(
        request("/api/choices" + query + "&visitorId=" + visitor),
        400,
        "invalid_query",
    )

    assert_error(request("/api/telemetry"), 405, "method_not_allowed")

    telemetry_event = {
        "id": event_id,
        "runId": telemetry_run,
        "type": "run_started",
        "at": int(time.time() * 1000),
        "role": "nurse",
        "difficulty": "normal",
        "fresh": True,
    }
    telemetry = {"visitorId": visitor, "events": [telemetry_event]}
    status, first_telemetry = request("/api/telemetry", "POST", telemetry)
    assert first_telemetry == {"accepted": 1, "duplicates": 0}, (status, first_telemetry)
    assert status == 200
    status, retry_telemetry = request("/api/telemetry", "POST", telemetry)
    assert retry_telemetry == {"accepted": 0, "duplicates": 1}, (status, retry_telemetry)
    assert status == 200

    # New catalog entries must pass the real local Functions/D1 boundary as well.
    new_questions = {
        "event:stress_checklist": ["sort", "read", "continue"],
        "event:exit_diaoyutai_signal": ["call_out", "hold_position", "retrace"],
        "npc:linqiao": ["photo", "trade", "leave"],
    }
    for source, options in new_questions.items():
        question = source + ":" + "|".join(sorted(options))
        result = request("/api/choices", "POST", {"visitorId": visitor, "runId": run_one,
            "questionId": question, "optionIds": options, "optionId": options[0]})
        assert result[0] == 200 and result[1]["recorded"] is True, result
    expanded = {**telemetry_event, "id": event_id + "_cook", "runId": telemetry_run + "_cook", "role": "cook"}
    result = request("/api/telemetry", "POST", {"visitorId": visitor, "events": [expanded]})
    assert result == (200, {"accepted": 1, "duplicates": 0}), result

    print(
        "PASS: local HTTP choice baseline/first-vote idempotency/run isolation, "
        "validation and same-origin rejection, telemetry retry idempotency; "
        f"question_total={base_total}->{final_read['total']} prefix={prefix}"
    )


if __name__ == "__main__":
    main()
