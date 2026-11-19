# Real Chromium draws a game's board. Usage: browser-board.py <base> <slug> <expected title> <rules substring or "-" for "rules unavailable">
# Proves the one static page works for any slug, takes the game's name from the API,
# and shows "Rules unavailable" (instead of breaking) when the rules cannot be read.
import sys
from playwright.sync_api import sync_playwright

base, slug, title, rules = sys.argv[1:5]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context().new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/{slug}/")
    page.wait_for_function("document.getElementById('dock').textContent.trim().length > 0")
    page.wait_for_function("document.getElementById('rules').textContent.indexOf('Loading') < 0")
    got_title = page.inner_text("#title")
    rules_text = page.inner_text("#rules")
    ok = got_title == title and not errors and ((rules == "-" and "Rules unavailable" in rules_text) or (rules != "-" and rules in rules_text and "Starter notes" not in rules_text))
    print(("OK " if ok else "FAIL ") + repr((got_title, rules_text[:80], errors)))
    b.close()
sys.exit(0 if ok else 1)
