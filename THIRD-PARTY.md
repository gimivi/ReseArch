# Componenti di terze parti

ReseArch è distribuito con licenza [EUPL-1.2](LICENSE). Usa librerie e servizi di terze parti,
ciascuno con la propria licenza, elencati qui sotto. Le licenze indicate sono quelle dichiarate
dai progetti per la versione usata.

## 1. Inclusi nel repository

Questi file sono copiati nel repository; ogni cartella contiene il testo della propria licenza.

| Componente | Versione | Licenza | Cartella | Progetto |
|---|---|---|---|---|
| LiteGraph.js (fork con correzioni, vedi `PATCHES.md`) | 0.7.18 | MIT | `lib/litegraph/` | https://github.com/jagenjo/litegraph.js |
| vis-timeline | 8.5.4 | Apache-2.0 OR MIT | `lib/vis-timeline/` | https://visjs.github.io/vis-timeline/ |
| MQTT.js | — | MIT | `lib/mqtt/` | https://github.com/mqttjs/MQTT.js |
| rhino3dm | 8.17.0 | MIT | `lib/rhino3dm/` | https://github.com/mcneel/rhino3dm |
| Design Tokens Italia | — | BSD-3-Clause | `lib/design-tokens-italia/` | https://github.com/italia/design-tokens-italia |
| Titillium Web (font) | — | SIL Open Font License 1.1 | `lib/fonts/titillium-web/` | https://fonts.google.com/specimen/Titillium+Web |
| PHPMailer | 7.0.1 | LGPL-2.1 | `phpmailer/` | https://github.com/PHPMailer/PHPMailer |
| DA² — Depth Anything in Any Direction (codice del modello, senza modifiche) | commit `d659838` | Apache-2.0 | `integrations/comfyui/ComfyUI-DA2/da2_model/` (licenza in `LICENSE-DA2`) | https://github.com/EnVision-Research/DA-2 |

PHPMailer è usato senza modifiche come libreria separata (`phpmailer/src/`): può essere
sostituito con un'altra versione compatibile.

Non inclusa nel repository, da copiare a mano sul server se serve (vedi `lib/libraries.json`):
OpenCV.js 4.10.0 (Apache-2.0, https://opencv.org) in `lib/opencv/`.

## 2. Caricati dal browser da CDN (jsDelivr)

Non sono copiati nel repository: le pagine li scaricano da `cdn.jsdelivr.net` alla versione indicata.

| Componente | Versione | Licenza | Usato da |
|---|---|---|---|
| Bootstrap | 5.3.3 | MIT | interfaccia |
| Bootstrap Icons | 1.11.3 | MIT | interfaccia |
| Three.js (con gli addons) | 0.186.1 | MIT | App TJS, HYS, IFC, PSG; sfondo della pagina di accesso |
| That Open Engine: @thatopen/components, components-front, fragments | 3.6.0 | MIT | App IFC |
| web-ifc | 0.0.77 | MPL-2.0 | App IFC |
| OpenSeadragon | 6.0.0 | BSD-3-Clause | App OSD |
| openseadragon-filters | — | MIT | App OSD |
| Paper.js | 0.12.17 | MIT | App OSD (disegni sovrapposti), PJS |
| Apache ECharts | 5.6.0 | Apache-2.0 | App ECH |
| Tabulator | 6.3.1 | MIT | App CSV, DBJ, GSH, MYS |
| PDF.js (pdfjs-dist) | 3.11.174 | Apache-2.0 | App PDF |
| JSXGraph | 1.9.2 | MIT OR LGPL-3.0-or-later | App JSX |
| OpenLayers (ol) | 10.11.0 | BSD-2-Clause | App OLY |
| proj4js | 2.22.0 | MIT | App OLY |
| geotiff.js | 3.0.5 | MIT | App OLY |
| rdflib.js | 2.x | MIT | App OWL |
| Cytoscape.js | 3.x | MIT | App OWL |
| dagre / cytoscape-dagre | 0.8 / 2.x | MIT | App OWL |
| html2canvas | 1.4.1 | MIT | immagine di anteprima delle configurazioni della dashboard |

Altre librerie possono essere caricate dagli utenti nei flow (nodi Context/Library): non fanno
parte della piattaforma e hanno le loro licenze.

## 3. Servizi esterni

Usati solo se configurati; ognuno ha i propri termini di servizio.

| Servizio | Uso | Configurazione |
|---|---|---|
| Google Maps Platform (Maps JavaScript API) | App MPS | chiave in `cfg/cfg_google.php` |
| Google Sheets | App GSH, App TML (fogli pubblicati) | — |
| ORCID, Google, GitHub (OAuth) | accesso con account esterni | `cfg/cfg_sso.php` |
| OpenStreetMap e servizi WMS/WMTS | App OLY | `lib/map-services.json` |
| Wikipedia (API) | nodi Web/* dei flow | — |
| Ollama, ComfyUI (server propri) | nodi AI dei flow | indirizzo nei nodi |
| Broker MQTT | nodi dei dispositivi IoT | `cfg/cfg_iot.php` |

## 4. Loghi e marchi

I loghi in `docs/loghi/` (Ministero dell'Università e della Ricerca, PRIN, Sapienza Università di
Roma) compaiono per gli obblighi di comunicazione del finanziamento. Sono marchi dei rispettivi
titolari, non sono coperti dalla licenza EUPL-1.2 e non possono essere riusati senza il loro
permesso.
