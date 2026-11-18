# Headless screenshots at phone (390) and desktop (1100) width. Called by seed-demo.mjs.
# Game one (slug "first") is in play and the logged-in player is Ada; game two ("second") is open.
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base, out, cookie, code = sys.argv[1:5]
host = urlparse(base).hostname
SIZES = [(390, 844, "phone"), (1100, 800, "desktop")]

def ctx_for(b, w, h, logged_in):
    c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1)
    if logged_in:  # the session cookie is named `s` and scoped to the game's path
        c.add_cookies([{"name": "s", "value": cookie, "domain": host, "path": "/first"}])
    return c

def sideways(page, w, name):
    sw = page.evaluate("document.documentElement.scrollWidth")
    print(f"{name}: scrollWidth={sw} viewport={w} sideways_scroll={sw > w}")

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, name in SIZES:
        # landing page
        c = ctx_for(b, w, h, False); page = c.new_page()
        page.goto(base + "/"); page.wait_for_selector(".games li")
        page.screenshot(path=f"{out}/landing-{name}.png", full_page=True); sideways(page, w, f"landing-{name}")
        c.close()
        # a game board with two players, logged in as Ada
        c = ctx_for(b, w, h, True); page = c.new_page()
        page.goto(base + "/first/")
        page.wait_for_selector("#scores tr"); page.wait_for_selector("#bell")
        page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0")
        if w < 500: page.wait_for_selector("#badge:not([hidden])")
        page.screenshot(path=f"{out}/board-{name}.png", full_page=True); sideways(page, w, f"board-{name}")
        if w < 500:
            page.click("#bell"); page.wait_for_selector("#notes li")
            page.screenshot(path=f"{out}/board-{name}-notifications.png")
        c.close()
        # the join page of the game that is still open
        c = ctx_for(b, w, h, False); page = c.new_page()
        page.goto(base + f"/second/join/{code}"); page.wait_for_selector("form")
        page.screenshot(path=f"{out}/join-{name}.png", full_page=True); sideways(page, w, f"join-{name}")
        c.close()
    # the turn form, then after submitting (phone)
    c = ctx_for(b, 390, 844, True); page = c.new_page()
    page.goto(base + "/first/"); page.wait_for_selector("#turn-form")
    page.fill("textarea[name=prompt]", "Anyone who proposes a rule about cats gets 5 points.")
    page.screenshot(path=f"{out}/turn-phone-form.png", clip={"x": 0, "y": 0, "width": 390, "height": 520})
    page.click("#turn-form button"); page.wait_for_selector("blockquote.prompt")
    page.screenshot(path=f"{out}/turn-phone-submitted.png", clip={"x": 0, "y": 0, "width": 390, "height": 520})
    c.close()
    b.close()
