"""Read-only production checks: title/settings/assets and nearby GET, without starting a run."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('AOTAI_TEST_URL', 'https://aotai-trek-sim.pages.dev').rstrip('/')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    errors, bad, writes = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: bad.append((response.status, response.url)) if response.status >= 400 else None)
    page.on('request', lambda request: writes.append(request.url) if request.method != 'GET' else None)
    page.add_init_script("localStorage.setItem('aotai-analytics-consent-v1','false')")
    page.goto(URL, wait_until='networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    expect(page.locator('[data-act="remains"]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('[data-act="remains-shared"]')).to_have_attribute('aria-pressed', 'true')
    assert page.evaluate('typeof window.__game') == 'undefined'
    page.locator('[data-act="remains"]').tap()
    expect(page.locator('[data-act="remains"]')).to_have_attribute('aria-pressed', 'false')
    expect(page.locator('[data-act="remains-shared"]')).to_be_disabled()
    page.reload(wait_until='networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    expect(page.locator('[data-act="remains"]')).to_have_attribute('aria-pressed', 'false')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'title overflow'
    response = page.request.get(URL + '/api/remains?world=aotai-winter-v1&path=main&cx=0&cz=0')
    assert response.status == 200, (response.status, response.text())
    rows = response.json()['remains']
    assert len(rows) <= 24
    for row in rows:
        assert row['world'] == 'aotai-winter-v1' and row['path'] == 'main'
        assert abs(row['x'] // 64) <= 1 and abs(row['z'] // 64) <= 1
        assert not {'visitorId', 'name', 'ip'}.intersection(row)
    assert page.request.get(URL + '/api/remains').status == 400
    Path('output/playwright').mkdir(parents=True, exist_ok=True)
    page.screenshot(path='output/playwright/remains-production-title.png', full_page=True)
    assert not errors, errors
    assert not bad, bad
    assert not writes, writes
    print('PASS: published assets/fonts, bloodstain settings persistence, production nearby GET, no run/test writes or browser errors')
    browser.close()
