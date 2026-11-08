"""Slow-photo, pointer and keyboard-focus checks in the existing glass suite."""
from playwright.sync_api import expect
from qa_browser import frames, settled


def verify_arrival(page, state, appearance, deliver, shots=None, engine='browser'):
    appearance.update(glassEnabled=True, glass='default', fit='cover', cacheSeconds=0, revision='glass-cold-arrival')
    state['hold'] = True; state.pop('held', None)
    page.reload(wait_until='domcontentloaded'); page.locator('.auth-card').wait_for()
    page.wait_for_function("document.querySelector('.auth-page')?.dataset.backgroundState==='pending'")
    expect(page.locator('.auth-card')).to_have_attribute('data-glass', 'default')
    expect(page.locator('.auth-background-placeholder')).to_have_css('opacity', '1')
    page.get_by_role('textbox', name='Username', exact=True).fill('arrival-draft')
    page.get_by_label('Password', exact=True).fill('Synthetic-Password-123!')
    page.wait_for_timeout(250); assert state.get('held')
    if shots:
        shots.mkdir(parents=True, exist_ok=True); page.screenshot(path=str(shots / f'{engine}-pending-photo.png'), full_page=True)
    # A failed cold request keeps the material and draft while retrying.
    state.pop('held').fulfill(status=503, json={'error': 'background_temporarily_unavailable'}, headers={'Retry-After': '2'})
    page.wait_for_timeout(200)
    expect(page.locator('.auth-page')).to_have_attribute('data-background-state', 'pending')
    expect(page.locator('.auth-card')).to_have_attribute('data-glass', 'default')
    page.wait_for_function("document.querySelector('.auth-page')?.style.backgroundImage===''")
    for _ in range(60):
        if state.get('held'): break
        page.wait_for_timeout(100)
    assert state.get('held'), 'cold image retry missing'
    before = page.locator('.auth-card').bounding_box()
    reveal = frames(page.locator('.auth-background-placeholder'), lambda: deliver(state.pop('held')), False)
    state['hold'] = False
    settled(page)
    expect(page.locator('.auth-page')).to_have_attribute('data-background-state', 'ready')
    expect(page.locator('.auth-card')).to_have_attribute('data-glass', 'default')
    expect(page.get_by_role('textbox', name='Username', exact=True)).to_have_value('arrival-draft')
    expect(page.get_by_label('Password', exact=True)).to_have_value('Synthetic-Password-123!')
    after = page.locator('.auth-card').bounding_box()
    assert all(abs(before[k]-after[k]) < 1 for k in ('x', 'y', 'width', 'height'))
    values = {round(r['opacity'], 3) for r in reveal}
    assert len(values) >= 3 and reveal[0]['opacity'] > reveal[-1]['opacity'], reveal
    expect(page.locator('.auth-glass-optics')).to_have_css('opacity', '1')
    if shots: page.screenshot(path=str(shots / f'{engine}-revealed-photo.png'), full_page=True)
    return {'pendingGlass': True, 'failedImageKeepsForm': True, 'draftPreserved': True, 'revealFrames': len(values), 'stableCardGeometry': True}


def verify_language_control(page):
    state = page.evaluate("""()=>{
      const root=document.documentElement, auth=document.querySelector('.auth-page'), card=document.querySelector('.auth-card');
      const saved=[root.dataset.theme, auth.getAttribute('style'), auth.dataset.backgroundState, card.dataset.glass, card.dataset.glassTone];
      auth.style.backgroundImage='linear-gradient(white, white)';auth.dataset.backgroundState='ready';
      card.dataset.glass='clear';card.dataset.glassTone='light';
      Object.defineProperty(navigator,'languages',{value:['en-US'],configurable:true});
      dispatchEvent(new Event('languagechange'));
      return saved;
    }""")
    button = page.get_by_role('button', name='Language', exact=True)
    button.click()
    page.get_by_role('option', name='Follow system', exact=True).click()
    contrast = """(e, foregroundOnMenu)=>{
      const fg=getComputedStyle(e).color;
      let bg=getComputedStyle(e).backgroundColor;
      if(foregroundOnMenu && bg==='rgba(0, 0, 0, 0)')bg=getComputedStyle(e.closest('.md-select-menu')).backgroundColor;
      const luminance=color=>color.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>v/255)
        .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const levels=[luminance(fg),luminance(bg)].sort((a,b)=>a-b);
      return (levels[1]+.05)/(levels[0]+.05);
    }"""
    for theme in ('light', 'dark'):
        page.evaluate('theme=>document.documentElement.dataset.theme=theme', theme)
        expect(button.locator('span').first).to_have_text('Language')
        button.hover(); settled(page)
        assert button.evaluate(contrast, False) >= 4.5
        button.click()
        menu = page.get_by_role('listbox', name='Language', exact=True)
        english = menu.get_by_role('option', name='English', exact=True)
        english.hover(); settled(page)
        assert button.evaluate(contrast, False) >= 4.5
        assert all(option.evaluate(contrast, True) >= 4.5 for option in menu.get_by_role('option').all())
        page.keyboard.press('Escape')
    page.evaluate("""()=>{
      Object.defineProperty(navigator,'languages',{value:['zh-Hans-CN'],configurable:true});
      dispatchEvent(new Event('languagechange'));
    }""")
    chinese = page.get_by_role('button', name='语言', exact=True)
    expect(chinese.locator('span').first).to_have_text('语言')
    chinese.click(); page.get_by_role('option', name='English', exact=True).click()
    page.evaluate("""([theme,style,background,glass,tone])=>{
      const auth=document.querySelector('.auth-page'), card=document.querySelector('.auth-card');
      document.documentElement.dataset.theme=theme;
      if(style===null)auth.removeAttribute('style');else auth.setAttribute('style',style);
      auth.dataset.backgroundState=background;card.dataset.glass=glass;card.dataset.glassTone=tone;
      delete navigator.languages;dispatchEvent(new Event('languagechange'));
    }""", state)
    settled(page)
    return True


