<?php
// cfg/cfg_MYSQL.example.php — MODELLO della connessione MySQL.
// Copiarlo in cfg/cfg_MYSQL.php (escluso da git: contiene la password) e compilarlo.
// Utente MySQL con i soli privilegi SELECT/INSERT/UPDATE/DELETE (install/03_ReseArch_Users.sql).
return [
    'host'       => 'localhost',
    'port'       => 3306,
    'db_main'    => 'ReseArch',   // database della piattaforma (install/01-05)
    'db_data'    => '',           // database con le tabelle dei progetti (App MYS, cfg/grid_schema.php)
    'db_HySpace' => '',           // database di HySpace (facoltativo)
    'user'       => '',
    'pass'       => '',
    'charset'    => 'utf8mb4',
];
