"""Browser integration smoke tests. Run under the webapp-testing with_server helper.
Artifacts: output/playwright/ (ignored by git). Requires Python Playwright + Chromium.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

URL = 'http://127.0.0.1:53741'
OUT = Path('output/playwright')
OUT.mkdir(parents=True, exist_ok=True)


def boot(page):
    page.goto(URL)
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    expect(page.locator('[data-act="new"]')).to_be_visible()


def seed(page, extra=''):
    page.evaluate('''async (extra) => {
      const { createState, addItem } = await import('/src/sim/state.js');
      const { mainPath } = await import('/src/world/terrain.js');
      const { EVENTS } = await import('/src/data/events.js');
      const { EXPANDED_EVENTS } = await import('/src/data/events-expanded.js');
      const { REPORTED_EVENTS } = await import('/src/data/events-reported.js');
      __app.toTitle();
      const st = createState('blogger');
      for (const id of ['tent_alpine','bag_winter','pad_air','insul_down','shell_pro','boots','mitts','hat','thermos','stove','pot','satcomm','gps','headlamp','firstaid','bar']) addItem(st,id);
      st.time = 720; st.s = 140; st.maxS = 140;
      const point = mainPath.pointAt(st.s); st.pos = {x:point.x,z:point.z};
      st.thermos = {l:1,temp:80}; st.gas.alpine = 10; st.wearInsul = true;
      st.flags.gateDone = true; st.flags.illegal = true;
      for (const ev of [...EVENTS,...EXPANDED_EVENTS,...REPORTED_EVENTS]) st.flags['ev_'+ev.id] = st.time;
      for (const e of st.schedule) st.warned[e.t] = true;
      st.story.lastAmbientAt = st.time;
      new Function('st', extra)(st);
      localStorage.setItem('aotai-save-v1', JSON.stringify(st));
      __app.continueGame();
    }''', extra)


def pick(page, choice):
    button = page.locator(f'#dialog button[data-id="{choice}"]')
    expect(button).to_be_visible()
    # 游戏有450ms防误触保护；键盘选择同一个已识别的按钮。
    index = page.locator('#dialog button').evaluate_all('(buttons, id) => buttons.findIndex(b => b.dataset.id === id) + 1', choice)
    page.keyboard.press(str(index))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    desktop = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = desktop.new_page()
    errors = []
    page.on('pageerror', lambda error: (print('PAGE ERROR:', str(error), flush=True), errors.append(str(error))))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    boot(page)
    expect(page.locator('.title-edition')).to_have_text('3D版')
    page.screenshot(path=str(OUT / 'title-desktop.png'))
    page.locator('[data-act="archive"]').click()
    expect(page.get_by_role('heading', name='暴雨中分离，求救尚未结束')).to_be_visible()
    assert page.get_by_role('link', name='封面新闻（2022-06-08）').get_attribute('href') == 'https://www.thecover.cn/news/9278529'
    assert page.locator('.case .lesson').count() == 4
    page.locator('[data-act="back"]').click()
    page.locator('[data-act="new"]').click()
    page.locator('[data-act="difficulty"][data-id="hardcore"]').click()
    expect(page.locator('[data-act="difficulty"][data-id="hardcore"]')).to_have_attribute('aria-pressed', 'true')
    page.locator('[data-act="difficulty"][data-id="easy"]').click()
    page.locator('.role[data-id="blogger"]').click()
    page.locator('[data-act="go"]').click()
    assert '冬季装备检查' not in page.locator('#screen').inner_text()
    assert page.locator('.cart .checklist').count() == 0
    page.screenshot(path=str(OUT / 'shop-desktop.png'))
    page.locator('[data-act="depart"]').click()
    page.wait_for_function('window.__game.st && !__game.eventRunning')
    expect(page.locator('#dialog.open')).to_have_count(0)
    assert page.evaluate('__game.st.body.health') > 190
    expect(page.locator('[data-v="health"]')).to_have_attribute('aria-label', '健康 200 / 200')

    seed(page)
    normal_speed = page.evaluate('__game.speedFactor()')
    page.locator('[data-act="pace"]').click()
    expect(page.locator('[data-act="pace"]')).to_have_attribute('aria-pressed', 'true')
    assert abs(page.evaluate('__game.speedFactor()') / normal_speed - 1.55) < .01
    page.screenshot(path=str(OUT / 'fast-pace-desktop.png'))
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    page.locator('[data-act="continue"]').click()
    expect(page.locator('[data-act="pace"]')).to_have_attribute('aria-pressed', 'true')
    page.keyboard.press('v')
    expect(page.locator('[data-act="pace"]')).to_have_attribute('aria-pressed', 'false')

    # 从实际村口往回走，不能在主线s钳到0时提前结束。
    seed(page, "st.s=4;st.maxS=4;st.pos={x:3.8,z:-1};st.story.lastAmbientAt=st.time+10000;")
    page.evaluate("__game.retreat('back')")
    page.keyboard.down('w')
    expect(page.get_by_role('heading', name='Sigma · 现在回家', exact=True)).to_be_visible(timeout=45000)
    page.keyboard.up('w')
    page.screenshot(path=str(OUT / 'sigma-desktop.png'))
    page.evaluate("localStorage.removeItem('aotai-records-v1')")

    # 过2800后新增的手动下撤选项；真实低地海拔触发新结局。
    seed(page, "st.maxS=1350;st.story.lastAmbientAt=st.time+10000;")
    page.evaluate('__app.retreat()')
    pick(page, 'free')
    page.wait_for_function('!__game.eventRunning')
    assert page.evaluate('__game.st.flags.freeDescent && !__game.autoWalk')
    page.evaluate("""async () => {
      const {mainPath} = await import('/src/world/terrain.js');
      const p=mainPath.pointAt(1400),x=p.x-p.dz*270,z=p.z+p.dx*270;
      __world.loadAllAround(x,z);__game.pos.set(x,__world.height(x,z),z);__game.updateProgress();
    }""")
    expect(page.get_by_role('heading', name='半途下山', exact=True)).to_be_visible(timeout=15000)
    page.evaluate("localStorage.removeItem('aotai-records-v1')")

    # 隐藏搜索阻力不会变成玩家可见的实时倒计时。
    seed(page, "st.rescue={self:true,eta:st.time+200,at:st.time,x:st.pos.x,z:st.pos.z,npcs:[],moved:false};")
    expect(page.locator('[data-h="rescue"]')).to_contain_text('等待搜救')
    assert '小时' not in page.locator('[data-h="rescue"]').inner_text()

    # 中途事件读档会重开选择，随后故障可在背包修复。
    seed(page, "st.story.pendingEvent = 'headlamp_contact';")
    expect(page.locator('#dialog h3')).to_have_text('忽明忽暗的头灯')
    page.screenshot(path=str(OUT / 'headlamp-choice-desktop.png'))
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    page.locator('[data-act="continue"]').click()
    expect(page.locator('#dialog h3')).to_have_text('忽明忽暗的头灯')
    pick(page, 'defer')
    page.wait_for_function('!__game.eventRunning')
    page.keyboard.press('b')
    expect(page.get_by_text('头灯接触不良：夜间有效照明降低')).to_be_visible()
    page.locator('[data-act="repair"][data-id="headlamp_contact"]').click()
    pick(page, 'fix')
    page.wait_for_function('!__game.eventRunning && !__game.busy')
    assert page.evaluate('__game.st.story.effects.headlampFault') is False

    # 真营地恢复菜单、热水真实转移，并保留互助后续入口。
    seed(page, "st.camp={x:st.pos.x,z:st.pos.z,rot:0,tent:'tent_alpine',exposure:.3,orient:.7,doorIntoWind:false,health:100,inside:true,collapsed:false};")
    expect(page.locator('#campMenu')).to_be_visible()
    page.evaluate("__game.st.story.pendingEvent = 'hot_water_share'")
    expect(page.locator('#dialog h3')).to_have_text('隔壁帐篷')
    pick(page, 'share')
    page.wait_for_function('!__game.eventRunning')
    assert 0.74 < page.evaluate('__game.st.thermos.l') < 0.76
    expect(page.locator('#campMenu')).to_be_visible()
    page.evaluate("__game.st.time += 125; __game.st.story.pendingEvent='mutual_followup'")
    expect(page.locator('#dialog h3')).to_have_text('隔壁的人还醒着')
    pick(page, 'wave')
    page.wait_for_function('!__game.eventRunning')

    # 结局实际线索移交、回信刷新恢复、主结局与多个尾声分别统计。
    seed(page, "st.story.threads={reportNote:true,contactHome:true,honestFootage:true};st.body.fracture=1;")
    page.evaluate("void __game.finish('dayehai')")
    pick(page, 'report')
    expect(page.locator('#dialog h3')).to_have_text('山下 · 回一条消息')
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    page.locator('[data-act="continue"]').click()
    expect(page.locator('#dialog h3')).to_have_text('山下 · 回一条消息')
    pick(page, 'reply')
    expect(page.get_by_role('heading', name='不必登顶', exact=True)).to_be_visible()
    expect(page.get_by_text('把消息带下山', exact=True)).to_be_visible()
    expect(page.get_by_text('镜头之外', exact=True)).to_be_visible()
    expect(page.get_by_text('活下来以后', exact=True)).to_be_visible()
    assert page.evaluate("JSON.parse(localStorage.getItem('aotai-records-v1')).length") == 1
    page.screenshot(path=str(OUT / 'ending-desktop.png'))
    page.locator('[data-act="records"]').click()
    expect(page.get_by_role('heading', name='游玩记录')).to_be_visible()
    assert page.evaluate("JSON.parse(localStorage.getItem('aotai-records-v1'))[0].epilogues.length") == 3
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('#boot.gone', timeout=45000)
    page.locator('[data-act="records"]').click()
    expect(page.get_by_text('镜头之外', exact=True).first).to_be_visible()

    # 窄屏截图和布局检查复用真实保存记录。
    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
    mobile.add_init_script('''localStorage.setItem('aotai-records-v1', %s)''' % json.dumps(page.evaluate("localStorage.getItem('aotai-records-v1')")))
    phone = mobile.new_page()
    phone.on('pageerror', lambda error: errors.append(str(error)))
    boot(phone)
    phone.locator('[data-act="records"]').click()
    expect(phone.get_by_role('heading', name='游玩记录')).to_be_visible()
    assert phone.locator('.page').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
    phone.screenshot(path=str(OUT / 'records-mobile.png'))
    phone.locator('[data-act="back"]').click()
    seed(phone)
    phone.locator('[data-act="pace"]').click()
    expect(phone.locator('[data-act="pace"]')).to_have_attribute('aria-pressed', 'true')
    assert phone.locator('.actions').evaluate('(el) => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth')
    phone.screenshot(path=str(OUT / 'fast-pace-mobile.png'))
    seed(phone, "st.story.pendingEvent='headlamp_contact';")
    expect(phone.locator('#dialog h3')).to_have_text('忽明忽暗的头灯')
    assert phone.locator('.dlg').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
    phone.screenshot(path=str(OUT / 'headlamp-choice-mobile.png'))
    assert not errors, errors
    print('PASS: desktop/mobile, archive sources, real new-game flow, pending-event reload, persistent repair, camp recovery, hot-water transfer, mutual followup, resumable ending, record persistence, shop without gear checklist, fast pace toggle/reload/keyboard/mobile, difficulty, actual Sigma walk, free descent, hidden rescue status; no browser errors')
    browser.close()
