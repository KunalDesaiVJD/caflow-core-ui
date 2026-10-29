# CAFlow WhatsApp Sender (Chrome extension)

Lets the WhatsApp buttons on the CAFlow Billing page use the WhatsApp Web tab
you already have open. It first checks that tab is logged in as the billing
number +91 97271 72515 (and stops if not), then opens the client's chat (their
registered number), types the billing reminder and attaches the statement /
invoice PDF. Nothing is sent until you review it and press Send in WhatsApp.

## Install (once per Chrome profile)

1. Download `caflow-whatsapp-extension.zip` from https://app.vjdesai.com/caflow-whatsapp-extension.zip and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped `caflow-whatsapp` folder.
4. Reload the CAFlow Billing page.

The extension is required: without it the app cannot check which WhatsApp
account would send the message, so the WhatsApp buttons ask you to install it.

## Updating

Replace the folder with the new zip's contents and click the reload icon on
the extension card in `chrome://extensions`.
