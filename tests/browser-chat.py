# The chat window in real Chromium (called by tests/chat-browser.mjs). Game "shop" is on day 1: Ada (teal, the viewer) has a ticket W1 that
# Gremlin drafted over two turns (a flying dragon, priced with a reason), Bo (vermilion) is at the day's cap with the limit's excuse stored.
# Checks the column on the Workshop tab at 1280 (open, a new message, minimize and back, remembered across a reload, "Commission something"
# opens it on the new draft), the corner pill and the bottom sheet at 390, the cap's closed composer, a visitor with no window, light and dark,
# no sideways scroll and no console errors. "ok"/"FAIL" lines; any FAIL makes the exit code 1.
# Usage: browser-chat.py <base> <screenshot dir or -> <Ada's session cookie> <Bo's session cookie>
import re, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base, out, ada_cookie, bo_cookie = sys.argv[1:5]
host = urlparse(base).hostname
failed = []
SLUG = "shop"

def check(name, ok, detail=""):
    print(("ok    " if ok else "FAIL  ") + name + (f"  -> {detail}" if detail and not ok else ""))
    if not ok: failed.append(name)

def shot(page, name, **kw):
    if out != "-": page.screenshot(path=f"{out}/{name}.png", **kw)

def new_page(b, w, h, scheme, cookie=None):
    c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, color_scheme=scheme, has_touch=w < 500)
    if cookie: c.add_cookies([{"name": "s", "value": cookie, "domain": host, "path": "/" + SLUG}])
    page = c.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "401" not in m.text else None)
    page.goto(base + f"/{SLUG}/", wait_until="domcontentloaded")
    page.wait_for_selector("#scores li"); page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0")
    page.wait_for_selector("#tab-workshop"); page.wait_for_timeout(400)
    return c, page, errors

def sideways(page, w, name):
    sw = page.evaluate("document.documentElement.scrollWidth")
    check(f"{name}: no sideways scroll (scrollWidth {sw} <= {w})", sw <= w)

def text(page, sel): return " ".join(page.inner_text(sel).split())
def mode(page): return page.get_attribute("#bwrap", "data-chat")
def sheet(page): return page.get_attribute("#bwrap", "data-sheet")
def vis(page, sel): return page.locator(sel).first.is_visible() if page.locator(sel).count() else False
def msgs(page): return page.locator("#chatLog .msg").count()

