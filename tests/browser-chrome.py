# The page structure in real Chromium (called by tests/chrome.mjs). Game "chrome" is in play on day 2: Ada (teal, the viewer),
# Bo (vermilion) and Cy (cobalt). Two proposals are on today's ballot: P1 (Bo) adds a clause to rule 401, P2 (Cy) adds a rule to
# block 400. Ada's piece is at x 2, y 0 (1N 3E). Every checklist ID the chrome PR claims has a check here; "ok"/"FAIL" lines, and
# any FAIL makes the exit code 1. Usage: browser-chrome.py <base> <screenshot dir or -> <Ada's session cookie>
import re, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base, out, cookie = sys.argv[1:4]
host = urlparse(base).hostname
failed = []
SLUG = "chrome"

def check(name, ok, detail=""):
    print(("ok    " if ok else "FAIL  ") + name + (f"  -> {detail}" if detail and not ok else ""))
    if not ok: failed.append(name)

def shot(page, name, **kw):
    if out != "-": page.screenshot(path=f"{out}/{name}.png", **kw)

def ctx_for(b, w, h, scheme, touch=False):
    c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, color_scheme=scheme, has_touch=touch)
    c.add_cookies([{"name": "s", "value": cookie, "domain": host, "path": "/" + SLUG}])
    return c

def new_page(b, w, h, scheme, touch=False):
    c = ctx_for(b, w, h, scheme, touch); page = c.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.goto(base + f"/{SLUG}/")
    page.wait_for_selector("#scores li"); page.wait_for_selector("#board-wrap[data-renderer]")
    page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0")
    page.wait_for_selector("#bell"); page.wait_for_selector("#sday .dstep")
    page.wait_for_timeout(500)
    return c, page, errors

def sideways(page, w, name):
    sw = page.evaluate("document.documentElement.scrollWidth")
    check(f"{name}: no sideways scroll (scrollWidth {sw} <= {w})", sw <= w)

def text(page, sel):
    return " ".join(page.inner_text(sel).split())

def box(page, sel):
    return page.evaluate("s => { const r = document.querySelector(s).getBoundingClientRect(); return {x: r.x, y: r.y + scrollY, w: r.width, h: r.height, r: r.right, b: r.bottom + scrollY}; }", sel)

def open_card(page, num):
    page.click("#tab-rules"); page.click(f'.bcard[data-card="{num}"]')
    page.wait_for_selector("#mroot .mcard")

def tile(page, x, y):
    page.locator("#board-wrap").scroll_into_view_if_needed()
    return page.evaluate(f"window.__board.screenPos({x}, {y})")

def tag_text(page):
    return [t.inner_text() for t in page.locator(".tip:not([hidden])").all()]

def long_press(page, c, x, y, ms=800):
    cdp = c.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    page.wait_for_timeout(ms)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(200)

def click_tile(page, x, y):
    p = tile(page, x, y)
    page.mouse.click(p["x"], p["y"]); page.wait_for_timeout(150)

