"""Spring-mode and pressure-dialogue acceptance against the local Vite server."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = "http://127.0.0.1:53750"
OUT = Path("output/playwright")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""localStorage.setItem('aotai-analytics-consent-v1', 'false');
      localStorage.setItem('aotai-remains-settings-v1', JSON.stringify({enabled:false,shared:false}));""")
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#boot.gone", timeout=45000)
    page.locator('[data-act="new"]').tap()
    assert page.locator('[data-act="difficulty"]').all_text_contents() == ["春游", "轻松", "标准", "真实"]
    page.locator('[data-act="difficulty"][data-id="spring"]').tap()
    expect(page.locator('[data-difficulty-note]')).to_contain_text("气温与体感保持在0℃以上")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "difficulty picker overflow"
    page.screenshot(path=str(OUT / "spring-difficulty.png"), full_page=True)
    page.locator('.role[data-id="nurse"]').tap()
    page.locator('[data-act="go"]').tap()
    page.locator('.cart [data-act="depart"]').tap()
    page.wait_for_function("!!window.__game?.st && !__game.over")
    initial = page.evaluate("""() => ({ difficulty:__game.st.difficulty, health:__game.st.body.health, air:__game.airT() })""")
    assert initial["difficulty"] == "spring" and initial["health"] == 240 and initial["air"] > 0, initial
    page.evaluate("__game.save()")
    page.reload(wait_until="networkidle")
    page.wait_for_selector("#boot.gone", timeout=45000)
    page.locator('[data-act="continue"]').tap()
    page.wait_for_function("window.__game?.st?.difficulty === 'spring'")
    assert page.evaluate("__game.airT() > 0 && __game.st.body.health === 240")

    for event_id, title, selected in [
        ("memory_echo", "回忆突然变得很近", "bury"),
        ("regret_turn", "后悔有了具体的形状", "push"),
        ("homeward_voice", "像从身后传来的声音", "deny"),
        ("life_review", "走马灯一样闪过的片段", "rush"),
    ]:
        page.evaluate("""async (id) => {
          const { STRESS_EVENTS } = await import('/src/data/events-stress.js');
          const { ensureEventPacing } = await import('/src/sim/event-director.js');
          const g = __game, st = g.st;
          st.flags.gateDone = true; st.stats.walked = 80;
          Object.assign(st.body, { stress:85, core:37, health:id === 'life_review' ? 20 : 240, stamina:85, food:85, water:85 });
          st.bat.phone = 0; g.refreshHud(true);
          const pacing = ensureEventPacing(st); pacing.started = true; pacing.elapsed += 200;
          pacing.nextAmbientAt = pacing.nextPressureAt = 0;
          window.__sceneDone = false;
          void g.runScheduledEvent(STRESS_EVENTS.find(ev => ev.id === id)).then(() => { window.__sceneDone = true; });
        }""", event_id)
        expect(page.locator('#dialog h3')).to_have_text(title)
        expect(page.locator('#dialog .choice')).to_have_count(3)
        if event_id in ("memory_echo", "life_review"):
            phone_option = "write" if event_id == "memory_echo" else "promise"
            expect(page.locator(f'#dialog .choice[data-id="{phone_option}"]')).to_be_disabled()
        if event_id == "life_review":
            expect(page.locator('#dialog')).to_contain_text("不会自动发送")
        expect(page.locator('#dialog .dlg')).to_be_visible()
        page.wait_for_timeout(500)  # The game's intentional tap-through protection lasts 450 ms.
        page.screenshot(path=str(OUT / f"pressure-{event_id}.png"))
        page.locator(f'#dialog .choice[data-id="{selected}"]').tap()
        page.wait_for_function("window.__sceneDone === true")
        assert page.evaluate("""({id, selected}) => __game.st.story.threads[id] === selected
          && __game.st.story.choices[id] === selected && Number.isFinite(__game.st.flags['ev_' + id])""", {"id":event_id, "selected":selected})
        assert page.evaluate("!__game.over && __game.st.difficulty === 'spring'")

    page.evaluate("__game.save()")
    page.reload(wait_until="networkidle")
    page.wait_for_selector("#boot.gone", timeout=45000)
    page.locator('[data-act="continue"]').tap()
    page.wait_for_function("window.__game?.st?.story?.threads?.life_review === 'rush'")
    assert page.evaluate("__game.st.difficulty === 'spring' && __game.airT() > 0")
    assert not errors, errors
    print("PASS: spring order/mobile layout, real spring departure and reload, positive temperature, four real pressure dialogs, disabled batteries, choices/cooldowns and story persistence; no browser errors")
    browser.close()
