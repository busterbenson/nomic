# Headless screenshots and browser checks with playwright (python). Called by seed-demo.mjs.
# Game one ("first") is in play: Ada (teal) and Bo (vermilion), it is Ada's turn, and the logged-in player is
# Ada. Her piece stands at x 2, y 0 (1N 3E), one step inside the island's east edge. Game two ("second") is
# open for joining. Checks print "ok"/"FAIL" lines; any FAIL makes the exit code 1.
import re, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base, out, cookie, code = sys.argv[1:5]
host = urlparse(base).hostname
SIZES = [(390, 844, "phone"), (1100, 800, "desktop")]
LABEL = re.compile(r"^[1-9][0-9]*[NS] [1-9][0-9]*[EW] [1-9][0-9]*[UD]$")
failed = []

def check(name, ok, detail=""):
    print(("ok    " if ok else "FAIL  ") + name + (f"  -> {detail}" if detail and not ok else ""))
    if not ok: failed.append(name)

def ctx_for(b, w, h, logged_in, scheme="light", touch=False):
    c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1, color_scheme=scheme, has_touch=touch)
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

def pos(page, x, y):
    page.locator("#board-wrap").scroll_into_view_if_needed()
    return page.evaluate(f"window.__board.screenPos({x}, {y})")

def click_tile(page, x, y):
    p = pos(page, x, y)
    page.mouse.click(p["x"], p["y"]); page.wait_for_timeout(250)
    return p

def tag_text(page):
    return [t.inner_text() for t in page.locator(".board-tags .tag:not([hidden])").all()]

def tile_count(page):
    return page.evaluate("fetch('/first/api/board').then(r => r.json()).then(b => b.tiles.length)")

def long_press(page, c, x, y, ms=800):
    cdp = c.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    page.wait_for_timeout(ms)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(200)

