"""Shared browser readiness and native animation sampling; no application mocks."""
import os
import sys
from urllib.parse import urlsplit


class PageErrorMonitor:
    """Track script errors and WebKit's native diagnostics during document replacement."""

    def __init__(self, page, engine, origin, reload_paths):
        self.page = page
        self.origin = urlsplit(origin)
        self.webkit_reload_diagnostics = engine == 'webkit' and self.origin.hostname in ('127.0.0.1', '::1', 'localhost')
        self.reload_paths = set(reload_paths)
        self.errors = []
        self.reload_diagnostics = []
        self.replacing = False
        page.on('pageerror', self._page_error)
        if self.webkit_reload_diagnostics:
            page.on('framenavigated', self._frame_navigated)
            page.expose_function('__qaBrowserError', lambda message: self.errors.append(message))
            page.add_init_script("""(() => {
                const report = message => window.__qaBrowserError(message).catch(() => {});
                window.addEventListener('error', event => report(event.message));
                window.addEventListener('unhandledrejection', event => report(String(event.reason)));
            })();""")

    def _frame_navigated(self, frame):
        if frame == self.page.main_frame:
            self.replacing = False

    def _page_error(self, error):
        # WebKit reports a blocked old-document fetch as a JavaScript-source
        # console error. Playwright forwards it as pageerror (issue #43120).
        if self.replacing and error.name == f'Fetch API cannot load {self.origin.scheme}':
            prefix = '/' + self.origin.netloc
            suffix = ' due to access control checks.'
            if error.message.startswith(prefix + '/') and error.message.endswith(suffix):
                path = error.message[len(prefix):-len(suffix)].partition('?')[0]
                if path in self.reload_paths:
                    self.reload_diagnostics.append(path)
                    return
        self.errors.append(str(error))

    def reload(self, *, wait_until):
        if not self.webkit_reload_diagnostics:
            return self.page.reload(wait_until=wait_until)
        self.replacing = True
        try:
            response = self.page.reload(wait_until='commit')
        finally:
            self.replacing = False
        self.page.wait_for_load_state(wait_until)
        return response


def settled(page):
    if os.getenv('CASTORICEUI_QA_TRACE'):
        print(page.evaluate("""()=>document.getAnimations().map(a=>({target:a.effect?.target?.className,state:a.playState,pending:a.pending,time:a.currentTime,iterations:a.effect?.getTiming().iterations,visibility:a.effect?.target instanceof Element?getComputedStyle(a.effect.target).visibility:null,closedDetails:a.effect?.target instanceof Element?!!a.effect.target.closest('details:not([open])'):null}))"""), file=sys.stderr, flush=True)
    page.evaluate("""async () => {
      await document.fonts.ready;
      const frame=()=>new Promise(requestAnimationFrame);
      await frame(); await frame();
      // Retained CSS fill effects can already be finished, including effects
      // inside a closed native details element. Their old finished promises
      // are not a readiness signal in every engine.
      const animations=document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity&&a.playState!=='finished'&&a.playState!=='idle');
      await Promise.race([Promise.all(animations.map(a=>a.finished.catch(()=>{}))),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('Animations did not settle: '+JSON.stringify(animations.map(a=>({target:a.effect?.target?.className,state:a.playState,pending:a.pending,time:a.currentTime}))))),10000))]);
      let stable=0, last=null; const deadline=performance.now()+10000;
      while(stable<3){
        if(performance.now()>deadline)throw new Error('Layout/scroll did not settle');
        await frame(); const value=scrollX+','+scrollY;
        stable=value===last?stable+1:0; last=value;
      }
    }""")


def open_page(page, section, heading):
    page.evaluate("section=>location.hash='/'+section", section)
    page.get_by_role("heading", level=1, name=heading, exact=True).wait_for()
    page.locator("#main-content .page-loading").wait_for(state="detached")
    if section == "traffic/connections":
        page.locator(".active-connections .traffic-analysis__heading").wait_for()
    settled(page)
    assert page.evaluate("location.hash") == "#/" + section


def frames(locator, click, reduced):
    """Sample actual CSS/WAAPI at timeline positions, independently of CPU FPS."""
    locator.evaluate("""e=>{
      const state={animations:[],originalAnimate:e.animate,frame:0};
      const capture=a=>{if(a.effect?.target===e&&!['finished','idle'].includes(a.playState)&&!state.animations.includes(a)){a.pause();state.animations.push(a)}};
      state.scan=()=>e.getAnimations().forEach(capture);
      state.onRun=event=>{if(event.target!==e)return;state.scan();
        if(!state.frame)state.frame=requestAnimationFrame(()=>{state.frame=0;state.scan()})};
      e.animate=function(...args){const a=state.originalAnimate.apply(this,args);capture(a);return a};
      e.addEventListener('transitionrun',state.onRun);e.__motionQA=state;
    }""")
    try:
        click()
        return locator.evaluate("""async(e,reduced)=>{
          const state=e.__motionQA,deadline=performance.now()+3000;
          while(!reduced&&!state.animations.length&&performance.now()<deadline){
            state.scan();if(!state.animations.length)await new Promise(requestAnimationFrame);
          }
          if(!reduced&&!state.animations.length)throw new Error('Expected a native browser animation');
          const duration=Math.max(0,...state.animations.map(a=>{const t=a.effect.getTiming();return Number(t.delay)+Number(t.duration)}));
          const rows=[];
          for(const progress of reduced?[1]:[0,.25,.5,.75,.96]){
            for(const a of state.animations)a.currentTime=duration*progress;
            await new Promise(requestAnimationFrame);
            const style=getComputedStyle(e);
            rows.push({progress,height:e.getBoundingClientRect().height,opacity:Number(style.opacity),marginLeft:parseFloat(style.marginLeft)||0,backgroundColor:style.backgroundColor});
          }
          return rows;
        }""", reduced)
    finally:
        locator.evaluate("""async e=>{const s=e.__motionQA;e.removeEventListener('transitionrun',s.onRun);cancelAnimationFrame(s.frame);e.animate=s.originalAnimate;
          for(const a of s.animations)a.finish();
          await Promise.all(s.animations.map(a=>a.finished.catch(()=>{})));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));delete e.__motionQA;
        }""")
