"""Real portrait input and event-camera integration, against the source app."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import os

out=Path('output/playwright');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':360,'height':640},is_mobile=True,has_touch=True)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(os.environ.get('AOTAI_TEST_URL','http://127.0.0.1:53744'))
    page.wait_for_load_state('networkidle');page.wait_for_selector('#boot.gone',timeout=45000)
    page.locator('[data-act="new"]').click();page.locator('.role[data-id="nurse"]').click();page.locator('[data-act="go"]').click();page.locator('[data-act="depart"]').click()
    expect(page.locator('#dialog.open')).to_have_count(0)
    before=page.evaluate('({time:__game.st.time,health:__game.st.body.health})')
    page.wait_for_timeout(8000)
    assert page.evaluate('({time:__game.st.time,health:__game.st.body.health})')==before
    expect(page.locator('#dialog.open')).to_have_count(0)
    joy=page.locator('#joyBase').bounding_box();assert joy
    x,y=joy['x']+joy['width']/2,joy['y']+joy['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y-35,steps=5);page.wait_for_timeout(700);page.mouse.up()
    page.wait_for_function('__game.st.story.pacing.started && __game.st.stats.walked>0')
    expect(page.locator('#dialog.open')).to_have_count(0)
    page.evaluate('''async()=>{
      const {makeCharacter}=await import('/src/world/models.js');
      const g=__game,w=__world,actor=makeCharacter({jacket:0xd18e4c});
      actor.position.set(g.pos.x+2,w.height(g.pos.x+2,g.pos.z+2),g.pos.z+2);w.scene.add(actor);
      g.npcRt.qa={group:actor,chars:[actor],ns:{met:true,done:true},def:{calls:false}};
      g._qaOrbit={yaw:g.cam.yaw,pitch:g.cam.pitch,dist:g.cam.dist};g._qaPos=w.camera.position.clone();g._qaTime=g.st.time;
      void g.runEvent(()=>g.dialog({who:'运镜验证',text:['镜头对准人物，行进视角不被改写。'],choices:[{id:'ok',label:'继续'}]}),{focus:{npc:'qa'}});
    }''')
    expect(page.locator('#dialog h3')).to_have_text('运镜验证')
    page.wait_for_function('__game.eventCamera._phase === "hold"',timeout=10000)
    framing=page.evaluate('''()=>{const g=__game,p=g._eventFocus.target.clone().project(__world.camera);return {x:p.x,y:p.y,z:p.z,unchanged:g.st.time===g._qaTime,orbit:g._qaOrbit.yaw===g.cam.yaw&&g._qaOrbit.pitch===g.cam.pitch&&g._qaOrbit.dist===g.cam.dist};}''')
    assert abs(framing['x'])<.15 and 0<framing['y']<.65 and -1<framing['z']<1,framing
    assert framing['unchanged'] and framing['orbit'],framing
    panel=page.locator('.dlg').bounding_box();assert panel['y']>240,panel
    page.screenshot(path=str(out/'portrait-event-camera.png'))
    page.locator('#dialog [data-id="ok"]').tap()
    page.wait_for_function('!__game.eventCamera.active',timeout=10000)
    assert page.evaluate('__game._qaOrbit.yaw===__game.cam.yaw && __game._qaOrbit.pitch===__game.cam.pitch && __game._qaOrbit.dist===__game.cam.dist')
    page.evaluate('__game._removeNpcMeshes("qa")')
    page.evaluate('''async()=>{const {EVENTS}=await import('/src/data/events.js');void __game.runScheduledEvent(EVENTS.find(e=>e.id==='takin'));}''')
    expect(page.locator('#dialog h3')).to_have_text('羚牛')
    assert page.evaluate('__game._eventFocus.kind==="object" && !!__game._eventActor')
    page.wait_for_function('__game.eventCamera._phase === "hold"',timeout=10000)
    page.screenshot(path=str(out/'portrait-animal-event.png'))
    page.locator('#dialog [data-id="back"]').tap()
    page.wait_for_function('!__game.eventCamera.active && !__game._eventActor',timeout=15000)
    assert not errors,errors
    print('PASS: 9:16 idle opening, actual joystick movement, NPC camera framing, frozen event time, orbit restoration and temporary object cleanup; no browser errors')
    browser.close()
