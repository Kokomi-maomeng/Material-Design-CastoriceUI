"""Shared browser readiness and native animation sampling; no application mocks."""
import os
import sys


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
    settled(page)
    assert page.evaluate("location.hash") == "#/" + section


def frames(locator, click, reduced):
    """Sample actual CSS/WAAPI at timeline positions, independently of CPU FPS."""
    locator.evaluate("""e=>{
      const state={animations:[],originalAnimate:e.animate};
      const capture=a=>{if(!state.animations.includes(a)){a.pause();state.animations.push(a)}};
      state.onRun=event=>{if(event.target===e)e.getAnimations().forEach(capture)};
      e.animate=function(...args){const a=state.originalAnimate.apply(this,args);capture(a);return a};
      e.addEventListener('transitionrun',state.onRun);e.__motionQA=state;
    }""")
    try:
        click()
        return locator.evaluate("""async(e,reduced)=>{
          const state=e.__motionQA,deadline=performance.now()+3000;
          while(!reduced&&!state.animations.length&&performance.now()<deadline)await new Promise(requestAnimationFrame);
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
        locator.evaluate("""async e=>{const s=e.__motionQA;e.removeEventListener('transitionrun',s.onRun);e.animate=s.originalAnimate;
          for(const a of s.animations)a.finish();
          await Promise.all(s.animations.map(a=>a.finished.catch(()=>{})));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));delete e.__motionQA;
        }""")
