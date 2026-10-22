"""Camp checkpoint desktop/mobile browser acceptance against local Vite."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('AOTAI_TEST_URL', 'http://127.0.0.1:53750')
OUT = Path('output/playwright')
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    for mobile in [True, False]:
        label = 'mobile' if mobile else 'desktop'
        page = browser.new_page(viewport={'width':390, 'height':844} if mobile else {'width':1440, 'height':1000}, is_mobile=mobile, has_touch=mobile)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("""localStorage.setItem('aotai-analytics-consent-v1', 'false');
          localStorage.setItem('aotai-remains-settings-v1', JSON.stringify({enabled:false,shared:false}));""")
        page.goto(URL, wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        page.locator('[data-act="new"]').click()
        page.locator('[data-act="difficulty"][data-id="spring"]').click()
        page.locator('.role[data-id="nurse"]').click()
        page.locator('[data-act="go"]').click()
        page.locator('.cart [data-act="depart"]').click()
        page.wait_for_function('!!window.__game?.st && !__game.over')
        # Set up a safe campsite, then exercise the actual camp menu and actual pack timer.
        page.evaluate("""() => {
          const g=__game, st=g.st;
          st.flags.gateDone=true;
          st.time=600; st.inv.tent_alpine=1; st.inv.bar=3;
          st.camp={tent:'tent_alpine',inside:true,collapsed:false,health:100,x:g.pos.x,z:g.pos.z,rot:0,exposure:0.3,orient:1,doorIntoWind:false};
          Object.assign(st.body,{core:37,health:240,stamina:90,food:90,water:90,stress:10});
          g._placeTentMesh(); g.ui.showCampMenu(g.campMenuInfo());
        }""")
        expect(page.locator('#campMenu')).to_contain_text('无需点火')
        page.locator('#campMenu [data-act="go"]').click()
        try:
            page.wait_for_function('!!__game.st.campCheckpoint && !__game.busy', timeout=6000)
        except Exception:
            print('URL', page.url, 'ERRORS', errors, 'BODY', page.locator('body').inner_text()[:1600], flush=True)
            print(page.evaluate("() => ({game:!!window.__game,busy:window.__game?.busy,event:window.__game?.eventRunning,over:window.__game?.over,st:window.__game?.st})"), flush=True)
            raise
        original = page.evaluate('JSON.parse(JSON.stringify(__game.st.campCheckpoint.state))')
        assert original['camp'] is None and 'campCheckpoint' not in original and 'telemetry' not in original
        assert original['inv']['bar'] == 3
        # Deplete supplies and die. Declining is a real ending; continuing must restore all resources.
        page.evaluate("""() => {const g=__game; g.st.inv.bar=0;g.st.body.health=0;g.st.story.threads.afterCamp=true;g.die('injury');}""")
        expect(page.locator('#dialog h3')).to_have_text('营地余温')
        expect(page.locator('#dialog .choice')).to_have_count(2)
        expect(page.locator('#dialog')).to_contain_text('可反复回溯')
        assert page.locator('#toasts').evaluate("el => getComputedStyle(el).visibility === 'hidden'")
        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-save-v1')).ending.pending")
        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-records-v1')||'[]').length === 0")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / f'camp-checkpoint-{label}.png'))
        # Refresh while death choice is pending and continue from the normal title save button.
        page.reload(wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        page.locator('[data-act="continue"]').click()
        expect(page.locator('#dialog h3')).to_have_text('营地余温')
        page.wait_for_timeout(500)
        page.locator('#dialog .choice[data-id="continue"]').click()
        page.wait_for_function('!__game.over && !__game.ui.dialogOpen')
        result = page.evaluate("""() => ({health:__game.st.body.health,bar:__game.st.inv.bar,camp:__game.st.camp,
          after:!!__game.st.story.threads.afterCamp,ending:__game.st.ending,auto:__game.autoWalk,falling:__game.falling,
          records:JSON.parse(localStorage.getItem('aotai-records-v1')||'[]').length,cp:__game.st.campCheckpoint.state})""")
        assert result['health'] > 230 and result['bar'] == 3 and not result['after'], result
        assert result['camp'] is None and result['ending'] is None and not result['auto'] and not result['falling'], result
        assert result['records'] == 0 and result['cp'] == original, result
        expect(page.locator('#campMenu')).to_have_count(0)
        page.wait_for_timeout(200)
        expect(page.locator('#dialog')).not_to_have_class('open')
        page.screenshot(path=str(OUT / f'camp-restored-{label}.png'))
        # The bonfire remains retryable. Accepting now uses the untouched normal death settlement.
        page.evaluate("__game.st.body.health=0;__game.die('fall')")
        expect(page.locator('#dialog h3')).to_have_text('营地余温')
        page.wait_for_timeout(500)
        page.locator('#dialog .choice[data-id="accept"]').click()
        expect(page.locator('.ending')).to_be_visible()
        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-records-v1')).length === 1 && !localStorage.getItem('aotai-save-v1')")
        page.reload(wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        expect(page.locator('[data-act="continue"]')).to_have_count(0)
        assert not errors, errors
        print(f'PASS {label}: real pack, immutable snapshot, pending-death reload, restore supplies/health, repeatable checkpoint, normal decline ending, no browser errors')
        page.close()
    browser.close()
