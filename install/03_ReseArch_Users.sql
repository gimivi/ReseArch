-- =============================================================================
-- ReseArch - 03 - Utente MySQL dell'applicazione e amministratore
-- =============================================================================
-- Due parti indipendenti, da eseguire in momenti diversi:
--
--   PARTE A - utente MySQL con cui PHP si collega al database
--             (solo su server propri: VM, NAS, ... ; su hosting condiviso
--              l'utente è creato dal provider e questa parte si salta)
--
--   PARTE B - promozione del primo utente dell'app ad amministratore ('X')
--             (dopo che l'utente si è registrato da register.php)
--
-- Sostituire i valori tra <...> prima di eseguire.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PARTE A - Utente MySQL dedicato all'applicazione (privilegi minimi)
-- -----------------------------------------------------------------------------
-- Eseguire come root / amministratore di MySQL.
-- L'app ha bisogno SOLO di leggere e scrivere righe: niente DROP, ALTER, GRANT.
-- Le modifiche di struttura (script 01, migrazioni in sql/) si eseguono con
-- l'utente amministratore di MySQL, non con questo.
--
-- '<host_app>' = da dove si collega PHP:
--   'localhost'  se MySQL e web server sono sulla stessa macchina
--   l'IP del web server se MySQL è su un'altra macchina
--   MAI '%' (qualsiasi host) se MySQL è raggiungibile da Internet.
--
-- Stesso nome utente e password vanno in cfg/cfg_MYSQL.php ('user', 'pass').

CREATE USER '<utente_app>'@'<host_app>' IDENTIFIED BY '<password_robusta>';

-- Database principale (db_main)
GRANT SELECT, INSERT, UPDATE, DELETE ON `ReseArch`.* TO '<utente_app>'@'<host_app>';

-- Database opzionali, solo se configurati in cfg/cfg_MYSQL.php:
--   db_data    : tabelle degli oggetti MYS (api/grid.php)
--   db_HySpace : dati di HySpace (api/hys_*.php)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `<db_data>`.*    TO '<utente_app>'@'<host_app>';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `<db_HySpace>`.* TO '<utente_app>'@'<host_app>';

FLUSH PRIVILEGES;


-- -----------------------------------------------------------------------------
-- PARTE B - Primo amministratore dell'applicazione
-- -----------------------------------------------------------------------------
-- La password degli utenti è un hash bcrypt generato da PHP (password_hash):
-- non si può scrivere direttamente in SQL. Procedura:
--   1) aprire <url_app>/register.php e registrarsi con l'email dell'amministratore
--      (se l'invio dell'email di verifica fallisce l'utente viene creato comunque)
--   2) eseguire qui sotto, con la stessa email: verifica l'account e lo rende 'X'
--   3) fare login da <url_app>/index.html

UPDATE `users`
   SET `is_verified` = 1,
       `user_type`   = 'X'
 WHERE `email` = '<email_amministratore>';

-- Controllo: deve restituire una riga con user_type = 'X' e is_verified = 1
SELECT `id`, `email`, `user_type`, `is_verified` FROM `users` WHERE `email` = '<email_amministratore>';
