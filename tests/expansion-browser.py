"""Mobile browser acceptance for the expansion UI; run against the existing Vite server."""
from pathlib import Path
import json
from playwright.sync_api import expect, sync_playwright

URL = "http://127.0.0.1:53750"
OUT = Path("output/playwright")
OUT.mkdir(parents=True, exist_ok=True)


def boot(page):
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#boot.gone", timeout=45000)
    expect(page.locator('[data-act="new"]')).to_be_visible()


def start_game(page):
    expect(page.locator('[data-act="privacy"]')).to_have_attribute("aria-pressed", "true")
    expect(page.locator('[data-act="privacy"]')).to_contain_text("匿名统计已开启")
    page.locator('[data-act="privacy"]').tap()
    expect(page.locator('[data-act="privacy"]')).to_have_attribute("aria-pressed", "false")
    page.locator('[data-act="new"]').tap()
    expect(page.locator(".role")).to_have_count(10)
    expect(page.locator('[data-act="difficulty"]')).to_have_count(4)
    expect(page.locator('[data-act="difficulty"][data-id="spring"]')).to_contain_text("春游")
    page.locator('[data-act="difficulty"][data-id="spring"]').tap()
    expect(page.locator('[data-difficulty-note]')).to_contain_text("0℃以上")
    page.locator('[data-act="difficulty"][data-id="normal"]').tap()
    expect(page.locator('[data-act="difficulty"][data-id="normal"]')).to_have_attribute("aria-pressed", "true")
    page.locator('.role[data-id="cook"]').tap()
    page.locator('[data-act="go"]').tap()
    page.locator('.cart [data-act="depart"]').tap()
    page.wait_for_function("!!window.__game?.st && !__game.over")
    page.wait_for_selector("#hud:not([hidden])")


def seed_gear(page, camp=False):
    page.evaluate("""async ({ camp }) => {
      const { ITEMS } = await import('/src/data/items.js');
      const { ensureClothes } = await import('/src/sim/clothes.js');
      const st = __game.st;
      for (const id of ['mid_hoodie', 'poncho', 'shell_pro', 'insul_coat', 'tent_winter', 'bag_winter', 'pad_air', 'headlamp'])
        st.inv[id] = Math.max(1, st.inv[id] || 0);
      st.warmers = 3;
      st.body.core = 37.4; st.body.health = 100; st.body.stamina = 100;
      st.body.food = 90; st.body.water = 90; st.body.frostbite = 0;
      st.wearInsul = true; st.keepWarm = true;
      const clothes = ensureClothes(st);
      Object.keys(st.inv).filter(id => ITEMS[id]?.kind === 'cloth').forEach((id, i) => {
        clothes.wetness[id] = id === 'poncho' ? 86 : id === 'mid_hoodie' ? 78 : 22 + (i * 11) % 67;
      });
      if (camp) {
        __game.autoWalk = false;
        st.camp = { x: __game.pos.x, z: __game.pos.z, rot: 0, tent: 'tent_winter', exposure: 0.2,
          orient: '背风', doorIntoWind: false, health: 100, inside: true, collapsed: false };
        __game._placeTentMesh();
        __ui.showCampMenu(__game.campMenuInfo());
      }
      __game.save();
    }""", {"camp": camp})


def assert_no_page_errors(errors, where):
    assert not errors, f"{where}: pageerror(s): {errors}"