with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme in ["light", "dark"]:
        # ---------------- desktop, 1280
        tag = f"1280-{scheme}"
        c, page, errors = new_page(b, 1280, 900, scheme, ada_cookie)
        check(f"{tag}: on the Summary there is no chat window and no pill", mode(page) == "off" and not vis(page, "#chatcol") and not vis(page, "#chatfab"))
        page.click("#tab-workshop"); page.wait_for_selector("#chatcol .chat"); page.wait_for_selector("#chatLog .slip")
        check(f"{tag}: on the Workshop tab the column is open beside the tickets", mode(page) == "open" and vis(page, "#chatcol .chat") and not vis(page, "#chatfab"))
        box = page.locator("#chatcol .chat").bounding_box(); wk = page.locator("#p-workshop .wk").bounding_box()
        check(f"{tag}: the column is on the right (x {box['x']:.0f}, width {box['width']:.0f}) and the tickets keep the rest ({wk['width']:.0f} wide)", box["x"] > 800 and box["x"] + box["width"] <= 1280 and wk["x"] + wk["width"] <= box["x"] + 4)
        head = text(page, "#chatcol .ch-h")
        check(f"{tag}: the header names Gremlin, with his portrait and the minimize button", head.startswith("Gremlin") and page.locator("#chatcol .ch-h .por svg").count() == 1 and page.locator('#chatcol [data-c="min"]').is_visible())
        check(f"{tag}: the log has the two turns (4 lines, more in the dark run: the light run added one) under a Today divider, in order, her words on the right", msgs(page) >= 4 and msgs(page) % 2 == 0 and text(page, "#chatLog .cday").lower() == "today" and page.locator("#chatLog .msg").nth(0).get_attribute("class") == "msg cme" and "low stone garden wall" in text(page, "#chatLog .msg >> nth=0"), f"{msgs(page)} lines; first class {page.locator('#chatLog .msg').nth(0).get_attribute('class')}; day {text(page, '#chatLog .cday')}")
        slip = text(page, "#chatLog .slip")
        check(f"{tag}: the slip is his drafted ticket: W1, its title, what it makes (a creature, a rule), the estimate, the price with his one-line reason, a DRAFT stamp",
              "W1" in slip and "Flying dragon" in slip and "creature" in slip and "3 nights" in slip and "6 points" in slip and "Charmed discount" in slip and "DRAFT" in slip, slip)
        check(f"{tag}: rule numbers in his words are pills (the ticket's rule)", page.locator("#chatLog .rpill").count() >= 0)
        page.evaluate("document.getElementById('book').scrollIntoView()"); page.wait_for_timeout(200)
        shot(page, f"desktop-open-{tag}")
        sideways(page, 1280, f"{tag} chat open")
        # a new message
        n0 = msgs(page)
        page.fill("#chatText", "can a Ghost commission something?"); page.keyboard.press("Enter")
        page.wait_for_function(f"document.querySelectorAll('#chatLog .msg').length === {n0 + 2}")
        check(f"{tag}: Enter sends: her line and his reply are added, the box is empty again, 28 left (no counter yet)", msgs(page) == n0 + 2 and page.input_value("#chatText") == "" and not vis(page, ".ch-in .left"))
        # the draft's ticket opens from the slip's pill
        page.click("#chatLog .slip .wpill"); page.wait_for_selector("#mroot .mcard")
        check(f"{tag}: the slip's W1 pill opens the ticket's card, and the card shows his price and reason", "W1" in text(page, "#mroot .mcard") and "6 points" in text(page, "#mroot .mcard") and "Charmed discount" in text(page, "#mroot .mcard"))
        page.keyboard.press("Escape"); page.wait_for_timeout(250)
        # minimize
        page.click('#chatcol [data-c="min"]')
        check(f"{tag}: minimize docks the column as the corner pill and the tab takes the full width", mode(page) == "min" and not vis(page, "#chatcol .chat") and vis(page, "#chatfab") and page.locator("#p-workshop .wk").bounding_box()["width"] > wk["width"] + 300)
        page.evaluate("document.getElementById('book').scrollIntoView()"); page.wait_for_timeout(200)
        shot(page, f"desktop-minimized-{tag}")
        page.reload(wait_until="domcontentloaded"); page.wait_for_selector("#tab-workshop"); page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0")
        page.click("#tab-workshop"); page.wait_for_timeout(500)
        check(f"{tag}: minimized stays minimized across a reload (remembered per player)", mode(page) == "min" and vis(page, "#chatfab"))
        page.click("#chatfab"); page.wait_for_selector("#chatcol .chat")
        check(f"{tag}: the pill opens the column again, with the log where it was", mode(page) == "open" and msgs(page) == n0 + 2 and vis(page, "#chatLog .slip"))
        # Commission something opens the chat on the new draft
        page.click('[data-w="open"]'); page.wait_for_selector("#wfTitle"); page.wait_for_selector(".ch-in .chip")
        check(f"{tag}: Commission something opens the draft (W2) and the chat is attached to it: a W2 chip beside the box", "W2" in text(page, ".ch-in .chip") and "W2" in text(page, "#mroot .mcard"), text(page, ".ch-in") + " | " + text(page, "#mroot .mcard")[:200])
        page.evaluate("document.getElementById('book').scrollIntoView()")
        shot(page, f"desktop-commission-{tag}")
        page.keyboard.press("Escape")
        check(f"{tag}: no console errors", not errors, str(errors))
        c.close()

        # ---------------- phone, 390
        tag = f"390-{scheme}"
        c, page, errors = new_page(b, 390, 844, scheme, ada_cookie)
        page.click("#tab-workshop"); page.wait_for_selector("#chatfab")
        check(f"{tag}: on a phone the column is not in the page; the corner pill is", not vis(page, "#chatcol .chat") and vis(page, "#chatfab") and sheet(page) == "closed")
        check(f"{tag}: the pill carries his portrait and name, and sits inside the screen", page.locator("#chatfab .por svg").count() == 1 and "Gremlin" in text(page, "#chatfab") and page.locator("#chatfab").bounding_box()["x"] + page.locator("#chatfab").bounding_box()["width"] <= 390)
        shot(page, f"phone-pill-{tag}")
        page.click("#chatfab"); page.wait_for_selector("#chatcol .chat")
        cb = page.locator("#chatcol .chat").bounding_box()
        check(f"{tag}: the pill opens a bottom sheet: full width, from under the header to the bottom edge, over a dim; the pill is gone", sheet(page) == "open" and cb["width"] == 390 and cb["y"] < 80 and abs(cb["y"] + cb["height"] - 844) < 2 and not vis(page, "#chatfab"))
        check(f"{tag}: the sheet has Close, not Minimize", vis(page, '#chatcol [data-c="close"]') and not vis(page, '#chatcol [data-c="min"]'))
        page.wait_for_selector("#chatLog .slip"); page.wait_for_timeout(300)
        lg = page.locator("#chatLog").bounding_box(); sl = page.locator("#chatLog .slip").bounding_box()
        check(f"{tag}: the sheet opens scrolled to the end: the slip is inside the log's visible area", sl["y"] >= lg["y"] - 1 and sl["y"] + sl["height"] <= lg["y"] + lg["height"] + 1, f"log {lg}, slip {sl}, scroll {page.evaluate('(() => { const l = document.getElementById(`chatLog`); return [l.scrollTop, l.scrollHeight, l.clientHeight]; })()')}")
        shot(page, f"phone-sheet-{tag}")
        sideways(page, 390, f"{tag} sheet")
        n0 = msgs(page)
        page.fill("#chatText", "can a Ghost commission something?"); page.click('[data-c="send"]')
        page.wait_for_function(f"document.querySelectorAll('#chatLog .msg').length === {n0 + 2}")
        check(f"{tag}: Send works from the sheet and the reply lands in the log", msgs(page) == n0 + 2)
        page.click('#chatcol [data-c="close"]'); page.wait_for_timeout(200)
        check(f"{tag}: Close puts the sheet away and the pill back", sheet(page) == "closed" and vis(page, "#chatfab") and not vis(page, "#chatcol .chat"))
        check(f"{tag}: no console errors", not errors, str(errors)); c.close()

        # ---------------- the cap, Bo
        for w, h in [(1280, 900), (390, 844)]:
            tag = f"{w}-{scheme}"
            c, page, errors = new_page(b, w, h, scheme, bo_cookie)
            page.click("#tab-workshop"); page.wait_for_selector("#chatfab" if w < 900 else "#chatcol .chat")
            if w < 900: page.click("#chatfab"); page.wait_for_selector("#chatcol .chat")
            page.wait_for_selector("#chatLog .msg")
            closed = text(page, ".ch-in .closed")
            check(f"{tag} (cap): the composer is closed with the count beside it; no text box, no Send", closed == "30 of 30 messages today" and page.locator("#chatText").count() == 0 and page.locator('[data-c="send"]').count() == 0, closed)
            check(f"{tag} (cap): the history is still there and his excuse is the last line, ending with when he's back", msgs(page) >= 2 and "midnight" in text(page, "#chatLog .msg >> nth=-1").lower(), text(page, "#chatLog .msg >> nth=-1"))
            if w >= 900: page.evaluate("document.getElementById('book').scrollIntoView()"); page.wait_for_timeout(200)
            shot(page, f"cap-{tag}"); sideways(page, w, f"{tag} cap")
            check(f"{tag} (cap): no console errors", not errors, str(errors)); c.close()

    # ---------------- a visitor
    c, page, errors = new_page(b, 1280, 900, "light")
    page.click("#tab-workshop"); page.wait_for_timeout(500)
    check("visitor: no chat window and no pill on the Workshop tab", mode(page) == "off" and not vis(page, "#chatcol") and not vis(page, "#chatfab"))
    check("visitor: no console errors besides logged-out 401s", not errors, str(errors)); c.close()
    b.close()
sys.exit(1 if failed else 0)
