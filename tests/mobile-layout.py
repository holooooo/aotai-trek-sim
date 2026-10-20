"""Portrait-first layout, touch bounds and local disclosure regression."""
import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('output/playwright');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':360,'height':640},is_mobile=True,has_touch=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(os.environ.get('AOTAI_TEST_URL','http://127.0.0.1:53745'));page.wait_for_load_state('networkidle');page.wait_for_selector('#boot.gone',timeout=45000)
 page.locator('[data-act="new"]').click();page.locator('.role[data-id="nurse"]').click();page.locator('[data-act="go"]').click();page.locator('[data-act="depart"]').click()
 results=[]
 for width,height in [(360,640),(390,693),(540,960),(390,844),(844,390)]:
  page.set_viewport_size({'width':width,'height':height})
  for key in ['core','health','stamina']:expect(page.locator(f'[data-v="{key}"]')).to_be_visible()
  expect(page.locator('[data-v="food"]')).to_be_hidden()
  expect(page.locator('[data-act="retreat"]')).to_be_hidden()
  bounds=page.evaluate('''()=>{const joy=document.querySelector('#joyBase').getBoundingClientRect();const touch=[...document.querySelectorAll('#hud button')].filter(b=>b.getClientRects().length);const hits=touch.filter(b=>{let r=b.getBoundingClientRect();return r.left<joy.right&&r.right>joy.left&&r.top<joy.bottom&&r.bottom>joy.top;});return {hud:document.querySelector('.hud-left').getBoundingClientRect().bottom,min:Math.min(...touch.map(b=>Math.min(b.getBoundingClientRect().width,b.getBoundingClientRect().height))),overflow:touch.some(b=>{let r=b.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight;}),collisions:hits.map(b=>b.dataset.act||b.dataset.hold)};}''')
  assert bounds['min']>=44 and not bounds['overflow'] and not bounds['collisions'],bounds
  if height>width:assert bounds['hud']<=height*.26,bounds
  before=page.evaluate('JSON.stringify(__game.st)')
  page.locator('[data-act="hudmore"]').tap();expect(page.locator('[data-v="food"]')).to_be_visible();expect(page.locator('[data-act="sos"]')).to_be_visible()
  expect(page.locator('[data-act="hudmore"]')).to_have_attribute('aria-expanded','true')
  page.locator('[data-act="hudmore"]').tap();assert page.evaluate('JSON.stringify(__game.st)')==before
  page.locator('[data-act="pack"]').tap();expect(page.locator('.drawer')).to_be_visible()
  page.locator('.drawer').evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.finished))')
  assert page.locator('.drawer').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1;}')
  page.locator('[data-act="close"]').tap()
  page.screenshot(path=str(out/f'portrait-hud-{width}x{height}.png'));results.append({'viewport':f'{width}x{height}',**bounds})
 # Critical warnings remain visible while details are folded.
 page.set_viewport_size({'width':360,'height':640})
 page.evaluate('''()=>{__game.eventRunning=true;__game.st.body.food=4;__game.st.rescue={self:true,eta:__game.st.time+1000,at:__game.st.time,x:__game.pos.x,z:__game.pos.z,npcs:[]};__game.refreshHud();}''')
 expect(page.locator('[data-v="food"]')).to_be_visible();expect(page.locator('[data-h="rescue"]')).to_be_visible()
 assert '小时' not in page.locator('[data-h="rescue"]').inner_text()
 # A long dialogue keeps its subject area clear and its final choice scrollable/tappable.
 page.evaluate('''()=>{void __ui.dialog({who:'长对话布局验证',text:Array(8).fill('这是一段可独立滚动的正文，不挤走下方的选项。'),choices:Array.from({length:8},(_,i)=>({id:String(i),label:'选择 '+i,sub:'选项内部滚动，触控区域保持可达'}))});}''')
 expect(page.locator('#dialog.open')).to_be_visible()
 panel=page.locator('.dlg').bounding_box();assert panel['height']<=320.5 and panel['y']>=310,panel
 page.locator('#dialog [data-id="7"]').scroll_into_view_if_needed();page.wait_for_timeout(500);page.locator('#dialog [data-id="7"]').tap();expect(page.locator('#dialog.open')).to_have_count(0)
 assert not errors,errors
 print('PASS: portrait-first HUD, disclosure without game mutation, 44px controls, no joystick overlap, drawer bounds, persistent critical warnings, long dialogue choices; '+json.dumps(results))
 browser.close()
