-- =============================================================================
-- ReseArch - 01 - Creazione struttura database (tabelle vuote)
-- =============================================================================
-- Origine: struttura del database in produzione (phpMyAdmin 5.2.3, MySQL 8.0),
-- 2026-11-14, senza le tabelle di uso specifico dei progetti.
-- Requisiti: MySQL 8.x (o MariaDB >= 10.5), charset utf8mb4.
--
-- Prima di importare: creare il database (o usare quello assegnato dal provider,
-- es. Sql123456_1 su hosting condiviso) e SELEZIONARLO in phpMyAdmin.
-- Lo script non crea né seleziona database.
-- Il nome usato deve coincidere con 'db_main' in cfg/cfg_MYSQL.php.
--
-- Le tabelle di dati dei singoli progetti (App MYS, cfg 'db_data') vanno in un
-- database separato: non fanno parte dell'installazione della piattaforma.
--
-- Dopo questo script: 02_ReseArch_Append_App.sql (dati iniziali),
-- 03_ReseArch_Users.sql (utente MySQL dell'app + amministratore) e
-- 04_ReseArch_Templates.sql (template dei mod_spec).
-- =============================================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

-- --------------------------------------------------------

--
-- Struttura della tabella `a11y_feedback`
--

CREATE TABLE `a11y_feedback` (
  `fb_id` int UNSIGNED NOT NULL,
  `fb_created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fb_user_id` int DEFAULT NULL,
  `fb_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `fb_email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `fb_page` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `fb_message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `fb_lang` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `fb_status` enum('new','done') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `activity_log`
--

CREATE TABLE `activity_log` (
  `id` bigint UNSIGNED NOT NULL,
  `user_id` int NOT NULL,
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `entity_id` int DEFAULT NULL,
  `entity_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `detail` json DEFAULT NULL,
  `ip` varchar(45) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `app`
--

CREATE TABLE `app` (
  `app_id` int NOT NULL,
  `app_cod` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `app_title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `app_description` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `app_access` enum('all','granted','admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'all',
  `app_status` enum('active','beta','hidden') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `app_sort` int NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `authors_flows`
--

CREATE TABLE `authors_flows` (
  `flow_id` int NOT NULL,
  `auth_id` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `authors_models`
--

CREATE TABLE `authors_models` (
  `mod_id` int NOT NULL,
  `auth_id` int NOT NULL,
  `auth_role` char(1) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'A',
  `auth_ord` smallint UNSIGNED NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `authors_objects`
--

CREATE TABLE `authors_objects` (
  `obj_id` int NOT NULL,
  `auth_id` int NOT NULL,
  `auth_role` char(1) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'A',
  `auth_ord` smallint UNSIGNED NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `cap_grants`
--

CREATE TABLE `cap_grants` (
  `profile_id` int NOT NULL,
  `kind` enum('app','template_level','perm') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `cap_profiles`
--

CREATE TABLE `cap_profiles` (
  `profile_id` int NOT NULL,
  `profile_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `profile_desc` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `csp_reports`
--

CREATE TABLE `csp_reports` (
  `csp_id` int NOT NULL,
  `directive` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `blocked` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `page` varchar(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `hits` int NOT NULL DEFAULT '1',
  `sample` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `first_seen` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `drawings_osd_pjs`
--

CREATE TABLE `drawings_osd_pjs` (
  `dwg_id` int NOT NULL,
  `mod_id` int NOT NULL,
  `dwg_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dwg_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dwg_version` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dwg_author_id` int NOT NULL,
  `dwg_time_first` datetime NOT NULL,
  `dwg_time_last` datetime NOT NULL,
  `dwg_sce_json` json NOT NULL,
  `dwg_show` int NOT NULL DEFAULT '1',
  `dwg_share` int NOT NULL DEFAULT '1',
  `dwg_delete` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `email_verification_tokens`
--

CREATE TABLE `email_verification_tokens` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `events`
--

CREATE TABLE `events` (
  `id` bigint UNSIGNED NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `res_id` int DEFAULT NULL,
  `wp_id` int NOT NULL,
  `topic` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payload` json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `fle_library_nodes`
--

CREATE TABLE `fle_library_nodes` (
  `lib_id` int NOT NULL,
  `lib_category` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `lib_name` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `lib_version` int NOT NULL DEFAULT '1',
  `lib_desc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `lib_inputs` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `lib_outputs` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `lib_code` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `lib_status` enum('approved','retired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'approved',
  `source_flow_id` int DEFAULT NULL,
  `approved_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `flows`
--

CREATE TABLE `flows` (
  `flow_id` int NOT NULL,
  `flow_wp` int NOT NULL,
  `flow_type` enum('object','dashboard') COLLATE utf8mb4_unicode_ci NOT NULL,
  `flow_role` enum('behavior','config') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'behavior',
  `flow_name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Nuovo flusso',
  `flow_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `flow_fle` json DEFAULT NULL,
  `flow_fle_published` json DEFAULT NULL,
  `flow_hash_published` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `flow_review` enum('none','pending','approved') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none',
  `flow_show` tinyint NOT NULL DEFAULT '1',
  `flow_share` tinyint NOT NULL DEFAULT '1',
  `flow_edit` tinyint(1) NOT NULL DEFAULT '1',
  `author_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

-- --------------------------------------------------------

--
-- Struttura della tabella `flow_validations`
--

CREATE TABLE `flow_validations` (
  `val_id` int NOT NULL,
  `flow_id` int NOT NULL,
  `flow_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `flow_fle` json NOT NULL,
  `validated_by` int NOT NULL,
  `validated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `note` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `revoked_at` datetime DEFAULT NULL,
  `revoked_by` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `folders`
--

CREATE TABLE `folders` (
  `folder_id` int NOT NULL,
  `folder_name` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `folder_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator_id` int NOT NULL,
  `folder_parent_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `guest_access_log`
--

CREATE TABLE `guest_access_log` (
  `ga_id` bigint UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `provider` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ip` varchar(45) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `event` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `json_template`
--

CREATE TABLE `json_template` (
  `template_id` int NOT NULL,
  `template_name` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_help` varchar(1500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_json` json NOT NULL,
  `template_extension` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `models`
--

CREATE TABLE `models` (
  `mod_id` int NOT NULL,
  `wp_id` int NOT NULL,
  `mod_folder_id` int NOT NULL,
  `mod_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mod_description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mod_filename` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mod_spec` json NOT NULL,
  `mod_show` tinyint NOT NULL DEFAULT '0',
  `mod_share` tinyint NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `mod_spec_templates`
--

CREATE TABLE `mod_spec_templates` (
  `tpl_id` int NOT NULL,
  `app_cod` varchar(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tpl_name` varchar(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tpl_level` enum('base','advanced') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'base',
  `tpl_help` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tpl_spec` json NOT NULL,
  `tpl_sort` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `objects`
--

CREATE TABLE `objects` (
  `obj_id` int NOT NULL,
  `wp_id` int NOT NULL,
  `obj_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `obj_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `obj_type_A` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `obj_type_B` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `obj_app` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `obj_show` tinyint NOT NULL DEFAULT '0',
  `obj_share` tinyint DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `object_flows_connections`
--

CREATE TABLE `object_flows_connections` (
  `id` int NOT NULL,
  `flow_id` int NOT NULL,
  `flow_type` enum('object','dashboard') COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `object_models_connections`
--

CREATE TABLE `object_models_connections` (
  `id` int NOT NULL,
  `obj_id` int NOT NULL,
  `mod_id` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `password_reset_tokens`
--

CREATE TABLE `password_reset_tokens` (
  `prt_id` int NOT NULL,
  `user_id` int NOT NULL,
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `request_ip` varchar(45) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `pdf_highlights`
--

CREATE TABLE `pdf_highlights` (
  `hl_id` int NOT NULL,
  `mod_id` int NOT NULL,
  `hlt_id` int NOT NULL,
  `hl_text` text COLLATE utf8mb4_unicode_ci,
  `hl_label` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hl_note` text COLLATE utf8mb4_unicode_ci,
  `hl_tags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hl_page` int NOT NULL DEFAULT '1',
  `hl_scale` float NOT NULL DEFAULT '1',
  `hl_rotation` int NOT NULL DEFAULT '0',
  `hl_spread` tinyint NOT NULL DEFAULT '0',
  `hl_scroll_top` float NOT NULL DEFAULT '0',
  `hl_scroll_left` float NOT NULL DEFAULT '0',
  `hl_rects` json DEFAULT NULL,
  `hl_marker_x` float DEFAULT NULL,
  `hl_marker_y` float DEFAULT NULL,
  `hl_created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `hl_user_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `pdf_highlights_type`
--

CREATE TABLE `pdf_highlights_type` (
  `hlt_id` int NOT NULL,
  `hlt_title` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hlt_color` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'hex con alpha, es. #ffff0066',
  `hlt_is_view` tinyint NOT NULL DEFAULT '0' COMMENT '1 = tipo vista, 0 = evidenziazione',
  `hlt_order` int NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `researches`
--

CREATE TABLE `researches` (
  `res_id` int NOT NULL,
  `res_folder_id` int NOT NULL,
  `res_year` year NOT NULL,
  `res_title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `res_subtitle` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `res_abstract` varchar(1500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `res_caption` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `res_color` char(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#555555',
  `res_show` tinyint NOT NULL,
  `res_lang` varchar(5) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'it',
  `res_profile` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'research'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `res_res_permissions`
--

CREATE TABLE `res_res_permissions` (
  `res_requester` int NOT NULL,
  `res_granter` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

-- --------------------------------------------------------

--
-- Struttura della tabella `users`
--

CREATE TABLE `users` (
  `id` int NOT NULL,
  `first_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_verified` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `user_type` varchar(1) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'V',
  `user_lang` varchar(5) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `users_cap_profiles`
--

CREATE TABLE `users_cap_profiles` (
  `user_id` int NOT NULL,
  `profile_id` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `users_identities`
--

CREATE TABLE `users_identities` (
  `provider` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `display_name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `linked_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `users_res_permissions`
--

CREATE TABLE `users_res_permissions` (
  `user_id` int NOT NULL,
  `res_id` int NOT NULL,
  `perm` enum('X','A','E','G','P','I','T','V','W','C') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'G'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `users_sessions`
--

CREATE TABLE `users_sessions` (
  `session_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int NOT NULL,
  `last_activity` datetime NOT NULL,
  `ip` varchar(45) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `current_page` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `guest_label` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `users_wp_permissions`
--

CREATE TABLE `users_wp_permissions` (
  `user_id` int NOT NULL,
  `wp_id` int NOT NULL,
  `perm` enum('X','A','E','G','P','I','T','V','W','C') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'V'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `workpackages`
--

CREATE TABLE `workpackages` (
  `wp_id` int NOT NULL,
  `res_id` int NOT NULL,
  `wp_folder_id` int NOT NULL,
  `wp_title` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `wp_subtitle` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `wp_abstract` varchar(1500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `wp_caption` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `wp_ord` tinyint NOT NULL,
  `wp_show` tinyint NOT NULL DEFAULT '0',
  `wp_share` tinyint NOT NULL DEFAULT '0',
  `wp_default_dshp_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struttura della tabella `wp_dashboard_configs`
--

CREATE TABLE `wp_dashboard_configs` (
  `dshp_id` int NOT NULL,
  `dshp_name` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dshp_description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `dshp_wp` int NOT NULL,
  `dshp_usr` int NOT NULL,
  `dshp_show` tinyint NOT NULL DEFAULT '1',
  `dshp_share` tinyint NOT NULL DEFAULT '1',
  `dshp_cfg` json NOT NULL,
  `dshp_ico` mediumblob,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indici per le tabelle scaricate
--

--
-- Indici per le tabelle `a11y_feedback`
--
ALTER TABLE `a11y_feedback`
  ADD PRIMARY KEY (`fb_id`),
  ADD KEY `idx_fb_status` (`fb_status`,`fb_created_at`);

--
-- Indici per le tabelle `activity_log`
--
ALTER TABLE `activity_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_al_user_id` (`user_id`),
  ADD KEY `idx_al_action` (`action`),
  ADD KEY `idx_al_created_at` (`created_at`),
  ADD KEY `idx_al_entity` (`entity_type`,`entity_id`);

--
-- Indici per le tabelle `app`
--
ALTER TABLE `app`
  ADD PRIMARY KEY (`app_id`),
  ADD UNIQUE KEY `uk_app_cod` (`app_cod`);

--
-- Indici per le tabelle `authors_flows`
--
ALTER TABLE `authors_flows`
  ADD UNIQUE KEY `uq_obj_auth` (`flow_id`,`auth_id`),
  ADD KEY `idx_auth` (`auth_id`);

--
-- Indici per le tabelle `authors_models`
--
ALTER TABLE `authors_models`
  ADD UNIQUE KEY `uq_mod_auth` (`mod_id`,`auth_id`),
  ADD KEY `idx_auth` (`auth_id`);

--
-- Indici per le tabelle `authors_objects`
--
ALTER TABLE `authors_objects`
  ADD UNIQUE KEY `uq_obj_auth` (`obj_id`,`auth_id`),
  ADD KEY `idx_auth` (`auth_id`);

--
-- Indici per le tabelle `cap_grants`
--
ALTER TABLE `cap_grants`
  ADD PRIMARY KEY (`profile_id`,`kind`,`ref`);

--
-- Indici per le tabelle `cap_profiles`
--
ALTER TABLE `cap_profiles`
  ADD PRIMARY KEY (`profile_id`),
  ADD UNIQUE KEY `uk_profile_name` (`profile_name`);

--
-- Indici per le tabelle `csp_reports`
--
ALTER TABLE `csp_reports`
  ADD PRIMARY KEY (`csp_id`),
  ADD UNIQUE KEY `uk_csp` (`directive`,`blocked`,`page`);

--
-- Indici per le tabelle `drawings_osd_pjs`
--
ALTER TABLE `drawings_osd_pjs`
  ADD PRIMARY KEY (`dwg_id`);

--
-- Indici per le tabelle `email_verification_tokens`
--
ALTER TABLE `email_verification_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_token` (`token`),
  ADD KEY `fk_evt_user` (`user_id`);

--
-- Indici per le tabelle `events`
--
ALTER TABLE `events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_events_wp_id_id` (`wp_id`,`id`),
  ADD KEY `idx_events_topic_id` (`topic`,`id`),
  ADD KEY `idx_events_created_at` (`created_at`);

--
-- Indici per le tabelle `fle_library_nodes`
--
ALTER TABLE `fle_library_nodes`
  ADD PRIMARY KEY (`lib_id`),
  ADD UNIQUE KEY `uk_lib_version` (`lib_category`,`lib_name`,`lib_version`);

--
-- Indici per le tabelle `flows`
--
ALTER TABLE `flows`
  ADD PRIMARY KEY (`flow_id`),
  ADD KEY `idx_flows_wp` (`flow_wp`);

--
-- Indici per le tabelle `flow_validations`
--
ALTER TABLE `flow_validations`
  ADD PRIMARY KEY (`val_id`),
  ADD KEY `idx_fv_flow_hash` (`flow_id`,`flow_hash`);

--
-- Indici per le tabelle `folders`
--
ALTER TABLE `folders`
  ADD PRIMARY KEY (`folder_id`),
  ADD UNIQUE KEY `uq_folders_parent_name` (`folder_parent_id`,`folder_name`),
  ADD KEY `idx_folders_parent` (`folder_parent_id`);

--
-- Indici per le tabelle `guest_access_log`
--
ALTER TABLE `guest_access_log`
  ADD PRIMARY KEY (`ga_id`),
  ADD KEY `idx_ga_created` (`created_at`),
  ADD KEY `idx_ga_who` (`provider`,`subject`);

--
-- Indici per le tabelle `json_template`
--
ALTER TABLE `json_template`
  ADD PRIMARY KEY (`template_id`);

--
-- Indici per le tabelle `models`
--
ALTER TABLE `models`
  ADD PRIMARY KEY (`mod_id`);

--
-- Indici per le tabelle `mod_spec_templates`
--
ALTER TABLE `mod_spec_templates`
  ADD PRIMARY KEY (`tpl_id`),
  ADD KEY `idx_tpl_app` (`app_cod`,`tpl_sort`);

--
-- Indici per le tabelle `objects`
--
ALTER TABLE `objects`
  ADD PRIMARY KEY (`obj_id`);

--
-- Indici per le tabelle `object_flows_connections`
--
ALTER TABLE `object_flows_connections`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_flow_target` (`flow_id`,`target_id`),
  ADD KEY `idx_ofc_target` (`flow_type`,`target_id`);

--
-- Indici per le tabelle `object_models_connections`
--
ALTER TABLE `object_models_connections`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_obj_mod` (`obj_id`,`mod_id`);

--
-- Indici per le tabelle `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  ADD PRIMARY KEY (`prt_id`),
  ADD UNIQUE KEY `uq_prt_token` (`token_hash`),
  ADD KEY `idx_prt_user` (`user_id`,`created_at`),
  ADD KEY `idx_prt_ip` (`request_ip`,`created_at`);

--
-- Indici per le tabelle `pdf_highlights`
--
ALTER TABLE `pdf_highlights`
  ADD PRIMARY KEY (`hl_id`),
  ADD KEY `idx_hl_mod` (`mod_id`),
  ADD KEY `idx_hl_page` (`mod_id`,`hl_page`),
  ADD KEY `fk_hl_type` (`hlt_id`);
ALTER TABLE `pdf_highlights` ADD FULLTEXT KEY `ft_hl` (`hl_text`,`hl_label`,`hl_note`,`hl_tags`);

--
-- Indici per le tabelle `pdf_highlights_type`
--
ALTER TABLE `pdf_highlights_type`
  ADD PRIMARY KEY (`hlt_id`);

--
-- Indici per le tabelle `researches`
--
ALTER TABLE `researches`
  ADD PRIMARY KEY (`res_id`);

--
-- Indici per le tabelle `res_res_permissions`
--
ALTER TABLE `res_res_permissions`
  ADD PRIMARY KEY (`res_requester`,`res_granter`);

--
-- Indici per le tabelle `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Indici per le tabelle `users_cap_profiles`
--
ALTER TABLE `users_cap_profiles`
  ADD PRIMARY KEY (`user_id`,`profile_id`),
  ADD KEY `idx_ucp_profile` (`profile_id`);

--
-- Indici per le tabelle `users_identities`
--
ALTER TABLE `users_identities`
  ADD PRIMARY KEY (`provider`,`subject`),
  ADD KEY `idx_ui_user` (`user_id`);

--
-- Indici per le tabelle `users_res_permissions`
--
ALTER TABLE `users_res_permissions`
  ADD PRIMARY KEY (`user_id`,`res_id`);

--
-- Indici per le tabelle `users_sessions`
--
ALTER TABLE `users_sessions`
  ADD PRIMARY KEY (`session_id`),
  ADD KEY `idx_us_user_id` (`user_id`),
  ADD KEY `idx_us_last_activity` (`last_activity`);

--
-- Indici per le tabelle `users_wp_permissions`
--
ALTER TABLE `users_wp_permissions`
  ADD PRIMARY KEY (`user_id`,`wp_id`);

--
-- Indici per le tabelle `workpackages`
--
ALTER TABLE `workpackages`
  ADD PRIMARY KEY (`wp_id`);

--
-- Indici per le tabelle `wp_dashboard_configs`
--
ALTER TABLE `wp_dashboard_configs`
  ADD PRIMARY KEY (`dshp_id`),
  ADD KEY `idx_dshp_wp` (`dshp_wp`),
  ADD KEY `idx_dshp_usr` (`dshp_usr`);

--
-- AUTO_INCREMENT per le tabelle scaricate
--

--
-- AUTO_INCREMENT per la tabella `a11y_feedback`
--
ALTER TABLE `a11y_feedback`
  MODIFY `fb_id` int UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `activity_log`
--
ALTER TABLE `activity_log`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `app`
--
ALTER TABLE `app`
  MODIFY `app_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `cap_profiles`
--
ALTER TABLE `cap_profiles`
  MODIFY `profile_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `csp_reports`
--
ALTER TABLE `csp_reports`
  MODIFY `csp_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `drawings_osd_pjs`
--
ALTER TABLE `drawings_osd_pjs`
  MODIFY `dwg_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `email_verification_tokens`
--
ALTER TABLE `email_verification_tokens`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `events`
--
ALTER TABLE `events`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `fle_library_nodes`
--
ALTER TABLE `fle_library_nodes`
  MODIFY `lib_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `flows`
--
ALTER TABLE `flows`
  MODIFY `flow_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `flow_validations`
--
ALTER TABLE `flow_validations`
  MODIFY `val_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `folders`
--
ALTER TABLE `folders`
  MODIFY `folder_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `guest_access_log`
--
ALTER TABLE `guest_access_log`
  MODIFY `ga_id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `json_template`
--
ALTER TABLE `json_template`
  MODIFY `template_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `models`
--
ALTER TABLE `models`
  MODIFY `mod_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `mod_spec_templates`
--
ALTER TABLE `mod_spec_templates`
  MODIFY `tpl_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `objects`
--
ALTER TABLE `objects`
  MODIFY `obj_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `object_flows_connections`
--
ALTER TABLE `object_flows_connections`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `object_models_connections`
--
ALTER TABLE `object_models_connections`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  MODIFY `prt_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `pdf_highlights`
--
ALTER TABLE `pdf_highlights`
  MODIFY `hl_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `pdf_highlights_type`
--
ALTER TABLE `pdf_highlights_type`
  MODIFY `hlt_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `researches`
--
ALTER TABLE `researches`
  MODIFY `res_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `users`
--
ALTER TABLE `users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `workpackages`
--
ALTER TABLE `workpackages`
  MODIFY `wp_id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT per la tabella `wp_dashboard_configs`
--
ALTER TABLE `wp_dashboard_configs`
  MODIFY `dshp_id` int NOT NULL AUTO_INCREMENT;

--
-- Limiti per le tabelle scaricate
--

--
-- Limiti per la tabella `cap_grants`
--
ALTER TABLE `cap_grants`
  ADD CONSTRAINT `fk_cap_grants_profile` FOREIGN KEY (`profile_id`) REFERENCES `cap_profiles` (`profile_id`) ON DELETE CASCADE;

--
-- Limiti per la tabella `flow_validations`
--
ALTER TABLE `flow_validations`
  ADD CONSTRAINT `fk_fv_flow` FOREIGN KEY (`flow_id`) REFERENCES `flows` (`flow_id`) ON DELETE CASCADE;

--
-- Limiti per la tabella `folders`
--
ALTER TABLE `folders`
  ADD CONSTRAINT `fk_folders_parent` FOREIGN KEY (`folder_parent_id`) REFERENCES `folders` (`folder_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

--
-- Limiti per la tabella `object_flows_connections`
--
ALTER TABLE `object_flows_connections`
  ADD CONSTRAINT `fk_ofc_flow` FOREIGN KEY (`flow_id`) REFERENCES `flows` (`flow_id`) ON DELETE CASCADE;

--
-- Limiti per la tabella `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  ADD CONSTRAINT `fk_prt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Limiti per la tabella `pdf_highlights`
--
ALTER TABLE `pdf_highlights`
  ADD CONSTRAINT `fk_hl_type` FOREIGN KEY (`hlt_id`) REFERENCES `pdf_highlights_type` (`hlt_id`);

--
-- Limiti per la tabella `users_cap_profiles`
--
ALTER TABLE `users_cap_profiles`
  ADD CONSTRAINT `fk_ucp_profile` FOREIGN KEY (`profile_id`) REFERENCES `cap_profiles` (`profile_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ucp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Limiti per la tabella `users_identities`
--
ALTER TABLE `users_identities`
  ADD CONSTRAINT `fk_ui_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
