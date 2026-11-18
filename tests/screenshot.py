# Headless screenshots with playwright (python). Called by seed-demo.mjs.
# Game one ("first") is in play: Ada (teal) and Bo (vermilion) own a few tiles, it is Ada's turn, and the
# logged-in player is Ada. Game two ("second") is open, with two players who own no tile yet (their
# pieces wait on the bench). Checks print "ok"/"FAIL" lines; any FAIL makes the exit code 1.
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base, out, cookie, code = sys.argv[1:5]
host = urlparse(base).hostname
SIZES = [(390, 844, "phone"), (1100, 800, "desktop")]
failed = []

def check(name, ok, detail=""):
    print(("ok    " if ok else "FAIL  ") + name + (f"  -> {detail}" if detail and not ok else ""))
    if not ok: failed.append(name)

def ctx_for(b, w, h, logged_in, scheme="light"):
    c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1, color_scheme=scheme)
    if logged_in:  # the session cookie is named `s` and scoped to the game's path
        c.add_cookies([{"name": "s", "value": cookie, "domain": host, "path": "/first"}])
    return c

def sideways(page, w, name):
    sw = page.evaluate("document.documentElement.scrollWidth")
    check(f"{name}: no sideways scroll (scrollWidth {sw} <= {w})", sw <= w)

def ready(page):
    page.wait_for_selector("#scores tr"); page.wait_for_selector("#board-wrap[data-renderer]")
    page.wait_for_function("document.querySelectorAll('#tile-list li').length > 0")
    page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0")
    page.wait_for_timeout(400)  # one render frame

def click_tile(page, q, r):
    page.locator("#board-wrap").scroll_into_view_if_needed()
    pos = page.evaluate(f"window.__board.screenPos({q}, {r})")
    page.mouse.click(pos["x"], pos["y"])
    page.wait_for_timeout(250)
    return pos