def verify_light(page):
    page.set_viewport_size({'width': 1536, 'height': 960}); settled(page)
    card = page.locator('.auth-card'); box = card.bounding_box()
    capabilities = page.evaluate("""()=>({visible:!document.hidden,hover:matchMedia('(any-hover:hover) and (any-pointer:fine)').matches,
      reduced:matchMedia('(prefers-reduced-motion:reduce), (prefers-reduced-transparency:reduce), (prefers-contrast:more)').matches})""")
    card.evaluate("e=>e.addEventListener('pointermove',event=>window.__qaPointerType=event.pointerType,{once:true})")
    def move(x, y): page.mouse.move(box['x']+box['width']*x, box['y']+box['height']*y)
    def trace(action, target):
        card.evaluate("""(e,target)=>{window.__qaLight=[];window.__qaLightDone=false;
          const start=performance.now();function sample(){const x=parseFloat(e.style.getPropertyValue('--glass-light-x'))||18;window.__qaLight.push(x);
          const settled=window.__qaLight.length>=4&&Math.abs(x-target)<.02;
          if(!settled&&performance.now()-start<5000)requestAnimationFrame(sample);else window.__qaLightDone=true}sample()}""", target)
        action(); page.wait_for_function('window.__qaLightDone')
        return page.evaluate('window.__qaLight')
    move(.1, .1); page.wait_for_timeout(700)
    def reenter():
        page.mouse.move(0, 0); move(.9, .8)
    values = trace(reenter, 90)
    capabilities['pointerType'] = page.evaluate("window.__qaPointerType")
    assert len({round(x, 1) for x in values}) >= 4 and abs(values[-1]-90) < .1, (capabilities, values)
    assert max(abs(b-a) for a,b in zip(values,values[1:])) < 45, values
    returning = trace(lambda: page.mouse.move(0, 0), 18)
    assert len({round(x, 1) for x in returning}) >= 4 and abs(returning[-1]-18) < .1, returning
    page.dispatch_event('.auth-card', 'pointermove', {'pointerType':'touch','clientX':box['x']+box['width']*.9,'clientY':box['y']+box['height']*.8})
    page.wait_for_timeout(150)
    assert card.evaluate("e=>parseFloat(e.style.getPropertyValue('--glass-light-x'))||18") == 18
    page.emulate_media(reduced_motion='reduce'); move(.8, .7); page.wait_for_timeout(150)
    assert card.evaluate("e=>parseFloat(e.style.getPropertyValue('--glass-light-x'))||18") == 18
    duration = page.locator('.auth-background-placeholder').evaluate("e=>parseFloat(getComputedStyle(e).transitionDuration)")
    assert duration <= .00002, duration  # The shared reduced-motion rule uses .01ms.
    page.emulate_media(reduced_motion='no-preference'); page.mouse.move(0, 0)
    return {'smoothReentry': True, 'returnsToRest': True, 'touchStaysStill': True, 'reducedMotionStaysStill': True, 'inputCapabilities': capabilities}


def verify_navigation_focus(page):
    rows = []
    for width,height in ((1536,960),(1024,720),(901,420)):
        page.set_viewport_size({'width':width,'height':height}); settled(page)
        buttons = page.locator('.navigation-rail nav button')
        expect(buttons).to_have_count(8)
        buttons.first.press('Tab'); page.keyboard.press('Shift+Tab')
        for index in range(buttons.count()):
            # WebKit scrolls a newly focused item on a later rendering turn.
            # Observe that native scroll; do not scroll the item in the test.
            actual = page.wait_for_function("""()=>{const e=document.activeElement,n=e?.closest('.navigation-rail nav');if(!n)return false;
              const r=e.getBoundingClientRect(),p=n.getBoundingClientRect(),s=getComputedStyle(e),space=parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset);
              const value={keyboard:e.matches(':focus-visible'),space,left:r.left-p.left-n.clientLeft,right:p.left+n.clientLeft+n.clientWidth-r.right,
                top:r.top-p.top-n.clientTop,bottom:p.top+n.clientTop+n.clientHeight-r.bottom,height:r.height,overflow:n.scrollWidth>n.clientWidth+1};
              return ['left','right','top','bottom'].every(k=>value[k]>=space-.5)?value:false}""", timeout=5000).json_value()
            assert actual and actual['keyboard'] and actual['height'] >= 47 and not actual['overflow'], actual
            assert all(actual[k] >= actual['space']-.5 for k in ('left','right','top','bottom')), (width,index,actual)
            page.keyboard.press('Enter'); settled(page)
            expect(buttons.nth(index)).to_have_attribute('aria-current', 'page')
            rows.append({'width':width,'height':height,'page':index,'outlineVisible':True})
            if index < buttons.count()-1: page.keyboard.press('Tab')
        buttons.first.press('Enter')
        page.get_by_role('link', name='View connections', exact=True).press('Enter')
        heading = page.get_by_role('heading', level=2, name='Active connections', exact=True)
        expect(heading).to_be_focused()
        assert heading.evaluate("""e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);
          return e.matches(':focus-visible') && parseFloat(s.outlineWidth)>=2 && r.top>=0 && r.bottom<=innerHeight}""")
        assert page.evaluate("location.hash") == "#/traffic/connections"
        rows.append({'width':width,'height':height,'page':'traffic/connections','outlineVisible':True})
    page.set_viewport_size({'width':1536,'height':960}); settled(page)
    return rows
