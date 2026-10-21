import json
import math
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

URL = 'http://127.0.0.1:53750'
WORLD = 'aotai-winter-v1'
ARTIFACTS = Path(__file__).resolve().parents[1] / 'output' / 'playwright'


def valid_row(remains_id, path, x, z):
    return {
        'id': remains_id, 'world': WORLD, 'path': path, 'x': round(x, 2), 'z': round(z, 2),
        'role': 'student', 'difficulty': 'normal', 'cause': 'hypothermia', 'gameMinute': 700,
        'core': 31.4, 'health': 0, 'food': 22, 'water': 18, 'stress': 76,
        'altitude': 3420, 'createdAt': int(time.time() * 1000),
    }


def start_game(page):
    page.locator('[data-act="new"]').click()
    page.locator('[data-act="difficulty"][data-id="normal"]').click()
    page.locator('.role[data-id="student"]').click()
    page.locator('[data-act="go"]').click()
    page.locator('.cart [data-act="depart"]').click()
    page.wait_for_function('!!window.__game?.st && !__game.over')


def rect_of(locator):
    return locator.evaluate("e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; }")


def overlap(a, b):
    return a['x'] < b['right'] and a['right'] > b['x'] and a['y'] < b['bottom'] and a['bottom'] > b['y']


def visible_control_boxes(page):
    return page.evaluate("""() => [...document.querySelectorAll('#joy, #hud .abtn, #hud .ibtn')]
      .filter(e => {
        if (!e.getClientRects().length || e.hidden) return false;
        for (let n=e; n && n !== document.documentElement; n=n.parentElement) {
          const s=getComputedStyle(n); if (s.display==='none' || s.visibility==='hidden') return false;
        }
        const r=e.getBoundingClientRect(); return r.width>0 && r.height>0;
      }).map(e => { const r=e.getBoundingClientRect(); return {name:e.id || e.dataset.act || e.className,
        x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; })""")


