# ReseArch

ReseArch è una piattaforma web per visualizzare, elaborare e mettere in relazione modelli digitali
eterogenei (modelli 3D, immagini gigapixel, mappe, documenti PDF, tabelle, grafici, ontologie,
linee del tempo, modelli BIM) dentro una dashboard a finestre configurabile. È pensata per la
ricerca scientifica e umanistica, in particolare per i beni culturali e l'architettura.

*ReseArch is a web platform to view, process and connect heterogeneous digital models (3D, gigapixel
images, maps, PDFs, tables, charts, ontologies, timelines, BIM) in a configurable windowed
dashboard, designed for research in the humanities and sciences. The interface is available in
Italian and English.*

## Caratteristiche

- **Ricerche e workpackage**: i contenuti sono organizzati per ricerca e workpackage, con ruoli,
  permessi e livelli di visibilità per utenti, gruppi e ospiti.
- **Oggetti e modelli**: ogni oggetto è mostrato da un'App e raccoglie uno o più modelli (file o
  sorgenti di dati) con la loro configurazione JSON (`mod_spec`), guidata da template.
- **Dashboard a finestre**: pannelli affiancabili e ridimensionabili; le configurazioni si salvano
  e si condividono.
- **Flow**: un editor visuale a nodi (basato su LiteGraph.js) collega le App tra loro e con
  servizi esterni (mappe, Wikipedia, server AI come Ollama e ComfyUI, dispositivi IoT via MQTT).
- **Accesso**: registrazione con verifica dell'email, recupero password, accesso con ORCID,
  Google o GitHub (facoltativo).
- **Interfaccia** in italiano e inglese, attenta all'accessibilità (WCAG 2.1 AA, linee guida AgID).

### App disponibili

| Codice | App | Libreria principale |
|---|---|---|
| TJS | Modelli 3D, nuvole di punti, panoramiche | Three.js |
| IFC | Modelli BIM (IFC) | That Open Engine, web-ifc |
| OSD | Immagini ad altissima risoluzione, con disegni sovrapposti | OpenSeadragon, Paper.js |
| PSG | Panoramiche sferiche gigapixel (in sviluppo) | Three.js |
| HYS | Museo virtuale HySpace | Three.js |
| MPS | Google Maps 2D e 3D | Google Maps JavaScript API |
| OLY | Cartografia: OSM, WMS/WMTS, GeoJSON, KML, GPX, GeoTIFF | OpenLayers |
| TML | Linee del tempo (anche avanti Cristo) | vis-timeline |
| PDF | Documenti PDF con annotazioni | PDF.js |
| ECH | Grafici | Apache ECharts |
| CSV / DBJ / GSH / MYS | Tabelle da CSV, JSON, Google Sheets, MySQL | Tabulator |
| JSX | Geometria e grafici matematici | JSXGraph |
| OWL | Ontologie (Web Ontology Language) come grafo | rdflib.js, Cytoscape.js |
| HTM | Pagine HTML nella dashboard, anche guidate da un flow | — |
| VID | Video | HTML5 |

## Requisiti