def check_drawer(page, width):
    drawer = page.locator("#sheet .drawer")
    expect(drawer).to_be_visible()
    page.wait_for_timeout(300)  # Let the 220 ms slide-in animation finish before measuring.
    box = drawer.bounding_box()
    assert box and box["x"] >= -2 and box["x"] + box["width"] <= width + 2, f"drawer exceeds viewport: {box}"
    body = page.locator("#sheet .drawer-body")
    assert body.evaluate("el => el.scrollHeight > el.clientHeight"), "drawer should be vertically scrollable on mobile"
    return body


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        errors = []
        try:
            # Scene 1: garment controls, lamp modes, map, then save/reload persistence.
            context = browser.new_context(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)
            page = context.new_page()
            page.on("pageerror", lambda err: errors.append(str(err)))
            boot(page)
            start_game(page)
            seed_gear(page)
            page.locator('[data-act="pack"]').tap()
            body = check_drawer(page, 360)
            page.screenshot(path=str(OUT / "expansion-360-pack.png"))
            cloth_ids = page.evaluate("""async () => {
              const { ITEMS } = await import('/src/data/items.js');
              return Object.keys(__game.st.inv).filter(id => ITEMS[id]?.kind === 'cloth' && __game.st.inv[id] > 0);
            }""")
            rows = page.locator(".clothing-sec .row")
            assert rows.count() == len(cloth_ids), f"clothing rows {rows.count()} != inventory clothing {len(cloth_ids)}"
            for item_id in cloth_ids:
                row = page.locator(f'.clothing-sec [data-act="clothing"][data-id="{item_id}"]').locator("xpath=../..")
                expect(row).to_contain_text("湿度")
            assert body.evaluate("el => el.scrollHeight > el.clientHeight"), "pack drawer lost scroll overflow"

            for item_id, minutes in [("mid_hoodie", 2), ("hat", 0.6)]:
                button = page.locator(f'.clothing-sec [data-act="clothing"][data-id="{item_id}"]')
                button.scroll_into_view_if_needed()
                initial_action = button.inner_text().strip()
                assert initial_action in {"穿上", "脱下"}, f"unexpected clothing action label: {initial_action}"
                before = page.evaluate("__game.st.time")
                button.tap()
                page.wait_for_function("(before) => !__game.busy && __game.st.time >= before + 0.1", arg=before, timeout=10000)
                delta = page.evaluate("(before) => __game.st.time - before", before)
                assert abs(delta - minutes) < 0.01, f"{item_id} exchange cost expected {minutes} min, got {delta}"
                expect(page.locator("#sheet .drawer")).to_be_visible()
                new_body = page.locator("#sheet .drawer-body")
                assert new_body.evaluate("el => el.scrollHeight > el.clientHeight"), f"drawer no longer scrolls after {item_id} exchange"
                assert new_body.evaluate("el => el.scrollTop > 0"), f"drawer scroll position not retained after {item_id} exchange"
                button = page.locator(f'.clothing-sec [data-act="clothing"][data-id="{item_id}"]')
                expected_action = "脱下" if initial_action == "穿上" else "穿上"
                expect(button).to_contain_text(expected_action)
                assert_no_page_errors(errors, f"{item_id} equip")

            for mode in ["auto", "on", "off"]:
                lamp = page.locator(f'.mode-buttons [data-act="lampMode"][data-mode="{mode}"]')
                lamp.scroll_into_view_if_needed()
                lamp.tap()
                expect(page.locator(f'.mode-buttons [data-act="lampMode"][data-mode="{mode}"]')).to_have_attribute("aria-pressed", "true")
            page.screenshot(path=str(OUT / "expansion-360-lamp.png"))
            page.locator('#sheet [data-act="close"]').tap()
            page.locator('[data-act="map"]').tap()
            expect(page.locator('[data-act="mapMode"][data-mode="satellite"]')).to_have_attribute("aria-pressed", "true")
            expect(page.locator('[data-act="mapScope"][data-scope="nearby"]')).to_have_attribute("aria-pressed", "true")
            expect(page.locator('.route-map-frame svg')).to_have_attribute("aria-label", "鳌太线卫星式示意地图")
            page.locator('[data-act="mapMode"][data-mode="elevation"]').tap()
            expect(page.locator('.route-map-frame svg')).to_have_attribute("aria-label", "鳌太线高程示意地图")
            page.locator('[data-act="mapScope"][data-scope="all"]').tap()
            expect(page.locator('[data-act="mapScope"][data-scope="all"]')).to_have_attribute("aria-pressed", "true")
            route_ids = page.locator('.route-map-frame svg [data-route-id]').evaluate_all("els => els.map(el => el.getAttribute('data-route-id'))")
            base_routes = {route_id for route_id in route_ids if not route_id.endswith("-walked")}
            assert base_routes == {"main", "hetaoping", "qingfengxia", "dudumen", "diaoyutai"}, f"all-line map routes differ from main + four branches: {route_ids}"
            expect(page.locator(".map-disclaimer").first).to_contain_text("不是真实卫星影像或导航资料")
            expect(page.locator(".branch-list")).to_contain_text("不证明存在固定通道")
            expect(page.locator(".branch-reference")).to_have_count(4)
            for i in range(4):
                page.locator(".branch-reference summary").nth(i).tap()
            assert page.locator('.branch-reference a[href^="https://"]').count() >= 4, "branch source links missing"
            page.screenshot(path=str(OUT / "expansion-360-map.png"))
            assert_no_page_errors(errors, "map")

            page.locator('#sheet [data-act="close"]').tap()
            page.evaluate("""() => {
              const st = __game.st;
              localStorage.setItem('__expansion_baseline', JSON.stringify({ encounters: st.story.encounters, profile: st.difficulty }));
              __game.save();
            }""")
            page.reload(wait_until="networkidle")
            page.wait_for_selector("#boot.gone", timeout=45000)
            page.locator('[data-act="continue"]').tap()
            page.wait_for_function("!!window.__game?.st && !__game.over")
            result = page.evaluate("""() => ({ baseline: JSON.parse(localStorage.getItem('__expansion_baseline')),
              encounters: __game.st.story.encounters, profile: __game.st.difficulty })""")
            assert result["encounters"] == result["baseline"]["encounters"], "encounters changed across save/reload"
            assert result["profile"] == result["baseline"]["profile"] == "normal", f"difficulty profile changed: {result}"
            assert_no_page_errors(errors, "save/reload")
            context.close()

            # Scene 2: a seeded healthy tent; exercise the drying choice through the UI.
            context = browser.new_context(viewport={"width": 390, "height": 693}, is_mobile=True, has_touch=True)
            page = context.new_page()
            page.on("pageerror", lambda err: errors.append(str(err)))
            boot(page)
            start_game(page)
            seed_gear(page, camp=True)
            camp = page.locator("#campMenu")
            expect(camp).to_be_visible()
            dry = camp.locator('[data-act="dry"]')
            expect(dry).to_be_enabled()
            expect(camp).to_contain_text("晾干湿衣")
            box = camp.bounding_box()
            assert box and box["x"] >= -2 and box["x"] + box["width"] <= 392, f"camp controls exceed viewport: {box}"
            page.screenshot(path=str(OUT / "expansion-390-camp.png"))
            dry.tap()
            expect(page.locator("#dialog")).to_be_visible()
            expect(page.locator("#dialog")).to_contain_text("准备晾挂")
            assisted = page.locator('#dialog button[data-id="assisted"]')
            expect(assisted).to_be_enabled()
            page.screenshot(path=str(OUT / "expansion-390-assisted-choice.png"))
            page.wait_for_timeout(600)  # UI guards accidental dialogue taps briefly.
            before = page.evaluate("""() => ({ time: __game.st.time, warmers: __game.st.warmers,
              wet: __game.st.clothes.wetness.poncho })""")
            assisted.tap()
            page.wait_for_function("!__game.busy && !document.querySelector('#dialog.open')", timeout=15000)
            after = page.evaluate("""() => ({ time: __game.st.time, warmers: __game.st.warmers,
              wet: __game.st.clothes.wetness.poncho })""")
            assert abs((after["time"] - before["time"]) - 30) < 0.01, f"drying duration was not 30 min: {before} -> {after}"
            assert after["warmers"] == before["warmers"] - 1, f"assisted drying must consume one warmer: {before} -> {after}"
            assert 0.5 < after["wet"] < before["wet"], f"drying should reduce moisture gradually, not instantly: {before} -> {after}"
            page.screenshot(path=str(OUT / "expansion-390-dried.png"))
            assert_no_page_errors(errors, "assisted drying")
            context.close()
            print("PASS: 10 roles, default analytics consent toggle, per-item garment moisture/exchange time, scrollable touch drawers, three lamp modes, map modes/scopes/four sourced branches/disclaimers, save/reload encounters/profile, assisted 30-minute gradual drying; screenshots in output/playwright/expansion-*")
        except Exception:
            if 'page' in locals() and not page.is_closed():
                page.screenshot(path=str(OUT / "expansion-failed.png"), full_page=True)
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
