"""Exercise the built extension in an empty test profile with intercepted fixtures.

This does not sign in to Gmail or replace live-account QA.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import tempfile

from playwright.async_api import async_playwright


async def main():
    root = Path(__file__).resolve().parents[1]
    artifacts = root / "artifacts"
    artifacts.mkdir(exist_ok=True)
    receipt_path = artifacts / "browser-smoke.json"
    receipt_path.write_text(json.dumps({"status": "running", "buildInfoSha256": hashlib.sha256((root / "dist/build-info.json").read_bytes()).hexdigest()}) + "\n")
    build_info = json.loads((root / "dist/build-info.json").read_text())
    expected_files = {"content.js", "popup.js", "popup.html", "popup.css", "content.css", "manifest.json", "PATINA-LICENSE", "lexicon-en.json", "lexicon-ko.json"}
    assert set(build_info["runtimeHashes"]) == expected_files
    for name, expected in build_info["runtimeHashes"].items():
        path = root / "dist" / name
        assert not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == expected
    browser_path = os.environ.get("PATINA_TEST_BROWSER")
    if not browser_path:
        raise RuntimeError("Set PATINA_TEST_BROWSER to a Chrome for Testing executable")
    profile = tempfile.TemporaryDirectory(prefix="patina-extension-qa-")
    url = "https://mail.google.com/patina-local-qa"
    fixture = """<!doctype html><meta charset=utf-8><title>Patina extension QA fixture</title>
    <style>body{font:16px Arial;max-width:780px;margin:40px auto}form{border:1px solid #aaa;padding:18px;margin:20px 0}[contenteditable]{min-height:100px}</style>
    <h1>Patina extension QA fixture</h1><p>Local intercepted test data. No Gmail account is connected.</p>
    <form id=first><div id=draft-one contenteditable=true role=textbox g_editable=true><p>In today's rapidly evolving landscape, this comprehensive solution unlocks unprecedented opportunities. Furthermore, it fosters seamless collaboration and takes productivity to the next level.</p></div></form>
    <form id=second><div id=draft-two contenteditable=true role=textbox g_editable=true><p>I fixed the typo. Thanks.</p></div></form>
    <script>window.submits=0;document.addEventListener('submit',e=>{e.preventDefault();window.submits++})</script>"""
    requests = []
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            profile.name, executable_path=browser_path, headless=False,
            args=[f"--disable-extensions-except={root / 'dist'}", f"--load-extension={root / 'dist'}", "--no-sandbox"],
            viewport={"width": 1000, "height": 760},
        )
        try:
            await context.route("https://mail.google.com/**", lambda route: route.fulfill(status=200, content_type="text/html", body=fixture))
            page = await context.new_page()
            await page.goto(url)
            await page.locator(".patina-local-badge").first.wait_for()
            assert await page.locator(".patina-local-badge").count() == 2
            assert await page.locator("#first .patina-local-badge").inner_text() == "Patina 100%"
            assert await page.locator("#second .patina-local-badge").inner_text() == "Patina 0%"
            original = await page.locator("#draft-one").inner_html()
            context.on("request", lambda request: requests.append({"url": request.url, "navigation": request.is_navigation_request()}))
            await page.locator("#first .patina-local-badge").click()
            assert await page.locator("#draft-one").inner_html() == original
            assert await page.evaluate("window.submits") == 0
            await page.locator("#first .patina-local-badge").evaluate("node=>node.remove()")
            await page.wait_for_function("document.querySelectorAll('#first .patina-local-badge').length===1")
            await page.locator("#draft-one").evaluate("node=>node.setAttribute('contenteditable','false')")
            await page.wait_for_function("document.querySelectorAll('#first .patina-local-badge').length===0")
            await page.locator("#draft-one").evaluate("node=>node.setAttribute('contenteditable','true')")
            await page.wait_for_function("document.querySelectorAll('#first .patina-local-badge').length===1")
            await page.locator("#draft-two").fill("In today's rapidly evolving landscape, this comprehensive solution unlocks unprecedented opportunities. Furthermore, it fosters seamless collaboration and takes productivity to the next level.")
            await page.wait_for_function("document.querySelector('#second .patina-local-badge').textContent==='Patina 100%'")
            await page.locator("#draft-two").evaluate("node=>node.innerHTML='<p>I fixed the typo. Thanks.</p>'")
            await page.wait_for_function("document.querySelector('#second .patina-local-badge').textContent==='Patina 0%'")
            await page.locator("#draft-two p").evaluate("node=>node.firstChild.data=\"In today's rapidly evolving landscape, this comprehensive solution unlocks unprecedented opportunities. Furthermore, it fosters seamless collaboration and takes productivity to the next level.\"")
            await page.wait_for_function("document.querySelector('#second .patina-local-badge').textContent==='Patina 100%'")
            assert not any(value["url"].startswith(("http:", "https:")) for value in requests), requests

            # Discover only the extension under test through its visible manager card.
            manager = await context.new_page()
            await manager.goto("chrome://extensions/")
            item = manager.locator("extensions-item").filter(has_text="Patina Local Writing Signals")
            await item.wait_for()
            extension_id = await item.get_attribute("id")
            assert extension_id and len(extension_id) == 32
            popup = await context.new_page()
            await popup.goto(f"chrome-extension://{extension_id}/popup.html")
            await page.bring_to_front()
            await page.evaluate("""const r=document.createRange();r.selectNodeContents(document.querySelector('#draft-one'));const s=getSelection();s.removeAllRanges();s.addRange(r);""")
            await popup.evaluate("document.querySelector('#score').click()")
            for _ in range(100):
                if "100%" in await popup.locator("#status").inner_text():
                    break
                await asyncio.sleep(.05)
            assert "100%" in await popup.locator("#status").inner_text()
            await popup.evaluate("document.querySelector('#humanize').click()")
            await popup.locator("#handoff").wait_for(state="visible", timeout=5000)
            assert "rapidly evolving" in await popup.locator("#selection").input_value()
            assert await popup.locator("#command").inner_text() == "patina --verify --lang en draft.txt"
            await page.screenshot(path=str(artifacts / "gmail-fixture.png"))
            await popup.screenshot(path=str(artifacts / "popup.png"))
            await popup.evaluate("document.querySelector('#language').value='ko';document.querySelector('#language').dispatchEvent(new Event('change'))")
            stored = await popup.evaluate("chrome.storage.local.get(null)")
            assert set(stored).issubset({"language", "threshold"}) and stored.get("language") == "ko"

            # Reload an existing compose fixture with a saved nondefault gate.
            await popup.evaluate("chrome.storage.local.set({language:'en',threshold:100})")
            await page.reload()
            await page.locator(".patina-local-badge").first.wait_for()
            assert await page.locator("#first .patina-local-badge").inner_text() == "Patina 100%"
            assert "patina-local-warning" not in (await page.locator("#first .patina-local-badge").get_attribute("class"))

            # A cross-compose selection must never return either draft.
            await page.evaluate("""const r=document.createRange();r.setStart(document.querySelector('#draft-one'),0);r.setEnd(document.querySelector('#draft-two'),1);const s=getSelection();s.removeAllRanges();s.addRange(r);""")
            await popup.evaluate("document.querySelector('#score').click()")
            for _ in range(100):
                if "Select text inside" in await popup.locator("#status").inner_text():
                    break
                await asyncio.sleep(.05)
            assert "Select text inside" in await popup.locator("#status").inner_text()
            await page.locator("#second").evaluate("node=>node.remove()")
            await page.wait_for_function("document.querySelectorAll('.patina-local-badge').length===1")
            navigations = [value for value in requests if value["navigation"] and value["url"] == url]
            assert len(navigations) == 1
            external = [value["url"] for value in requests if value["url"].startswith(("http:", "https:")) and not (value["navigation"] and value["url"] == url)]
            assert not external, external
            receipt = {"status": "passed", "browser": context.browser.version if context.browser else "persistent Chromium",
                       "buildInfoSha256": hashlib.sha256((root / "dist/build-info.json").read_bytes()).hexdigest(),
                       "scope": "empty profile, intercepted fixture; not live Gmail", "manifestModified": False,
                       "badges": True, "typing": True, "selection": True, "cliHandoff": True, "noFormSubmit": True,
                       "draftMarkupPreserved": True, "crossComposeRejected": True, "settingsOnlyStorage": True,
                       "editorLifecycle": True,
                       "programmaticDraftChanges": True,
                       "persistedSettingsAtStartup": True,
                       "scorePathHttpRequests": external}
            receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
            print(json.dumps(receipt))
        except Exception as error:
            receipt_path.write_text(json.dumps({"status": "failed", "reason": type(error).__name__}) + "\n")
            raise
        finally:
            await context.close()
            profile.cleanup()


asyncio.run(main())
