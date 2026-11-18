# Headless screenshots of the board at phone and desktop width. Called by seed-demo.mjs.
import sys
from playwright.sync_api import sync_playwright

base, out, cookie, code = sys.argv[1:5]
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, name in [(390, 844, "phone"), (1100, 800, "desktop")]:
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1)
        ctx.add_cookies([{"name": "nomic_session", "value": cookie, "url": base}])
        page = ctx.new_page()
        page.goto(base + "/")
        page.wait_for_selector("#scores tr")
        page.wait_for_selector("#bell")
        if w < 500:  # opening the panel marks everything read, so only the first shot has a badge
            page.wait_for_selector("#badge:not([hidden])")
        page.screenshot(path=f"{out}/board-{name}.png", full_page=True)
        sw = page.evaluate("document.documentElement.scrollWidth")
        print(f"{name}: scrollWidth={sw} viewport={w} sideways_scroll={sw > w}")
        page.click("#bell")
        page.wait_for_selector("#notes li")
        page.screenshot(path=f"{out}/board-{name}-notifications.png")
        ctx.close()
    # logged out + join page
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    page = ctx.new_page()
    page.goto(base + "/"); page.wait_for_selector("#login-btn"); page.click("#login-btn")
    page.screenshot(path=f"{out}/board-phone-logged-out.png", full_page=True)
    page.goto(base + f"/join/{code}")
    page.screenshot(path=f"{out}/join-phone.png", full_page=True)
    sw = page.evaluate("document.documentElement.scrollWidth")
    print(f"join: scrollWidth={sw} sideways_scroll={sw > 390}")
    b.close()
