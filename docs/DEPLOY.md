# Deploying to SAP BTP (trial or productive Cloud Foundry)

Target landscape after deployment:

| Cloud Foundry app / service | Type | Purpose |
|---|---|---|
| `order-mgmt-cap` | app (App Router) | entry point, login via XSUAA, serves UI from HTML5 repo |
| `order-mgmt-cap-srv` | app (Node.js) | CAP OData V4 service |
| `order-mgmt-cap-db-deployer` | task-like app | deploys HDI artifacts to HANA Cloud, then stops |
| `order-mgmt-cap-app-deployer` | content deployer | uploads `orders.zip` to the HTML5 Application Repository |
| `order-mgmt-cap-auth` | `xsuaa` / `application` | scopes, role templates, role collections |
| `order-mgmt-cap-db` | `hana` / `hdi-shared` | HDI container in HANA Cloud |
| `order-mgmt-cap-destination` | `destination` / `lite` | resolves `srv-api` and `S4_BUPA` |
| `order-mgmt-cap-html5-repo-host` / `-runtime` | `html5-apps-repo` | store / serve the UI |

## 0. Tools (WSL / Linux / macOS)

```bash
node -v                    # 22.x
npm i -g @sap/cds-dk mbt   # CAP CLI + Cloud MTA Build Tool
cf -v                      # CF CLI v8
cf install-plugin multiapps -f   # adds `cf deploy`
```

## 1. Subaccount and entitlements

1. BTP cockpit → trial subaccount (Cloud Foundry enabled, space `dev`).
2. **Entitlements** — make sure these service plans are assigned (trial has most of them):

| Service | Plan |
|---|---|
| Authorization and Trust Management Service (`xsuaa`) | `application` |
| SAP HANA Cloud | `hana-free` (trial) / `hana`, and `tools` |
| SAP HANA Schemas & HDI Containers (`hana`) | `hdi-shared` |
| Destination Service | `lite` |
| HTML5 Application Repository Service | `app-host`, `app-runtime` |

## 2. SAP HANA Cloud instance

1. Subscribe to **SAP HANA Cloud** (plan `tools`) and assign yourself the role collection
   `SAP HANA Cloud Administrator`.
2. Open **SAP HANA Cloud Central** → *Create Instance* → SAP HANA Database.
3. *Instance mapping*: map to your Cloud Foundry org/space (or at least
   *Allowed connections: Allow all IP addresses*).
4. Trial instances are **stopped every night** — start the instance before a deployment or a demo.

## 3. Destination to S/4HANA (`S4_BUPA`)

For a demo without an own S/4HANA system use the SAP API Business Hub sandbox:

1. Log in at <https://api.sap.com>, open *API_BUSINESS_PARTNER*, copy your **API key**.
2. Cockpit → subaccount → **Connectivity → Destinations → New Destination**:

| Field | Value |
|---|---|
| Name | `S4_BUPA` |
| Type | `HTTP` |
| URL | `https://sandbox.api.sap.com/s4hanacloud` |
| Proxy Type | `Internet` |
| Authentication | `NoAuthentication` |
| Additional property | `URL.headers.APIKey` = *your API key* |

The service appends the path `/sap/opu/odata/sap/API_BUSINESS_PARTNER`
(see `cds.requires.API_BUSINESS_PARTNER` in `package.json`).

For a real customer system: S/4HANA Cloud → communication arrangement `SAP_COM_0008`
and `BasicAuthentication` / `OAuth2SAMLBearerAssertion`; S/4HANA on-premise →
`ProxyType: OnPremise` + Cloud Connector + a Connectivity service binding (add
`connectivity` / `lite` to `mta.yaml`). The application code stays the same.

## 4. Build and deploy

```bash
cf login -a https://api.cf.us10-001.hana.ondemand.com   # API endpoint from the subaccount overview
cf target -s dev

mbt build -t ./mta_archives
cf deploy mta_archives/order-mgmt-cap_1.0.0.mtar
```

`mbt build` runs `npm ci` + `cds build --production` (generates `gen/srv`, `gen/db`
with `.hdbtable` / `.hdbview` artifacts) and builds the UI5 app into `orders.zip`.

## 5. Authorization

`cf deploy` creates two role collections from `mta.yaml`:

- `OrderViewer (order-mgmt-cap <org>-<space>)`
- `OrderManager (order-mgmt-cap <org>-<space>)`

Cockpit → **Security → Users** → your user → *Assign Role Collection* → `OrderManager …`.
Log out of the app (or open a private window) so that a new JWT with the scope is issued.

## 6. Open the application

```bash
cf apps        # route of `order-mgmt-cap`
```

- UI: `https://<org>-<space>-order-mgmt-cap.cfapps.us10-001.hana.ondemand.com/`
  (welcome page → `/comyuryordermgmtorders/index.html`)
- OData: `…/odata/v4/order/Orders`, `…/odata/v4/order/BusinessPartners` (live call to S/4 via destination)

Smoke test: create an order with two items → **Save** → **Submit** (stock is reduced)
→ **Ship**. With `OrderViewer` only, the Create/Edit buttons and actions return 403.

## 7. Troubleshooting

| Symptom | Where to look / fix |
|---|---|
| `db-deployer` fails, "connection refused" / "instance not running" | HANA Cloud instance stopped (trial) or not mapped to the space |
| 403 on every request after login | role collection not assigned, or old token — log out / private window |
| 401 from the service directly (`-srv` URL) | expected: call the service through the App Router |
| `BusinessPartners` → 502 / "destination not found" | destination name must be `S4_BUPA`; check `URL.headers.APIKey` |
| App Router shows 404 for the UI | check `order-mgmt-cap-app-deployer` logs; the app path is the `sap.app.id` without dots (`/comyuryordermgmtorders/`) |
| Any runtime error | `cf logs order-mgmt-cap-srv --recent`, `cf logs order-mgmt-cap --recent` |
| Trial memory quota exceeded | `cf apps`, stop old apps; modules here use 256 MB each |

## 8. Clean up

```bash
cf undeploy order-mgmt-cap --delete-services --delete-service-keys
```
