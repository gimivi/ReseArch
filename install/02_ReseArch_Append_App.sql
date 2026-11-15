-- =============================================================================
-- ReseArch - 02 - Dati iniziali (tabelle di riferimento)
-- =============================================================================
-- Eseguire DOPO 01_ReseArch_CreateDB.sql, sul database dell'app
-- (in phpMyAdmin: selezionare prima il database, poi Importa / SQL).
--
-- Contenuto:
--   1) `app`                 : elenco delle app proposte nella creazione di un
--                              oggetto (obj_app). Il codice deve esistere in
--                              SPEC_REGISTRY di app/template_XXX.mjs, altrimenti
--                              l'oggetto non si apre.
--   2) `pdf_highlights_type` : tipi di annotazione del visualizzatore PDF.
--                              Necessari: pdf_highlights ha una chiave esterna
--                              su questa tabella, senza tipi non si salvano note.
-- =============================================================================

--
-- 1) Dati per la tabella `app`
--

INSERT INTO `app` (`app_id`, `app_cod`, `app_title`, `app_description`) VALUES
(1, 'ECH', 'ECharts', 'Apache Echarts -  https://echarts.apache.org/en/index.html'),
(2, 'HYS', 'HySpace', 'HySpace - Museo Virtuale 2005-2026 - by Graziano Mario Valenti'),
(3, 'IFC', 'IFC Model', 'Web Ifc - That Open Company - https://github.com/thatopen/engine_web-ifc'),
(4, 'MPS', 'Google Maps', 'Google Maps Platform - https://mapsplatform.google.com/'),
(5, 'MYS', 'MySql', 'MySQL Database Service - https://www.mysql.com/it/'),
(6, 'OSD', 'OpenSeaDragon', 'High-resolution zoomable images - https://openseadragon.github.io/'),
(7, 'PJS', 'Paper Js', 'The Swiss Army Knife of Vector Graphics Scripting - https://paperjs.org/about/'),
(8, 'TJS', 'Three.js', 'Cross-browser, general-purpose 3D library - https://threejs.org/'),
(9, 'HTM', 'Html', 'File HTM in varie modalità di include'),
-- (10) 'OCV' Open CV: non ancora implementata (assente da SPEC_REGISTRY) - esclusa
(11, 'PDF', 'PDF.js', 'Web platform for parsing and rendering PDFs - https://mozilla.github.io/pdf.js/'),
(12, 'DBJ', 'DB Json', 'Viewer DB Json, realizzato con Tabulator - https://www.tabulator.info/'),
(13, 'CSV', 'CSV file', 'Viewer DB CSV, realizzato con Tabulator - https://www.tabulator.info/'),
(14, 'VID', 'MP4 file', 'Viewer video compatibili con HTML Tag Video'),
(15, 'PSG', 'Panosferico Gigapixel', 'Equirettangolari gigapixel mappate dinamicamente su poliedro sferico, realizzato in ambiente Three.js.'),
-- (16) 'FLE' LiteGraph: non è più un'APP degli oggetti (2026-10-04) — l'editor dei flow si apre dai flow, non da un oggetto - esclusa
(17, 'JSX', 'JSXGraph JS', 'Interazione Grafici per rappresentazioni matematiche\\geometriche - https://jsxgraph.org/share/'),
(18, 'OWL', 'OWL Graph', 'Rappresentazione di strutture in formato Web Ontology Language. '),
(19, 'GSH', 'Google Sheets', 'Dati da Google Sheets in formato tabellare (sola lettura), realizzato con Tabulator - https://www.google.com/sheets/about/'),
(20, 'TML', 'Timeline', 'Timeline di eventi e periodi, anche avanti Cristo, realizzata con vis-timeline - https://visjs.github.io/vis-timeline/'),
(21, 'OLY', 'Cartografia', 'Mappe e dati geografici con OpenLayers: OSM, servizi WMS/WMTS, file GeoJSON, KML, GPX, GeoTIFF, sistemi di riferimento italiani - https://openlayers.org/');

-- Ordinamento iniziale nel picker (app_access/app_status restano ai default
-- 'all'/'active').
UPDATE `app` SET `app_sort` = `app_id` * 10;
-- OLY (2026-11-04): in prova, marcata "(beta)" nel picker
UPDATE `app` SET `app_status` = 'beta' WHERE `app_cod` = 'OLY';
-- TML (2026-10-07): in prova, marcata "(beta)" nel picker
UPDATE `app` SET `app_status` = 'beta' WHERE `app_cod` = 'TML';

--
-- Profilo di abilitazione iniziale "Base", valido per tutti gli utenti
-- (vede i template avanzati). Si modifica dalla modale admin "Abilitazioni".
--
INSERT INTO `cap_profiles` (`profile_name`, `profile_desc`, `is_default`)
VALUES ('Base', 'Profilo valido per tutti gli utenti', 1);
INSERT INTO `cap_grants` (`profile_id`, `kind`, `ref`)
VALUES (LAST_INSERT_ID(), 'template_level', 'advanced');

--
-- 2) Dati per la tabella `pdf_highlights_type`
--

INSERT INTO `pdf_highlights_type` (`hlt_title`, `hlt_color`, `hlt_is_view`, `hlt_order`) VALUES
('Vista',          '#4488ff99', 1, 0),
('Importante',     '#ff444466', 0, 1),
('Nota',           '#ffff0066', 0, 2),
('Da approfondire','#44cc4466', 0, 3),
('Citazione',      '#cc44ff66', 0, 4);