def check_prompt_layout(page, width, height):
    prompt = page.locator('.remains-prompt')
    expect(prompt).to_be_visible()
    p = rect_of(prompt)
    controls = visible_control_boxes(page)
    hud = page.locator('.hud-left .vitals:visible, .hud-left .device:visible, .hud-left .route:visible').evaluate_all("els => els.map(e => { const r=e.getBoundingClientRect(); return {name:e.className,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; })")
    conflicts = [c for c in controls if overlap(p, c)]
    report = {'viewport': f'{width}x{height}', 'prompt': p, 'controls': controls, 'hud': hud, 'hud_overlaps': [h for h in hud if overlap(p, h)]}
    print('PROMPT_BBOX ' + json.dumps(report, ensure_ascii=False), flush=True)
    assert not conflicts, f'{width}x{height} remains prompt overlaps controls: {conflicts}; prompt={p}'
    return report


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        context = browser.new_context(viewport={'width': 390, 'height': 693}, is_mobile=True, has_touch=True)
        context.add_init_script('window.__AOTAI_TEST_REMAINS__ = true;')
        requests = []
        death_position = {'x': 0.0, 'z': 0.0}

        def mock_remains(route):
            request = route.request
            assert urlparse(request.url).netloc == '127.0.0.1:53750', request.url
            if request.method == 'POST':
                body = json.loads(request.post_data or '{}')
                requests.append({'method': 'POST', 'body': body})
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'recorded': True}))
                return
            parsed = urlparse(request.url)
            params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            requests.append({'method': 'GET', 'params': params})
            assert params.get('world') == WORLD, params
            assert params.get('path') in {'main', 'hetaoping', 'qingfengxia', 'dudumen', 'diaoyutai'}, params
            cx, cz = int(params['cx']), int(params['cz'])
            px, pz = death_position['x'], death_position['z']
            near = valid_row('remote_near_0001', params['path'], px + 2, pz)
            far = valid_row('remote_far_0001', params['path'], px + 110, pz)
            wrong_path = valid_row('remote_path_001', 'qingfengxia' if params['path'] != 'qingfengxia' else 'main', px + 1, pz)
            rows = [near, far, wrong_path]
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'remains': rows}))

        context.route('**/api/remains*', mock_remains)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL, wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        expect(page.locator('[data-act="remains"]')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('[data-act="remains-shared"]')).to_have_attribute('aria-pressed', 'true')

        start_game(page)
        page.evaluate("""() => {
          const g=__game;
          g.st.path='main'; g.st.body.core=27.9; g.st.body.health=0; g.st.body.lastHarm='hypothermia';
          g.st.ending && delete g.st.ending.remainsId;
          window.__deathPos={x:g.pos.x,y:g.pos.y,z:g.pos.z};
          __deathPositionForMock = window.__deathPos;
          g.die('hypothermia');
          g.die('fall');
        }""".replace('__deathPositionForMock = window.__deathPos;', ''))
        pos = page.evaluate('window.__deathPos')
        death_position.update(x=pos['x'], z=pos['z'])
        page.wait_for_selector('#screen .ending', timeout=10000)
        page.wait_for_function("JSON.parse(localStorage.getItem('aotai-remains-local-v1') || '[]').length === 1")
        page.wait_for_function("JSON.parse(localStorage.getItem('aotai-remains-local-v1'))[0].pending === false", timeout=10000)
        post_calls = [r for r in requests if r['method'] == 'POST']
        assert len(post_calls) == 1, f'die() should create one idempotent POST, got {len(post_calls)}'
        death_id = post_calls[0]['body']['id']
        assert len(death_id) >= 8 and post_calls[0]['body']['cause'] == 'hypothermia', post_calls
        assert 'createdAt' not in post_calls[0]['body'], 'server owns shared-record timestamps'
        local = page.evaluate("JSON.parse(localStorage.getItem('aotai-remains-local-v1'))[0].record")
        assert local['id'] == death_id and abs(local['x'] - pos['x']) < 0.02 and abs(local['z'] - pos['z']) < 0.02
        page.screenshot(path=str(ARTIFACTS / 'remains-mobile-ending-390x693.png'))

        page.locator('#screen [data-act="title"]').tap()
        page.wait_for_function('window.__game.st === null')
        assert page.evaluate('__game.remainsRt.size') == 0, 'returning to title must unload scene meshes'
        assert page.evaluate("JSON.parse(localStorage.getItem('aotai-remains-local-v1')).length") == 1, 'title transition preserves local death record'

        page.reload(wait_until='networkidle')
        page.wait_for_selector('#boot.gone', timeout=45000)
        start_game(page)
        page.wait_for_function('window.__game?.st && !__game.over')
        page.evaluate("""({x,z}) => {
          const g=__game, y=g.world.height(x,z);
          g.pos.set(x,y,z); g.st.pos={x,z}; g.st.path='main';
          g.remains.reset(); g.remainsTimer=0; g.updateRemains(1);
        }""", {'x': local['x'], 'z': local['z']})
        page.wait_for_function("__game.remains.remote.some(r => r.id === 'remote_near_0001')", timeout=10000)
        page.wait_for_function("__game.remainsRt.size >= 2", timeout=10000)
        remote_ids = page.evaluate("__game.remains.remote.map(r=>r.id)")
        assert 'remote_near_0001' in remote_ids
        visible_ids = page.evaluate("[...__game.remainsRt.keys()]")
        assert death_id in visible_ids and 'remote_near_0001' in visible_ids, visible_ids
        assert 'remote_path_001' not in remote_ids, remote_ids
        nearby_ids = page.evaluate("__game.remains.nearby('main', __game.pos, new Set(__game.remainsRt.keys())).map(r=>r.id)")
        assert 'remote_far_0001' not in nearby_ids, nearby_ids
        get_calls = [r for r in requests if r['method'] == 'GET']
        assert get_calls, 'nearby session should load shared records'
        for call in get_calls:
            params = call['params']
            assert {'world', 'path', 'cx', 'cz'} <= params.keys(), params
        expected_cell = {'cx': str(math.floor(local['x'] / 64)), 'cz': str(math.floor(local['z'] / 64))}
        assert any(r['params'].get('path') == 'main' and r['params'].get('cx') == expected_cell['cx'] and r['params'].get('cz') == expected_cell['cz'] for r in get_calls), get_calls

        layout_390 = check_prompt_layout(page, 390, 693)
        page.screenshot(path=str(ARTIFACTS / 'remains-mobile-prompt-390x693.png'))
        page.locator('.remains-prompt').tap()
        expect(page.locator('#dialog')).to_be_visible()
        expect(page.locator('.remains-prompt')).to_be_hidden()
        page.wait_for_timeout(500)  # UI.dialog ignores accidental choice clicks during its first 450ms.
        page.locator('#dialog button[data-id="close"]').click()
        expect(page.locator('#dialog.open')).to_have_count(0)
        page.wait_for_function('!__game.ui.modalOpen')
        page.set_viewport_size({'width': 360, 'height': 640})
        page.wait_for_timeout(250)
        layout_360 = check_prompt_layout(page, 360, 640)
        page.screenshot(path=str(ARTIFACTS / 'remains-mobile-prompt-360x640.png'))

        page.evaluate("""() => {
          const g=__game;
          g.pos.x += 180; g.st.pos={x:g.pos.x,z:g.pos.z};
          g.remainsTimer=0; g.updateRemains(1);
        }""")
        assert page.evaluate('__game.remainsRt.size') == 0, 'leaving the load radius must unload local and remote markers'
        expect(page.locator('.remains-prompt')).to_be_hidden()
        page.locator('[data-act="menu"]').tap()
        expect(page.locator('#sheet [data-act="remains-shared"]')).to_have_attribute('aria-pressed', 'true')
        page.locator('#sheet [data-act="remains-shared"]').tap()
        expect(page.locator('#sheet [data-act="remains-shared"]')).to_have_attribute('aria-pressed', 'false')
        call_count = len(requests)
        page.evaluate("""() => { __game.remains.reset(); __game.remains.tick('main', __game.pos); __game.remains.recordDeath(__game.st,__game.pos,'fall',3400); }""")
        page.wait_for_timeout(200)
        assert len(requests) == call_count, 'sharing off must make no GET or POST requests'
        page.locator('#sheet [data-act="quit"]').click()
        page.wait_for_timeout(500)
        page.locator('#dialog button[data-id="y"]').click()
        page.wait_for_function('window.__game.st === null')
        page.locator('[data-act="remains"]').tap()
        expect(page.locator('[data-act="remains"]')).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('[data-act="remains-shared"]')).to_be_disabled()
        call_count = len(requests)
        start_game(page)
        page.evaluate("""() => { __game.remains.tick('main',__game.pos); __game.remains.recordDeath(__game.st,__game.pos,'fall',3400); }""")
        page.wait_for_timeout(200)
        assert len(requests) == call_count, 'global remains off must make no GET or POST requests'
        page.screenshot(path=str(ARTIFACTS / 'remains-mobile-disabled-360x640.png'))
        assert not errors, errors
        context.close()

        desktop_context = browser.new_context(viewport={'width': 1280, 'height': 800})
        desktop_context.add_init_script('window.__AOTAI_TEST_REMAINS__ = true;')
        desktop_context.route('**/api/remains*', mock_remains)
        desktop = desktop_context.new_page()
        desktop_errors = []
        desktop.on('pageerror', lambda e: desktop_errors.append(str(e)))
        desktop.goto(URL, wait_until='networkidle')
        desktop.wait_for_selector('#boot.gone', timeout=45000)
        start_game(desktop)
        desktop.evaluate("""() => {
          const g=__game; g.st.path='main';
          window.__deathPos={x:g.pos.x,y:g.pos.y,z:g.pos.z};
          g.die('fall');
        }""")
        desktop.wait_for_selector('#screen .ending', timeout=10000)
        desktop.screenshot(path=str(ARTIFACTS / 'remains-desktop-ending-1280x800.png'))
        assert not desktop_errors, desktop_errors
        desktop_context.close()
        browser.close()
        print('PASS: real Game.die(), single POST/id, local persistence across title+reload+new run, query cell params, remote path/radius filtering, proximity prompt/modal, range unload, title cleanup, shared/global off no requests')
        print('PROMPT_BBOX ' + json.dumps([layout_390, layout_360], ensure_ascii=False))
        print('SCREENSHOTS ' + json.dumps(sorted(p.name for p in ARTIFACTS.glob('remains-*.png'))))


if __name__ == '__main__':
    main()