- Server web Apache (con `.htaccess`) oppure IIS (con `Web.config`)
- PHP 8.0 o superiore, con le estensioni `pdo_mysql`, `mbstring` e `curl`
- MySQL 8 oppure MariaDB 10.5 o superiore, charset `utf8mb4`
- Un account SMTP per le email (verifica dell'indirizzo, recupero password)

Non servono passaggi di compilazione: le librerie JavaScript sono caricate da CDN o incluse in `lib/`.

## Installazione

La guida completa è in [`install/Steps2install.txt`](install/Steps2install.txt). In breve:

1. Copiare i file sul server web, in una cartella pubblicata.
2. Creare accanto alla cartella dell'app la cartella dei dati `RA_Data` e copiarvi il file di
   protezione adatto al server da `install/RA_Data/` (`.htaccess` o `web.config`).
3. Creare il database, selezionarlo ed eseguire in ordine gli script di `install/`:
   `01_ReseArch_CreateDB.sql`, `02_ReseArch_Append_App.sql`, `03_ReseArch_Users.sql` (parte A),
   `04_ReseArch_Templates.sql`.
4. In `cfg/`, creare i file di configurazione copiando i modelli `*.example.php`
   (`cfg_MYSQL.php`, `cfg_SMTP.php`, `cfg_google.php`, `grid_schema.php`, e se servono
   `cfg_sso.php`, `cfg_iot.php`) e compilarli.
5. Registrare il primo utente da `register.php` e renderlo amministratore con la parte B di
   `03_ReseArch_Users.sql`.
6. Facoltativo: caricare le guide di `install/help/` come modelli ed eseguire
   `05_ReseArch_Help_Pages.sql`.

I file di `cfg/` con password e chiavi sono esclusi da git: non vanno mai pubblicati.

## Struttura delle cartelle

| Cartella | Contenuto |
|---|---|
| `/` | pagine PHP (accesso, ricerche, workpackage, dashboard, account) |
| `api/` | servizi PHP chiamati dalle pagine |
| `app/` | App della dashboard (`model_XXX.mjs`), flow e nodi (`*_sub_modules/`) |
| `ui/` | finestre modali e componenti dell'interfaccia |
| `css/`, `js/`, `img/`, `partials/` | stili, script comuni, immagini, parti di pagina |
| `lang/` | testi dell'interfaccia (`it.json`, `en.json`) |
| `lib/` | librerie incluse (vedi [THIRD-PARTY.md](THIRD-PARTY.md)) |
| `phpmailer/` | PHPMailer, per l'invio delle email |
| `cfg/` | configurazione (non accessibile dal web) |
| `install/` | script SQL, guida di installazione, guide di aiuto, file di protezione di `RA_Data` |
| `integrations/` | estensioni per servizi esterni (nodi per ComfyUI) |
| `docs/` | immagini del README (loghi del finanziamento) |

I commenti nel codice che citano `_doc/`, `_dev/` o migrazioni in `sql/` rimandano alla documentazione
di progetto e agli strumenti di sviluppo, che non sono in questo repository: la documentazione sarà
pubblicata separatamente.

## Origine e finanziamento

<p><img src="docs/loghi/mur-prin-sapienza.png" alt="Ministero dell'Università e della Ricerca, PRIN – Progetti di Ricerca di Rilevante Interesse Nazionale, Sapienza Università di Roma" width="100%"></p>

ReseArch è stata ideata e sviluppata da Graziano Mario Valenti (Sapienza Università di Roma)
nell'ambito del progetto di ricerca **SCAENAE – Teatro barocco italiano. Paradigmi della scena e
della memoria culturale** (*SCAENAE – Italian Baroque Theatre. Paradigms of Scene and Cultural
Memory*), PRIN 2022, prot. 20223835NX, CUP B53C24007890006, di cui è la piattaforma digitale
collaborativa.

Realizzata con il finanziamento del Ministero dell'Università e della Ricerca nell'ambito del Bando
relativo allo scorrimento delle graduatorie finali del bando PRIN 2022 (D.D. n. 104 del 2 febbraio
2022; D.S.G. n. 1401 del 18 settembre 2024).

Unità di ricerca del progetto:

- **Sapienza Università di Roma**: Graziano Mario Valenti, responsabile scientifico del progetto (PI);
- **Università Iuav di Venezia**: Gabriella Liva. L'unità è stata ideata e guidata da Massimiliano
  Ciammaichella, che ricordiamo con affetto e gratitudine;
- **Consiglio Nazionale delle Ricerche, Istituto di Scienze del Patrimonio Culturale (CNR-ISPC)**:
  Elena Gigliarelli.

ReseArch è stata sviluppata con l'assistenza di strumenti di intelligenza artificiale, in prevalenza
Claude (Anthropic); il progetto, le scelte e la revisione del codice sono dell'autore.

Per citare ReseArch: vedi [CITATION.cff](CITATION.cff) (su GitHub, "Cite this repository").

## Licenza

Copyright © 2026 Graziano Mario Valenti.

ReseArch è distribuito con la licenza **European Union Public Licence v. 1.2** (EUPL-1.2): vedi
[LICENSE](LICENSE). La EUPL è disponibile, con pari valore, in tutte le lingue ufficiali dell'Unione
europea, compreso l'italiano: https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12

Le librerie e i servizi di terze parti hanno le proprie licenze: vedi [THIRD-PARTY.md](THIRD-PARTY.md).
I loghi in `docs/loghi/` sono marchi dei rispettivi titolari e non sono coperti dalla EUPL.
