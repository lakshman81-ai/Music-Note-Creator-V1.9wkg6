
import time
from playwright.sync_api import sync_playwright

def verify_sheet_music():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Using port 3000 as seen in server.log
        port = 3000
        page = browser.new_page()

        print(f"Connecting to localhost:{port}")
        # Wait for server
        for i in range(10):
            try:
                page.goto(f"http://localhost:{port}")
                break
            except Exception as e:
                print(f"Connection attempt {i} failed: {e}")
                time.sleep(2)

        # Wait for app to load
        print("Waiting for title...")
        page.wait_for_selector("text=Music Note Creator", state="visible")
        print("App loaded.")

        # Click "YouTube" button
        page.click("button[title='Use YouTube Source']")

        # Fill URL
        # Using "Never Gonna Give You Up" for deterministic seed in app logic
        page.fill("input[placeholder='Paste YouTube URL...']", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")

        # Click Load
        page.click("button[title='Load Video']")
        print("Video loading initiated...")

        # Wait for "Video Loaded" toast or processing
        try:
            page.wait_for_selector("text=Video Loaded", timeout=15000)
            print("Video loaded toast confirmed.")
        except:
            print("Toast not found, maybe missed it. Checking for SVG...")

        # Wait for Sheet Music container to populate (look for Stave lines or Clefs)
        # VexFlow renders <svg> and paths.
        try:
            page.wait_for_selector("svg", timeout=15000)
            print("SVG element found.")
        except:
            print("No SVG found yet.")

        # Take screenshot of the Sheet Music area
        page.screenshot(path="verification/sheet_music_full.png")
        print("Full page screenshot taken.")

        # Try to screenshot just the sheet music container
        # The container in `SheetMusic.tsx` has `ref={scrollRef}` and class `w-full h-[400px] ...`
        element = page.locator("div.w-full.h-\\[400px\\]")
        if element.count() > 0:
            element.screenshot(path="verification/sheet_music_detail.png")
            print("Detail screenshot taken.")

        browser.close()

if __name__ == "__main__":
    verify_sheet_music()