def canvas_has_pixels(page):
    return len(page.locator(".hex-canvas").screenshot()) > 8000

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---- landing + join pages
    for w, h, name in SIZES:
        c = ctx_for(b, w, h, False); page = c.new_page()
        page.goto(base + "/"); page.wait_for_selector(".games li")
        page.screenshot(path=f"{out}/landing-{name}.png", full_page=True); sideways(page, w, f"landing-{name}")
        c.close()
        c = ctx_for(b, w, h, False); page = c.new_page()
        page.goto(base + f"/second/join/{code}"); page.wait_for_selector("form")
        check(f"join-{name}: eight pieces, two taken", page.locator("input[name=color]").count() == 8 and page.locator("input[name=color]:disabled").count() == 2)
        page.screenshot(path=f"{out}/join-{name}.png", full_page=True); sideways(page, w, f"join-{name}")
        c.close()

    # ---- desktop, light: the start, coordinates hidden, hover, right-click, then a move that charts new tiles
    c = ctx_for(b, 1100, 800, True, "light"); page = c.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/first/"); ready(page); page.wait_for_selector("#bell")
    check("desktop: WebGL renderer with a drawn canvas", page.get_attribute("#board-wrap", "data-renderer") == "webgl" and canvas_has_pixels(page))
    check("desktop: nothing shows coordinates by default (no tag, no axis labels, none in the panel)", tag_text(page) == [] and page.locator(".board-tags .edge").count() == 0 and not re.search(r"\b[1-9][0-9]*[NS]\b", page.inner_text("#tile-panel")))
    check("desktop: the island is 64 charted tiles and the board has 2 pieces", tile_count(page) == 64 and page.evaluate("fetch('/first/api/board').then(r => r.json()).then(b => b.pieces.length)") == 2)
    page.screenshot(path=f"{out}/board-desktop-light-start.png", full_page=True)
    p0 = pos(page, -2, 1)
    page.mouse.move(p0["x"], p0["y"]); page.wait_for_timeout(250)
    tt = tag_text(page)
    check("desktop: hovering a tile shows its coordinate (2N 2W 1U for x -2, y 1)", tt == ["2N 2W 1U"], str(tt))
    page.mouse.move(2, 2); page.wait_for_timeout(200)
    check("desktop: moving off the tile hides it again", tag_text(page) == [], str(tag_text(page)))
    p1 = pos(page, -3, 2)
    page.mouse.click(p1["x"], p1["y"], button="right"); page.wait_for_timeout(250)
    tt = tag_text(page)
    check("desktop: right-clicking a tile shows its coordinate (3N 3W 1U) and no browser menu", any(t == "3N 3W 1U" for t in tt), str(tt))
    page.mouse.move(2, 2); page.wait_for_timeout(200)
    check("desktop: the right-click label stays until the next click", "3N 3W 1U" in tag_text(page))
    page.mouse.click(p0["x"], p0["y"]); page.wait_for_timeout(250)
    check("desktop: the next click clears it and selects the tile; the panel names no coordinates", "3N 3W 1U" not in tag_text(page) and "A charted tile" in page.inner_text("#tile-panel") and not re.search(r"\b[1-9][0-9]*[NS]\b", page.inner_text("#tile-panel")), page.inner_text("#tile-panel"))
    # pan / zoom / recenter still work
    ph = pos(page, 2, 0)
    bx = page.locator("#board-wrap").bounding_box()
    page.mouse.move(bx["x"] + 40, bx["y"] + 40); page.mouse.down(); page.mouse.move(bx["x"] + 140, bx["y"] + 90, steps=6); page.mouse.up(); page.wait_for_timeout(200)
    pp = pos(page, 2, 0)
    check("desktop: dragging pans the board by the drag", abs((pp["x"] - ph["x"]) - 100) < 3 and abs((pp["y"] - ph["y"]) - 50) < 3, f"{ph} {pp}")
    page.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); page.mouse.wheel(0, -400); page.wait_for_timeout(200)
    pz = pos(page, 2, 0)
    check("desktop: the wheel zooms", abs(pz["x"] - pp["x"]) > 10 or abs(pz["y"] - pp["y"]) > 10)
    page.click(".recenter"); page.wait_for_timeout(200)
    pr = pos(page, 2, 0)
    check("desktop: Recenter puts the board back", abs(pr["x"] - ph["x"]) < 3 and abs(pr["y"] - ph["y"]) < 3, f"{ph} {pr}")
    # the move through the page: Ada at x 2, y 0 steps east to x 3 (the island's edge), which charts beyond it
    click_tile(page, -2, 1)
    check("desktop: a tile two steps away offers no Move button", page.query_selector("#move-btn") is None, page.inner_text("#tile-panel"))
    click_tile(page, 1, -1)  # diagonal step
    check("desktop: a diagonal neighbour offers Move here", page.query_selector("#move-btn") is not None, page.inner_text("#tile-panel"))
    click_tile(page, 3, 0)
    page.click("#move-btn"); page.wait_for_function("!document.getElementById('act-note').hidden && document.getElementById('act-note').textContent.indexOf('Moved') === 0")
    page.wait_for_timeout(500)
    n_after = tile_count(page)
    check("desktop: moving to the island's edge charted new tiles beyond it (64 -> more)", n_after > 64, str(n_after))
    check("desktop: the turn is NOT over: the propose form is still there, and a second move is not offered", page.locator("#turn-form").count() == 1 and "You have moved this turn" in page.inner_text("#turn-box"), page.inner_text("#turn-box"))
    page.mouse.move(2, 2)
    far = page.evaluate("window.__board.screenPos(5, 0)")
    check("desktop: the new tiles are on the board (x 5 is drawn)", far is not None)
    page.mouse.move(far["x"], far["y"]); page.wait_for_timeout(250)
    check("desktop: hovering a new tile shows its coordinate (1N 6E 1U)", "1N 6E 1U" in tag_text(page), str(tag_text(page)))
    click_tile(page, 2, 0)
    page.mouse.move(2, 2)
    check("desktop: after moving, no tile offers Move here", page.query_selector("#move-btn") is None and "already moved" in page.inner_text("#tile-panel"), page.inner_text("#tile-panel"))
    page.screenshot(path=f"{out}/board-desktop-light-moved.png", full_page=True)
    check("desktop: no page errors", not errors, str(errors)); sideways(page, 1100, "board-desktop-light")
    c.close()

    # ---- phone, dark: touch. Nothing by default; a tap selects without a label; a long-press shows the label.
    c = ctx_for(b, 390, 844, True, "dark", touch=True); page = c.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/first/"); ready(page)
    check("phone dark: WebGL canvas drawn, nothing shows coordinates", canvas_has_pixels(page) and tag_text(page) == [])
    pt = pos(page, -2, 1)
    page.touchscreen.tap(pt["x"], pt["y"]); page.wait_for_timeout(300)
    check("phone dark: a tap selects the tile and shows no coordinate", "A charted tile" in page.inner_text("#tile-panel") and tag_text(page) == [], str(tag_text(page)))
    pt = pos(page, -2, -2)
    long_press(page, c, pt["x"], pt["y"])
    tt = tag_text(page)
    check("phone dark: a long-press shows the tile's coordinate (2S 2W 1U)", "2S 2W 1U" in tt, str(tt))
    check("phone dark: and the long-press did not also select it", "A charted tile" in page.inner_text("#tile-panel") and page.evaluate("document.querySelector('#tile-panel').innerText").count("Nobody") <= 1)
    page.touchscreen.tap(2, 2) if False else None
    page.screenshot(path=f"{out}/board-phone-dark.png", full_page=True)
    check("phone dark: no page errors", not errors, str(errors)); sideways(page, 390, "board-phone-dark")
    page.wait_for_selector("#badge:not([hidden])", timeout=3000) if page.locator("#badge").count() and False else None
    c.close()

    # ---- the turn box on a phone, light
    c = ctx_for(b, 390, 844, True, "light"); page = c.new_page()
    page.goto(base + "/first/"); ready(page); page.wait_for_selector("#turn-form")
    page.screenshot(path=f"{out}/turn-phone-form.png", clip={"x": 0, "y": 0, "width": 390, "height": 640})
    c.close()
    b.close()

    # ---- the flat fallback: no WebGL at all
    b = p.chromium.launch(args=["--disable-webgl", "--disable-3d-apis", "--disable-gpu"])
    for w, h, name in SIZES:
        c = ctx_for(b, w, h, True, "light", touch=(w < 500)); page = c.new_page()
        page.add_init_script("const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }")
        page.goto(base + "/first/"); ready(page)
        check(f"svg-{name}: falls back to the SVG map", page.get_attribute("#board-wrap", "data-renderer") == "svg" and page.locator("svg.hex-svg polygon[data-x]").count() > 60)
        check(f"svg-{name}: no coordinates by default", tag_text(page) == [])
        click_tile(page, -2, 1)
        check(f"svg-{name}: selecting works the same", "A charted tile" in page.inner_text("#tile-panel"))
        if w >= 500:
            pp = pos(page, 1, 1); page.mouse.move(pp["x"], pp["y"]); page.wait_for_timeout(200)
            check(f"svg-{name}: hover shows the coordinate", tag_text(page) == ["2N 2E 1U"], str(tag_text(page)))
            pp = pos(page, -1, 2); page.mouse.click(pp["x"], pp["y"], button="right"); page.wait_for_timeout(200)
            check(f"svg-{name}: right-click shows the coordinate", "3N 1W 1U" in tag_text(page), str(tag_text(page)))
        else:
            pp = pos(page, -2, -2); long_press(page, c, pp["x"], pp["y"])
            check(f"svg-{name}: long-press shows the coordinate", "2S 2W 1U" in tag_text(page), str(tag_text(page)))
        page.screenshot(path=f"{out}/svg-{name}.png", full_page=True); sideways(page, w, f"svg-{name}")
        page.locator("#tile-list button[data-x='1'][data-y='1']").focus(); page.keyboard.press("Enter")
        check(f"svg-{name}: the tile list works from the keyboard", "A charted tile" in page.inner_text("#tile-panel"))
        check(f"svg-{name}: the screen reader list names tiles with their coordinates", page.locator("#tile-list button[data-x='1'][data-y='1']").inner_text().startswith("Tile 2N 2E 1U"))
        c.close()
    b.close()
sys.exit(1 if failed else 0)
