"""Real authenticated browser-save/isolation checks. Run with sandbox credentials.

SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read only by this test runner.
Temporary accounts/scans are cleaned in finally. Credentials never reach reports.
Set ECOLENS_TEST_IMAGE to an original labelled photo; output is under /tmp/browser.
"""
import asyncio
import base64
import json
import os
import secrets
import uuid
from pathlib import Path

import requests
from playwright.async_api import async_playwright

OUTPUT = Path("/tmp/browser/browser-save")
SOURCE = "MobileNetV3-Small (ONNX Browser)"


async def login(page, account):
    await page.goto("http://localhost:8080", wait_until="networkidle")
    await page.get_by_label("Email", exact=True).fill(account["email"])
    await page.get_by_label("Password", exact=True).fill(account["password"])
    await page.get_by_role("button", name="Log In", exact=True).click()
    await page.get_by_role("heading", name="Dashboard", exact=True).wait_for()


async def navigate(page, tab):
    await page.get_by_role("navigation", name="Main", exact=True).filter(visible=True).get_by_role("button", name=tab, exact=True).click()


async def scans(page):
    return await page.evaluate("""async () => {
      const {supabase}=await import('/src/integrations/supabase/client.ts');
      const {data,error}=await supabase.from('scans').select('*');
      if(error)throw Error('Owner history read failed');return data;
    }""")


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image_path = Path(os.environ.get("ECOLENS_TEST_IMAGE", str(OUTPUT / "plastic.jpg")))
    if not image_path.is_file():
        raise RuntimeError("An original labelled test image is required.")
    url = os.environ["SUPABASE_URL"]
    headers = {"apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_ROLE_KEY"]}
    accounts = []
    report = {}
    try:
        for _ in range(2):
            account = {"email": "browser-save-" + uuid.uuid4().hex + "@example.com", "password": secrets.token_urlsafe(24)}
            response = requests.post(url + "/auth/v1/admin/users", headers=headers, json={**account, "email_confirm": True}, timeout=30)
            if response.status_code not in (200, 201):
                raise RuntimeError("Temporary test account creation failed.")
            account["id"] = response.json()["id"]
            accounts.append(account)
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
            context = await browser.new_context(viewport={"width": 1280, "height": 1800}, permissions=["camera"], reduced_motion="reduce")
            page = await context.new_page()
            runtime_errors = []
            page.on("pageerror", lambda error: runtime_errors.append(str(error)))
            await login(page, accounts[0])
            assert await scans(page) == []
            await navigate(page, "Scan Waste")
            await page.set_input_files('input[type=file]', str(image_path))
            await page.get_by_role("button", name="Analyze Waste", exact=True).click()
            await page.get_by_role("button", name="Save Scan", exact=True).wait_for()
            assert await scans(page) == []
            detected = await page.locator("main h2").inner_text()
            confidence = int(await page.get_by_role("progressbar", name="Prediction confidence").get_attribute("aria-valuenow"))
            # A failed network save preserves the prediction and allows explicit retry.
            await page.route("**/_serverFn/**", lambda route: route.abort())
            await page.get_by_role("button", name="Save Scan", exact=True).click()
            await page.get_by_role("alert").filter(has_text="Failed to fetch").wait_for()
            assert await scans(page) == []
            assert await page.get_by_role("heading", name=detected, exact=True).count() == 1
            await page.unroute("**/_serverFn/**")
            report["save_failure_preserves_prediction_and_retry"] = True
            await page.get_by_role("button", name="Save Scan", exact=True).click()
            await page.get_by_text("Saved to history", exact=True).wait_for(timeout=30000)
            own = await scans(page)
            assert len(own) == 1 and own[0]["source"] == SOURCE and own[0]["provenance"] == "client-reported"
            assert own[0]["item"] == detected and own[0]["confidence"] == confidence
            assert own[0]["user_id"] == accounts[0]["id"]
            record = own[0]
            await page.screenshot(path=str(OUTPUT / "saved-result-desktop.png"))
            report["signed_in_upload_predict_save"] = True
            await navigate(page, "History")
            await page.get_by_role("heading", name=detected, exact=True).wait_for()
            await page.get_by_role("button", name="View", exact=True).click()
            dialog = page.get_by_role("dialog")
            await dialog.get_by_text("Engine: " + SOURCE, exact=True).wait_for()
            assert await dialog.get_by_role("progressbar", name="Prediction confidence").get_attribute("aria-valuenow") == str(confidence)
            await page.screenshot(path=str(OUTPUT / "history-detail.png"))
            await page.keyboard.press("Escape")
            await page.reload(wait_until="networkidle")
            await navigate(page, "History")
            await page.get_by_role("heading", name=detected, exact=True).wait_for()
            report["saved_result_read_after_reload"] = True
            await navigate(page, "Dashboard")
            assert "1 scan" in await page.get_by_text("Based on your 1 scan", exact=True).inner_text()
            await page.screenshot(path=str(OUTPUT / "dashboard.png"))
            report["dashboard_counts_saved_browser_result"] = True
            retry = await page.evaluate("""async (row) => {
              const {saveBrowserScan}=await import('/src/lib/classify.functions.ts');
              return await saveBrowserScan({data:{image:row.image,item:row.item,confidence:row.confidence,requestId:row.client_request_id}});
            }""", record)
            assert retry["id"] == record["id"] and len(await scans(page)) == 1
            report["save_retry_is_idempotent"] = True
            other_context = await browser.new_context(viewport={"width": 1280, "height": 1800})
            other = await other_context.new_page()
            await login(other, accounts[1])
            assert await scans(other) == []
            isolation = await other.evaluate("""async (id) => {
              const {supabase}=await import('/src/integrations/supabase/client.ts');
              const selected=await supabase.from('scans').select('*').eq('id',id);
              const updated=await supabase.from('scans').update({feedback:'cross-account'}).eq('id',id).select('id');
              const deleted=await supabase.from('scans').delete().eq('id',id).select('id');
              return {selected:selected.data,updated:updated.data,deleted:deleted.data};
            }""", record["id"])
            assert isolation == {"selected": [], "updated": [], "deleted": []}
            assert len(await scans(page)) == 1
            report["cross_account_read_update_delete_blocked"] = True
            security = await page.evaluate("""async (row) => {
              const {supabase}=await import('/src/integrations/supabase/client.ts');
              const inserted=await supabase.from('scans').insert({user_id:row.user_id,item:row.item,category:row.category,bin:row.bin,confidence:row.confidence,reasoning:'forged',image:row.image,source:'gateway'});
              const forged=await supabase.from('scans').update({source:'gateway'}).eq('id',row.id);
              const feedback=await supabase.from('scans').update({feedback:'owner check'}).eq('id',row.id).select('feedback');
              return {insertBlocked:!!inserted.error,sourceBlocked:!!forged.error,feedback:feedback.data};
            }""", record)
            assert security["insertBlocked"] and security["sourceBlocked"] and security["feedback"] == [{"feedback": "owner check"}]
            report["direct_forged_insert_and_source_update_blocked"] = True
            report["owner_feedback_still_works"] = True
            # Same retry identifier is independent for another owner.
            other_saved = await other.evaluate("""async (row) => {
              const {saveBrowserScan}=await import('/src/lib/classify.functions.ts');
              return await saveBrowserScan({data:{image:row.image,item:row.item,confidence:row.confidence,requestId:row.client_request_id}});
            }""", record)
            assert other_saved["id"] != record["id"] and len(await scans(other)) == 1
            assert len(await scans(page)) == 1
            report["retry_keys_are_owner_scoped"] = True
            uncertain = await other.evaluate("""async (row) => {
              const {saveBrowserScan}=await import('/src/lib/classify.functions.ts');
              return await saveBrowserScan({data:{image:row.image,item:'battery',confidence:54,requestId:crypto.randomUUID()}});
            }""", record)
            assert uncertain["category"] == "uncertain" and uncertain["bin"] == "No bin — rescan or check local rules" and uncertain["source"] == SOURCE
            report["below_55_saved_and_read_as_uncertain"] = True
            # Reject a caller attempting to supply ownership or source.
            rejected = await page.evaluate("""async (row) => {
              const {saveBrowserScan}=await import('/src/lib/classify.functions.ts');
              try {await saveBrowserScan({data:{image:row.image,item:row.item,confidence:row.confidence,requestId:row.client_request_id,user_id:'forged',source:'gateway'}});return false;}catch{return true;}
            }""", record)
            assert rejected
            report["forged_save_fields_rejected"] = True
            # Anonymous save cannot run; no credentials are restored to this context.
            anonymous = await browser.new_page(viewport={"width": 1280, "height": 1800})
            await anonymous.goto("http://localhost:8080", wait_until="networkidle")
            denied = await anonymous.evaluate("""async (row) => {
              const {saveBrowserScan}=await import('/src/lib/classify.functions.ts');
              try {await saveBrowserScan({data:{image:row.image,item:row.item,confidence:row.confidence,requestId:row.client_request_id}});return false;}catch{return true;}
            }""", record)
            assert denied
            report["anonymous_save_denied"] = True
            # The complete workflow also works at the user's current viewport.
            await page.set_viewport_size({"width": 880, "height": 715})
            await navigate(page, "Scan Waste")
            await page.set_input_files('input[type=file]', str(image_path))
            await page.get_by_role("button", name="Analyze Waste", exact=True).click()
            await page.get_by_role("button", name="Save Scan", exact=True).wait_for()
            await page.get_by_role("button", name="Save Scan", exact=True).click()
            await page.get_by_text("Saved to history", exact=True).wait_for()
            assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth")
            await page.screenshot(path=str(OUTPUT / "saved-result-current-viewport.png"))
            await page.set_viewport_size({"width": 390, "height": 844})
            await page.get_by_role("button", name="New Scan", exact=True).click()
            await page.get_by_role("tab", name="Use Camera", exact=True).click()
            await page.get_by_role("button", name="Start camera", exact=False).click()
            await page.get_by_role("button", name="Capture Photo", exact=True).wait_for()
            await page.wait_for_timeout(1000)
            await page.get_by_role("button", name="Capture Photo", exact=True).click()
            await page.get_by_role("button", name="Analyze Waste", exact=True).click()
            await page.get_by_role("button", name="Save Scan", exact=True).wait_for()
            await page.get_by_role("button", name="Save Scan", exact=True).click()
            await page.get_by_text("Saved to history", exact=True).wait_for()
            assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth")
            await page.get_by_text("Saved to history", exact=True).scroll_into_view_if_needed()
            await page.screenshot(path=str(OUTPUT / "saved-camera-mobile.png"))
            report["camera_predict_save_and_mobile_layout"] = True
            # Explicit Gateway still runs and saves a separate Gateway source.
            await page.get_by_role("button", name="New Scan", exact=True).click()
            await page.get_by_role("tab", name="Upload Photo", exact=True).click()
            await page.set_input_files('input[type=file]', str(image_path))
            await page.get_by_role("button", name="Use Lovable AI Gateway", exact=True).click()
            await page.get_by_text("Saved to history", exact=True).wait_for(timeout=120000)
            await page.get_by_text("Engine: Lovable AI Gateway", exact=True).wait_for()
            final_rows = await scans(page)
            assert any(row["source"] == "gateway" and row["provenance"] == "server-classified" for row in final_rows)
            assert sum(row["source"] == SOURCE for row in final_rows) == 3
            report["explicit_gateway_preserved_and_separately_labelled"] = True
            await page.reload(wait_until="networkidle")
            await navigate(page, "Scan Waste")
            await page.route("**/models/mobilenet-v3-small.json", lambda route: route.fulfill(status=503, body="Unavailable"))
            await page.set_input_files('input[type=file]', str(image_path))
            await page.get_by_role("button", name="Analyze Waste", exact=True).click()
            await page.get_by_text("Analysis failed", exact=True).wait_for()
            assert len(await scans(page)) == len(final_rows)
            assert await page.get_by_role("button", name="Use Lovable AI Gateway", exact=True).is_enabled()
            report["model_failure_no_auto_fallback_gateway_available"] = True
            report["runtime_errors"] = runtime_errors
            await browser.close()
        (OUTPUT / "flow-results.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    finally:
        for account in accounts:
            requests.delete(url + "/rest/v1/scans", headers=headers, params={"user_id": "eq." + account["id"]}, timeout=30).raise_for_status()
            requests.delete(url + "/auth/v1/admin/users/" + account["id"], headers=headers, timeout=30).raise_for_status()
        print("Temporary test users and scans removed; existing data untouched.")


if __name__ == "__main__":
    asyncio.run(main())