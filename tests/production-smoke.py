"""Verify the built static game without developer-only globals."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    errors, bad = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: bad.append(response.url) if response.status >= 400 else None)
    page.goto(os.environ.get('AOTAI_TEST_URL', 'http://127.0.0.1:53742'))
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    expect(page.locator('.title-edition')).to_have_text('3D版')
    page.locator('[data-act="new"]').click()
    real = page.locator('[data-act="difficulty"][data-id="hardcore"]')
    expect(real).to_have_text('真实')
    real.click()
    expect(real).to_have_attribute('aria-pressed', 'true')
    page.locator('[data-act="difficulty"][data-id="easy"]').click()
    page.locator('.role[data-id="runner"]').click()
    page.locator('[data-act="go"]').click()
    assert '冬季装备检查' not in page.locator('#screen').inner_text()
    page.locator('[data-act="depart"]').click()
    expect(page.locator('#dialog h3')).to_have_text('塘口村 · 凌晨5:30')
    page.keyboard.press('1')
    expect(page.locator('#dialog.open')).to_have_count(0)
    button = page.locator('[data-act="pace"]')
    expect(button).to_be_visible()
    button.click()
    expect(button).to_have_attribute('aria-pressed', 'true')
    assert page.evaluate("JSON.parse(localStorage.getItem('aotai-save-v1')).pace") == 'fast'
    assert page.evaluate("JSON.parse(localStorage.getItem('aotai-save-v1')).difficulty") == 'easy'
    assert page.evaluate("JSON.parse(localStorage.getItem('aotai-save-v1')).body.health") > 190
    assert page.evaluate('typeof window.__game') == 'undefined'
    assert page.locator('.actions').evaluate('(el) => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth')
    Path('output/playwright').mkdir(parents=True, exist_ok=True)
    page.screenshot(path='output/playwright/production-fast-pace-mobile.png')
    assert not errors, errors
    assert not bad, bad
    print('PASS: production mobile startup, runner selection, no equipment check, fast-pace toggle and saved state, fonts/assets load, no developer globals or browser errors')
    browser.close()
