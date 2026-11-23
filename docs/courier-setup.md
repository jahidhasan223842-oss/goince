# Courier API setup — Steadfast / Pathao (Goince)

Admin panel-e **Settings → Courier API** theke courier connect kora jay.
Kono key hardcode kora nei — shob `settings` table-e thake.

## Steadfast

- Keys paoa jay: Steadfast merchant portal → **API** section (API Key + Secret Key).
- Settings-e: Provider = Steadfast, Enable ✓, Mode = Live, API Key + Secret Key boshan.
- Booking: `POST https://portal.packzy.com/api/v1/create_order` (headers `Api-Key`,
  `Secret-Key`), body-te `invoice` (= `GOINCE-<order id>`), `recipient_name`,
  `recipient_phone`, `recipient_address`, `cod_amount` (Paid order-e 0, na hole
  order total), `note` (product-er nam).
- Response theke `consignment.tracking_code` tracking number hisebe ar
  `consignment.consignment_id` consignment ID hisebe save hoy.
- Status: `GET /status_by_cid/{consignment_id}`.
- ⚠️ **Steadfast-er kono sandbox nei** — live key diye booking korle asol parcel
  toiri hobe. Tai "Create Consignment" chaple age confirm korte hoy.

## Pathao

- Keys paoa jay: Pathao merchant panel → API credentials (Client ID, Client Secret)
  + merchant login email/password + Store ID (store-ta age Pathao panel-e banate hoy).
- Settings-e: Provider = Pathao, Enable ✓, Mode = Sandbox (test) / Live,
  Client ID, Client Secret, Username, Password, Store ID boshan.
- Auth: OAuth2 password grant — `POST {base}/aladdin/api/v1/issue-token`
  (`client_id`, `client_secret`, `grant_type=password`, `username`, `password`)
  → `access_token` (5 din valid). Token prottek booking/status call-e notun kore
  neya hoy, tai save kore rakhte hoy na.
- Booking: `POST {base}/aladdin/api/v1/orders` (Bearer token), body-te `store_id`,
  `merchant_order_id` (= `GOINCE-<order id>`), `recipient_name`, `recipient_phone`,
  `recipient_address`, `delivery_type: 48` (normal), `item_type: 2` (parcel),
  `item_quantity`, `item_weight` (0.5 kg default), `amount_to_collect` (COD),
  `item_description`.
- Response theke `data.consignment_id` tracking number hisebe save hoy.
- Status: `GET {base}/aladdin/api/v1/orders/{consignment_id}/info`.
- Base URL: Sandbox `https://courier-api-sandbox.pathao.com`,
  Live `https://api-hermes.pathao.com`.

## Admin-e kibhabe kaj kore

- Order details page-e **🚚 Courier API — Book Parcel** box: configured thakle
  "Create Consignment" button dekhabe; na thakle Settings-e jawar hint dekhabe.
- Booking hoye gele order-e `courier_name`, `tracking_number`,
  `courier_consignment_id`, `courier_status` save hoy; **Refresh Tracking Status**
  button diye courier-er kach theke notun status ana jay.
- Manual courier/tracking field gulo ager motoi kaj kore — API na thakleo cholbe.
- Customer Track Order page-e courier + tracking number + delivery status dekhay.

## Test kora hoyni (key nei bole)

- Asol Steadfast/Pathao key chara live booking/status call test kora jayni.
  Code-er moddhe API call-er structure documented endpoint onujayi banano, ar
  fake API response diye unit test kora hoyeche (payload, header, tracking save).
- Key boshanor por prothom booking-ta ekta choto/test order diye kore dekhben.
  Pathao Sandbox diye age test kora jabe; Steadfast-e sandbox nei bole live key
  diye prothom booking asol parcel hobe.
