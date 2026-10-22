"""Verify camp retry in the production bundle, without developer globals."""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('AOTAI_TEST_URL', 'http://127.0.0.1:53742')
fixture = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', """
import {createState} from './src/sim/state.js';
import {createCampCheckpoint} from './src/sim/camp-checkpoint.js';
import {mainPath} from './src/world/terrain.js';
const st=createState('nurse','spring'),p=mainPath.pointAt(4);
st.pos={x:p.x,z:p.z};st.s=st.maxS=4;st.time=615;st.flags.gateDone=true;st.inv.bar=3;
st.campCheckpoint=createCampCheckpoint(st,'生产验收营地');
st.body.health=0;st.inv.bar=0;st.ending={type:'dead',cause:'injury',pending:true};
console.log(JSON.stringify(st));
"""], text=True))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    for mobile in [True, False]:
        page = browser.new_page(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':1000}, is_mobile=mobile, has_touch=mobile)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("""if (location.protocol.startsWith('http')) {
          localStorage.setItem('aotai-analytics-consent-v1','false');
          localStorage.setItem('aotai-remains-settings-v1',JSON.stringify({enabled:false,shared:false}));
        }""")
        page.goto(URL, wait_until='networkidle', timeout=45000)
        page.wait_for_selector('#boot.gone', timeout=45000)
        assert page.evaluate('typeof window.__game') == 'undefined'
        page.evaluate('(st) => localStorage.setItem("aotai-save-v1", JSON.stringify(st))', fixture)
        page.reload(wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        page.locator('[data-act="continue"]').click()
        expect(page.locator('#dialog h3')).to_have_text('营地余温')
        expect(page.locator('#dialog')).to_contain_text('生产验收营地')
        assert page.locator('#toasts').evaluate("el => getComputedStyle(el).visibility === 'hidden'")
        page.wait_for_timeout(500)
        label = 'mobile' if mobile else 'desktop'
        Path('output/playwright').mkdir(parents=True, exist_ok=True)
        page.screenshot(path=f'output/playwright/camp-production-{label}.png')
        page.locator('#dialog .choice[data-id="continue"]').click()
        expect(page.locator('#dialog.open')).to_have_count(0)
        restored = page.evaluate('JSON.parse(localStorage.getItem("aotai-save-v1"))')
        assert restored['ending'] is None and restored['camp'] is None and restored['body']['health'] == 240
        assert restored['inv']['bar'] == 3 and restored['time'] == 615
        assert restored['campCheckpoint'] == fixture['campCheckpoint']
        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-records-v1')||'[]').length") == 0
        # Stop the live game first: its pagehide save must not overwrite the pending-death fixture.
        page.goto('about:blank')
        page.goto(URL, wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        restored['ending'] = {'type':'dead','cause':'fall','pending':True}
        restored['body']['health'] = 0
        page.evaluate('(st) => localStorage.setItem("aotai-save-v1",JSON.stringify(st))', restored)
        page.reload(wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        page.locator('[data-act="continue"]').click()
        expect(page.locator('#dialog h3')).to_have_text('营地余温')
        page.wait_for_timeout(500)
        page.locator('#dialog .choice[data-id="accept"]').click()
        expect(page.locator('.ending')).to_be_visible()
        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-records-v1')).length === 1 && !localStorage.getItem('aotai-save-v1')")
        assert not errors, errors
        print(f'PASS production {label}: pending-death reload, checkpoint continue, exact persisted restoration, repeat choice, normal ending, no developer globals/errors', flush=True)
        page.close()
    browser.close()