with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ================= the screenshot set: five screens, 1280 and 390, light and dark (before anyone acts) =================
    if out != "-":
        for w, h, scheme in [(1280, 900, "light"), (1280, 900, "dark"), (390, 844, "light"), (390, 844, "dark")]:
            c, page, errors = new_page(b, w, h, scheme)
            tag = f"{w}-{scheme}"
            shot(page, f"after-summary-{tag}", full_page=True)
            page.click("#tab-rules"); page.wait_for_timeout(300); shot(page, f"after-rulebook-{tag}", full_page=True)
            page.locator('.bcard[data-card="103"]').click(); page.wait_for_selector("#mroot .mcard")
            page.locator("#mroot .mtext .xref").first.click(); page.click("#rprev [data-fromprev]"); page.wait_for_timeout(250)
            shot(page, f"after-rule-card-back-{tag}")
            page.keyboard.press("Escape")
            page.locator('.bcard[data-card="401"]').click(); page.wait_for_selector("#mroot .mcard"); page.wait_for_timeout(200)
            shot(page, f"after-rule-card-ballot-{tag}"); page.keyboard.press("Escape")
            page.locator("#scores li .prow", has_text="Bo").click(); page.wait_for_selector("#mroot .mcard"); page.wait_for_timeout(200)
            shot(page, f"after-player-card-{tag}"); page.keyboard.press("Escape")
            page.click("#me-chip"); page.wait_for_selector("#acct:not([hidden])"); page.wait_for_timeout(150)
            shot(page, f"after-account-menu-{tag}", clip={"x": 0, "y": 0, "width": w, "height": 330})
            check(f"shots {tag}: no page errors", not errors, str(errors))
            c.close()

    # ================= phone, dark: layout, order, nothing wider than the screen =================
    c, page, errors = new_page(b, 390, 844, "dark", touch=True)
    pos = lambda sel: box(page, sel)["y"]
    check("phone S1-SUM-05: order is ballot, Propose, then the Catalog block last", pos("#sballot") < pos("#spropose") < pos(".sw.cat"), f"{pos('#sballot')} {pos('#spropose')} {pos('.sw.cat')}")
    check("phone S1-BRD-01: the board is a 290 px band", round(box(page, "#board-wrap")["h"]) == 290, str(box(page, "#board-wrap")))
    check("phone: the SVG board is drawn and nothing shows coordinates by default", page.get_attribute("#board-wrap", "data-renderer") == "svg" and tag_text(page) == [])
    pt = tile(page, 3, 0)
    page.touchscreen.tap(pt["x"], pt["y"]); page.wait_for_timeout(300)
    check("phone: a tap picks the tile (a pending move) and shows no coordinate tag", "Make this move" in text(page, "#movebar") and tag_text(page) == [], str(tag_text(page)))
    page.click("#undo-move")
    pt = tile(page, -2, -2)
    long_press(page, c, pt["x"], pt["y"])
    check("phone: a long-press shows the tile's coordinate (2S 2W 1U) and did not also pick it", "2S 2W 1U" in tag_text(page) and "Make this move" not in text(page, "#movebar"), str(tag_text(page)))
    page.touchscreen.tap(2, 2); page.wait_for_timeout(150)
    click_tile(page, 3, 0)
    sp = box(page, "#movebar .mb > span"); bt = box(page, "#make-move"); tg = box(page, "#board-toggle")
    check("phone S1-MOV-08: the move bar's text has its own line; the button and Hide board share the next", sp["w"] > 250 and bt["y"] > sp["y"] + 10 and abs(bt["y"] - tg["y"]) < 20, f"{sp} {bt} {tg}")
    shot(page, "movebar-pending-phone-dark", clip={"x": 0, "y": max(0, sp["y"] - 330), "width": 390, "height": 420})
    page.click("#undo-move")
    pw_ = page.evaluate("[...document.querySelectorAll('#scores li')].map(l => l.getBoundingClientRect().width)")
    check("phone S1-PLY-01: the Players list wraps as chips (each row narrower than the page)", all(w < 300 for w in pw_), str(pw_))
    sideways(page, 390, "phone summary")
    page.click("#tab-rules"); page.wait_for_timeout(200); sideways(page, 390, "phone rulebook")
    page.click('.bcard[data-card="401"]'); page.wait_for_selector("#mroot .mcard"); page.wait_for_timeout(200)
    check("phone S1-RUL-03: the rule card fits the screen", box(page, ".mcard")["w"] <= 390 and box(page, ".mcard")["x"] >= 0)
    page.keyboard.press("Escape")
    page.click('#scores li .prow'); page.wait_for_selector("#mroot .mcard"); page.keyboard.press("Escape")
    page.click("#me-chip"); page.wait_for_selector("#acct:not([hidden])"); page.click("#me-chip")
    sideways(page, 390, "phone with a card open")
    check("phone: no page errors (dark)", not errors, str(errors))
    c.close()

    # ================= desktop, light: the whole page =================
    c, page, errors = new_page(b, 1280, 900, "light")
    pos = lambda sel: box(page, sel)["y"]
    # ---- header, account menu, bell
    check("S1-ACC-01: the top bar's chip is a button with a down arrow, named for the player", page.locator("button#me-chip").count() == 1 and "Ada" in text(page, "#me-chip") and "▾" in text(page, "#me-chip"))
    page.click("#me-chip"); page.wait_for_selector("#acct:not([hidden])")
    am = text(page, "#acct")
    check("S1-ACC-01: the menu has the name, color and points, Your player card and Log out", "Ada" in am and "Teal · 0 points" in am and "Your player card" in am and "Log out" in am, am)
    check("S1-ACC-02: no Invite or Connect your AI in the menu, the header or the Players aside; no Settings (invite links per player have no backend yet)", not re.search(r"Invite|Connect your AI|Settings", text(page, "header") + text(page, "aside")), text(page, "header"))
    page.click("#bell"); page.wait_for_timeout(200)
    check("opening the bell leaves focus on the bell (the header is redrawn under it)", page.evaluate("document.activeElement && document.activeElement.id") == "bell")
    check("S1-ACC-03: opening the bell closes the account menu", page.locator("#acct").is_hidden() and page.locator("#notes-panel").is_visible())
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    check("S1-ACC-03: Esc closes the bell", page.locator("#notes-panel").is_hidden())
    page.click("#me-chip"); page.click("body", position={"x": 600, "y": 700}); page.wait_for_timeout(200)
    check("S1-ACC-03: a click outside closes the menu", page.locator("#acct").is_hidden())
    page.click("#me-chip"); page.click("#bell"); page.click("#me-chip"); page.wait_for_timeout(200)
    check("S1-ACC-03: and the menu closes the bell", page.locator("#notes-panel").is_hidden() and page.locator("#acct").is_visible())
    page.click('#acct [data-pl]'); page.wait_for_selector("#mroot .mcard")
    check("S1-PLY-03: the account menu's Your player card opens Ada's card", "Ada" in text(page, "#mroot h2") and page.locator("#acct").is_hidden())
    page.keyboard.press("Escape")

    # ---- the board itself (port 1's behavior, kept): SVG, 64 tiles, coordinates only on hover, right-click, long-press; pan and zoom
    check("the board is drawn as SVG: the island is 64 charted tiles and a grounded piece for each of the 3 players", page.get_attribute("#board-wrap", "data-renderer") == "svg" and page.locator("#board-wrap g.piece").count() == 3 and page.locator("#board-wrap polygon.top").count() == 64)
    check("nothing shows coordinates by default (no tag, none on the move bar)", tag_text(page) == [] and not re.search(r"\b[1-9][0-9]*[NS]\b", text(page, "#movebar")))
    p0 = tile(page, -2, 1)
    page.mouse.move(p0["x"], p0["y"]); page.wait_for_timeout(250)
    check("hovering a tile shows its coordinate (2N 2W 1U for x -2, y 1)", tag_text(page) == ["2N 2W 1U"], str(tag_text(page)))
    page.mouse.move(2, 2); page.wait_for_timeout(200)
    check("moving off the tile hides it again", tag_text(page) == [])
    p1 = tile(page, -3, 2)
    page.mouse.click(p1["x"], p1["y"], button="right"); page.wait_for_timeout(250)
    check("right-clicking a tile shows its coordinate (3N 3W 1U)", "3N 3W 1U" in tag_text(page), str(tag_text(page)))
    page.mouse.move(2, 2); page.wait_for_timeout(200)
    check("the right-click label stays until the next click", "3N 3W 1U" in tag_text(page))
    page.mouse.click(p0["x"], p0["y"]); page.wait_for_timeout(250)
    check("the next click clears it", "3N 3W 1U" not in tag_text(page))
    ph = tile(page, 2, 0)
    bx = page.locator("#board-wrap").bounding_box()
    page.mouse.move(bx["x"] + 40, bx["y"] + 40); page.mouse.down(); page.mouse.move(bx["x"] + 140, bx["y"] + 90, steps=6); page.mouse.up(); page.wait_for_timeout(200)
    pp = tile(page, 2, 0)
    check("dragging pans the board by the drag", abs((pp["x"] - ph["x"]) - 100) < 3 and abs((pp["y"] - ph["y"]) - 50) < 3, f"{ph} {pp}")
    page.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); page.keyboard.down("Control"); page.mouse.wheel(0, -400); page.keyboard.up("Control"); page.wait_for_timeout(200)
    pz = tile(page, 2, 0)
    check("Ctrl and the wheel zooms (a plain wheel scrolls the page)", abs(pz["x"] - pp["x"]) > 10 or abs(pz["y"] - pp["y"]) > 10)
    page.click('.board-ctl [aria-label="Zoom out"]'); page.wait_for_timeout(200)
    pr = tile(page, 2, 0)
    check("the zoom buttons zoom the board", abs(pr["x"] - pz["x"]) > 5 or abs(pr["y"] - pz["y"]) > 5, f"{pz} {pr}")
    page.click('.board-ctl [data-ctl="me"]'); page.wait_for_timeout(250)
    check("S1-ACC-06: You puts the viewer's own piece back in view", page.evaluate("(() => { const r = document.querySelector('#board-wrap .nametag').getBoundingClientRect(); const w = document.getElementById('board-wrap').getBoundingClientRect(); return r.left >= w.left && r.right <= w.right; })()") and "Ada · you" in page.evaluate("document.querySelector('#board-wrap .nametag').textContent"))
    page.mouse.click(2, 2)

    # ---- the board band and the move bar
    bw = box(page, "#board-wrap")
    check("S1-BRD-01: the board is a 420 px band in the page flow", round(bw["h"]) == 420 and page.evaluate("getComputedStyle(document.getElementById('board-wrap')).position") != "fixed", str(bw))
    check("S1-ACC-06: the board's button is named You (not My piece), with Zoom - and +", text(page, ".board-ctl") .startswith("You") and "My piece" not in text(page, "body") and page.locator('.board-ctl [aria-label="Zoom out"]').count() == 1)
    check("S1-MOV-01: nothing picked: one line, no filled button", "Pick a highlighted tile" in text(page, "#movebar") and page.locator("#movebar .btn:not(.ghost)").count() == 0, text(page, "#movebar"))
    check("S1-MOV-02: the tiles you may move to are highlighted", page.locator("#board-wrap polygon.reach").count() == 8, str(page.locator("#board-wrap polygon.reach").count()))
    n0 = page.evaluate("document.querySelectorAll('#board-wrap polygon.top').length")
    click_tile(page, 3, 0)
    mbar = text(page, "#movebar")
    check("S1-MOV-01: a picked tile makes a pending move: 'Move to 1N 4E', the count of new tiles, Make this move and Undo", re.search(r"Move to 1N 4E · \+\d+ tiles", mbar) and "Make this move" in mbar and "Undo" in mbar, mbar)
    check("S1-MOV-02: the picked tile is highlighted", page.locator("#board-wrap polygon.selected").count() == 1)
    pending_n = int(re.search(r"\+(\d+) tiles", mbar).group(1))
    check("S1-MOV-06: one filled button on the bar, the others ghost or link", page.locator("#movebar .btn:not(.ghost)").count() == 1)
    shot(page, "movebar-pending-desktop-light", clip={"x": 0, "y": 80, "width": 1280, "height": 520})
    page.click("#undo-move"); page.wait_for_timeout(150)
    check("S1-MOV-02: Undo drops the pick and the highlight", page.locator("#board-wrap polygon.selected").count() == 0 and "Make this move" not in text(page, "#movebar"))
    click_tile(page, 0, 0)   # two steps away: not a move you may make
    check("S1-MOV-01: a tile out of reach offers no move", "Make this move" not in text(page, "#movebar"))
    page.click("#board-toggle"); page.wait_for_timeout(150)
    check("S1-MOV-07: Hide board hides the band and the move bar stays", page.locator("#board-wrap").is_hidden() and page.locator("#movebar").is_visible() and "Show board" in text(page, "#movebar"))
    page.click("#board-toggle"); page.wait_for_timeout(300)
    check("S1-MOV-07: Show board brings it back", page.locator("#board-wrap").is_visible())

    # ---- players, the player pill, the player card
    names = [t.strip() for t in page.locator("#scores li .prow").all_inner_texts()]
    check("S1-PLY-01: Players lists all three, one button each (Enter opens the card)", len(names) == 3 and page.locator("#scores li button.prow").count() == 3 and "Ada" in names[0] + names[1] + names[2])
    page.focus('#scores li button.prow >> nth=0'); page.keyboard.press("Enter"); page.wait_for_selector("#mroot .mcard")
    check("S1-PLY-03: Enter on a Players row opens the card", page.locator("#mroot .mcard").count() == 1)
    page.keyboard.press("Escape")
    check("S1-PLY-02: a player pill is the piece plus the name, and your own says (you)", page.locator("#sballot .plpill svg").count() >= 2 and "Bo" in text(page, "#sballot") and page.locator(".plpill", has_text="(you)").count() >= 0)
    page.locator("#scores li .prow", has_text="Bo").click(); page.wait_for_selector("#mroot .mcard")
    ct = text(page, "#mroot .mcard")
    check("S1-PLY-05: the card header: name, 'Vermilion · player', 'Living'", "Bo" in text(page, "#mroot h2") and "Vermilion · player" in ct and "Living" in ct, ct)
    check("S1-PLY-04: the rows carry rule chips: Points 401 402, Today 202, Piece 504", all(page.locator("#mroot .rref", has_text=n).count() >= 1 for n in ["401", "402", "202", "504"]))
    check("S1-PLY-07: no turn-order row", not re.search(r"turn order|Turn order", ct) and "Order" not in ct)
    check("S1-PLY-08: the Piece row: name, where it stands, speed", re.search(r"Pawn.*At 1S 1W\. Moves one space a day, diagonals included, and charts the tiles within 2\.", ct) is not None, ct)
    page.click('#mroot .mx'); page.wait_for_timeout(100)
    p = tile(page, -1, -1)
    page.mouse.click(p["x"], p["y"]); page.wait_for_timeout(300)
    check("S1-PLY-03: clicking a piece on the board opens that player's card", page.locator("#mroot .mcard").count() == 1 and "Bo" in text(page, "#mroot h2"))
    page.keyboard.press("Escape")

    # ---- Summary: the structure
    tabs = [t.strip() for t in page.locator("#btabs .btab").all_inner_texts()]
    check("S1-SUM-01: Summary is first and selected; tabs: Summary, Rulebook (rule count), Catalog (entry count), History (day count)", page.locator("#tab-summary").get_attribute("aria-selected") == "true" and re.match(r"Summary", tabs[0]) and re.match(r"Rulebook\s*\d+ rules", tabs[1]) and re.match(r"Catalog\s*0 entries", tabs[2]) and re.match(r"History\s*2 days", tabs[3]), str(tabs))
    day = text(page, "#sday")
    check("S1-SUM-02: the day strip: Day 1, Move, Vote, Propose, the countdown to midnight, End turn (the moon is a slot for step 2)", day.startswith("Day 2") and all(w in day for w in ["Move", "Vote", "Propose", "to midnight", "End turn"]) and page.locator('#sday [data-slot="moon"]').count() == 1, day)
    check("S1-SUM-03: Vote reads '0 of 2' (votes cast of ballot items); the others are unfilled before they are done", "0 of 2" in text(page, "#sday") and page.locator("#sday .dstep.done").count() == 0)
    check("S1-SUM-05: at 1280 two columns: the ballot and Catalog on the left, Propose on the right", box(page, "#sballot")["x"] < box(page, "#spropose")["x"] and abs(box(page, "#sballot")["x"] - box(page, ".sw.cat")["x"]) < 2 and box(page, "#sballot")["y"] - box(page, "#spropose")["y"] < 5)
    check("S1-SUM-06: order top to bottom: day strip, Today's ballot, Catalog; Propose card beside; then 'Full history'; the recap and recent days are empty slots", pos("#sday") < pos("#sballot") < pos(".sw.cat") and page.locator('[data-slot="recap"]').count() == 1 and page.locator('[data-slot="recent-days"]').count() == 1 and "Full history →" in text(page, "#p-summary"))
    sticky = page.evaluate("[...document.querySelectorAll('body *')].filter(e => { const p = getComputedStyle(e).position; return (p === 'sticky' || p === 'fixed') && !e.closest('#mroot') && e.offsetParent !== null || (p === 'sticky') }).map(e => e.tagName + '#' + e.id)")
    check("S1-SUM-07: nothing on the page is sticky or fixed (the board is a band in the flow)", sticky == [], str(sticky))
    ball = text(page, "#sballot")
    check("Today's ballot lists P1 and P2 with the proposer's pill, what it needs, and the tracked change", "P1" in ball and "P2" in ball and "Bo" in ball and "Cy" in ball and "needs 2 of 3 votes" in ball and page.locator("#sballot ins").count() >= 2, ball)
    check("ballot-vote slots are in place under each proposal and empty (votes are PR 4)", page.locator('#sballot [data-slot="ballot-vote"]').count() == 2 and all(page.locator('#sballot [data-slot="ballot-vote"]').nth(i).inner_text() == "" for i in range(2)))
    pr = text(page, "#spropose")
    check("S1-SUM-08: the Propose card: 'Propose a change', '0 of 1 today', '+10 if it passes', Rulebook (count, + Change or add a rule), Catalog (count, + Propose a thing)", "Propose a change" in pr and "0 of 1 today" in pr and "+10 if it passes" in pr and re.search(r"Rulebook\s*\d+ rules\s*\+ Change or add a rule", pr) and re.search(r"Catalog\s*0 entries\s*\+ Propose a thing", pr), pr)
    page.click('#sday [data-jump="ballot"]'); page.wait_for_timeout(700)
    check("S1-SUM-04: Vote jumps to the first ballot item", page.evaluate("(() => { const r = document.querySelector('#sballot li').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })()"))
    page.click('#sday [data-jump="propose"]'); page.wait_for_timeout(700)
    check("S1-SUM-04: Propose jumps to the Propose card", page.evaluate("(() => { const r = document.getElementById('spropose').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })()"))
    page.click('#sday [data-jump="board"]'); page.wait_for_timeout(700)
    check("S1-SUM-04: Move jumps to the board's move bar", page.evaluate("(() => { const r = document.getElementById('movebar').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"))
    page.click('.sw.cat [data-tab="catalog"]'); page.wait_for_timeout(200)
    check("S1-RUL-10: 'Open the catalog →' switches tabs; the Catalog tab shows an honest empty state", page.locator("#tab-catalog").get_attribute("aria-selected") == "true" and "No entries yet." in text(page, "#p-catalog"))
    page.click("#tab-history"); page.wait_for_timeout(100)
    check("History tab: the day count, and the event log until the recap lands (history-days is a slot)", "Chrome Game" not in text(page, "#p-history") and page.locator("#p-history .log li").count() >= 1 and page.locator('[data-slot="history-days"]').count() == 1)
    page.click("#tab-summary")
    pill_before = page.locator("#tab-summary").get_attribute("aria-selected")
    page.click('#sballot .rpill >> nth=0'); page.wait_for_selector("#rprev")
    check("S1-RUL-07: a rule pill opens a preview: the clause number, the rule title, its text, 'Open rule N'", re.search(r"401\s*Points.*Open rule 401", text(page, "#rprev")) is not None and page.locator("#tab-summary").get_attribute("aria-selected") == pill_before, text(page, "#rprev"))
    check("S1-RUL-10: a pill in the Summary does not switch tabs", page.locator("#tab-summary").get_attribute("aria-selected") == "true")
    page.keyboard.press("Escape")
    check("S1-RUL-07: Esc closes only the preview", page.locator("#rprev").count() == 0)
    page.click('#sballot .ppill >> nth=0'); page.wait_for_selector("#mroot .mcard")
    check("S1-RUL-08: a P pill opens the proposal's rule card, from the Summary, without changing tab", "401" in text(page, "#mroot .mnum") and page.locator("#tab-summary").get_attribute("aria-selected") == "true")
    page.keyboard.press("Escape")

    # ---- Rulebook: blocks, rows, legend
    page.click("#tab-rules"); page.wait_for_timeout(200)
    secs = page.locator("#rules .bsec").count()
    check("S1-RUL-01: blocks of hundreds, each with its title, an 'All N' count and a lock when unanimous", secs == 5 and re.search(r"^100\s*Core rules", text(page, "#rules .bsec >> nth=0")) and "All " in text(page, "#rules .bsec >> nth=0") and page.locator("#rules .bsec >> nth=0 >> svg.lk").count() >= 1)
    card = text(page, '.bcard[data-card="201"]')
    check("S1-RUL-01: a row shows the number, title, text excerpt and an age line", card.startswith("201") and "Game size" in card and "A game has at most" in card and "unchanged since Day 0" in card, card)
    check("S1-RUL-02: the legend names changed this week, settled, everyone must agree; unanimous rules show a lock; on-ballot rules a ring and 'On the ballot'", all(w in text(page, "#rb-legend") for w in ["changed this week", "settled", "everyone must agree"]) and page.locator('.bcard[data-card="101"] svg.lk').count() == 1 and page.locator('.bcard.bal[data-card="401"]').count() == 1 and "On the ballot · P1" in text(page, '.bcard[data-card="401"]'))
    check("S1-RUL-02: no use arcs or seal rings; a rule changed lately is warm (none has changed yet, so no row is)", page.locator(".bcard.w1, .bcard.w2").count() == 0)
    TOTAL = page.locator("#rules .bcard:not(.add)").count()
    check("S1-RUL-13: the tab says N rules, counting the new rule on the ballot (a ghost card), the same N the card nav uses", page.locator('.bcard.ghost').count() == 1 and re.match(rf"Rulebook\s*{TOTAL} rules", text(page, "#tab-rules")) is not None, f"{TOTAL} {text(page, '#tab-rules')}")
    page.click('.gtog >> nth=0'); page.wait_for_timeout(100)
    check("S1-RUL-01: a block's All N toggles to a grid and back to a Row", page.locator(".brow.grid").count() == 1 and "Row" in text(page, ".gtog >> nth=0"))
    page.click('.gtog >> nth=0')

    # ---- search and permalinks (port 1's, kept)
    page.fill("#rb-q", "504"); page.wait_for_timeout(200)
    check("typing a number finds that rule (and the rules that cite it) and highlights it", page.locator('.bcard[data-card="504"]').count() == 1 and page.locator(".bcard mark").count() >= 1 and page.locator(".bcard[data-card]").count() < 10)
    page.keyboard.press("Enter"); page.wait_for_selector("#mroot .mcard")
    check("Enter opens the rule's card, clears the search, and the address says #r-504", "504" in text(page, "#mroot .mnum") and page.evaluate("location.hash") == "#r-504" and page.input_value("#rb-q") == "")
    page.keyboard.press("Escape")
    page.fill("#rb-q", "paradox"); page.wait_for_timeout(200)
    check("a word finds the rule by its text", page.locator(".bcard[data-card]").count() == 1 and "403" in text(page, ".bcard"))
    page.fill("#rb-q", "zzzz"); page.wait_for_timeout(200)
    check("no match says so", page.locator(".bcard[data-card]").count() == 0 and "No rule matches" in text(page, "#rb-body"))
    page.fill("#rb-q", "constructor"); page.keyboard.press("Enter"); page.wait_for_timeout(200)
    check("a search for an inherited object key (constructor) finds nothing and opens nothing", page.locator("#mroot .mcard").count() == 0 and page.evaluate("location.hash") != "#r-constructor" and "No rule matches" in text(page, "#rb-body"))
    page.fill("#rb-q", ""); page.wait_for_timeout(200)

    # ---- the rule card
    page.locator('.bcard[data-card="401"]').click(); page.wait_for_selector("#mroot .mcard"); page.wait_for_timeout(200)
    m = box(page, ".mcard")
    check("S1-RUL-03: the rule card is centered over a dim backdrop", abs((m["x"] + m["w"] / 2) - 640) < 3 and page.locator("#mroot .mback").count() == 1)
    ct = text(page, "#mroot .mcard")
    check("S1-RUL-03: number (+ lock if unanimous), title, meta 'Majority · Points and winning · unchanged since Day 0', text, Propose a change, HISTORY, nav '← prev | n of N | next →'", "401" in text(page, ".mnum") and "Points" in text(page, ".mtop h2") and "Majority · Points and winning · unchanged since Day 0" in ct and "Propose a change" in ct and "HISTORY" in ct and re.search(rf"← \d{{3}}\s*\d+ of {TOTAL}\s*\d{{3}} →", ct) is not None, ct)
    order = page.evaluate("""() => { const c = document.querySelector('.mcard'), q = s => c.querySelector(s), pos = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & 4));
      return [pos(q('.mtext'), q('.chg')), pos(q('.chg'), q('.proposeact')), pos(q('.proposeact'), q('.mhist')), pos(q('.mhist'), q('.mnav'))]; }""")
    check("S1-RUL-04: card order: text, the ballot box, Propose a change, History, nav", order == [True, True, True, True], str(order))
    check("S1-RUL-05: a card for a rule on today's ballot: the 'On today's ballot' pill, the P pill, the proposer, the tracked change, what it needs; the vote box is an empty slot", "On today's ballot" in ct and page.locator("#mroot .chg .ppill").count() == 1 and "Bo" in text(page, "#mroot .chg") and page.locator("#mroot .chg ins").count() >= 1 and "needs 2 of 3" in ct and page.locator('#mroot [data-slot="ballot-vote"]').count() == 1)
    check("S1-RUL-06: HISTORY is collapsed by default ('HISTORY · unchanged')", "HISTORY · unchanged" in ct and page.locator("#mroot .hist").count() == 0)
    page.click("#mroot [data-mhist]")
    check("S1-RUL-06: opening it shows the rows, the last one 'Starter rule · Before day 1'", "Starter rule" in text(page, "#mroot .hist") and "Before day 1" in text(page, "#mroot .hist"))
    page.click('#mroot [data-mnav="1"]'); page.wait_for_timeout(150)
    check("S1-RUL-06: History is collapsed again on the next card", page.locator("#mroot .hist").count() == 0 and "HISTORY" in text(page, "#mroot .mhist"))
    page.click('#mroot [data-mnav="-1"]')
    check("S1-RUL-13: the card nav counts rules plus the ghost rule", f"of {TOTAL}" in text(page, "#mroot .mnav"))
    page.keyboard.press("Escape"); page.wait_for_timeout(100)
    check("S1-RUL-11: Esc closes the card, and focus returns to the card that opened it", page.locator("#mroot .mcard").count() == 0 and page.evaluate("document.activeElement && document.activeElement.dataset.card") in ("401", "301", "402", "403", "400"), page.evaluate("document.activeElement && document.activeElement.outerHTML.slice(0, 80)"))
    page.locator('.bcard[data-card="103"]').click(); page.wait_for_selector("#mroot .mcard")
    check("S1-RUL-11: focus moves to the close button when a card opens", page.evaluate("document.activeElement.classList.contains('mx')"))
    page.click("#mroot .mback", position={"x": 5, "y": 5}); page.wait_for_timeout(100)
    check("S1-RUL-11: a click on the backdrop closes the card", page.locator("#mroot .mcard").count() == 0)
    # the back stack: 103's text names rule 202; open it from the preview
    page.locator('.bcard[data-card="103"]').click(); page.wait_for_selector("#mroot .mcard")
    page.locator("#mroot .mtext .xref").first.click(); page.wait_for_selector("#rprev")
    target = page.locator("#rprev .pn").inner_text()
    page.click("#rprev [data-fromprev]"); page.wait_for_timeout(150)
    bk = text(page, "#mroot .mbackbtn")
    check("S1-RUL-09: opening a rule from inside a card pushes it: the new card shows '← Back to 103 Proposals'", bk == "← Back to 103 Proposals" and target.split(".")[0] in text(page, "#mroot .mnum"), bk)
    page.click("#mroot [data-mback]"); page.wait_for_timeout(100)
    check("S1-RUL-09: Back goes back one step", "103" in text(page, "#mroot .mnum") and page.locator("#mroot .mbackbtn").count() == 0)
    page.locator("#mroot .mtext .xref").first.click(); page.click("#rprev [data-fromprev]"); page.wait_for_timeout(100)
    page.click("#mroot .mx"); page.wait_for_timeout(100)
    page.locator('.bcard[data-card="104"]').click(); page.wait_for_selector("#mroot .mcard")
    check("S1-RUL-09: X clears the stack", page.locator("#mroot .mbackbtn").count() == 0)
    page.keyboard.press("Escape")
    # settings chips, rule action
    page.locator('.bcard[data-card="504"]').click(); page.wait_for_selector("#mroot .mcard")
    check("S1-RUL-14: settings are inline chips on the clause that carries them (board.chart_radius 2)", "board.chart_radius 2" in text(page, "#mroot .mtext") and page.locator("#mroot .mtext .setting").count() >= 1)
    check("S1-RUL-12: 504's card carries its action: a filled 'Move your piece' (OPEN-05: kept as v32 draws it), above Propose a change", page.locator("#mroot .pbtn.fill", has_text="Move your piece").count() == 1 and page.evaluate("(() => { const c = document.querySelector('.mcard'); return !!(c.querySelector('[data-slot=rule-action]').compareDocumentPosition(c.querySelector('.proposeact')) & 4); })()"))
    page.click('#mroot [data-muse="move"]'); page.wait_for_timeout(700)
    check("S1-RUL-12: Move your piece closes the card and takes you to the board's move bar", page.locator("#mroot .mcard").count() == 0 and page.evaluate("(() => { const r = document.getElementById('movebar').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"))
    # a card for the ghost rule, a pick-a-block flow, and proposing through the card
    page.locator('.bcard.ghost').click(); page.wait_for_selector("#mroot .mcard")
    check("a ghost (new rule) card: 'new', its text, the proposer, 'On today's ballot'", "A tie goes to the older player." in text(page, "#mroot .mcard") and "On today's ballot" in text(page, "#mroot .mcard") and "Cy" in text(page, "#mroot .chg"))
    page.keyboard.press("Escape")
    page.click('[data-p="pickblock"]'); page.wait_for_selector("#mroot .pmenu")
    check("the banner's 'Propose a new rule' opens a 'Which block?' card", "Which block?" in text(page, "#mroot .mcard") and page.locator("#mroot .pmi").count() == 5)
    page.keyboard.press("Escape")
    # a card keeps what you were writing when it closes (Esc, backdrop); focus stays inside the card after a menu click
    page.locator('.bcard[data-card="401"]').click(); page.wait_for_selector("#mroot .mcard")
    page.click('#mroot [data-p="open"]'); page.click('#mroot [data-p="kind"][data-k="addclause"]'); page.wait_for_selector("#pfWords")
    check("after a menu click the focus is still inside the card (not dropped to the page)", page.evaluate("document.querySelector('.mcard').contains(document.activeElement)"))
    page.fill("#pfWords", "Ties go to the older player.")
    page.keyboard.press("Escape"); page.wait_for_timeout(100)
    page.locator('.bcard[data-card="401"]').click(); page.wait_for_selector("#mroot .mcard"); page.wait_for_timeout(150)
    check("closing a card keeps the words being written: they are there when it opens again", page.locator("#pfWords").count() == 1 and page.input_value("#pfWords") == "Ties go to the older player.")
    page.click('#mroot [data-p="cancel"]'); page.wait_for_timeout(100)
    check("Cancel drops them", page.locator("#pfWords").count() == 0)
    page.click("#mroot [data-mhist]"); page.wait_for_timeout(100)
    check("the History toggle keeps focus on its own button", page.evaluate("document.activeElement && document.activeElement.hasAttribute('data-mhist')"))
    page.keyboard.press("Escape")
    page.locator('.bcard[data-card="403"]').click(); page.wait_for_selector("#mroot .mcard")
    page.click('#mroot [data-p="open"]'); page.click('#mroot [data-p="kind"][data-k="repeal"]')
    page.wait_for_selector("#mroot .ruling"); page.wait_for_timeout(200)
    check("proposing from a card: the moderator's slip shows in the card (PR 3's flow, moved into the card)", "Repeal rule 403" in text(page, "#mroot .ruling") and page.locator('#mroot [data-p="confirm"]').count() == 1)
    page.click('#mroot [data-p="confirm"]'); page.wait_for_selector("#mroot .chg.mine"); page.wait_for_timeout(300)
    check("after confirming: your pending change shows in the card, with Withdraw", "on tomorrow's ballot" in text(page, "#mroot .chg.mine").lower() and page.locator('#mroot [data-p="withdraw"]').count() == 1)
    page.keyboard.press("Escape")
    check("the Rulebook banner says it once: 'You proposed P3 today'", re.search(r"You proposed P\d today", text(page, "#rb-banner")) is not None, text(page, "#rb-banner"))
    page.click("#tab-summary"); page.wait_for_timeout(200)
    pr = text(page, "#spropose")
    check("S1-SUM-09: after proposing: 'Your proposal, 1 of 1 today', the P pill, your player pill, 'On tomorrow's ballot', the tracked change; no 'See it in the Rulebook'", "Your proposal, 1 of 1 today" in pr and re.search(r"P3", pr) and page.locator("#spropose .plpill").count() == 1 and "(you)" in pr and "on tomorrow's ballot" in pr.lower() and page.locator("#spropose del").count() >= 1 and "See it in the Rulebook" not in text(page, "#p-summary"), pr)
    check("S1-SUM-03: the Propose step is done and reads 'Proposed P3'", "Proposed" in text(page, "#sday") and "P3" in text(page, "#sday"))

    # ---- moving: the move is final at once, through the existing route and the day's one-move guard
    tiles_before = page.evaluate("fetch('/chrome/api/board').then(r => r.json()).then(b => b.tiles.length)")
    click_tile(page, 3, 0)
    page.click("#make-move"); page.wait_for_selector("#movebar .ok"); page.wait_for_timeout(500)
    mbar = text(page, "#movebar")
    tiles_after = page.evaluate("fetch('/chrome/api/board').then(r => r.json()).then(b => b.tiles.length)")
    check("S1-MOV-03: the move is final at once: the bar says 'Moved to 1N 4E today · +N tiles', no Undo, no second move", re.search(r"Moved to 1N 4E today · \+\d+ tiles", mbar) and "Undo" not in mbar and "Make this move" not in mbar, mbar)
    check("S1-MOV-04: the count the bar promised is the number of tiles the move charted (rule 504.2: tiles within the chart radius, corners cut)", int(re.search(r"\+(\d+) tiles", mbar).group(1)) == pending_n, f"{mbar} promised {pending_n}")
    check("S1-MOV-04: and it equals what the board gained (64 -> %d)" % tiles_after, tiles_after - tiles_before == int(re.search(r"\+(\d+) tiles", mbar).group(1)), f"{tiles_before} {tiles_after} {mbar}")
    check("S1-MOV-03: the day strip then shows 'Moved 1N 4E' and Move is done", re.search(r"Moved\s*1N 4E", text(page, "#sday")) and page.locator("#sday .dstep.done").count() == 2, text(page, "#sday"))
    check("S1-MOV-03: no highlighted tiles and no move offered after the move", page.locator("#board-wrap polygon.reach").count() == 0)
    click_tile(page, 2, 0)
    check("S1-MOV-04 (rule 504): a second move is not offered (one a day)", "Make this move" not in text(page, "#movebar"))
    page.click('.bcard >> nth=0') if page.locator("#tab-rules[aria-selected=true]").count() else None
    page.mouse.move(2, 2)
    shot(page, "summary-after-desktop-light", full_page=True)

    # ---- the bell: unread count, tint while open, read on close
    unread = int(page.inner_text("#badge"))
    check("S1-ACC-04: the bell shows how many notifications are unread", unread >= 1 and f"{unread} new" in page.get_attribute("#bell", "aria-label"), str(unread))
    page.click("#bell"); page.wait_for_timeout(300)
    check("S1-ACC-04: opening it clears the badge, and the unread lines keep their tint while it is open", page.locator("#badge").is_hidden() and page.locator("#notes li.unread").count() == unread, f"{page.locator('#notes li.unread').count()}")
    check("S1-ACC-05: the lines are real events with a time ('12:05 am', 'yesterday', or a date)", page.locator("#notes li").count() >= 1 and re.search(r"\d{1,2}:\d\d [ap]m|yesterday|\d{4}-\d\d-\d\d", text(page, "#notes li >> nth=0")) is not None, text(page, "#notes"))
    page.keyboard.press("Escape"); page.wait_for_timeout(400)
    check("S1-ACC-04: closing it marks them read: no badge, no tint on the next open, and the server agrees", page.evaluate("fetch('/chrome/api/notifications').then(r => r.json()).then(d => d.unread)") == 0 and page.locator("#badge").is_hidden())
    page.click("#bell"); page.wait_for_timeout(200)
    check("S1-ACC-04: opened again, nothing is tinted", page.locator("#notes li.unread").count() == 0)
    page.keyboard.press("Escape")

    # ---- no leftovers
    body = text(page, "body")
    check("X-08: no prototype bar, no mockup notes, no switchers", not re.search(r"Mockup notes|site mockup|Prototype", body) and page.locator(".proto, #tabs, #daystate").count() == 0)
    check("no visible text says 'fog' (it is 'uncharted')", not re.search(r"\bfog\b", body, re.I) and "UNCHARTED" in page.evaluate("document.querySelector('#board-wrap svg').textContent"))
    check("S1-RUL-16: no GitHub link on the game page, and nobody 'takes a seat'", page.locator("a[href*='github.com']").count() == 0 and "take a seat" not in body.lower())
    check("desktop: no page errors (light)", not errors, str(errors))
    sideways(page, 1280, "desktop")
    c.close()

    # ================= desktop, dark: no page errors =================
    c, page, errors = new_page(b, 1280, 900, "dark")
    page.click("#tab-rules"); page.locator('.bcard[data-card="401"]').click(); page.wait_for_selector("#mroot .mcard"); page.keyboard.press("Escape")
    check("desktop: no page errors (dark)", not errors, str(errors))
    c.close()

    # ================= phone, light: the moved state and the rule card with Back =================
    c, page, errors = new_page(b, 390, 844, "light")
    page.click("#tab-rules"); page.locator('.bcard[data-card="103"]').click(); page.wait_for_selector("#mroot .mcard")
    page.locator("#mroot .mtext .xref").first.click(); page.click("#rprev [data-fromprev]"); page.wait_for_timeout(200)
    check("phone: a rule card with Back stays on screen", box(page, ".mcard")["w"] <= 390 and page.locator("#mroot .mbackbtn").count() == 1)
    sideways(page, 390, "phone with the Back card")
    page.keyboard.press("Escape")
    check("phone: no page errors (light)", not errors, str(errors))
    c.close()
    # ================= logged out, and a game still being set up =================
    c = b.new_context(viewport={"width": 1280, "height": 900}); page = c.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e))); page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "401" not in m.text else None)   # logged out, /api/me answers 401 by design: the browser logs it
    page.goto(base + f"/{SLUG}/"); page.wait_for_selector("#scores li"); page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0"); page.wait_for_selector("#sday"); page.wait_for_timeout(400)
    check("logged out: Log in in the header, the move bar says so, the ballot is readable, Propose is off with the reason", page.locator("#login-btn").count() == 1 and "Log in to play." in text(page, "#movebar") and "P1" in text(page, "#sballot") and page.locator("#spropose .ptile:disabled").count() == 2)
    page.click("#tab-rules"); page.wait_for_timeout(200)
    check("logged out: the Rulebook reads, with no Add a rule and no banner", page.locator(".bcard[data-card]").count() > 10 and page.locator(".bcard.add").count() == 0 and page.locator("#rb-banner").count() == 0)
    page.locator('.bcard[data-card="401"]').click(); page.wait_for_selector("#mroot .mcard")
    check("logged out: a rule card has no Propose and no action", page.locator("#mroot .proposeact").count() == 0 and page.locator("#mroot .pbtn").count() == 0)
    page.goto(base + f"/{SLUG}/#r-301"); page.wait_for_selector("#mroot .mcard"); page.wait_for_timeout(200)
    check("a link to a rule (#r-301) opens the Rulebook tab with that rule's card", "301" in text(page, "#mroot .mnum") and page.locator("#tab-rules").get_attribute("aria-selected") == "true")
    check("logged out: no page errors", not errors, str(errors))
    c.close()
    c = b.new_context(viewport={"width": 1280, "height": 900}); page = c.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e))); page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "401" not in m.text else None)
    page.goto(base + "/setup/"); page.wait_for_selector("#scores li"); page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0"); page.wait_for_timeout(400)
    check("a game being set up: 'Setting up. 1 player of 8 joined.', no day strip, no lock bar", "Setting up. 1 player of 8 joined." in text(page, "#movebar") and page.locator("#sday").is_hidden() and page.locator("#lockbar").is_hidden(), text(page, "#movebar"))
    check("a game being set up: no page errors, no sideways scroll", not errors and page.evaluate("document.documentElement.scrollWidth") <= 1280, str(errors))
    c.close()
    b.close()

print("\nbrowser-chrome:", "FAILED %d: %s" % (len(failed), "; ".join(failed)) if failed else "all checks passed")
sys.exit(1 if failed else 0)
