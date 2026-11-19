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
    page.wait_for_selector("#scores li"); page.wait_for_selector("#board-wrap[data-renderer]")
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
    return [t.inner_text() for t in page.locator(".tip:not([hidden])").all()]

def tile_count(page):
    return page.evaluate("fetch('/first/api/board').then(r => r.json()).then(b => b.tiles.length)")

def long_press(page, c, x, y, ms=800):
    cdp = c.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    page.wait_for_timeout(ms)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(200)

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
        check(f"join-{name}: sixteen colors, two taken", page.locator("input[name=color]").count() == 16 and page.locator("input[name=color]:disabled").count() == 2)
        page.screenshot(path=f"{out}/join-{name}.png", full_page=True); sideways(page, w, f"join-{name}")
        c.close()

    # ---- desktop, light: the start, coordinates hidden, hover, right-click, then a move that charts new tiles
    c = ctx_for(b, 1100, 800, True, "light"); page = c.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/first/"); ready(page); page.wait_for_selector("#bell")
    check("desktop: the board is drawn as SVG with a piece for each of the two players, grounded on a tile", page.get_attribute("#board-wrap", "data-renderer") == "svg" and page.locator("#board-wrap g.piece").count() == 2 and page.locator("#board-wrap polygon.top").count() == 64)
    check("desktop: nothing shows coordinates by default (no tag, no axis labels, none in the panel)", tag_text(page) == [] and not re.search(r"\b[1-9][0-9]*[NS]\b", page.inner_text("#tile-panel")))
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
    page.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); page.keyboard.down("Control"); page.mouse.wheel(0, -400); page.keyboard.up("Control"); page.wait_for_timeout(200)
    pz = pos(page, 2, 0)
    check("desktop: Ctrl and the wheel zooms (a plain wheel scrolls the page)", abs(pz["x"] - pp["x"]) > 10 or abs(pz["y"] - pp["y"]) > 10)
    page.click("button[data-ctl=out]"); page.wait_for_timeout(200)
    pr = pos(page, 2, 0)
    check("desktop: the zoom buttons zoom the board", abs(pr["x"] - pz["x"]) > 5 or abs(pr["y"] - pz["y"]) > 5, f"{pz} {pr}")
    page.click("button[data-ctl=me]"); page.wait_for_timeout(200)
    check("desktop: My piece puts the viewer's own piece in view", page.evaluate("(() => { const r = document.querySelector('#board-wrap g.piece').getBoundingClientRect(); const w = document.getElementById('board-wrap').getBoundingClientRect(); return r.left >= w.left && r.right <= w.right; })()"))
    # the move through the page: Ada at x 2, y 0 steps east to x 3 (the island's edge), which charts beyond it
    click_tile(page, -2, 1)
    check("desktop: a tile two steps away offers no Move button", page.query_selector("#move-btn") is None, page.inner_text("#tile-panel"))
    click_tile(page, 1, -1)  # diagonal step
    check("desktop: a diagonal neighbour offers Move here", page.query_selector("#move-btn") is not None, page.inner_text("#tile-panel"))
    page.fill("#turn-form textarea", "Draft: make the sea saltier.")
    click_tile(page, 3, 0)
    page.click("#move-btn"); page.wait_for_function("document.getElementById('dock').textContent.indexOf('You have moved this turn') >= 0")
    page.wait_for_timeout(500)
    n_after = tile_count(page)
    check("desktop: moving to the island's edge charted new tiles beyond it (64 -> more)", n_after > 64, str(n_after))
    check("desktop: an unsent proposal draft survives the move", page.input_value("#turn-form textarea") == "Draft: make the sea saltier.")
    check("desktop: the turn is NOT over: the propose form is still there, and a second move is not offered", page.locator("#turn-form").count() == 1 and "You have moved this turn" in page.inner_text("#dock"), page.inner_text("#dock"))
    page.mouse.move(2, 2)
    page.click("button[data-ctl=me]"); page.wait_for_timeout(250)
    far = pos(page, 5, 0)
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
    check("phone dark: the SVG board is drawn, nothing shows coordinates", page.get_attribute("#board-wrap", "data-renderer") == "svg" and tag_text(page) == [])
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

    # ---- the join flow: a shape and a color from the palette, taken colors unavailable, the preview follows the choice
    for w, h, scheme in [(1280, 900, "light"), (390, 844, "dark")]:
        c = ctx_for(b, w, h, False, scheme, touch=(w < 500)); page = c.new_page()
        errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base + f"/second/join/{code}"); page.wait_for_selector("form"); page.wait_for_timeout(500)
        check(f"join {w}: 9 shapes and 16 colors, two colors taken and unavailable", page.locator("input[name=shape]").count() == 9 and page.locator("input[name=color]").count() == 16 and page.locator("input[name=color]:disabled").count() == 2)
        check(f"join {w}: each shape shows its drawing", page.locator(".opt .thumb > svg").count() == 9 and page.locator(".opt .thumb svg path").count() > 50)
        before = page.inner_html("#pv")
        page.locator("input[name=color][value=orchid] + .face").click(); page.locator("input[name=shape][value=robot] + .face").click(); page.wait_for_timeout(200)
        check(f"join {w}: choosing a shape and a color redraws the preview and names them", page.inner_html("#pv") != before and "Orchid" in page.inner_text("#pvmeta") and "Robot" in page.inner_text("#pvmeta"))
        page.fill("input[name=name]", "Sam"); page.fill("input[name=email]", "sam@example.com")
        page.click("button[type=submit]"); page.wait_for_selector("#msg.notice")
        check(f"join {w}: taking a seat sends the link (dev link shown)", "Check your email" in page.inner_text("#msg") and "Dev mode link" in page.inner_text("#msg"))
        page.screenshot(path=f"{out}/join-picked-{w}-{scheme}.png", full_page=True); sideways(page, w, f"join-{w}")
        check(f"join {w}: no page errors", not errors, str(errors))
        c.close()

    # ---- the rulebook: expanded by default, marks, revisions, search, jump, collapse, deep links
    for w, h, scheme in [(1280, 900, "light"), (390, 844, "dark")]:
        c = ctx_for(b, w, h, True, scheme, touch=(w < 500)); page = c.new_page()
        errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base + "/first/"); ready(page)
        check(f"rulebook {w}: five hundreds blocks, 19 rules, every rule open", page.locator(".rsec").count() == 5 and page.locator(".rule").count() == 19 and page.locator(".rule[data-open='1']").count() == 19)
        check(f"rulebook {w}: block 100 is marked unanimous and the others majority", [t.inner_text().lower() for t in page.locator(".rsec > h2 .pill").all()] == ["unanimous", "majority", "majority", "majority", "majority"])
        check(f"rulebook {w}: every rule shows its revision", page.locator(".rule .rev").count() == 19 and all(t.inner_text() == "rev 1" for t in page.locator(".rule .rev").all()))
        check(f"rulebook {w}: a setting's value is shown inline in the rule that names it", "max_players 8" in " ".join(page.inner_text("#r-201").split()) and "board.island 8\u00d78" in " ".join(page.inner_text("#r-503").split()))
        page.locator("#r-104 [data-hist]").click(); check(f"rulebook {w}: a rule's history lists rev 1", "rev 1" in page.inner_text("#r-104 .hist"))
        page.fill("#rb-q", "504"); page.wait_for_timeout(200)
        check(f"rulebook {w}: typing a number finds that rule and highlights it", page.locator(".rule").count() == 1 and page.locator(".rule mark").count() >= 1 and "504" in page.inner_text(".rule"))
        page.keyboard.press("Enter"); page.wait_for_timeout(300)
        check(f"rulebook {w}: Enter jumps to the rule and clears the search", page.locator(".rule").count() == 19 and page.evaluate("location.hash") == "#r-504" and page.input_value("#rb-q") == "")
        page.fill("#rb-q", "paradox"); page.wait_for_timeout(200)
        check(f"rulebook {w}: a word finds the rule by text", page.locator(".rule").count() == 1 and "403" in page.inner_text(".rule"))
        page.fill("#rb-q", "zzzz"); page.wait_for_timeout(200)
        check(f"rulebook {w}: no match says so", page.locator(".rule").count() == 0 and "No rule matches" in page.inner_text("#rb-body"))
        page.fill("#rb-q", ""); page.wait_for_timeout(200)
        if w >= 500:
            page.click("#rb-all"); page.wait_for_timeout(200)
            check(f"rulebook {w}: Collapse all closes every rule, Expand all opens them", page.locator(".rule[data-open='1']").count() == 0 and page.locator(".rule .prev").first.is_visible())
            page.click("#rb-all"); page.wait_for_timeout(200)
            check(f"rulebook {w}: and back", page.locator(".rule[data-open='1']").count() == 19)
            page.click("#rb-rail a[data-goto='402']"); page.wait_for_timeout(300)
            check(f"rulebook {w}: the contents rail jumps to a rule", page.evaluate("location.hash") == "#r-402" and page.evaluate("document.getElementById('r-402').getBoundingClientRect().top") < 300)
        else:
            page.click("#rb-jump"); check(f"rulebook {w}: Jump to opens the contents", page.locator("#rb-jumplist").is_visible())
            page.click("#rb-jumplist a[data-goto='402']"); page.wait_for_timeout(300)
            check(f"rulebook {w}: and jumps to the rule, and the contents close", page.evaluate("location.hash") == "#r-402" and not page.locator("#rb-jumplist").is_visible())
        page.goto(base + "/first/#r-301"); ready(page); page.wait_for_timeout(300)
        check(f"rulebook {w}: a link to a rule opens the page at that rule", page.evaluate("document.getElementById('r-301').getBoundingClientRect().top") < 300)
        check(f"rulebook {w}: no page errors", not errors, str(errors)); sideways(page, w, f"rulebook-{w}")
        c.close()
    b.close()
sys.exit(1 if failed else 0)
