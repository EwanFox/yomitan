/*
 * Copyright (C) 2023  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const path = require('path');
const {test: base, chromium} = require('@playwright/test');
const root = path.join(__dirname, '..', '..');

export const test = base.extend({
    context: async ({ }, use) => {
        const pathToExtension = path.join(root, 'ext');
        const context = await chromium.launchPersistentContext('', {
            // headless: false,
            args: [
                '--headless=new',
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`
            ]
        });
        await use(context);
        await context.close();
    },
    extensionId: async ({context}, use) => {
        let [background] = context.serviceWorkers();
        if (!background) {
            background = await context.waitForEvent('serviceworker');
        }

        const extensionId = background.url().split('/')[2];
        await use(extensionId);
    }
});
const expect = test.expect;

test('visual', async ({context, page, extensionId}) => {
    // wait for the on-install welcome.html tab to load, which becomes the foreground tab
    const welcome = await context.waitForEvent('page');
    welcome.close(); // close the welcome tab so our main tab becomes the foreground tab -- otherwise, the screenshot can hang

    // open settings
    await page.goto(`chrome-extension://${extensionId}/settings.html`);

    await expect(page.locator('id=dictionaries')).toBeVisible();

    // get the locator for the disk usage indicator so we can later mask it out of the screenshot
    const storage_locator = page.locator('.storage-use-finite >> xpath=..');

    await page.addStyleTag({content: `@font-face {
                font-family: 'Noto Sans JP';
                src: url('./NotoSansJP.ttf') format('opentype');
            }
body {
    font-family: "Noto Sans JP", Helvetica, Arial, sans-serif;
    font-size: 14px;
    padding: 0;
    margin: 0;
    background-color: #f8f8f8;
}`});

    // make sure font is loaded just in case
    await page.evaluate(() => document.fonts.ready); // eslint-disable-line
    // take a simple screenshot of the settings page
    await expect.soft(page).toHaveScreenshot('settings-fresh.png', {mask: [storage_locator]});

    // load in jmdict_english.zip
    await page.locator('input[id="dictionary-import-file-input"]').setInputFiles(path.join(root, 'dictionaries/jmdict_english.zip'));
    await expect(page.locator('id=dictionaries')).toHaveText('Dictionaries (1 installed, 1 enabled)', {timeout: 5 * 60 * 1000});

    await page.addStyleTag({content: `@font-face {
                font-family: 'Noto Sans JP';
                src: url('./NotoSansJP.ttf') format('opentype');
            }
body {
    font-family: "Noto Sans JP", Helvetica, Arial, sans-serif;
    font-size: 14px;
    padding: 0;
    margin: 0;
    background-color: #f8f8f8;
}`});

    // await font loading
    await page.evaluate(() => document.fonts.ready); // eslint-disable-line
    // take a screenshot of the settings page with jmdict loaded
    await expect.soft(page).toHaveScreenshot('settings-jmdict-loaded.png', {mask: [storage_locator]});

    const screenshot = async (doc_number, test_number, el, offset) => {
        const test_name = 'doc' + doc_number + '-test' + test_number;

        const box = await el.boundingBox();

        // find the popup frame if it exists
        let popup_frame = page.frames().find((f) => f.url().includes('popup.html'));

        // otherwise prepare for it to be attached
        let frame_attached;
        if (popup_frame === undefined) {
            frame_attached = page.waitForEvent('frameattached');
        }
        await page.mouse.move(box.x + offset.x, box.y + offset.y, {steps: 10}); // hover over the test
        if (popup_frame === undefined) {
            popup_frame = await frame_attached; // wait for popup to be attached
        }
        try {
            await (await popup_frame.frameElement()).waitForElementState('visible', {timeout: 500});  // some tests don't have a popup, so don't fail if it's not there; TODO: check if the popup is expected to be there
        } catch (error) {
            console.log(test_name + ' has no popup');
        }

        await page.bringToFront(); // bring the page to the foreground so the screenshot doesn't hang; for some reason the frames result in page being in the background

        // Make sure font is loaded
        await page.evaluate(() => document.fonts.ready); // eslint-disable-line
        await expect.soft(page).toHaveScreenshot(test_name + '.png');

        await page.mouse.click(0, 0); // click away so popup disappears
        await (await popup_frame.frameElement()).waitForElementState('hidden'); // wait for popup to disappear
    };

    // Load test-document1.html
    await page.goto('file://' + path.join(root, 'test/data/html/test-document1.html'));
    console.log('file://' + path.join(root, 'test/data/html/test-document1.html'));
    await page.setViewportSize({width: 1000, height: 1800});
    await page.keyboard.down('Shift');
    let i = 1;
    for (const el of await page.locator('div > *:nth-child(1)').elementHandles()) {
        await screenshot(1, i, el, {x: 6, y: 6});
        i++;
    }

    // Load test-document2.html
    await page.goto('file://' + path.join(root, 'test/data/html/test-document2.html'));
    await page.setViewportSize({width: 1000, height: 4500});
    await page.keyboard.down('Shift');
    i = 1;
    for (const el of await page.locator('.hovertarget').elementHandles()) {
        await screenshot(2, i, el, {x: 15, y: 15});
        i++;
    }
});
