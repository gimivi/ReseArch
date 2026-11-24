<?php
// cfg/grid_schema.example.php — MODELLO dell'elenco delle tabelle leggibili dall'App MYS.
//
// Copiarlo in cfg/grid_schema.php (escluso da git: ogni installazione ha le sue tabelle)
// e scrivere una voce per ogni tabella del database dei dati ('db_data' in cfg_MYSQL.php).
// Una tabella che non è in questo elenco non si può leggere (api/grid.php risponde 403).
//
// columns:    campi SELECT consentiti ('*' = tutti)
// filterable: campi WHERE  consentiti ('*' = tutti)
// sortable:   campi ORDER  consentiti ('*' = tutti)
// writable:   true  = INSERT / UPDATE / DELETE abilitati
// id:         nome del campo chiave primaria (per UPDATE / DELETE)
// maxLimit:   limite massimo righe per singola query
// db:         (facoltativo) nome del database della tabella, quando non è 'db_data': serve
//             alle installazioni con più database di progetto. L'utente MySQL deve avere
//             i privilegi anche su quel database. Esempio: "db" => "altro_database",
//
// Il modello MYS indica la tabella in mod_spec.table.

return [

  // Esempio
  "Esempio_Luoghi" => [
    "id"         => "id",
    "columns"    => ["id", "Nome", "Citta", "Anno", "Latitudine", "Longitudine"],
    "filterable" => ["Nome", "Citta", "Anno"],
    "sortable"   => ["id", "Nome", "Anno"],
    "maxLimit"   => 1000,
    "writable"   => false,
  ],

];
