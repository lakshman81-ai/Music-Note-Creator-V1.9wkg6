
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # We need to serve the file somehow.
        # Since vite build failed to run due to missing environment,
        # I cannot reliably serve the built app.
        # I will try to inspect the code statically primarily.
        # However, checking if I can serve via simple python http server if 'dist' existed?
        # But 'npm run build' succeeded the second time!

        # Let's try to serve 'dist' folder on port 3000
        # This script assumes server is running.

        page.goto('http://localhost:4173') # Vite preview port usually
        time.sleep(2)
        page.screenshot(path='verification/screenshot.png')
        browser.close()

if __name__ == '__main__':
    run()
