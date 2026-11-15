-- Guide di aiuto (install/help/) nel database: modelli HTM, oggetti e collegamenti.
--
-- Uno script solo, da personalizzare nei PARAMETRI qui sotto e da rieseguire quando si vuole:
--   - un modello per ogni riga dell'elenco (saltato se nella cartella c'è già lo stesso file);
--   - un oggetto per ogni CHIAVE: la chiave è il nome del file senza cartella, estensione e
--     suffisso di lingua (help-ui-TJS.html e help-ui-TJS.en.html hanno la chiave help-ui-TJS).
--     Se nel WP c'è già un oggetto di tipo A uguale collegato a un modello con quella chiave,
--     si usa quello: non si creano doppioni, nemmeno degli oggetti creati dagli SQL del 16/10;
--   - il collegamento oggetto ↔ modello (saltato se c'è già);
--   - l'autore di modelli e oggetti, se @uid è impostato.
-- È la stessa chiave che usa il nodo ReseArch/Object/Index e che le pagine scrivono in data-help.
--
-- TRADUZIONI: aggiungere all'elenco una riga con il file tradotto (es. 'help-ui-TJS.en.html').
-- Il modello viene collegato all'oggetto che c'è già; l'App HTM apre la versione nella lingua
-- dell'interfaccia. Il suffisso va scritto in minuscolo (.en, .fr, .pt-BR).
-- Le configurazioni della dashboard salvate prima di aggiungere la traduzione vanno salvate di nuovo.
--
-- Richiede MySQL 8 (REGEXP_REPLACE). I file devono essere già caricati nella cartella dei modelli.
-- Le tabelle di lavoro sono in utf8mb4_unicode_ci come le colonne del database: i parametri di
-- testo stanno in una tabella e non in variabili @, che darebbero l'errore #1267 sulle collation.

SET NAMES utf8mb4;

-- ═════ PARAMETRI ═══════════════════════════════════════════════════════════════════════════
-- @wp e @folder vanno impostati: con NULL lo script si ferma al primo inserimento.
SET @wp        := NULL;  -- DA IMPOSTARE: id del workpackage (wp_id) che ospita le guide
SET @folder    := NULL;  -- DA IMPOSTARE: id della cartella dei modelli (mod_folder_id) con i file di help/
SET @mod_show  := 4;
SET @mod_share := 3;
SET @obj_show  := 3;
SET @obj_share := 2;
SET @uid       := 0;     -- id dell'utente autore di modelli e oggetti (0 = nessuno)

CREATE TEMPORARY TABLE tmp_help_cfg (
  path    varchar(255) NOT NULL,   -- prefisso di mod_filename (sottocartella dei file)
  type_A  varchar(255) NOT NULL,   -- tipo A degli oggetti: lo stesso scritto nel nodo Object Index
  type_B  varchar(255) NOT NULL    -- tipo B per le righe che non ne indicano uno proprio
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO tmp_help_cfg VALUES ('Help/', 'Help', 'App UI');

-- Controllo: se @wp o @folder non sono impostati questa riga dà l'errore
-- "Subquery returns more than 1 row" e lo script si ferma senza scrivere nulla.
SELECT IF(@wp IS NULL OR @folder IS NULL, (SELECT 1 UNION SELECT 2), 'parametri impostati') AS controllo_parametri;
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- Elenco delle pagine. Togliere le righe dei file che non si installano.
-- file: nome del file senza prefisso · nome e descrizione: del modello e (per la prima riga
-- di ogni chiave) dell'oggetto · titolo: va nel mod_spec · type_B: NULL = quello dei parametri.
CREATE TEMPORARY TABLE tmp_help_pages (
  ord         int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  file        varchar(255) NOT NULL,
  name        varchar(255) NOT NULL,
  description varchar(255) NOT NULL,
  title       varchar(255) NOT NULL,
  type_B      varchar(255) NULL,
  page_key    varchar(255) NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_help_pages (file, name, description, title, type_B) VALUES
  -- Pagine generali
  ('help-benvenuto.html', 'Benvenuto', 'Pagina di benvenuto per gli utenti registrati.', 'Benvenuto', NULL),
  ('help-benvenuto-guest.html', 'Benvenuto (ospiti)', 'Pagina di benvenuto per gli ospiti.', 'Benvenuto', NULL),
  ('help-app-elenco.html', 'Guida: le App', 'Elenco delle App della piattaforma, con i pulsanti per le guide del pannello e dei nodi.', 'Guida: le App', NULL),
  ('help-logo.html', 'Il logo', 'Il logo della piattaforma.', 'Il logo', NULL),
  ('help-pannello-intestazione-footer.html', 'Guida: Intestazione e footer del pannello', 'Guida all''intestazione e al footer dei pannelli.', 'Guida: Intestazione e footer del pannello', NULL),
  ('help-workflow-oggetto.html', 'Guida: definire un oggetto', 'Guida passo passo alla definizione di un oggetto.', 'Guida: definire un oggetto', NULL),
  -- Schede delle App (help-app-*)
  ('help-app-CSV.html', 'Guida: Tabelle da file CSV', 'Tabelle da file CSV: a cosa serve l''App e come si prepara il modello.', 'Guida: Tabelle da file CSV', NULL),
  ('help-app-DBJ.html', 'Guida: Tabelle JSON (DBJ)', 'Tabelle JSON (DBJ): a cosa serve l''App e come si prepara il modello.', 'Guida: Tabelle JSON (DBJ)', NULL),
  ('help-app-ECH.html', 'Guida: Grafici (ECH)', 'Grafici (ECH): a cosa serve l''App e come si prepara il modello.', 'Guida: Grafici (ECH)', NULL),
  ('help-app-GSH.html', 'Guida: Fogli Google (GSH)', 'Fogli Google (GSH): a cosa serve l''App e come si prepara il modello.', 'Guida: Fogli Google (GSH)', NULL),
  ('help-app-HTM.html', 'Guida: Pagine HTML (HTM)', 'Pagine HTML (HTM): a cosa serve l''App e come si prepara il modello.', 'Guida: Pagine HTML (HTM)', NULL),
  ('help-app-HYS.html', 'Guida: HySpace (HYS)', 'HySpace (HYS): a cosa serve l''App e come si prepara il modello.', 'Guida: HySpace (HYS)', NULL),
  ('help-app-IFC.html', 'Guida: Modelli BIM (IFC)', 'Modelli BIM (IFC): a cosa serve l''App e come si prepara il modello.', 'Guida: Modelli BIM (IFC)', NULL),
  ('help-app-JSX.html', 'Guida: Geometria interattiva (JSX)', 'Geometria interattiva (JSX): a cosa serve l''App e come si prepara il modello.', 'Guida: Geometria interattiva (JSX)', NULL),
  ('help-app-MPS.html', 'Guida: Mappe (MPS)', 'Mappe (MPS): a cosa serve l''App e come si prepara il modello.', 'Guida: Mappe (MPS)', NULL),
  ('help-app-MYS.html', 'Guida: Tabelle del database (MYS)', 'Tabelle del database (MYS): a cosa serve l''App e come si prepara il modello.', 'Guida: Tabelle del database (MYS)', NULL),
  ('help-app-OLY.html', 'Guida: Cartografia (OLY)', 'Cartografia (OLY): a cosa serve l''App e come si prepara il modello.', 'Guida: Cartografia (OLY)', NULL),
  ('help-app-OSD.html', 'Guida: Immagini gigapixel (OSD)', 'Immagini gigapixel (OSD): a cosa serve l''App e come si prepara il modello.', 'Guida: Immagini gigapixel (OSD)', NULL),
  ('help-app-OWL.html', 'Guida: Ontologie (OWL)', 'Ontologie (OWL): a cosa serve l''App e come si prepara il modello.', 'Guida: Ontologie (OWL)', NULL),
  ('help-app-PDF.html', 'Guida: Documenti PDF', 'Documenti PDF: a cosa serve l''App e come si prepara il modello.', 'Guida: Documenti PDF', NULL),
  ('help-app-TJS.html', 'Guida: App 3D (TJS)', 'App 3D (TJS): a cosa serve l''App e come si prepara il modello.', 'Guida: App 3D (TJS)', NULL),
  ('help-app-TML.html', 'Guida: Timeline (TML)', 'Timeline (TML): a cosa serve l''App e come si prepara il modello.', 'Guida: Timeline (TML)', NULL),
  ('help-app-VID.html', 'Guida: Video (VID)', 'Video (VID): a cosa serve l''App e come si prepara il modello.', 'Guida: Video (VID)', NULL),
  -- Guide del pannello (help-ui-*)
  ('help-ui-CSV.html', 'Guida: Tabelle CSV, il pannello', 'Guida all''uso del pannello Tabelle da file CSV: comandi, menu, problemi comuni.', 'Guida: Tabelle CSV, il pannello', NULL),
  ('help-ui-DBJ.html', 'Guida: Tabelle di dati, il pannello', 'Guida all''uso del pannello Tabelle di dati (DBJ): comandi, menu, problemi comuni.', 'Guida: Tabelle di dati, il pannello', NULL),
  ('help-ui-ECH.html', 'Guida: Grafici, il pannello', 'Guida all''uso del pannello Grafici (ECH): comandi, menu, problemi comuni.', 'Guida: Grafici, il pannello', NULL),
  ('help-ui-GSH.html', 'Guida: Fogli Google, il pannello', 'Guida all''uso del pannello Fogli Google (GSH): comandi, menu, problemi comuni.', 'Guida: Fogli Google, il pannello', NULL),
  ('help-ui-HTM.html', 'Guida: Pagine HTML, il pannello', 'Guida all''uso del pannello Pagine HTML (HTM): comandi, menu, problemi comuni.', 'Guida: Pagine HTML, il pannello', NULL),
  ('help-ui-HYS.html', 'Guida: Museo virtuale, il pannello', 'Guida all''uso del pannello Museo virtuale (HYS): comandi, menu, problemi comuni.', 'Guida: Museo virtuale, il pannello', NULL),
  ('help-ui-IFC.html', 'Guida: Modelli BIM, il pannello', 'Guida all''uso del pannello Modelli BIM (IFC): comandi, menu, problemi comuni.', 'Guida: Modelli BIM, il pannello', NULL),
  ('help-ui-JSX.html', 'Guida: Disegni JSX, il pannello', 'Guida all''uso del pannello Disegni matematici (JSX): comandi, menu, problemi comuni.', 'Guida: Disegni JSX, il pannello', NULL),
  ('help-ui-MPS.html', 'Guida: Mappe, il pannello', 'Guida all''uso del pannello Mappe (MPS): comandi, menu, problemi comuni.', 'Guida: Mappe, il pannello', NULL),
  ('help-ui-MYS.html', 'Guida: Database, il pannello', 'Guida all''uso del pannello Tabelle del database (MYS): comandi, menu, problemi comuni.', 'Guida: Database, il pannello', NULL),
  ('help-ui-OLY.html', 'Guida: Cartografia, il pannello', 'Guida all''uso del pannello Cartografia (OLY): comandi, finestre, disegno, problemi comuni.', 'Guida: Cartografia, il pannello', NULL),
  ('help-ui-OSD.html', 'Guida: Immagini, il pannello', 'Guida all''uso del pannello Immagini ad alta risoluzione (OSD): comandi, menu, problemi comuni.', 'Guida: Immagini, il pannello', NULL),
  ('help-ui-OWL.html', 'Guida: Ontologie, il pannello', 'Guida all''uso del pannello Ontologie (OWL): comandi, menu, problemi comuni.', 'Guida: Ontologie, il pannello', NULL),
  ('help-ui-PDF.html', 'Guida: PDF, il pannello', 'Guida all''uso del pannello Documenti PDF: comandi, menu, problemi comuni.', 'Guida: PDF, il pannello', NULL),
  ('help-ui-TJS.html', 'Guida: App 3D, il pannello', 'Guida all''uso del pannello App 3D (TJS): comandi, menu, problemi comuni.', 'Guida: App 3D, il pannello', NULL),
  ('help-ui-TML.html', 'Guida: Timeline, il pannello', 'Guida all''uso del pannello Timeline (TML): comandi, menu, problemi comuni.', 'Guida: Timeline, il pannello', NULL),
  ('help-ui-VID.html', 'Guida: Video, il pannello', 'Guida all''uso del pannello Video (VID): comandi, menu, problemi comuni.', 'Guida: Video, il pannello', NULL),
  -- Guide dei nodi (help-nodes-*)
  ('help-nodes-DBJ.html', 'Guida: Tabelle di dati, i nodi', 'Guida sintetica ai nodi dei flow per Tabelle di dati (DBJ): famiglie e una riga per nodo.', 'Guida: Tabelle di dati, i nodi', NULL),
  ('help-nodes-ECH.html', 'Guida: Grafici, i nodi', 'Guida sintetica ai nodi dei flow per Grafici (ECH): famiglie e una riga per nodo.', 'Guida: Grafici, i nodi', NULL),
  ('help-nodes-GSH.html', 'Guida: Fogli Google, i nodi', 'Guida sintetica ai nodi dei flow per Fogli Google (GSH): famiglie e una riga per nodo.', 'Guida: Fogli Google, i nodi', NULL),
  ('help-nodes-HTM.html', 'Guida: Pagine HTML, i nodi', 'Guida sintetica ai nodi dei flow per Pagine HTML (HTM): famiglie e una riga per nodo.', 'Guida: Pagine HTML, i nodi', NULL),
  ('help-nodes-IFC.html', 'Guida: Modelli BIM, i nodi', 'Guida sintetica ai nodi dei flow per Modelli BIM (IFC): famiglie e una riga per nodo.', 'Guida: Modelli BIM, i nodi', NULL),
  ('help-nodes-HYS.html', 'Guida: Museo virtuale, i nodi', 'Guida sintetica ai nodi dei flow per Museo virtuale (HYS): famiglie e una riga per nodo.', 'Guida: Museo virtuale, i nodi', NULL),
  ('help-nodes-JSX.html', 'Guida: Disegni JSX, i nodi', 'Guida sintetica ai nodi dei flow per Disegni matematici (JSX): famiglie e una riga per nodo.', 'Guida: Disegni JSX, i nodi', NULL),
  ('help-nodes-MPS.html', 'Guida: Mappe, i nodi', 'Guida sintetica ai nodi dei flow per Mappe (MPS): famiglie e una riga per nodo.', 'Guida: Mappe, i nodi', NULL),
  ('help-nodes-MYS.html', 'Guida: Database, i nodi', 'Guida sintetica ai nodi dei flow per Tabelle del database (MYS): famiglie e una riga per nodo.', 'Guida: Database, i nodi', NULL),
  ('help-nodes-OLY.html', 'Guida: Cartografia, i nodi', 'Guida sintetica ai nodi dei flow per Cartografia (OLY): famiglie e una riga per nodo.', 'Guida: Cartografia, i nodi', NULL),
  ('help-nodes-OSD.html', 'Guida: Immagini, i nodi', 'Guida sintetica ai nodi dei flow per Immagini ad alta risoluzione (OSD): famiglie e una riga per nodo.', 'Guida: Immagini, i nodi', NULL),
  ('help-nodes-PDF.html', 'Guida: PDF, i nodi', 'Guida sintetica ai nodi dei flow per Documenti PDF: famiglie e una riga per nodo.', 'Guida: PDF, i nodi', NULL),
  ('help-nodes-TJS.html', 'Guida: App 3D, i nodi', 'Guida sintetica ai nodi dei flow per App 3D (TJS): famiglie e una riga per nodo.', 'Guida: App 3D, i nodi', NULL),
  ('help-nodes-TML.html', 'Guida: Timeline, i nodi', 'Guida sintetica ai nodi dei flow per Timeline (TML): famiglie e una riga per nodo.', 'Guida: Timeline, i nodi', NULL),
  -- Guide di approfondimento
  ('help-comfyui.html', 'Guida: ComfyUI', 'Guida all''uso di ComfyUI nei flow.', 'Guida: ComfyUI', NULL),
  ('help-tml-css.html', 'Guida: Timeline, stile CSS', 'Guida allo stile CSS della Timeline.', 'Guida: Timeline, stile CSS', NULL)
  -- Traduzioni: una riga per file tradotto, come questa (togliere i due trattini iniziali):
  -- ,('help-ui-TJS.en.html', 'Guide: 3D App, the panel', 'How to use the 3D App panel (TJS).', 'Guide: 3D App, the panel', NULL)
;

START TRANSACTION;

-- 1. Chiave di ogni riga
UPDATE tmp_help_pages
SET page_key = REGEXP_REPLACE(REGEXP_REPLACE(file, '[.][^.]+$', ''), '[.][a-z]{2}(-[A-Za-z]{2})?$', '', 1, 0, 'c');

-- 2. Modelli
INSERT INTO models (wp_id, mod_folder_id, mod_name, mod_description, mod_filename, mod_spec, mod_fle, mod_show, mod_share)
SELECT @wp, @folder, t.name, t.description, CONCAT(c.path, t.file),
       JSON_OBJECT('mode', 'flow', 'title', t.title), NULL, @mod_show, @mod_share
FROM tmp_help_pages t
CROSS JOIN tmp_help_cfg c
WHERE NOT EXISTS (
  SELECT 1 FROM models m
  WHERE m.wp_id = @wp AND m.mod_folder_id = @folder AND m.mod_filename = CONCAT(c.path, t.file)
);

-- 3. Una riga per chiave (la prima dell'elenco dà nome, descrizione e tipo B all'oggetto)
CREATE TEMPORARY TABLE tmp_help_keys (
  page_key varchar(255) NOT NULL PRIMARY KEY,
  ord      int NOT NULL,
  obj_id   int NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO tmp_help_keys (page_key, ord)
SELECT page_key, MIN(ord) FROM tmp_help_pages GROUP BY page_key;

-- 4. Oggetto già presente per la chiave (come nel nodo Object Index: il più vecchio)
UPDATE tmp_help_keys k
JOIN (
  SELECT REGEXP_REPLACE(REGEXP_REPLACE(SUBSTRING_INDEX(m.mod_filename, '/', -1), '[.][^.]+$', ''),
                        '[.][a-z]{2}(-[A-Za-z]{2})?$', '', 1, 0, 'c') AS page_key,
         MIN(o.obj_id) AS obj_id
  FROM objects o
  CROSS JOIN tmp_help_cfg c
  JOIN object_models_connections omc ON omc.obj_id = o.obj_id
  JOIN models m ON m.mod_id = omc.mod_id
  WHERE o.wp_id = @wp AND o.obj_app = 'HTM' AND o.obj_type_A = c.type_A
  GROUP BY page_key
) x ON x.page_key = k.page_key
SET k.obj_id = x.obj_id;

-- 5. Oggetti nuovi per le chiavi che non ne hanno
INSERT INTO objects (wp_id, obj_name, obj_description, obj_type_A, obj_type_B, obj_app, obj_show, obj_share)
SELECT @wp, t.name, t.description, c.type_A, COALESCE(t.type_B, c.type_B), 'HTM', @obj_show, @obj_share
FROM tmp_help_keys k
JOIN tmp_help_pages t ON t.ord = k.ord
CROSS JOIN tmp_help_cfg c
WHERE k.obj_id IS NULL;

-- ... e il loro obj_id: l'oggetto più recente con quel nome, tipo e ancora senza modelli
UPDATE tmp_help_keys k
JOIN tmp_help_pages t ON t.ord = k.ord
JOIN (
  SELECT o.obj_name, MAX(o.obj_id) AS obj_id
  FROM objects o
  CROSS JOIN tmp_help_cfg c
  WHERE o.wp_id = @wp AND o.obj_app = 'HTM' AND o.obj_type_A = c.type_A
    AND NOT EXISTS (SELECT 1 FROM object_models_connections omc WHERE omc.obj_id = o.obj_id)
  GROUP BY o.obj_name
) x ON x.obj_name = t.name
SET k.obj_id = x.obj_id
WHERE k.obj_id IS NULL;

-- 6. Collegamenti oggetto ↔ modello
INSERT INTO object_models_connections (obj_id, mod_id)
SELECT k.obj_id, m.mod_id
FROM tmp_help_pages t
JOIN tmp_help_keys k ON k.page_key = t.page_key
CROSS JOIN tmp_help_cfg c
JOIN models m ON m.wp_id = @wp AND m.mod_folder_id = @folder AND m.mod_filename = CONCAT(c.path, t.file)
WHERE k.obj_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM object_models_connections omc WHERE omc.obj_id = k.obj_id AND omc.mod_id = m.mod_id);

-- 7. Autori (diritto di modifica), solo se @uid è impostato
INSERT IGNORE INTO authors_models (mod_id, auth_id, auth_role, auth_ord)
SELECT m.mod_id, @uid, 'A', 1
FROM tmp_help_pages t
CROSS JOIN tmp_help_cfg c
JOIN models m ON m.wp_id = @wp AND m.mod_folder_id = @folder AND m.mod_filename = CONCAT(c.path, t.file)
WHERE @uid > 0;

INSERT IGNORE INTO authors_objects (obj_id, auth_id, auth_role, auth_ord)
SELECT k.obj_id, @uid, 'A', 1
FROM tmp_help_keys k
WHERE @uid > 0 AND k.obj_id IS NOT NULL;

COMMIT;

-- Controllo: una riga per file installato. obj_id NULL = qualcosa non è andato.
SELECT t.page_key, k.obj_id, m.mod_id, m.mod_filename, m.mod_name
FROM tmp_help_pages t
JOIN tmp_help_keys k ON k.page_key = t.page_key
CROSS JOIN tmp_help_cfg c
LEFT JOIN models m ON m.wp_id = @wp AND m.mod_folder_id = @folder AND m.mod_filename = CONCAT(c.path, t.file)
ORDER BY t.ord;

DROP TEMPORARY TABLE tmp_help_keys;
DROP TEMPORARY TABLE tmp_help_pages;
DROP TEMPORARY TABLE tmp_help_cfg;
