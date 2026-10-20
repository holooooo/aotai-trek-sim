"""Analytics choice-distribution browser acceptance test.

Run against the already managed DEV server, for example through with_server.py.
A clean first visit defaults on; the test opts out through the UI before its
GET-only choice-distribution scenario. It never starts a server and does not
await the whole scheduled event from page.evaluate: the event waits for dialog.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

URL = os.environ.get("AOTAI_TEST_URL", "http://127.0.0.1:53741")
_TARGET = urlparse(URL)
if _TARGET.scheme != "http" or _TARGET.hostname not in {"127.0.0.1", "localhost", "::1"}:
    raise SystemExit(f"Refusing analytics browser target outside loopback: {URL}")
OUT = Path("output/playwright")
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    calls: list[dict] = []
    seen_votes: set[tuple[str, str, str]] = set()
    headlamp_counts = {"defer": 1, "fix": 2, "warm": 2}
    fail_choices = False

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        context = browser.new_context(
            viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True
        )
        page = context.new_page()
        errors: list[str] = []
        console_errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "console",
            lambda message: console_errors.append(message.text) if message.type == "error" else None,
        )
        page.add_init_script("window.__AOTAI_TEST_ANALYTICS__ = true;")

        def api(route) -> None:
            nonlocal fail_choices
            request = route.request
            parsed = urlparse(request.url)
            body = None
            if request.post_data:
                try:
                    body = json.loads(request.post_data)
                except json.JSONDecodeError:
                    body = request.post_data
            entry = {"path": parsed.path, "method": request.method, "body": body}
            calls.append(entry)

            if parsed.path.endswith("/api/choices"):
                if fail_choices:
                    route.fulfill(
                        status=503,
                        content_type="application/json",
                        body=json.dumps({"error": "analytics_unavailable"}),
                    )
                    return
                if request.method == "GET":
                    query = parse_qs(parsed.query)
                    question_id = query["questionId"][0]
                    option_ids = query["optionIds"][0].split(",")
                else:
                    question_id = body["questionId"]
                    option_ids = body["optionIds"]
                recorded = None
                if question_id == "event:headlamp_contact:defer|fix|warm":
                    if request.method == "POST":
                        vote_key = (body["visitorId"], body["runId"], question_id)
                        recorded = vote_key not in seen_votes
                        seen_votes.add(vote_key)
                        if recorded:
                            headlamp_counts[body["optionId"]] += 1
                    counts = dict(headlamp_counts)
                else:
                    counts = {option_id: index + 1 for index, option_id in enumerate(option_ids)}
                result = {
                    "questionId": question_id,
                    "total": sum(counts.values()),
                    "counts": counts,
                }
                if request.method == "POST":
                    if recorded is None:
                        vote_key = (body["visitorId"], body["runId"], question_id)
                        recorded = vote_key not in seen_votes
                        seen_votes.add(vote_key)
                    result.update({"recorded": recorded})
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(result),
                )
                return

            if parsed.path.endswith("/api/telemetry"):
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({"accepted": len((body or {}).get("events", [])), "duplicates": 0}),
                )
                return

            route.continue_()

        page.route("**/api/choices**", api)
        page.route("**/api/telemetry**", api)
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("#boot.gone", timeout=45000)
        expect(page.locator('[data-act="privacy"]')).to_have_attribute("aria-pressed", "true")
        assert page.evaluate("localStorage.getItem('aotai-analytics-consent-v1')") == "true"
        page.locator('[data-act="privacy"]').click()
        expect(page.locator('[data-act="privacy"]')).to_have_attribute("aria-pressed", "false")
        assert page.evaluate("localStorage.getItem('aotai-analytics-consent-v1')") == "false"
        assert page.evaluate("localStorage.getItem('aotai-analytics-visitor-v1')") is None
        page.locator('[data-act="new"]').click()
        page.locator('.role[data-id="nurse"]').click()
        page.locator('[data-act="go"]').click()
        page.locator('[data-act="depart"]').click()
        expect(page.locator("#dialog.open")).to_have_count(0)

        # Make the selected planned event deterministic while retaining the real Game/UI.
        page.evaluate(
            """async () => {
                const { addItem } = await import('/src/sim/state.js');
                const g = __game;
                addItem(g.st, 'headlamp');
                g.st.bat.headlamp = 80;
                g.st.story.effects.headlampFault = false;
                delete g.st.story.threads.headlampResolved;
            }"""
        )
        calls.clear()
        page.evaluate(
            """async () => {
                const { EXPANDED_EVENTS } = await import('/src/data/events-expanded.js');
                window.__aotaiEventPromise = __game.runScheduledEvent(
                    EXPANDED_EVENTS.find((event) => event.id === 'headlamp_contact')
                );
            }"""
        )
        expect(page.locator("#dialog h3")).to_have_text("忽明忽暗的头灯")
        question = page.locator("#dialog .dlg")
        initial_box = question.bounding_box()
        assert initial_box and initial_box["height"] <= 320.5, initial_box
        assert "%" not in question.inner_text()
        assert page.locator("#dialog .poll-score").count() == 0
        before = page.evaluate(
            """() => ({
                time: __game.st.time,
                headlamp: __game.st.bat.headlamp,
                eventRunning: __game.eventRunning,
            })"""
        )
        assert before["eventRunning"] is True

        page.wait_for_timeout(600)
        page.locator('#dialog button[data-id="fix"]').click()
        expect(page.locator("#dialog .showing-results")).to_be_visible()
        expect(page.locator('#dialog [data-act="poll-consent"]')).to_be_visible()
        page.wait_for_function("document.querySelectorAll('#dialog .choice').length === 3")
        result_box = question.bounding_box()
        assert result_box and result_box["height"] <= 320.5, result_box
        expect(page.locator("#dialog .poll-status")).to_contain_text("5次有效首选")
        page.wait_for_function(
            """() => [...document.querySelectorAll('#dialog .poll-score')].length === 3 &&
                [...document.querySelectorAll('#dialog .poll-score')].every((node) => node.textContent !== '…')"""
        )
        state = page.locator("#dialog .choice").evaluate_all(
            """(buttons) => ({
                allDisabled: buttons.every((button) => button.disabled),
                picked: buttons.filter((button) => button.classList.contains('is-picked')).map((button) => button.dataset.id),
                scores: buttons.map((button) => button.querySelector('.poll-score')?.textContent || ''),
            })"""
        )
        assert state["allDisabled"] and state["picked"] == ["fix"], state
        assert all("%" in score for score in state["scores"]), state
        after_select = page.evaluate(
            """() => ({ time: __game.st.time, headlamp: __game.st.bat.headlamp })"""
        )
        assert after_select == {"time": before["time"], "headlamp": before["headlamp"]}

        choice_calls = [entry for entry in calls if entry["path"].endswith("/api/choices")]
        assert [entry["method"] for entry in choice_calls] == ["GET"], choice_calls
        assert not [entry for entry in calls if entry["path"].endswith("/api/telemetry")], calls
        page.screenshot(path=str(OUT / "portrait-choice-distribution.png"))

        page.locator('[data-act="poll-consent"]').click()
        page.wait_for_function(
            """() => JSON.parse(localStorage.getItem('aotai-analytics-consent-v1') || 'false') === true"""
        )
        expect(page.locator("#dialog .poll-status")).to_contain_text("含本次")
        expect(page.locator('[data-act="poll-continue"]')).to_be_enabled()
        choice_calls = [entry for entry in calls if entry["path"].endswith("/api/choices")]
        assert [entry["method"] for entry in choice_calls] == ["GET", "POST"], choice_calls
        post_body = choice_calls[-1]["body"]
        assert post_body["optionId"] == "fix"
        run_id = page.evaluate(
            """() => JSON.parse(localStorage.getItem('aotai-save-v1')).telemetry.runId"""
        )
        assert isinstance(run_id, str) and len(run_id) >= 8
        saved_before_continue = page.evaluate(
            """() => {
                const saved = JSON.parse(localStorage.getItem('aotai-save-v1'));
                return {
                    runId: saved.telemetry.runId,
                    pendingEvent: saved.story.pendingEvent,
                    time: saved.time,
                    headlamp: saved.bat.headlamp,
                    fault: saved.story.effects.headlampFault,
                };
            }"""
        )
        assert post_body["runId"] == run_id, post_body
        assert saved_before_continue == {
            "runId": run_id,
            "pendingEvent": "headlamp_contact",
            "time": before["time"],
            "headlamp": before["headlamp"],
            "fault": False,
        }, saved_before_continue

        # Refresh while the event is still at its pre-choice save point.
        page.reload()
        page.wait_for_load_state("networkidle")
        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-save-v1')).telemetry.runId") == run_id
        page.locator('[data-act="continue"]').click()
        expect(page.locator("#dialog h3")).to_have_text("忽明忽暗的头灯")
        resumed = page.evaluate(
            """() => ({
                runId: __game.st.telemetry.runId,
                time: __game.st.time,
                headlamp: __game.st.bat.headlamp,
                pendingEvent: __game.st.story.pendingEvent,
            })"""
        )
        assert resumed == {
            "runId": run_id,
            "time": before["time"],
            "headlamp": before["headlamp"],
            "pendingEvent": "headlamp_contact",
        }, resumed
        page.wait_for_timeout(600)
        page.locator('#dialog button[data-id="fix"]').click()
        expect(page.locator("#dialog .poll-status")).to_contain_text("6次有效首选")
        expect(page.locator('[data-act="poll-continue"]')).to_be_enabled()
        choice_calls = [entry for entry in calls if entry["path"].endswith("/api/choices")]
        assert [entry["method"] for entry in choice_calls] == ["GET", "POST", "POST"], choice_calls
        retry_body = choice_calls[-1]["body"]
        assert retry_body["runId"] == run_id and retry_body["optionId"] == "fix", retry_body
        assert len({entry["body"]["runId"] for entry in choice_calls if entry["method"] == "POST"}) == 1
        # Only the actual ten-minute repair may drain the ambient-driven lamp.
        expected_battery = page.evaluate("""async () => {
            const {computeEnv} = await import('/src/sim/body.js');
            const {updateLamp} = await import('/src/sim/lighting.js');
            const g = __game, copy = structuredClone(g.st);
            const env = computeEnv(copy, g.ctx());
            const lamp = updateLamp(copy, {sunEl:g.sunEl(), wx:g.wx(), terrain:g.here().type});
            const cold = env.T < -5 ? 1 + (-env.T - 5) / (copy.keepWarm ? 30 : 8) : 1;
            return Math.max(0, copy.bat.headlamp - (lamp.on ? 0.2 * cold * 10 : 0));
        }""")
        page.locator('[data-act="poll-continue"]').click()
        page.wait_for_function("!__game.eventRunning && !document.querySelector('#dialog.open')", timeout=10000)
        settled = page.evaluate(
            """() => ({
                time: __game.st.time,
                headlamp: __game.st.bat.headlamp,
                fault: __game.st.story.effects.headlampFault,
                resolved: __game.st.story.threads.headlampResolved,
            })"""
        )
        assert settled["time"] == before["time"] + 10, settled
        assert abs(settled["headlamp"] - expected_battery) < 1e-7, (settled, expected_battery)
        assert settled["fault"] is False and settled["resolved"] is True, settled
        page.wait_for_timeout(500)
        assert page.evaluate("__game.st.time") == settled["time"]
        assert page.evaluate("__game.st.bat.headlamp") == settled["headlamp"]

        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-save-v1')).telemetry.runId") == run_id
        expect(page.locator('[data-act="menu"]')).to_be_visible()
        page.locator('[data-act="menu"]').click()
        page.locator('[data-act="privacy"]').click()
        page.wait_for_function(
            """() => localStorage.getItem('aotai-analytics-consent-v1') === 'false' &&
                !localStorage.getItem('aotai-analytics-visitor-v1') &&
                !localStorage.getItem('aotai-analytics-queue-v1')"""
        )

        # The eight-option cold-wake question keeps results usable on portrait screens.
        page.locator('.drawer-head [data-act="close"]').click()
        page.evaluate(
            """() => {
                window.__aotaiEightPromise = __game.dialog({
                    pollSource: 'scene:cold_wake',
                    who: '冷醒布局验收',
                    text: ['八个选项需要保持在可滚动区域内。'],
                    choices: [
                        { id: 'cook', label: '烧水' },
                        { id: 'drink', label: '喝水' },
                        { id: 'eat', label: '吃东西' },
                        { id: 'warmer', label: '使用暖宝宝' },
                        { id: 'insul', label: '穿保暖层' },
                        { id: 'move', label: '起身移动' },
                        { id: 'sleep', label: '继续睡' },
                        { id: 'up', label: '立即起身' },
                    ],
                });
            }"""
        )
        expect(page.locator("#dialog h3")).to_have_text("冷醒布局验收")
        expect(page.locator("#dialog .choice")).to_have_count(8)
        eight_box = page.locator("#dialog .dlg").bounding_box()
        assert eight_box and eight_box["height"] <= 320.5, eight_box
        page.wait_for_timeout(600)
        page.locator('#dialog button[data-id="cook"]').click()
        expect(page.locator("#dialog .poll-status")).to_contain_text("36次有效首选")
        eight_state = page.locator("#dialog .choice").evaluate_all(
            """(buttons) => ({
                allDisabled: buttons.every((button) => button.disabled),
                picked: buttons.filter((button) => button.classList.contains('is-picked')).map((button) => button.dataset.id),
                scores: buttons.map((button) => button.querySelector('.poll-score')?.textContent || ''),
            })"""
        )
        assert eight_state["allDisabled"] and eight_state["picked"] == ["cook"], eight_state
        assert all("%" in score for score in eight_state["scores"]), eight_state
        expect(page.locator('[data-act="poll-continue"]')).to_be_enabled()
        page.locator('[data-act="poll-continue"]').click()
        page.wait_for_function("!document.querySelector('#dialog.open')", timeout=10000)

        # Failed distribution reads remain actionable and do not throw page errors.
        fail_choices = True
        page.evaluate(
            """async () => {
                const { EXPANDED_EVENTS } = await import('/src/data/events-expanded.js');
                window.__aotaiEventPromise = __game.runScheduledEvent(
                    EXPANDED_EVENTS.find((event) => event.id === 'headlamp_contact')
                );
            }"""
        )
        expect(page.locator("#dialog h3")).to_have_text("忽明忽暗的头灯")
        page.wait_for_timeout(600)
        page.locator('#dialog button[data-id="defer"]').click()
        expect(page.locator("#dialog .poll-status")).to_contain_text("统计暂不可用，可继续游玩")
        expect(page.locator('[data-act="poll-continue"]')).to_be_enabled()
        page.locator('[data-act="poll-continue"]').click()
        page.wait_for_function("!__game.eventRunning && !document.querySelector('#dialog.open')", timeout=10000)
        unexpected_console = [message for message in console_errors if "status of 503" not in message]
        assert not unexpected_console, unexpected_console
        assert not errors, errors
        print("PASS: browser choice distribution, consent/run persistence, opt-out cleanup, failure fallback; "
              f"initial GET-only, consent POST, screenshot={OUT / 'portrait-choice-distribution.png'}")
        browser.close()


if __name__ == "__main__":
    main()
