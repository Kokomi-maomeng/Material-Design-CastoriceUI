"""Shared-control regressions, run inside the existing three-engine suite."""
from playwright.sync_api import expect
from qa_browser import frames, settled


def verify_controls(page, state, appearance, configured_url):
    source = page.get_by_role('button', name='Sign-in background source', exact=True)
    def choose(label):
        source.click(); page.get_by_role('option', name=label, exact=True).click(); settled(page)
    choose('Default Material background'); choose('Image API')
    field = page.locator('.background-settings input[type=url]')
    # The input has a wrapping label; its existing API value survived the
    # earlier unsaved switches in this same settings dialog.
    expect(field).to_have_value(configured_url)
    field.fill('https://images.example.com/draft')
    choose('Server image'); choose('Default Material background'); choose('Image API')
    expect(field).to_have_value('https://images.example.com/draft')
    field.fill(configured_url)
    toggle = page.get_by_role('switch', name='Liquid Glass', exact=True)
    if toggle.get_attribute('aria-checked') != 'true': toggle.click()
    slider = page.get_by_role('slider', name='Glass transparency', exact=True)
    settled(page)
    slider.press('Home'); expect(slider).to_have_value('0')
    slider.press('ArrowRight'); expect(slider).to_have_value('1')
    slider.press('End'); expect(slider).to_have_value('2')
    # Real native mouse movement across non-preset positions, then snap.
    box = slider.bounding_box(); y = box['y'] + box['height']/2
    slider.press('Home'); settled(page)
    page.mouse.move(box['x'] + 10, y); page.mouse.down()
    positions = []
    for fraction in (.13, .27, .38, .43):
        page.mouse.move(box['x'] + 10 + (box['width']-20)*fraction, y, steps=3)
        positions.append(float(slider.input_value()))
    assert len(set(positions)) >= 3 and all(0 < p < 1 for p in positions), positions
    thumb_before = page.locator('.md-preset-slider__thumb').bounding_box()['x']
    page.mouse.up(); expect(slider).to_have_value('1'); settled(page)
    thumb_after = page.locator('.md-preset-slider__thumb').bounding_box()['x']
    assert thumb_after > thumb_before
    # Actual closing animation remains mounted, non-interactive and measurable.
    source.click(); settled(page)
    menu = page.locator('.md-select-menu')
    closing = frames(menu, lambda: page.get_by_role('option', name='Image API', exact=True).click(), False)
    opacities = [round(row['opacity'], 3) for row in closing]
    assert len(set(opacities)) >= 3 and opacities[0] > opacities[-1], opacities
    # A second close can inspect inert before the presence timeout unmounts it.
    source.click(); settled(page)
    page.get_by_role('option', name='Image API', exact=True).click()
    assert page.locator('.md-select-menu.is-closing').get_attribute('inert') is not None
    settled(page)
    slider.press('ArrowLeft'); expect(slider).to_have_value('0')
    # Save in this document, then sign out from a non-overview route.
    # The selected mock response is the same API contract as the real backend.
    page.get_by_role('button', name='Save sign-in background', exact=True).click()
    expect(page.get_by_role('status').filter(has_text='Sign-in background saved')).to_be_visible()
    page.get_by_role('button', name='Done', exact=True).click(); settled(page)
    page.evaluate("location.hash='/audit'")
    page.get_by_role('heading', name='Audit log', exact=True).wait_for(); settled(page)
    page.locator('.user-menu').click(); page.get_by_role('menuitem', name='Sign out', exact=True).click()
    page.locator('.auth-glass-optics image').wait_for(state='attached')
    expect(page.locator('.auth-card')).to_have_attribute('data-glass', 'clear')
    assert state['saved']['glassEnabled'] is True and state['saved']['glass'] == 'clear'
    return {'draftsPreserved': True, 'continuousDrag': True, 'snapsToPreset': True,
            'keyboardPresets': True, 'menuExitFrames': len(set(opacities)), 'exitingMenuInert': True,
            'glassAppliedWithoutReload': True}