def canvas_has_pixels(page):
    # An empty or one-colour canvas compresses to a few hundred bytes; a drawn board does not.
    return len(page.locator(".hex-canvas").screenshot()) > 15000

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, name in SIZES:
        # landing page
        c = ctx_for(b, w, h, False); page = c.new_page()
        page.goto(base + "/"); page.wait_for_selector(".games li")
        page.screenshot(path=f"{out}/landing-{name}.png", full_page=True); sideways(page, w, f"landing-{name}")
        c.close()
        for scheme in ("light", "dark"):
            # the board of game one, logged in as Ada, an unowned tile selected
            c = ctx_for(b, w, h, True, scheme); page = c.new_page()
            errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(base + "/first/"); ready(page)
            if scheme == "light": page.wait_for_selector("#bell")
            check(f"board-{name}-{scheme}: WebGL renderer with a drawn canvas", page.get_attribute("#board-wrap", "data-renderer") == "webgl" and canvas_has_pixels(page))
            click_tile(page, 5, 2)   # F3, unowned
            check(f"board-{name}-{scheme}: clicking tile F3 shows its panel with a Claim button", "F3" in page.inner_text("#tile-panel") and page.query_selector("#claim-btn") is not None, page.inner_text("#tile-panel"))
            page.screenshot(path=f"{out}/board-{name}-{scheme}-claim.png", full_page=True)
            click_tile(page, 2, 3)   # C4, Ada's described tile
            txt = page.inner_text("#tile-panel")
            check(f"board-{name}-{scheme}: her own tile shows name, description, owner, props and the describe form", "Hearth Hill" in txt and "fertility" in txt and "Ada (Teal)" in txt and page.query_selector("#describe-form") is not None, txt)
            page.screenshot(path=f"{out}/board-{name}-{scheme}-tile.png", full_page=True)
            if scheme == "light" and page.get_attribute("#board-wrap", "data-renderer") == "webgl":
                tag = page.locator(".board-tags .tag.sel")
                check(f"board-{name}-{scheme}: the selected tile's label (C4) shows on the board", tag.is_visible() and tag.inner_text() == "C4", tag.inner_text())
                check(f"board-{name}-{scheme}: faint edge labels A-H and 1-8 are there", page.locator(".board-tags .edge").count() >= 14)
                p0 = page.evaluate("window.__board.screenPos(2, 3)")
                bx = page.locator("#board-wrap").bounding_box()
                page.mouse.move(bx["x"] + 40, bx["y"] + 40); page.mouse.down(); page.mouse.move(bx["x"] + 140, bx["y"] + 90, steps=6); page.mouse.up(); page.wait_for_timeout(200)
                p1 = page.evaluate("window.__board.screenPos(2, 3)")
                check(f"board-{name}-{scheme}: dragging pans the board by the drag", abs((p1["x"] - p0["x"]) - 100) < 3 and abs((p1["y"] - p0["y"]) - 50) < 3, f"{p0} {p1}")
                check(f"board-{name}-{scheme}: a drag does not select a tile", "C4" in page.inner_text("#tile-panel"))
                page.screenshot(path=f"{out}/board-{name}-{scheme}-panned.png")
                page.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); page.mouse.wheel(0, -400); page.wait_for_timeout(200)
                p2 = page.evaluate("window.__board.screenPos(2, 3)")
                check(f"board-{name}-{scheme}: the wheel zooms (tiles move apart)", abs(p2["x"] - p1["x"]) > 10 or abs(p2["y"] - p1["y"]) > 10)
                page.screenshot(path=f"{out}/board-{name}-{scheme}-zoomed.png")
                page.click(".recenter"); page.wait_for_timeout(200)
                p3 = page.evaluate("window.__board.screenPos(2, 3)")
                check(f"board-{name}-{scheme}: Recenter puts the island back", abs(p3["x"] - p0["x"]) < 3 and abs(p3["y"] - p0["y"]) < 3, f"{p0} {p3}")
                page.mouse.click(bx["x"] + 6, bx["y"] + 6); page.wait_for_timeout(150)
                check(f"board-{name}-{scheme}: tapping open sea clears the selection", "Tap a tile" in page.inner_text("#tile-panel"))
                click_tile(page, 2, 3)
            if scheme == "light":
                click_tile(page, 3, 4)   # D5: its name is HTML on purpose
                check(f"board-{name}-{scheme}: a tile name containing HTML is shown as text, never as markup", "<b>Reed</b>" in page.inner_text("#tile-panel") and page.locator("#tile-panel b").count() == 0 and "<b>Reed</b>" in page.inner_text("#log") and page.locator("#log b").count() == page.locator("#log li").count())
                click_tile(page, 2, 3)
            check(f"board-{name}-{scheme}: no page errors", not errors, str(errors))
            sideways(page, w, f"board-{name}-{scheme}")
            if w < 500 and scheme == "light":
                page.wait_for_selector("#badge:not([hidden])")
                page.click("#bell"); page.wait_for_selector("#notes li")
                page.screenshot(path=f"{out}/board-{name}-notifications.png")
            c.close()
        # game two: nobody has a tile, pieces on the bench; and the join page with the piece colors
        c = ctx_for(b, w, h, False); page = c.new_page()
        page.goto(base + "/second/"); page.wait_for_selector("#board-wrap[data-renderer]"); page.wait_for_function("document.querySelectorAll('#tile-list li').length > 0"); page.wait_for_timeout(400)
        page.screenshot(path=f"{out}/bench-{name}.png", full_page=True); c.close()
        c = ctx_for(b, w, h, False); page = c.new_page()
        page.goto(base + f"/second/join/{code}"); page.wait_for_selector("form")
        check(f"join-{name}: eight pieces, two taken", page.locator("input[name=color]").count() == 8 and page.locator("input[name=color]:disabled").count() == 2)
        page.screenshot(path=f"{out}/join-{name}.png", full_page=True); sideways(page, w, f"join-{name}")
        c.close()
    # the turn box with the propose form (phone), then acting by claiming a tile
    c = ctx_for(b, 390, 844, True); page = c.new_page()
    page.goto(base + "/first/"); ready(page); page.wait_for_selector("#turn-form")
    page.screenshot(path=f"{out}/turn-phone-form.png", clip={"x": 0, "y": 0, "width": 390, "height": 640})
    click_tile(page, 5, 2)
    page.click("#claim-btn"); page.wait_for_function("!document.getElementById('act-note').hidden && document.getElementById('act-note').textContent.indexOf('Done') === 0")
    check("claiming through the panel ends the turn", "is playing" in page.inner_text("#turn-box") and "Bo" in page.inner_text("#turn-box"), page.inner_text("#turn-box"))
    page.screenshot(path=f"{out}/after-claim-phone.png", full_page=True)
    c.close()
    b.close()

    # the flat fallback: no WebGL at all
    b = p.chromium.launch(args=["--disable-webgl", "--disable-3d-apis", "--disable-gpu"])
    for w, h, name in SIZES:
        c = ctx_for(b, w, h, True); page = c.new_page()
        page.add_init_script("const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }")
        page.goto(base + "/first/"); ready(page)
        check(f"svg-{name}: falls back to the SVG map", page.get_attribute("#board-wrap", "data-renderer") == "svg" and page.locator("svg.hex-svg polygon[data-x]").count() > 50)
        click_tile(page, 2, 3)
        check(f"svg-{name}: selecting works the same", "Hearth Hill" in page.inner_text("#tile-panel"))
        page.screenshot(path=f"{out}/svg-{name}.png", full_page=True); sideways(page, w, f"svg-{name}")
        # the list for screen readers exists in both modes and selecting from it works
        page.locator("#tile-list button[data-x='3'][data-y='3']").focus(); page.keyboard.press("Enter")
        check(f"svg-{name}: the tile list works from the keyboard", "D4" in page.inner_text("#tile-panel"))
        c.close()
    b.close()
sys.exit(1 if failed else 0)
